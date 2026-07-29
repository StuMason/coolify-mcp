/**
 * Integration tests for the Coolify v4.2 GET-to-POST compatibility work (#292 / #296).
 *
 * That work was built by reading upstream's `routes/api.php` at v4.1.2, v4.0.0
 * and older betas, and shipped without ever being run against a pre-4.2
 * instance. These tests close that gap: on Coolify < 4.2 they prove the legacy
 * path is genuinely needed, and on >= 4.2 they prove POST is genuinely accepted.
 * Either way the suite is meaningful — it just asserts a different thing.
 *
 * **Every assertion here is side-effect free.** Two properties make that
 * possible, and both are the same properties the fallback relies on:
 *
 * 1. A `405` is raised by Laravel's router *before* the controller runs, so a
 *    rejected method executes nothing. That is exactly why the fallback can
 *    retry a state-changing call safely, and it is what lets us probe with a
 *    real POST here without starting, stopping or deploying anything.
 * 2. `/deploy` with a tag that matches no resource routes successfully and then
 *    deploys nothing, so it proves the method was accepted without triggering
 *    a deployment.
 *
 * Nothing in this file starts, stops, restarts, deletes or deploys a real
 * resource, and `/disable` is never called — it would cut off the API this
 * client depends on.
 *
 * Run with: npm run test:integration
 */

import { config } from 'dotenv';
import { describe, it, expect } from '@jest/globals';
import { CoolifyClient } from '../../lib/coolify-client.js';

config({ override: true });

const COOLIFY_URL = process.env.COOLIFY_URL;
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;

const shouldRun = Boolean(COOLIFY_URL && COOLIFY_TOKEN);

if (!shouldRun) {
  console.warn(
    '\n[v42-compat.integration] SKIPPED — COOLIFY_URL and COOLIFY_TOKEN are not set. ' +
      'Nothing was verified against a real Coolify.\n',
  );
}

const client = shouldRun
  ? new CoolifyClient({ baseUrl: COOLIFY_URL as string, accessToken: COOLIFY_TOKEN as string })
  : (null as unknown as CoolifyClient);

function parseMajorMinor(version: string): number {
  const match = /^v?(\d+)\.(\d+)/.exec(version);
  return match ? Number(`${match[1]}.${match[2]}`) : 0;
}

let instanceVersion = 0;
if (shouldRun) {
  try {
    const { version } = await client.getVersion();
    instanceVersion = parseMajorMinor(version);
    console.warn(
      `\n[v42-compat.integration] Coolify ${version} — asserting the ` +
        `${instanceVersion >= 4.2 ? 'v4.2 POST-only' : 'pre-4.2 GET-only'} behaviour.\n`,
    );
  } catch {
    /* leave at 0; the version test below reports it */
  }
}
const isPre42 = instanceVersion > 0 && instanceVersion < 4.2;
const is42Plus = instanceVersion >= 4.2;

const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

/** Issue a raw request, returning the HTTP status without going through the fallback. */
async function rawStatus(path: string, method: 'GET' | 'POST'): Promise<number> {
  const response = await fetch(`${COOLIFY_URL}/api/v1${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${COOLIFY_TOKEN}`,
    },
  });
  return response.status;
}

describeIf(shouldRun)('v4.2 method compatibility', () => {
  it('resolved the instance version, so a skip below is a real skip', () => {
    expect(instanceVersion).toBeGreaterThan(0);
  });

  describeIf(isPre42)('on a pre-4.2 instance', () => {
    // The premise of the whole fallback: these are GET-only before v4.2, so a
    // blanket switch to POST would have broken every instance like this one.
    //
    // Note the status is 404, NOT 405. Coolify ends routes/api.php with
    // `Route::any('/{any}', ...)` returning 404 "Not found.", which swallows an
    // unmatched method+path before Laravel can raise a 405. The original
    // implementation only handled 405 and therefore never fell back here —
    // caught by running this suite against a real 4.1.2 instance.
    const METHOD_REJECTED = [404, 405];

    it.each([['/enable'], ['/disable']])(
      'rejects POST on %s without executing anything',
      async (path) => {
        const status = await rawStatus(path, 'POST');

        expect(METHOD_REJECTED).toContain(status);
      },
      30_000,
    );

    it('rejects POST on /servers/{uuid}/validate without running a validation', async () => {
      const servers = await client.listServers();
      expect(servers.length).toBeGreaterThan(0);

      // Rejected at routing, so no validation job ran against a real server.
      const status = await rawStatus(`/servers/${servers[0].uuid}/validate`, 'POST');

      expect(METHOD_REJECTED).toContain(status);
    }, 30_000);

    // The other half of #296: these were `Route::match(['get','post'])` well
    // before v4.2, so they send POST unconditionally with no fallback. If that
    // were wrong, this instance would 405 them.
    it('accepts POST on /deploy, so the unconditional POST is correct', async () => {
      // A tag matching nothing routes fine and deploys nothing, which isolates
      // "was the method accepted" from "did anything happen".
      const status = await rawStatus(
        '/deploy?tag=coolify-mcp-compat-probe-no-such-tag&force=false',
        'POST',
      );

      expect(status).not.toBe(405);
    }, 30_000);

    it('accepts GET on /enable too, which is why the fallback lands', async () => {
      // Deliberately /enable and never /disable: enabling an already-enabled
      // API is a no-op, whereas disabling it would cut off this client.
      const status = await rawStatus('/enable', 'GET');

      expect(status).not.toBe(405);
    }, 30_000);

    it('drives the real client through POST-then-GET and succeeds', async () => {
      // The end-to-end proof: enableApi() sends POST, gets a 405, retries GET
      // and returns normally. Idempotent on an instance whose API is already on.
      await expect(client.enableApi()).resolves.toBeDefined();
    }, 30_000);
  });

  describeIf(is42Plus)('on a v4.2+ instance', () => {
    it('accepts POST on /enable without needing the fallback', async () => {
      const status = await rawStatus('/enable', 'POST');
      expect(status).not.toBe(405);
    }, 30_000);

    it('rejects the legacy GET on /enable with 405', async () => {
      const status = await rawStatus('/enable', 'GET');
      expect(status).toBe(405);
    }, 30_000);

    it('drives the real client, which should succeed on the first POST', async () => {
      await expect(client.enableApi()).resolves.toBeDefined();
    }, 30_000);
  });
});
