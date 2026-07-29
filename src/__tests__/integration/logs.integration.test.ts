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

config();

const COOLIFY_URL = process.env.COOLIFY_URL;
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const APPLICATION_UUID = process.env.TEST_APPLICATION_UUID;
const DATABASE_UUID = process.env.TEST_DATABASE_UUID;
const SERVICE_UUID = process.env.TEST_SERVICE_UUID;

const shouldRun = Boolean(COOLIFY_URL && COOLIFY_TOKEN);

const client = shouldRun
  ? new CoolifyClient({ baseUrl: COOLIFY_URL as string, accessToken: COOLIFY_TOKEN as string })
  : (null as unknown as CoolifyClient);

const describeIf = (condition: boolean) => (condition ? describe : describe.skip);

describeIf(shouldRun)('logs integration', () => {
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

  describeIf(Boolean(DATABASE_UUID))('database logs', () => {
    it('returns a plain string', async () => {
      const logs = await client.getDatabaseLogs(DATABASE_UUID as string, 5);
      expect(typeof logs).toBe('string');
    }, 30_000);
  });

  describeIf(Boolean(SERVICE_UUID))('service containers', () => {
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
