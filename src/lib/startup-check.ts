/**
 * Startup config self-check (#368, first slice) + Cloudflare Access service
 * token pairing rule (#373).
 *
 * Both entry points run this before serving anything, because most "the MCP
 * is broken" reports are the environment handing us garbage and saying
 * nothing: a macOS Keychain that stored the literal string
 * `${COOLIFY_ACCESS_TOKEN}` cost one team their whole integration
 * (pedrorezendefig/hospital-reunioes#312) when a single stderr line would
 * have kept them.
 *
 * Iron rule: messages name the variable and describe the shape of the
 * problem. They never contain the value — a malformed token is still a
 * token.
 */

import { mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export interface StartupCheckResult {
  /** Fatal: the server must refuse to start and print these. */
  errors: string[];
  /** Suspicious but survivable: print to stderr and carry on. */
  warnings: string[];
}

/**
 * The env vars whose values we sanity-check, per transport. Secrets among
 * them are only ever described, never echoed. MCP_PUBLIC_URL and MCP_HOST
 * are HTTP-only: stdio never reads them, so a broken value there (say, a
 * shared .env with an unexpanded Coolify magic var) must not stop a stdio
 * server that would run fine.
 */
const CHECKED_VARS = {
  stdio: [
    'COOLIFY_BASE_URL',
    'COOLIFY_UI_URL',
    'COOLIFY_ACCESS_TOKEN',
    'CF_ACCESS_CLIENT_ID',
    'CF_ACCESS_CLIENT_SECRET',
  ],
  http: [
    'COOLIFY_BASE_URL',
    'COOLIFY_UI_URL',
    'COOLIFY_ACCESS_TOKEN',
    'MCP_PUBLIC_URL',
    'MCP_HOST',
    'MCP_REQUEST_STATE_KEY',
    'CF_ACCESS_CLIENT_ID',
    'CF_ACCESS_CLIENT_SECRET',
  ],
} as const;

export type Transport = keyof typeof CHECKED_VARS;

/**
 * An unexpanded shell/launcher placeholder: the whole value is `${VAR}`,
 * `$VAR`, or contains a `${` that no launcher expanded. Real Coolify tokens
 * and URLs never contain `${`.
 */
function looksUnexpanded(value: string): boolean {
  return value.includes('${') || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(value);
}

/**
 * The characters that actually make fetch() throw in a header value: NUL, CR
 * and LF — and only where they survive the fetch spec's normalization, which
 * strips *outer* whitespace from the composed header value first. Verified
 * against undici. Everything else (tabs, other control bytes) is legal.
 */

const HEADER_BREAKING = /[\0\r\n]/;

/**
 * Whether a base URL is only reachable from inside a container network: a
 * single-label hostname other than localhost (`http://coolify:8080`). A
 * dashboard link built on it opens nowhere (#342). Localhost and private IPs
 * are not counted: they open fine in the browser on the same machine or LAN.
 */
export function looksInternalBaseUrl(url: string): boolean {
  try {
    const host = new URL(url).hostname;
    return host !== 'localhost' && !host.includes('.') && !host.includes(':');
  } catch {
    return false;
  }
}

export function checkStartupConfig(
  env: NodeJS.ProcessEnv,
  transport: Transport,
): StartupCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of CHECKED_VARS[transport]) {
    const value = env[name];
    if (value !== undefined && value !== '' && looksUnexpanded(value)) {
      errors.push(
        `${name} contains an unexpanded \${VAR} placeholder — the literal text reached this process instead of the value. ` +
          `macOS Keychain entries and some launchers do this. Set the real value directly. ` +
          `(If your real value genuinely contains "\${", open an issue — no known Coolify credential or URL does.)`,
      );
    }
  }

  const token = env.COOLIFY_ACCESS_TOKEN;
  if (token !== undefined && token !== '' && !looksUnexpanded(token)) {
    checkTokenShape('COOLIFY_ACCESS_TOKEN', token, errors);
  }

  for (const name of ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'] as const) {
    const value = env[name];
    if (value !== undefined && value !== '' && !looksUnexpanded(value)) {
      checkHeaderValueShape(name, value, errors);
    }
  }

  checkUiUrlShape(
    { ui: 'COOLIFY_UI_URL', base: 'COOLIFY_BASE_URL' },
    env.COOLIFY_UI_URL,
    env.COOLIFY_BASE_URL,
    errors,
    warnings,
  );

  // A key too short to sign with is a boot-time shape problem, not something to
  // discover once per request when a confirmation fails deep inside a tool call
  // (#341). The codec throws on it; this says so while the operator is still
  // looking at the terminal.
  const stateKey = env.MCP_REQUEST_STATE_KEY;
  if (stateKey !== undefined && stateKey !== '' && !looksUnexpanded(stateKey)) {
    if (Buffer.byteLength(stateKey, 'utf8') < 32) {
      errors.push(
        'MCP_REQUEST_STATE_KEY is shorter than 32 bytes, which is the minimum for the HMAC that ' +
          'signs destructive-confirmation state. Generate one with: openssl rand -hex 32',
      );
    }
  }

  const baseUrl = env.COOLIFY_BASE_URL;
  if (baseUrl !== undefined && baseUrl !== '' && !looksUnexpanded(baseUrl)) {
    checkBaseUrlShape('COOLIFY_BASE_URL', baseUrl, errors, warnings);
  }

  // Cloudflare Access service tokens (#373) come as a pair or not at all:
  // one without the other means every request either fails Access or sends a
  // half-credential, and neither failure names itself at the far end.
  const cfId = env.CF_ACCESS_CLIENT_ID;
  const cfSecret = env.CF_ACCESS_CLIENT_SECRET;
  if (Boolean(cfId) !== Boolean(cfSecret)) {
    const missing = cfId ? 'CF_ACCESS_CLIENT_SECRET' : 'CF_ACCESS_CLIENT_ID';
    const present = cfId ? 'CF_ACCESS_CLIENT_ID' : 'CF_ACCESS_CLIENT_SECRET';
    errors.push(
      `${present} is set but ${missing} is not. Cloudflare Access service tokens need both, or neither.`,
    );
  }

  checkInstanceEntries(env.COOLIFY_INSTANCES, errors, warnings);

  return { errors, warnings };
}

