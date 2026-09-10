/**
 * Instance registry (#367): the named Coolify instances this server manages.
 *
 * Single-instance configs (COOLIFY_BASE_URL + COOLIFY_ACCESS_TOKEN) are a
 * registry of one, named "default", and behave exactly as before — no new
 * tool arguments, no new output. COOLIFY_INSTANCES (a JSON array) adds more;
 * only then does the fleet surface appear.
 *
 * Trust model, decided on #367 ("option 1"): a fleet is ONE trust domain.
 * Every instance in a registry belongs to the same owner. Agencies with a
 * Coolify per client run one server per client; per-instance OAuth scopes
 * are a 3.2 concern, not something this registry pretends to solve.
 *
 * Errors thrown here name the entry and the problem, never a value.
 */

import { mergeCfAccessHeaders } from './startup-check.js';
import type { CoolifyConfig } from '../types/coolify.js';

/**
 * An intersection rather than `interface ... extends`, because `CoolifyConfig`
 * is a union expressing "a token, or a token file" and an interface cannot
 * extend a union.
 */
export type InstanceDefinition = CoolifyConfig & {
  /** Unique, used as the tools' `instance` argument. */
  name: string;
};

/** `instance: "all"` is a fan-out selector on the tools that support it, never a name. */
export const ALL_INSTANCES = 'all';

export const DEFAULT_INSTANCE_NAME = 'default';

export class UnknownInstanceError extends Error {
  constructor(requested: string, known: string[]) {
    // The requested name is model-supplied text: cap it so a hostile or
    // runaway argument cannot balloon the error, and quote it so the shape
    // of the mistake is visible.
    const shown = requested.length > 40 ? `${requested.slice(0, 40)}…` : requested;
    super(`Unknown instance "${shown}". Configured instances: ${known.join(', ')}`);
    this.name = 'UnknownInstanceError';
  }
}

export class InstanceRegistry {
  private readonly byName = new Map<string, InstanceDefinition>();

  constructor(instances: InstanceDefinition[]) {
    if (instances.length === 0) {
      throw new Error('No Coolify instance configured');
    }
    for (const instance of instances) {
      if (this.byName.has(instance.name)) {
        throw new Error(`Instance name "${instance.name}" is configured twice`);
      }
      this.byName.set(instance.name, instance);
    }
  }

  /** The first configured instance — what an omitted `instance` argument means. */
  get default(): InstanceDefinition {
    return this.byName.values().next().value as InstanceDefinition;
  }

  get all(): InstanceDefinition[] {
    return [...this.byName.values()];
  }

  get names(): string[] {
    return [...this.byName.keys()];
  }

  /** True once there is anything to choose between — the fleet surface's switch. */
  get isFleet(): boolean {
    return this.byName.size > 1;
  }

  /** Resolve an `instance` argument; undefined means the default. */
  get(name?: string): InstanceDefinition {
    if (name === undefined || name === '') return this.default;
    const found = this.byName.get(name);
    if (!found) throw new UnknownInstanceError(name, this.names);
    return found;
  }
}

/** One entry of the COOLIFY_INSTANCES JSON array. */
interface RawInstance {
  name?: unknown;
  url?: unknown;
  token?: unknown;
  headers?: unknown;
}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

function parseInstancesJson(raw: string): InstanceDefinition[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(
      'COOLIFY_INSTANCES is not valid JSON. Expected an array like [{"name":"prod","url":"https://coolify.example.com","token":"..."}]',
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('COOLIFY_INSTANCES must be a JSON array of {name, url, token} objects');
  }
  return parsed.map((entry: RawInstance, index) => {
    const where = `COOLIFY_INSTANCES[${index}]`;
    if (typeof entry !== 'object' || entry === null) {
      throw new Error(`${where} is not an object`);
    }
    const { name, url, token, headers } = entry;
    if (typeof name !== 'string' || !NAME_PATTERN.test(name)) {
      throw new Error(
        `${where} needs a "name": letters, digits, "_", "-" or "." (max 64 chars), starting with a letter or digit`,
      );
    }
    if (name === ALL_INSTANCES) {
      throw new Error(`${where}: "${ALL_INSTANCES}" is reserved as the fan-out selector`);
    }
    if (typeof url !== 'string' || !/^https?:\/\//.test(url)) {
      throw new Error(`${where} ("${name}") needs a "url" starting with http:// or https://`);
    }
    if (typeof token !== 'string' || token === '') {
      throw new Error(`${where} ("${name}") needs a "token"`);
    }
    if (token.includes('${')) {
      throw new Error(
        `${where} ("${name}") token contains an unexpanded \${VAR} placeholder — set the real value`,
      );
    }
    let customHeaders: Record<string, string> | undefined;
    if (headers !== undefined) {
      if (typeof headers !== 'object' || headers === null || Array.isArray(headers)) {
        throw new Error(`${where} ("${name}") "headers" must be an object of header name → value`);
      }
      customHeaders = {};
      for (const [key, value] of Object.entries(headers as Record<string, unknown>)) {
        if (typeof value !== 'string') {
          throw new Error(`${where} ("${name}") header "${key}" must be a string`);
        }
        customHeaders[key] = value;
      }
    }
    return { name, baseUrl: url.replace(/\/$/, ''), accessToken: token, customHeaders };
  });
}

/**
 * Build the registry from the environment.
 *
 * COOLIFY_BASE_URL / COOLIFY_ACCESS_TOKEN (with the CF Access pair and any
 * CLI `--header` flags) define the "default" instance and come first, so an
 * existing single-instance config keeps its meaning when COOLIFY_INSTANCES
 * is added alongside it. With only COOLIFY_INSTANCES set, its first entry is
 * the default.
 */
export function registryFromEnv(
  env: NodeJS.ProcessEnv,
  cliHeaders: Record<string, string> = {},
): InstanceRegistry {
  const instances: InstanceDefinition[] = [];
  // Either source satisfies the requirement: the file is read at construction,
  // so a config with only COOLIFY_ACCESS_TOKEN_FILE is complete (#398).
  if (env.COOLIFY_BASE_URL && (env.COOLIFY_ACCESS_TOKEN || env.COOLIFY_ACCESS_TOKEN_FILE)) {
    const merged = mergeCfAccessHeaders(env, cliHeaders);
    instances.push({
      name: DEFAULT_INSTANCE_NAME,
      baseUrl: env.COOLIFY_BASE_URL.replace(/\/$/, ''),
      accessToken: env.COOLIFY_ACCESS_TOKEN ?? '',
      accessTokenFile: env.COOLIFY_ACCESS_TOKEN_FILE,
      customHeaders: Object.keys(merged).length > 0 ? merged : undefined,
    });
  }
  if (env.COOLIFY_INSTANCES) {
    instances.push(...parseInstancesJson(env.COOLIFY_INSTANCES));
  }
  return new InstanceRegistry(instances);
}
