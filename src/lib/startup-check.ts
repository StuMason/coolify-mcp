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

export interface StartupCheckResult {
  /** Fatal: the server must refuse to start and print these. */
  errors: string[];
  /** Suspicious but survivable: print to stderr and carry on. */
  warnings: string[];
}

/** The env vars whose values we sanity-check. Secrets among them are only ever described, never echoed. */
const CHECKED_VARS = [
  'COOLIFY_BASE_URL',
  'COOLIFY_ACCESS_TOKEN',
  'MCP_PUBLIC_URL',
  'CF_ACCESS_CLIENT_ID',
  'CF_ACCESS_CLIENT_SECRET',
] as const;

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

export function checkStartupConfig(env: NodeJS.ProcessEnv): StartupCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of CHECKED_VARS) {
    const value = env[name];
    if (value !== undefined && value !== '' && looksUnexpanded(value)) {
      errors.push(
        `${name} contains an unexpanded \${VAR} placeholder — the literal text reached this process instead of the value. ` +
          `macOS Keychain entries and some launchers do this. Set the real value directly. ` +
          `(If your real value genuinely contains "\${", open an issue — no known Coolify credential or URL does.)`,
      );
    }
  }

  // COOLIFY_ACCESS_TOKEN is sent as `Bearer <value>`, so header normalization
  // applies to the *composed* value (verified against undici): trailing
  // whitespace is stripped and works — say nothing about it; leading
  // whitespace survives as `Bearer  <token>` and 401s every call; NUL/CR/LF
  // anywhere before the trailing run makes fetch throw before sending.
  const token = env.COOLIFY_ACCESS_TOKEN;
  if (token !== undefined && token !== '' && !looksUnexpanded(token)) {
    const core = token.replace(/\s+$/, '');
    if (HEADER_BREAKING.test(core)) {
      errors.push(
        'COOLIFY_ACCESS_TOKEN contains a line break or NUL — every request would fail before it is even sent. ' +
          'Re-paste the token without it.',
      );
    } else if (/^[ \t]/.test(core)) {
      errors.push(
        'COOLIFY_ACCESS_TOKEN has leading whitespace, which becomes part of the credential — ' +
          'Coolify rejects every request with 401. Re-paste the token without it.',
      );
    }
  }

  // The CF Access pair are sent as whole header values, where outer
  // whitespace is normalized away harmlessly — only an interior line break
  // or NUL breaks fetch, and it breaks every Coolify request at once.
  for (const name of ['CF_ACCESS_CLIENT_ID', 'CF_ACCESS_CLIENT_SECRET'] as const) {
    const value = env[name];
    if (value !== undefined && value !== '' && !looksUnexpanded(value)) {
      if (HEADER_BREAKING.test(value.trim())) {
        errors.push(
          `${name} contains a line break or NUL — every request to Coolify would fail before it is even sent. ` +
            'Re-paste it without it.',
        );
      }
    }
  }

  const baseUrl = env.COOLIFY_BASE_URL;
  if (baseUrl !== undefined && baseUrl !== '' && !looksUnexpanded(baseUrl)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(baseUrl);
    } catch {
      errors.push(
        'COOLIFY_BASE_URL is not a usable URL (a missing http:// or https:// scheme is the usual cause). ' +
          'Set it to your Coolify URL, e.g. https://coolify.example.com',
      );
    }
    if (parsed) {
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`COOLIFY_BASE_URL has scheme "${parsed.protocol}" — it must be http or https.`);
      } else if (/\/api\/v1\/?$/.test(parsed.pathname)) {
        // Guaranteed 404 on every call — the server appends /api/v1 itself.
        errors.push(
          'COOLIFY_BASE_URL ends with /api/v1. The server appends /api/v1 itself, so every request ' +
            'would hit /api/v1/api/v1 and 404. Set it to the bare Coolify URL.',
        );
      } else if (/\/api\/?$/.test(parsed.pathname)) {
        // Could conceivably be a deliberate proxy prefix, so only a warning.
        warnings.push(
          'COOLIFY_BASE_URL ends with /api. The server appends /api/v1 itself — unless this is a ' +
            'deliberate proxy prefix, set it to the bare Coolify URL.',
        );
      }
    }
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

  return { errors, warnings };
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
