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

import { CoolifyClient } from '../../lib/coolify-client.js';
import type { Application } from '../../types/coolify.js';
import { COOLIFY_URL, COOLIFY_TOKEN, warnIfSkipped } from './helpers.js';

warnIfSkipped('diagnostics.integration');

// Skip all tests if environment variables are not set
const shouldRun = COOLIFY_URL && COOLIFY_TOKEN;

/**
 * Fixtures are discovered from the live instance rather than hardcoded.
 *
 * They used to be literal UUIDs copied off one particular estate, with a
 * comment saying "these should be updated to match your test environment".
 * Nobody ever does. When the estate moved hosts, all three pointed at
 * resources that no longer existed and the suite failed for a reason that had
 * nothing to do with the code under test — which is the worst kind of failure,
 * because the honest reading of a red integration suite is "the client is
 * broken" and the true cause was rotted fixtures.
 *
 * Resolving them at run time means the suite is portable across instances and
 * can only fail for real reasons.
 */
interface Fixtures {
  serverUuid?: string;
  healthyAppUuid?: string;
  /** May legitimately be absent: a healthy estate has no unhealthy app. */
  unhealthyAppUuid?: string;
}

const describeFn = shouldRun ? describe : describe.skip;

describeFn('Diagnostic Integration Tests', () => {
  let client: CoolifyClient;
  const fixtures: Fixtures = {};

  beforeAll(async () => {
    if (!COOLIFY_URL || !COOLIFY_TOKEN) {
      throw new Error('COOLIFY_URL and COOLIFY_TOKEN must be set for integration tests');
    }
    client = new CoolifyClient({
      baseUrl: COOLIFY_URL,
      accessToken: COOLIFY_TOKEN,
    });

    const [servers, apps] = await Promise.all([
      client.listServers(),
      client.listApplications() as Promise<Application[]>,
    ]);
    fixtures.serverUuid = servers[0]?.uuid;
    // Deliberately NOT `isRunningStatus`. That predicate answers "what should
    // `stop_all_apps` target", where over-matching is the safe direction — it
    // treats `exited:unhealthy` as running because 'unhealthy' contains
    // 'healthy'. The question here is the stricter "which application is
    // actually healthy", so that an app in a bad state is not handed to the
    // test asserting healthy diagnostics. Different question, so a different
    // test, not a rival copy of the same one.
    fixtures.healthyAppUuid = apps.find(
      (app) => app.status?.includes('running') && !app.status.includes('unhealthy'),
    )?.uuid;
    fixtures.unhealthyAppUuid = apps.find(
      (app) => app.status?.includes('exited') || app.status?.includes('unhealthy'),
    )?.uuid;

    // Fail here, once, rather than letting each test below dereference an
    // undefined uuid and fail separately against `/applications/undefined`.
    // One honest error beats three confusing ones, and an instance with no
    // servers or no running application cannot verify anything in this suite.
    if (!fixtures.serverUuid || !fixtures.healthyAppUuid) {
      throw new Error(
        `Cannot run diagnostics integration tests against ${COOLIFY_URL}: ` +
          `discovered ${servers.length} servers and ${apps.length} applications, ` +
          `needing at least one server and one healthy running application.`,
      );
    }
  }, 60000);

  describe('diagnoseApplication', () => {
    it('should return diagnostic data for a healthy application', async () => {
      const result = await client.diagnoseApplication(fixtures.healthyAppUuid!);

      // Should have application info
      expect(result.application).not.toBeNull();
      expect(result.application?.uuid).toBe(fixtures.healthyAppUuid);
      expect(result.application?.name).toBeDefined();

      // Should have health assessment
      expect(result.health).toBeDefined();
      expect(['healthy', 'unhealthy', 'unknown']).toContain(result.health.status);

      // Should have environment variables (even if empty)
      expect(result.environment_variables).toBeDefined();
      expect(typeof result.environment_variables.count).toBe('number');
      expect(Array.isArray(result.environment_variables.variables)).toBe(true);

      // Values should be hidden (only key, is_buildtime, is_runtime exposed)
      if (result.environment_variables.variables.length > 0) {
        const firstVar = result.environment_variables.variables[0];
        expect(firstVar).toHaveProperty('key');
        expect(firstVar).toHaveProperty('is_buildtime');
        expect(firstVar).toHaveProperty('is_runtime');
        expect(firstVar).not.toHaveProperty('value');
      }

      // Should have recent deployments array
      expect(Array.isArray(result.recent_deployments)).toBe(true);

      // Should not have errors if all calls succeeded
      // (errors array might be present if some endpoints failed)
      console.log('Healthy app diagnostic result:', JSON.stringify(result, null, 2));
    }, 30000);

    it('should detect issues in an unhealthy application', async () => {
      if (!fixtures.unhealthyAppUuid) {
        // Stated out loud rather than passing quietly: an estate where
        // everything is up cannot exercise this path, and a silent green here
        // would read as "unhealthy detection works".
        console.warn(
          '\n[diagnostics.integration] No unhealthy application on this instance — ' +
            'unhealthy detection was NOT verified.\n',
        );
        return;
      }
      const result = await client.diagnoseApplication(fixtures.unhealthyAppUuid);

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
      const result = await client.diagnoseServer(fixtures.serverUuid!);

      // Should have server info
      expect(result.server).not.toBeNull();
      expect(result.server?.uuid).toBe(fixtures.serverUuid);
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
