/**
 * Integration tests for the log endpoints added in #300.
 *
 * These exist because parts of this feature could not be verified from a
 * development sandbox. `GET /applications/{uuid}/logs` was confirmed against a
 * live instance to return `{ logs: "..." }` rather than a bare string, but
 * upstream's OpenAPI types the service sub-resource listings as an untyped
 * `array of object`, so the real shape of `/services/{uuid}/applications` and
 * `/services/{uuid}/databases` is unconfirmed — as is whether the
 * `sub_service_name` values they yield are accepted by `/services/{uuid}/logs`.
 *
 * Run these against a real Coolify before trusting the service paths:
 *   npm run test:integration
 *
 * Prerequisites:
 * - COOLIFY_URL and COOLIFY_TOKEN set (from .env)
 * - TEST_APPLICATION_UUID / TEST_DATABASE_UUID / TEST_SERVICE_UUID set to
 *   resources on that instance. Each block skips if its uuid is absent.
 */

import { config } from 'dotenv';
import { describe, it, expect } from '@jest/globals';
import { CoolifyClient } from '../../lib/coolify-client.js';

// override: true because an empty COOLIFY_URL in the ambient environment
// otherwise wins over .env and silently skips every test — a skipped suite
// reads like a passing one, which is the failure mode these tests exist to
// avoid.
config({ override: true });

const COOLIFY_URL = process.env.COOLIFY_URL;
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const APPLICATION_UUID = process.env.TEST_APPLICATION_UUID;
const DATABASE_UUID = process.env.TEST_DATABASE_UUID;
const SERVICE_UUID = process.env.TEST_SERVICE_UUID;

const shouldRun = Boolean(COOLIFY_URL && COOLIFY_TOKEN);

if (!shouldRun) {
  console.warn(
    '\n[logs.integration] SKIPPED — COOLIFY_URL and COOLIFY_TOKEN are not set. ' +
      'Nothing was verified against a real Coolify.\n',
  );
}

/**
 * Endpoints under test here landed in Coolify v4.2. On an older instance they
 * 404, which is correct behaviour rather than a defect — but an ungated test
 * reports that as a failure and sends you looking for a bug that is not there.
 * Resolved once from the live instance so the suite can say which it is.
 */
const V4_2 = 4.2;

function parseMajorMinor(version: string): number {
  const match = /^v?(\d+)\.(\d+)/.exec(version);
  return match ? Number(`${match[1]}.${match[2]}`) : 0;
}

const client = shouldRun
  ? new CoolifyClient({ baseUrl: COOLIFY_URL as string, accessToken: COOLIFY_TOKEN as string })
  : (null as unknown as CoolifyClient);

// Resolved at module scope, before jest collects the suites, so version-gated
// blocks can be genuinely SKIPPED rather than passing via an early return.
// A test that returns early still reports a green tick, which is precisely the
// false-confidence these tests exist to prevent.
let instanceVersion = 0;
if (shouldRun) {
  try {
    const { version } = await client.getVersion();
    instanceVersion = parseMajorMinor(version);
    if (instanceVersion < V4_2) {
      console.warn(
        `\n[logs.integration] Coolify ${version} predates v4.2 — the database and ` +
          'service log endpoints do not exist on it yet, so those suites are SKIPPED, ' +
          'not verified. Re-run after upgrading.\n',
      );
    }
  } catch (error) {
    console.warn(
      `\n[logs.integration] Could not read the Coolify version (${(error as Error).message}). ` +
        'Version-gated suites will be skipped.\n',
    );
  }
}
const supportsV42 = instanceVersion >= V4_2;

const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

describeIf(shouldRun)('logs integration', () => {
  it('resolved the instance version, so a skip below is a real skip', () => {
    expect(instanceVersion).toBeGreaterThan(0);
  });
  describeIf(Boolean(APPLICATION_UUID))('application logs', () => {
    it('returns a plain string, not the raw { logs } envelope', async () => {
      const logs = await client.getApplicationLogs(APPLICATION_UUID as string, 5);

      // The whole point of the unwrapping in #300 — a caller must be able to do
      // string work on this without it silently being an object.
      expect(typeof logs).toBe('string');
      expect(logs).not.toContain('{"logs"');
    }, 30_000);

    it('accepts show_timestamps without erroring', async () => {
      const logs = await client.getApplicationLogs(APPLICATION_UUID as string, 5, true);
      expect(typeof logs).toBe('string');
    }, 30_000);
  });

  describeIf(Boolean(DATABASE_UUID) && supportsV42)('database logs (Coolify v4.2+)', () => {
    it('returns a plain string', async () => {
      const logs = await client.getDatabaseLogs(DATABASE_UUID as string, 5);
      expect(typeof logs).toBe('string');
    }, 30_000);
  });

  describeIf(Boolean(SERVICE_UUID) && supportsV42)('service containers (Coolify v4.2+)', () => {
    it('lists the containers inside a service with usable names', async () => {
      const [applications, databases] = await Promise.all([
        client.listServiceApplications(SERVICE_UUID as string),
        client.listServiceDatabases(SERVICE_UUID as string),
      ]);

      expect(Array.isArray(applications)).toBe(true);
      expect(Array.isArray(databases)).toBe(true);

      // The shape assumption this whole feature rests on: every container has a
      // `name`, because that is what `logs` passes as `sub_service_name`.
      for (const container of [...applications, ...databases]) {
        expect(typeof container.name).toBe('string');
        expect(container.name.length).toBeGreaterThan(0);
      }
    }, 30_000);

    it('fetches logs for a container discovered from that listing', async () => {
      const applications = await client.listServiceApplications(SERVICE_UUID as string);
      const databases = await client.listServiceDatabases(SERVICE_UUID as string);
      const container = [...applications, ...databases][0];

      if (!container) {
        console.warn('Service has no containers — skipping the round-trip assertion');
        return;
      }

      // Closes the loop: a name from list_containers must be accepted by the
      // logs endpoint. If this fails, discovery and retrieval disagree.
      const logs = await client.getServiceLogs(SERVICE_UUID as string, container.name, 5);
      expect(typeof logs).toBe('string');
    }, 30_000);
  });
});
