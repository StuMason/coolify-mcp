/**
 * Integration tests for the Coolify v4.2 GET-to-POST compatibility work (#292 / #296).
 *
 * That work was built by reading upstream's `routes/api.php` at v4.1.2, v4.0.0
 * and older betas, and shipped without ever being run against a pre-4.2
 * instance. These tests close that gap: on Coolify < 4.2 they prove the legacy
 * path is genuinely needed, and on >= 4.2 they prove POST is genuinely accepted.
 * Either way the suite asserts something real.
 *
 * **Every assertion here is side-effect free**, and deliberately so:
 *
 * - A method the router rejects executes no controller, so a real POST probe
 *   starts, stops and deploys nothing. That is the same property the fallback
 *   itself relies on.
 * - `/deploy` with a tag matching no resource routes successfully and then
 *   deploys nothing, isolating "was the method accepted" from "did anything
 *   happen".
 * - `/enable` is only ever called on an instance whose API is already on, where
 *   it is a no-op. **`/disable` is never called at all** — it would turn off the
 *   API this client depends on, and it proves nothing that `/enable` and
 *   `/servers/{uuid}/validate` do not already prove.
 *
 * That guarantee is downstream of the version compare being correct, which is
 * why `parseMajorMinor` returns a tuple — `Number('4.10')` is `4.1`, which would
 * classify a 4.10 instance as pre-4.2 and point state-changing probes at a box
 * that accepts them.
 *
 * Run with: npm run test:integration
 */

import { it, expect } from '@jest/globals';
import {
  COOLIFY_URL,
  COOLIFY_TOKEN,
  hasCredentials,
  warnIfSkipped,
  describeIf,
  makeClient,
  resolveVersion,
  atLeast,
  V4_2,
} from './helpers.js';

warnIfSkipped('v42-compat.integration');

const client = makeClient();

let version: [number, number] = [0, 0];
if (hasCredentials) {
  const resolvedVersion = await resolveVersion(client);
  version = resolvedVersion.version;
  const rawVersion = resolvedVersion.raw;
  console.warn(
    `\n[v42-compat.integration] Coolify ${rawVersion} — asserting the ` +
      `${atLeast(version, V4_2) ? 'v4.2 POST-only' : 'pre-4.2 GET-only'} behaviour.\n`,
  );
}

const resolved = version[0] > 0;
const isPre42 = resolved && !atLeast(version, V4_2);
const is42Plus = resolved && atLeast(version, V4_2);

/**
 * Statuses that mean "the router refused this method, nothing ran".
 *
 * 404 as well as 405, because Coolify ends `routes/api.php` with
 * `Route::any('/{any}', ...)` returning 404 "Not found.", which swallows an
 * unmatched method+path before Laravel can raise a 405. That catch-all is still
 * the last route on v4.2, so it applies in both directions.
 */
const METHOD_REJECTED = [404, 405];

/** Issue a raw request, bypassing the client's fallback entirely. */
async function rawProbe(
  path: string,
  method: 'GET' | 'POST',
): Promise<{ status: number; routed: boolean }> {
  const response = await fetch(`${COOLIFY_URL}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
    },
  });
  const body: unknown = await response.json().catch(() => ({}));

  // Status alone cannot answer "did the router accept this method": Coolify's
  // catch-all and a controller's own "not found" are both 404. The catch-all
  // adds a `docs` key, and no controller response carries it — the same
  // signature the client's fallback keys off.
  const isCatchAll =
    response.status === 404 && typeof body === 'object' && body !== null && 'docs' in body;

  return { status: response.status, routed: !isCatchAll && response.status !== 405 };
}

async function rawStatus(path: string, method: 'GET' | 'POST'): Promise<number> {
  return (await rawProbe(path, method)).status;
}

describeIf(hasCredentials)('v4.2 method compatibility', () => {
  it('resolved the instance version, so a skip below is a real skip', () => {
    expect(resolved).toBe(true);
  });

  describeIf(isPre42)('on a pre-4.2 instance', () => {
    // The premise of the whole fallback: these are GET-only before v4.2, so a
    // blanket switch to POST would have broken every instance like this one.
    it('rejects POST on /enable without executing anything', async () => {
      const status = await rawStatus('/enable', 'POST');

      expect(METHOD_REJECTED).toContain(status);
    }, 30_000);

    it('rejects POST on /servers/{uuid}/validate without running a validation', async () => {
      const servers = await client.listServers();
      expect(servers.length).toBeGreaterThan(0);

      // Rejected at routing, so no validation job ran against a real server.
      const status = await rawStatus(`/servers/${servers[0].uuid}/validate`, 'POST');

      expect(METHOD_REJECTED).toContain(status);
    }, 30_000);

    // The other half of #296: these were `Route::match(['get','post'])` well
    // before v4.2, so they send POST unconditionally with no fallback. If that
    // were wrong, this instance would reject them.
    it('accepts POST on /deploy, so the unconditional POST is correct', async () => {
      // The tag matches nothing, so the controller answers 404 "no resource
      // found" — which is the point: reaching the controller at all proves the
      // method was routed, and nothing was deployed. Asserting on status alone
      // would confuse that with the router rejecting POST.
      const { routed } = await rawProbe(
        '/deploy?tag=coolify-mcp-compat-probe-no-such-tag&force=false',
        'POST',
      );

      expect(routed).toBe(true);
    }, 30_000);

    it('accepts GET on /enable, which is why the fallback lands', async () => {
      const status = await rawStatus('/enable', 'GET');

      expect(status).toBeLessThan(400);
    }, 30_000);

    it('drives the real client through POST-then-GET and succeeds', async () => {
      // The end-to-end proof. On this instance the POST comes back 404 from the
      // catch-all, not 405 — handling only 405 is exactly what broke this path
      // in 2.15.0. Idempotent: the API is already enabled.
      await expect(client.enableApi()).resolves.toBeDefined();
    }, 30_000);
  });

  describeIf(is42Plus)('on a v4.2+ instance', () => {
    it('accepts POST on /enable without needing the fallback', async () => {
      const status = await rawStatus('/enable', 'POST');

      // Not merely "not 405" — a 404 would satisfy that while proving the
      // opposite of acceptance.
      expect(status).toBeLessThan(400);
    }, 30_000);

    it('rejects the legacy GET on /enable', async () => {
      // v4.2 registers a `post_required` handler returning 405, but the
      // catch-all is still the last route in the file, so 404 is possible too.
      // The point is that GET no longer works, not which rejection it is.
      const status = await rawStatus('/enable', 'GET');

      expect(METHOD_REJECTED).toContain(status);
    }, 30_000);

    it('drives the real client, which should succeed on the first POST', async () => {
      await expect(client.enableApi()).resolves.toBeDefined();
    }, 30_000);
  });
});