/**
 * The same shape checks, per `COOLIFY_INSTANCES` entry (#383). Without them a
 * pasted line break or a doubled `/api/v1` in one entry passed the parser and
 * failed at that instance's first call, long after startup.
 *
 * JSON that does not parse, or an entry missing a field, is left to
 * `registryFromEnv`, which refuses it with its own message; this only looks at
 * the fields that are present and are strings. Labels carry the index and the
 * name, never a value.
 */
function checkInstanceEntries(raw: string | undefined, errors: string[], warnings: string[]): void {
  if (!raw) return;
  let entries: unknown;
  try {
    entries = JSON.parse(raw);
  } catch {
    return;
  }
  if (!Array.isArray(entries)) return;
  entries.forEach((entry: unknown, index) => {
    if (typeof entry !== 'object' || entry === null) return;
    const { name, url, ui_url: uiUrl, token, headers } = entry as Record<string, unknown>;
    const where = `COOLIFY_INSTANCES[${index}]${typeof name === 'string' ? ` ("${name}")` : ''}`;
    const usable = (value: unknown, label: string): value is string => {
      if (typeof value !== 'string' || value === '') return false;
      if (looksUnexpanded(value)) {
        errors.push(`${label} contains an unexpanded \${VAR} placeholder. Set the real value.`);
        return false;
      }
      return true;
    };
    if (usable(url, `${where} url`)) {
      checkBaseUrlShape(`${where} url`, url, errors, warnings);
    }
    checkUiUrlShape(
      { ui: `${where} ui_url`, base: `${where} url` },
      typeof uiUrl === 'string' ? uiUrl : undefined,
      typeof url === 'string' ? url : undefined,
      errors,
      warnings,
    );
    if (usable(token, `${where} token`)) {
      checkTokenShape(`${where} token`, token, errors);
    }
    if (typeof headers === 'object' && headers !== null && !Array.isArray(headers)) {
      for (const [key, value] of Object.entries(headers)) {
        if (usable(value, `${where} header "${key}"`)) {
          checkHeaderValueShape(`${where} header "${key}"`, value, errors);
        }
      }
    }
  });
}

