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

/** Characters that are illegal in an HTTP header value — fetch() throws on them. */
function hasControlChars(value: string): boolean {
  // eslint-disable-next-line no-control-regex
  return /[\x00-\x1f\x7f]/.test(value);
}

export function checkStartupConfig(env: NodeJS.ProcessEnv): StartupCheckResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const name of CHECKED_VARS) {
    const value = env[name];
    if (value !== undefined && value !== '' && looksUnexpanded(value)) {
      errors.push(
        `${name} contains an unexpanded \${VAR} placeholder — the literal text reached this process instead of the value. ` +
          `macOS Keychain entries and some launchers do this. Set the real value directly.`,
      );
    }
  }

  const token = env.COOLIFY_ACCESS_TOKEN;
  if (token !== undefined && token !== '' && !looksUnexpanded(token)) {
    if (hasControlChars(token)) {
      errors.push(
        'COOLIFY_ACCESS_TOKEN contains a control character (usually a copy-pasted newline). ' +
          'Every request would fail before reaching Coolify. Re-paste the token without it.',
      );
    } else if (token !== token.trim()) {
      warnings.push(
        'COOLIFY_ACCESS_TOKEN has leading or trailing whitespace — Coolify will reject it as-is. ' +
          'Re-paste the token without the surrounding space.',
      );
    }
  }

  const baseUrl = env.COOLIFY_BASE_URL;
  if (baseUrl !== undefined && baseUrl !== '' && !looksUnexpanded(baseUrl)) {
    let parsed: URL | undefined;
    try {
      parsed = new URL(baseUrl);
    } catch {
      errors.push(
        `COOLIFY_BASE_URL is not a usable URL. Set it to your Coolify URL, e.g. https://coolify.example.com`,
      );
    }
    if (parsed) {
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        errors.push(`COOLIFY_BASE_URL has scheme "${parsed.protocol}" — it must be http or https.`);
      } else if (/\/api(\/v1)?\/?$/.test(parsed.pathname)) {
        warnings.push(
          'COOLIFY_BASE_URL ends with an API path. The server appends /api/v1 itself, so requests ' +
            'would hit /api/v1 twice and 404. Set it to the bare Coolify URL.',
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
