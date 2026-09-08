/**
 * doctor (#368): turns "it's broken" into a one-line fix.
 *
 * Most coolify-mcp failure reports are the environment, not the server — a
 * Keychain that stored `${COOLIFY_ACCESS_TOKEN}` literally, a token missing
 * the `deploy` ability that 403s deep inside a tool call, a Cloudflare
 * Access policy 302ing every API call while /healthz stays green. Doctor
 * runs the checks that turn each of those into a named problem with a fix.
 *
 * Design rules:
 * - Every network probe is side-effect free: GETs only, on endpoints where
 *   Coolify's middleware answers before any controller runs.
 * - Output never contains a secret: variable names and "set"/"unset",
 *   never values. (The upstream 403 message is server-authored text that
 *   names abilities, not credentials.)
 * - Fleet-shaped from day one (#367): checks run per instance over a list,
 *   which today has exactly one entry.
 */

import { checkStartupConfig, cfAccessHeaders, type Transport } from './startup-check.js';

export type DoctorStatus = 'pass' | 'warn' | 'fail' | 'skipped' | 'inconclusive';

export interface DoctorCheck {
  check: string;
  status: DoctorStatus;
  detail: string;
  fix?: string;
}

export interface InstanceReport {
  instance: string;
  checks: DoctorCheck[];
}

export interface DoctorReport {
  ok: boolean;
  instances: InstanceReport[];
}

/** One Coolify instance to examine. The fleet issue (#367) will grow this list. */
interface InstanceConfig {
  name: string;
  baseUrl: string | undefined;
  token: string | undefined;
  headers: Record<string, string>;
}

/**
 * The Coolify versions this release is tested against. Outside the range is
 * a warning, not a failure — the API is mostly stable — but it is the first
 * thing to suspect when something else in the report is red.
 */
const TESTED_RANGE = { min: [4, 0] as const, max: [4, 3] as const, label: '4.0.x – 4.3.x' };

const PROBE_TIMEOUT_MS = 10_000;

type FetchLike = typeof fetch;

function instancesFromEnv(env: NodeJS.ProcessEnv): InstanceConfig[] {
  return [
    {
      name: 'default',
      baseUrl: env.COOLIFY_BASE_URL?.replace(/\/$/, ''),
      token: env.COOLIFY_ACCESS_TOKEN,
      headers: cfAccessHeaders(env) ?? {},
    },
  ];
}

/** The upstream ApiAbility middleware's missing-ability 403 body. */
function missingAbilities(body: unknown): string | undefined {
  const message = (body as { message?: unknown })?.message;
  if (typeof message === 'string' && message.startsWith('Missing required permissions')) {
    return message.replace('Missing required permissions:', '').trim();
  }
  return undefined;
}

/** The upstream Member-role hard block, a distinct 403 body. */
function isMemberBlocked(body: unknown): boolean {
  const message = (body as { message?: unknown })?.message;
  return typeof message === 'string' && message.includes('role as a team member');
}

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

/**
 * Probe one ability via an endpoint gated on it, without params so no
 * controller could act even if it ran. Middleware answers first:
 * a 403 naming the ability means it is missing and nothing executed; any
 * other authenticated answer (405 on v4.2+, 400/404 on older instances
 * where GET was the live route shape) means the gate let us through.
 * Never keyed on 405 and never POST — pre-4.2 answers differently.
 */
async function probeAbility(
  fetchImpl: FetchLike,
  instance: InstanceConfig,
  path: string,
): Promise<'granted' | 'missing' | 'member-blocked' | 'unknown'> {
  try {
    const response = await fetchImpl(`${instance.baseUrl}/api/v1${path}`, {
      headers: {
        ...instance.headers,
        Authorization: `Bearer ${instance.token}`,
        Accept: 'application/json',
      },
      redirect: 'manual',
      signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
    });
    if (response.status === 403) {
      const body = await readJson(response);
      if (missingAbilities(body) !== undefined) return 'missing';
      if (isMemberBlocked(body)) return 'member-blocked';
      return 'unknown';
    }
    return 'granted';
  } catch {
    return 'unknown';
  }
}

