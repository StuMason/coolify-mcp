/**
 * Integration tests for diagnostic tools.
 *
 * These tests hit the real Coolify API to verify diagnostic methods work correctly.
 * They are skipped in CI and should be run manually when testing against a real instance.
 *
 * Prerequisites:
 * - COOLIFY_URL and COOLIFY_TOKEN environment variables set (from .env)
 * - Access to a running Coolify instance
 *
 * Run with: npm run test:integration
 */

import { config } from 'dotenv';
import { CoolifyClient } from '../../lib/coolify-client.js';

// Load environment variables from .env file
config();

const COOLIFY_URL = process.env.COOLIFY_URL;
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN;

// Skip all tests if environment variables are not set
const shouldRun = COOLIFY_URL && COOLIFY_TOKEN;

// Test data - UUIDs from actual infrastructure
// These should be updated to match your test environment
const TEST_DATA = {
  // Server: coolify-apps (running, reachable)
  SERVER_UUID: 'ggkk8w4c08gw48oowsg4g0oc',
  // Application: test-system (running)
  APP_UUID_HEALTHY: 'xs0sgs4gog044s4k4c88kgsc',
  // Application: Bumnail Benerator (exited:unhealthy)
  APP_UUID_UNHEALTHY: 't444wg40s4kkwcc04s084wgw',
};

const describeFn = shouldRun ? describe : describe.skip;

describeFn('Diagnostic Integration Tests', () => {
  let client: CoolifyClient;

  beforeAll(() => {
    if (!COOLIFY_URL || !COOLIFY_TOKEN) {
      throw new Error('COOLIFY_URL and COOLIFY_TOKEN must be set for integration tests');
    }
    client = new CoolifyClient({
      baseUrl: COOLIFY_URL,
      accessToken: COOLIFY_TOKEN,
    });
  });

  describe('diagnoseApplication', () => {
    it('should return diagnostic data for a healthy application', async () => {
      const result = await client.diagnoseApplication(TEST_DATA.APP_UUID_HEALTHY);

      // Should have application info
      expect(result.application).not.toBeNull();
      expect(result.application?.uuid).toBe(TEST_DATA.APP_UUID_HEALTHY);
      expect(result.application?.name).toBeDefined();

      // Should have health assessment
      expect(result.health).toBeDefined();
      expect(['healthy', 'unhealthy', 'unknown']).toContain(result.health.status);

      // Should have environment variables (even if empty)
      expect(result.environment_variables).toBeDefined();
      expect(typeof result.environment_variables.count).toBe('number');
      expect(Array.isArray(result.environment_variables.variables)).toBe(true);

      // Values should be hidden (only key and is_build_time exposed)
      if (result.environment_variables.variables.length > 0) {
        const firstVar = result.environment_variables.variables[0];
        expect(firstVar).toHaveProperty('key');
        expect(firstVar).toHaveProperty('is_build_time');
        expect(firstVar).not.toHaveProperty('value');
      }

      // Should have recent deployments array
      expect(Array.isArray(result.recent_deployments)).toBe(true);

      // Should not have errors if all calls succeeded
      // (errors array might be present if some endpoints failed)
      console.log('Healthy app diagnostic result:', JSON.stringify(result, null, 2));
    }, 30000);

    it('should detect issues in an unhealthy application', async () => {
      const result = await client.diagnoseApplication(TEST_DATA.APP_UUID_UNHEALTHY);

      expect(result.application).not.toBeNull();

      // Should detect unhealthy status
      if (
        result.application?.status?.includes('exited') ||
        result.application?.status?.includes('unhealthy')
      ) {
        expect(result.health.status).toBe('unhealthy');
        expect(result.health.issues.length).toBeGreaterThan(0);
      }

      console.log('Unhealthy app diagnostic result:', JSON.stringify(result, null, 2));
    }, 30000);

    it('should handle non-existent application gracefully', async () => {
      const result = await client.diagnoseApplication('non-existent-uuid');

      // Should have errors but not throw
      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.application).toBeNull();
    }, 30000);
  });

  describe('diagnoseServer', () => {
    it('should return diagnostic data for a server', async () => {
      const result = await client.diagnoseServer(TEST_DATA.SERVER_UUID);

      // Should have server info
      expect(result.server).not.toBeNull();
      expect(result.server?.uuid).toBe(TEST_DATA.SERVER_UUID);
      expect(result.server?.name).toBeDefined();
      expect(result.server?.ip).toBeDefined();

      // Should have health assessment
      expect(result.health).toBeDefined();
      expect(['healthy', 'unhealthy', 'unknown']).toContain(result.health.status);

      // Should have resources array
      expect(Array.isArray(result.resources)).toBe(true);

      // Should have domains array
      expect(Array.isArray(result.domains)).toBe(true);

      // Should have validation result
      expect(result.validation).toBeDefined();

      console.log('Server diagnostic result:', JSON.stringify(result, null, 2));
    }, 30000);

    it('should handle non-existent server gracefully', async () => {
      const result = await client.diagnoseServer('non-existent-uuid');

      expect(result.errors).toBeDefined();
      expect(result.errors!.length).toBeGreaterThan(0);
      expect(result.server).toBeNull();
    }, 30000);
  });

  describe('findInfrastructureIssues', () => {
    it('should return infrastructure issues report', async () => {
      const result = await client.findInfrastructureIssues();

      // Should have summary
      expect(result.summary).toBeDefined();
      expect(typeof result.summary.total_issues).toBe('number');
      expect(typeof result.summary.unhealthy_applications).toBe('number');
      expect(typeof result.summary.unhealthy_databases).toBe('number');
      expect(typeof result.summary.unhealthy_services).toBe('number');
      expect(typeof result.summary.unreachable_servers).toBe('number');

      // Should have issues array
      expect(Array.isArray(result.issues)).toBe(true);

      // Each issue should have required fields
      for (const issue of result.issues) {
        expect(['application', 'database', 'service', 'server']).toContain(issue.type);
        expect(issue.uuid).toBeDefined();
        expect(issue.name).toBeDefined();
        expect(issue.issue).toBeDefined();
        expect(issue.status).toBeDefined();
      }

      // Summary counts should match issues array
      expect(result.summary.total_issues).toBe(result.issues.length);

      console.log('Infrastructure issues report:', JSON.stringify(result, null, 2));
    }, 60000);
  });
});