/**
 * A token is sent as `Bearer <value>`, so header normalization applies to the
 * *composed* value (verified against undici): trailing whitespace is stripped
 * and works, so say nothing about it; leading whitespace survives as
 * `Bearer  <token>` and 401s every call; NUL/CR/LF anywhere before the
 * trailing run makes fetch throw before sending.
 */
function checkTokenShape(label: string, token: string, errors: string[]): void {
  const core = token.replace(/\s+$/, '');
  if (HEADER_BREAKING.test(core)) {
    errors.push(
      `${label} contains a line break or NUL — every request would fail before it is even sent. ` +
        'Re-paste the token without it.',
    );
  } else if (/^[ \t]/.test(core)) {
    errors.push(
      `${label} has leading whitespace, which becomes part of the credential — ` +
        'Coolify rejects every request with 401. Re-paste the token without it.',
    );
  }
}

/**
 * A whole header value (the CF Access pair, a fleet entry's headers), where
 * outer whitespace is normalized away harmlessly — only an interior line break
 * or NUL breaks fetch, and it breaks every Coolify request at once.
 */
function checkHeaderValueShape(label: string, value: string, errors: string[]): void {
  if (HEADER_BREAKING.test(value.trim())) {
    errors.push(
      `${label} contains a line break or NUL — every request to Coolify would fail before it is even sent. ` +
        'Re-paste it without it.',
    );
  }
}

/**
 * Dashboard links (#342): a UI URL that is not a URL makes every link dead
 * while still claiming to be configured, and an internal base URL without one
 * makes them open nowhere.
 */
function checkUiUrlShape(
  labels: { ui: string; base: string },
  uiUrl: string | undefined,
  baseUrl: string | undefined,
  errors: string[],
  warnings: string[],
): void {
  if (uiUrl !== undefined && uiUrl !== '' && !looksUnexpanded(uiUrl)) {
    if (!/^https?:\/\//.test(uiUrl)) {
      errors.push(`${labels.ui} must start with http:// or https://`);
    }
  } else if (!uiUrl && baseUrl && looksInternalBaseUrl(baseUrl)) {
    warnings.push(
      `${labels.base} is an internal address and ${labels.ui} is unset, so coolify_url links will not open in a browser. ` +
        `Set ${labels.ui} to the dashboard address.`,
    );
  }
}

function checkBaseUrlShape(
  label: string,
  baseUrl: string,
  errors: string[],
  warnings: string[],
): void {
  let parsed: URL | undefined;
  try {
    parsed = new URL(baseUrl);
  } catch {
    errors.push(
      `${label} is not a usable URL (a missing http:// or https:// scheme is the usual cause). ` +
        'Set it to your Coolify URL, e.g. https://coolify.example.com',
    );
  }
  if (!parsed) return;
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    errors.push(`${label} has scheme "${parsed.protocol}" — it must be http or https.`);
  } else if (/\/api\/v1\/?$/.test(parsed.pathname)) {
    // Guaranteed 404 on every call — the server appends /api/v1 itself.
    errors.push(
      `${label} ends with /api/v1. The server appends /api/v1 itself, so every request ` +
        'would hit /api/v1/api/v1 and 404. Set it to the bare Coolify URL.',
    );
  } else if (/\/api\/?$/.test(parsed.pathname)) {
    // Could conceivably be a deliberate proxy prefix, so only a warning.
    warnings.push(
      `${label} ends with /api. The server appends /api/v1 itself — unless this is a ` +
        'deliberate proxy prefix, set it to the bare Coolify URL.',
    );
  }
}

