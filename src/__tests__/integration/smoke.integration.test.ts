/**
 * Smoke integration tests — quick sanity checks against a real Coolify instance.
 *
 * Run with: npm run test:integration
 *
 * Prerequisites:
 * - COOLIFY_URL and COOLIFY_TOKEN environment variables set (from .env)
 * - Access to a running Coolify instance
 *
 * NOTE: These tests make real API calls. The error handling tests rely on the
 * API rejecting invalid input (nonexistent project_uuid). If Coolify changes
 * its validation behaviour, these tests may need updating.
 */

import { config } from 'dotenv';
import { CoolifyClient } from '../../lib/coolify-client.js';

config();

const COOLIFY_URL = process.env.COOLIFY_URL;
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;
const shouldRun = COOLIFY_URL && COOLIFY_TOKEN;
const describeFn = shouldRun ? describe : describe.skip;

describeFn('Smoke Integration Tests', () => {
  let client: CoolifyClient;

  beforeAll(() => {
    if (!COOLIFY_URL || !COOLIFY_TOKEN) {
      throw new Error('COOLIFY_URL and COOLIFY_TOKEN must be set');
    }
    client = new CoolifyClient({
      baseUrl: COOLIFY_URL,
      accessToken: COOLIFY_TOKEN,
    });
  });

  describe('connectivity', () => {
    it('should connect to Coolify API', async () => {
      const version = await client.getVersion();
      expect(version).toBeDefined();
    }, 10000);
  });

  describe('database env var masking (#276)', () => {
    it('masks database env var values by default and reveals with reveal=true', async () => {
      const databases = await client.listDatabases();
      if (databases.length === 0) {
        console.warn('No databases on instance — skipping database env var masking smoke test');
        return;
      }

      const uuid = databases[0].uuid;
      const masked = await client.listDatabaseEnvVars(uuid);
      const revealed = await client.listDatabaseEnvVars(uuid, { reveal: true });

      if (masked.length === 0) {
        console.warn(`Database ${uuid} has no env vars — skipping masking assertions`);
        return;
      }

      // Default (no reveal): every value must be the mask sentinel, never plaintext.
      for (const v of masked) {
        expect(v.value).toBe('***');
        if ('real_value' in v && v.real_value !== undefined) {
          expect(v.real_value).toBe('***');
        }
      }

      // reveal=true: at least one value should differ from the mask (real secret).
      expect(revealed.some((v) => v.value !== '***')).toBe(true);
    }, 15000);
  });

  describe('error handling', () => {
    it('should handle validation errors with string messages (issue #107)', async () => {
      // Creating a service with docker_compose_raw but no type triggers
      // a validation error where Coolify returns string values, not arrays.
      const servers = await client.listServers();
      expect(servers.length).toBeGreaterThan(0);

      await expect(
        client.createService({
          server_uuid: servers[0].uuid,
          project_uuid: 'nonexistent',
          environment_name: 'production',
          docker_compose_raw: 'services:\n  test:\n    image: nginx',
        }),
      ).rejects.toThrow(/./); // Should throw a readable error, not crash
    }, 15000);

    it('should produce a readable error message from string validation errors', async () => {
      const servers = await client.listServers();

      try {
        await client.createService({
          server_uuid: servers[0].uuid,
          project_uuid: 'nonexistent',
          environment_name: 'production',
          docker_compose_raw: 'services:\n  test:\n    image: nginx',
        });
        throw new Error('Expected a validation error to be thrown');
      } catch (e) {
        const msg = (e as Error).message;
        // Should NOT contain "join is not a function"
        expect(msg).not.toContain('join is not a function');
        // Should contain something useful
        expect(msg.length).toBeGreaterThan(0);
      }
    }, 15000);
  });
});
