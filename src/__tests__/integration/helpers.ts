/**
 * Shared setup for the integration suites.
 *
 * Not a `*.test.ts` file, so `--testPathPattern`/`--testPathPatterns=integration` does not try to
 * collect it as a suite.
 */

import { config } from 'dotenv';
import { CoolifyClient } from '../../lib/coolify-client.js';

// override: true because an empty COOLIFY_URL in the ambient environment
// otherwise wins over .env and silently skips every test — and a skipped suite
// reads exactly like a passing one, which is the failure these tests exist to
// catch.
config({ override: true });

/** Trailing slashes produce `//api/v1/...`, which Coolify's catch-all 404s — making every "method rejected" assertion pass for the wrong reason. */
export const COOLIFY_URL = process.env.COOLIFY_URL?.replace(/\/+$/, '');
export const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;

export const hasCredentials = Boolean(COOLIFY_URL && COOLIFY_TOKEN);

export function warnIfSkipped(suite: string): void {
  if (!hasCredentials) {
    console.warn(
      `\n[${suite}] SKIPPED — COOLIFY_URL and COOLIFY_TOKEN are not set. ` +
        'Nothing was verified against a real Coolify.\n',
    );
  }
}

export const describeIf = (condition: boolean) =>
  condition ? global.describe : global.describe.skip;

export function makeClient(): CoolifyClient {
  return hasCredentials
    ? new CoolifyClient({
        baseUrl: COOLIFY_URL as string,
        accessToken: COOLIFY_TOKEN as string,
      })
    : (null as unknown as CoolifyClient);
}

/**
 * Parsed `major.minor`. Returned as a tuple rather than a float because
 * `Number('4.10')` is `4.1`, which compares as *older* than 4.2 — and the
 * pre-4.2 branch of the compat suite issues real state-changing probes, so a
 * mis-parse there is not a cosmetic bug.
 */
export function parseMajorMinor(version: string): [number, number] {
  const match = /^v?(\d+)\.(\d+)/.exec(version);
  return match ? [Number(match[1]), Number(match[2])] : [0, 0];
}

export function atLeast(actual: [number, number], target: [number, number]): boolean {
  return actual[0] > target[0] || (actual[0] === target[0] && actual[1] >= target[1]);
}

export const V4_2: [number, number] = [4, 2];

/** Resolve the instance version, or `[0, 0]` if it cannot be read. */
export async function resolveVersion(
  client: CoolifyClient,
): Promise<{ version: [number, number]; raw: string }> {
  try {
    const { version } = await client.getVersion();
    return { version: parseMajorMinor(version), raw: version };
  } catch {
    return { version: [0, 0], raw: 'unknown' };
  }
}