/** Where HTTP mode keeps OAuth state unless `MCP_OAUTH_STATE_FILE` says otherwise. */
export const DEFAULT_OAUTH_STATE_FILE = '/data/oauth-state.json';

/**
 * Make sure the OAuth state file can actually be written (#417), or say why not.
 *
 * The default path lives under `/data`, which the image creates and mounts as
 * a volume. Run `dist/http.js` on a workstation instead and that directory
 * does not exist, or exists and belongs to root. Nothing noticed until the
 * first client registration, when the debounced write threw from a timer
 * and took the process with it: `POST /register` had already answered 201.
 *
 * This asks the same question at boot, and it asks it for real: the
 * directory is created if missing (the write path has always done that), and
 * the temp file the provider writes is written and removed. A real write
 * rather than access(2) because a stale `.tmp` left by another user passes
 * an access check and fails every write, and because access(2) disagrees
 * with ACLs, NFS and Windows. The one side effect is the directory, which is
 * left behind even when boot then fails for another reason; every problem
 * still reports in one boot, which matters more.
 *
 * Returns the problem to list with the other reasons the server cannot
 * start, or undefined when the path is usable. `configured` picks the
 * message: the operator who typed the path is told the path, the one who
 * typed nothing is told where the default comes from.
 */
export function ensureStateFileWritable(file: string, configured: boolean): string | undefined {
  if (file === '') return undefined; // In-memory, as the provider treats it.
  const dir = dirname(file);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const tmp = `${file}.tmp`;
    writeFileSync(tmp, '', { mode: 0o600 });
    unlinkSync(tmp);
    return undefined;
  } catch (error) {
    // fs errors already read "EACCES: permission denied, mkdir '/data'":
    // the code, the operation and the path, which is the whole diagnosis.
    const cause = (error as Error).message;
    return configured
      ? `MCP_OAUTH_STATE_FILE points at ${file}, but this process cannot write there (${cause}). ` +
          'Set it to a path this user can write, e.g. ./oauth-state.json'
      : `The OAuth state file defaults to ${file}, and this process cannot write there (${cause}). ` +
          'That default only exists inside the container image. Outside it, set MCP_OAUTH_STATE_FILE ' +
          'to a path this user can write, e.g. MCP_OAUTH_STATE_FILE=./oauth-state.json';
  }
}

/**
 * The Cloudflare Access service-token headers (#373), when configured.
 *
 * These must only ever ride on requests to the Coolify base URL. They are
 * returned as customHeaders for CoolifyClient — which by construction talks
 * only to the base URL — and handed to the tier-2 proof-of-access fetch,
 * which targets the same host. Never attach them to any other fetch.
 */
export function cfAccessHeaders(env: NodeJS.ProcessEnv): Record<string, string> | undefined {
  const id = env.CF_ACCESS_CLIENT_ID;
  const secret = env.CF_ACCESS_CLIENT_SECRET;
  if (!id || !secret) return undefined;
  return {
    'CF-Access-Client-Id': id,
    'CF-Access-Client-Secret': secret,
  };
}

/**
 * Merge env-derived CF Access headers with CLI `--header` flags, CLI winning.
 *
 * Header names are case-insensitive on the wire, so the override has to be
 * too: without this, `--header "cf-access-client-id: x"` would produce a
 * second distinct key and fetch would send both values comma-joined —
 * rejected by Access with no indication why.
 */
export function mergeCfAccessHeaders(
  env: NodeJS.ProcessEnv,
  cliHeaders: Record<string, string>,
): Record<string, string> {
  const cliKeys = new Set(Object.keys(cliHeaders).map((key) => key.toLowerCase()));
  const fromEnv = Object.entries(cfAccessHeaders(env) ?? {}).filter(
    ([key]) => !cliKeys.has(key.toLowerCase()),
  );
  return { ...Object.fromEntries(fromEnv), ...cliHeaders };
}
