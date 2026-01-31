/**
 * Smoke integration tests — quick sanity checks against a real Coolify instance.
 *
 * Run with: npm run test:integration
 *
 * Prerequisites:
 * - COOLIFY_URL and COOLIFY_TOKEN environment variables set (from .env)
 * - Access to a running Coolify instance
 */

import { createRequire } from 'module';
import { config } from 'dotenv';
import { CoolifyClient } from '../../lib/coolify-client.js';
import { VERSION } from '../../lib/mcp-server.js';

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

  describe('version', () => {
    it('should match package.json', () => {
      const _require = createRequire(import.meta.url);
      const { version } = _require('../../../package.json');
      expect(VERSION).toBe(version);
    });

    it('should connect to Coolify API', async () => {
      const version = await client.getVersion();
      expect(version).toBeDefined();
    }, 10000);
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
        fail('Expected an error to be thrown');
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