async function checkInstance(
  env: NodeJS.ProcessEnv,
  instance: InstanceConfig,
  transport: Transport,
  fetchImpl: FetchLike,
): Promise<InstanceReport> {
  const checks: DoctorCheck[] = [];

  // --- config: required vars present, and shapes sane (#368's first story) ---
  const configProblems: string[] = [];
  if (!instance.baseUrl) configProblems.push('COOLIFY_BASE_URL is unset');
  if (!instance.token) configProblems.push('COOLIFY_ACCESS_TOKEN is unset');
  const shape = checkStartupConfig(env, transport);
  configProblems.push(...shape.errors);
  if (configProblems.length > 0) {
    checks.push({
      check: 'config',
      status: 'fail',
      detail: configProblems.join('; '),
      fix: 'Fix the variables above, then run doctor again',
    });
  } else if (shape.warnings.length > 0) {
    checks.push({ check: 'config', status: 'warn', detail: shape.warnings.join('; ') });
  } else {
    checks.push({
      check: 'config',
      status: 'pass',
      detail: 'COOLIFY_BASE_URL set, COOLIFY_ACCESS_TOKEN set',
    });
  }

  const configBroken = configProblems.length > 0;

  // --- reachability: can this process reach Coolify at all? ---
  // Unauthenticated on purpose: separates "network path broken" from "token
  // rejected". CF Access headers are included — they gate the path itself.
  let reachable = false;
  if (!instance.baseUrl || shape.errors.some((e) => e.includes('COOLIFY_BASE_URL'))) {
    checks.push({ check: 'reachability', status: 'skipped', detail: 'no usable COOLIFY_BASE_URL' });
  } else {
    const started = Date.now();
    try {
      const response = await fetchImpl(`${instance.baseUrl}/api/v1/version`, {
        headers: { ...instance.headers, Accept: 'application/json' },
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      const ms = Date.now() - started;
      const location = response.headers.get('location') ?? '';
      if (response.status >= 300 && response.status < 400) {
        if (location.includes('cloudflareaccess.com')) {
          checks.push({
            check: 'reachability',
            status: 'fail',
            detail: `Cloudflare Access is intercepting requests to Coolify (redirect to the Access login page in ${ms}ms)`,
            fix: 'Set CF_ACCESS_CLIENT_ID and CF_ACCESS_CLIENT_SECRET (an Access service token), or point COOLIFY_BASE_URL at the internal address — see docs/http-mode.md',
          });
        } else {
          checks.push({
            check: 'reachability',
            status: 'warn',
            detail: `COOLIFY_BASE_URL answers with a redirect (HTTP ${response.status})`,
            fix: 'Set COOLIFY_BASE_URL to the final URL so every API call skips the hop',
          });
          reachable = true;
        }
      } else {
        reachable = true;
        checks.push({
          check: 'reachability',
          status: 'pass',
          detail: `Coolify answered in ${ms}ms (HTTP ${response.status})`,
        });
      }
    } catch (error) {
      checks.push({
        check: 'reachability',
        status: 'fail',
        detail: `cannot reach COOLIFY_BASE_URL: ${error instanceof Error ? error.message : 'unknown error'}`,
        fix: 'Check the URL, DNS and firewall. If this runs as a container next to Coolify, use the internal address (see docs/http-mode.md)',
      });
    }
  }

  // --- token + version: one authenticated GET answers both ---
  let coolifyVersion: string | undefined;
  if (configBroken || !reachable || !instance.token) {
    const detail = !instance.token ? 'no token to test' : 'blocked by an earlier failure';
    checks.push({ check: 'token', status: 'skipped', detail });
    checks.push({ check: 'version', status: 'skipped', detail });
  } else {
    try {
      const response = await fetchImpl(`${instance.baseUrl}/api/v1/version`, {
        headers: {
          ...instance.headers,
          Authorization: `Bearer ${instance.token}`,
          Accept: 'application/json',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
      });
      if (response.ok) {
        coolifyVersion = (await response.text()).trim();
        checks.push({ check: 'token', status: 'pass', detail: 'accepted by Coolify' });
      } else if (response.status === 401 || response.status === 400) {
        checks.push({
          check: 'token',
          status: 'fail',
          detail: `Coolify rejected the token (HTTP ${response.status})`,
          fix: 'Create a fresh token under Keys & Tokens → API tokens and re-paste it — a stale, revoked or truncated token is the usual cause',
        });
      } else if (response.status === 403) {
        const body = await readJson(response);
        const missing = missingAbilities(body);
        checks.push({
          check: 'token',
          status: 'fail',
          detail: missing
            ? `token is valid but lacks the "${missing}" ability`
            : isMemberBlocked(body)
              ? 'token is valid but your team role blocks API access'
              : 'Coolify answered 403',
          fix: missing
            ? 'Recreate the token with the read ability (or root)'
            : 'Ask a team admin/owner to issue the token',
        });
      } else {
        checks.push({
          check: 'token',
          status: 'inconclusive',
          detail: `unexpected HTTP ${response.status} from the version endpoint`,
        });
      }
    } catch (error) {
      checks.push({
        check: 'token',
        status: 'inconclusive',
        detail: `probe failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      });
    }

    if (coolifyVersion) {
      const match = /^(\d+)\.(\d+)/.exec(coolifyVersion);
      const inRange =
        match !== null &&
        Number(match[1]) === TESTED_RANGE.min[0] &&
        Number(match[2]) >= TESTED_RANGE.min[1] &&
        Number(match[2]) <= TESTED_RANGE.max[1];
      checks.push({
        check: 'version',
        status: inRange ? 'pass' : 'warn',
        detail: inRange
          ? `Coolify ${coolifyVersion} (inside the tested range ${TESTED_RANGE.label})`
          : `Coolify ${coolifyVersion} is outside the range this release was tested against (${TESTED_RANGE.label})`,
        ...(inRange
          ? {}
          : { fix: 'Probably fine, but suspect this first if another check is red' }),
      });
    } else if (checks[checks.length - 1]?.check === 'token') {
      checks.push({ check: 'version', status: 'skipped', detail: 'token check did not pass' });
    }
  }

  // --- abilities: read is proven by the token check; probe write + deploy ---
  if (!coolifyVersion) {
    checks.push({ check: 'abilities', status: 'skipped', detail: 'token check did not pass' });
  } else {
    const [write, deploy] = await Promise.all([
      probeAbility(fetchImpl, instance, '/enable'),
      probeAbility(fetchImpl, instance, '/deploy'),
    ]);
    const granted = [
      'read',
      write === 'granted' ? 'write' : '',
      deploy === 'granted' ? 'deploy' : '',
    ]
      .filter(Boolean)
      .join(', ');
    const blocked = [write, deploy].includes('member-blocked');
    const missing = [write === 'missing' ? 'write' : '', deploy === 'missing' ? 'deploy' : '']
      .filter(Boolean)
      .join(', ');
    if (blocked) {
      checks.push({
        check: 'abilities',
        status: 'warn',
        detail: `token abilities exceed your team role — writes are blocked upstream (granted: ${granted})`,
        fix: 'Ask a team admin/owner to issue the token, or expect read-only behaviour',
      });
    } else if (missing) {
      checks.push({
        check: 'abilities',
        status: 'warn',
        detail: `token lacks: ${missing} (granted: ${granted}) — the matching tools will 403`,
        fix: 'Recreate the token with those abilities if you need the tools they gate',
      });
    } else {
      checks.push({ check: 'abilities', status: 'pass', detail: `token grants: ${granted}` });
    }
  }

  // --- api-shape: is the routing catch-all still shaped the way our v4.2
  // method fallback detection depends on? (#292's check, running itself) ---
  if (!coolifyVersion) {
    checks.push({ check: 'api-shape', status: 'skipped', detail: 'token check did not pass' });
  } else {
    try {
      const response = await fetchImpl(
        `${instance.baseUrl}/api/v1/doctor-probe-${Date.now().toString(36)}`,
        {
          headers: {
            ...instance.headers,
            Authorization: `Bearer ${instance.token}`,
            Accept: 'application/json',
          },
          redirect: 'manual',
          signal: AbortSignal.timeout(PROBE_TIMEOUT_MS),
        },
      );
      const body = await readJson(response);
      const hasDocsKey = typeof (body as { docs?: unknown })?.docs === 'string';
      if (response.status === 404 && hasDocsKey) {
        checks.push({
          check: 'api-shape',
          status: 'pass',
          detail: 'routing catch-all answers as expected',
        });
      } else {
        checks.push({
          check: 'api-shape',
          status: 'warn',
          detail: `unrouted path answered HTTP ${response.status}${hasDocsKey ? '' : ' without the expected body shape'}`,
          fix: 'A Coolify update may have changed API routing — check for a newer coolify-mcp release',
        });
      }
    } catch {
      checks.push({ check: 'api-shape', status: 'inconclusive', detail: 'probe failed' });
    }
  }

  return { instance: instance.name, checks };
}

export async function runDoctor(
  env: NodeJS.ProcessEnv,
  fetchImpl: FetchLike = fetch,
  nodeVersion: string = process.version,
): Promise<DoctorReport> {
  const transport: Transport = env.MCP_TRANSPORT === 'http' ? 'http' : 'stdio';
  const instances: InstanceReport[] = [];
  for (const instance of instancesFromEnv(env)) {
    instances.push(await checkInstance(env, instance, transport, fetchImpl));
  }
  // runtime is process-wide, not per instance
  const major = Number(nodeVersion.replace(/^v/, '').split('.')[0]);
  instances[0].checks.push({
    check: 'runtime',
    status: major >= 20 ? 'pass' : 'warn',
    detail: `node ${nodeVersion}`,
    ...(major >= 20 ? {} : { fix: 'coolify-mcp is tested on Node 20+' }),
  });

  const ok = instances.every((report) => report.checks.every((c) => c.status !== 'fail'));
  return { ok, instances };
}

const GLYPH: Record<DoctorStatus, string> = {
  pass: '✓',
  warn: '!',
  fail: '✗',
  skipped: '-',
  inconclusive: '?',
};

/** CLI front door: prints the report, returns the process exit code. */
export async function runDoctorCli(
  env: NodeJS.ProcessEnv,
  json: boolean,
  fetchImpl: FetchLike = fetch,
  out: (line: string) => void = console.log,
): Promise<number> {
  const report = await runDoctor(env, fetchImpl);
  if (json) {
    out(JSON.stringify(report, null, 2));
  } else {
    for (const instance of report.instances) {
      out(`coolify-mcp doctor — instance: ${instance.instance}`);
      for (const check of instance.checks) {
        out(`  ${GLYPH[check.status]} ${check.check}: ${check.detail}`);
        if (check.fix) out(`      fix: ${check.fix}`);
      }
    }
    out(report.ok ? 'No failures.' : 'Failures found — fixes listed above.');
  }
  return report.ok ? 0 : 1;
}
