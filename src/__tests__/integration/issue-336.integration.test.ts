/**
 * Integration tests for the #336 field-test follow-ups.
 *
 * These verify against a real Coolify instance that:
 * 1. `listDatabases` reports every database `/resources` knows about — the
 *    per-type id collision upstream made `GET /databases` silently drop whole
 *    types (2 Postgres + 2 Dragonfly with ids 1,2 returned only the Dragonflys).
 * 2. `findInfrastructureIssues` severity accounting is internally consistent,
 *    and warnings (unknown health, available proxy updates) never inflate the
 *    critical counts.
 * 3. `diagnoseApplication` env-var accounting is internally consistent —
 *    preview twins are surfaced, not deduped.
 *
 * Prerequisites:
 * - COOLIFY_URL and COOLIFY_TOKEN environment variables set (from .env)
 *
 * Run with: npm run test:integration
 */

import { CoolifyClient } from '../../lib/coolify-client.js';
import type { ApplicationSummary } from '../../lib/coolify-client.js';
import type { ResourceListItem } from '../../types/coolify.js';
import { COOLIFY_URL, COOLIFY_TOKEN, warnIfSkipped } from './helpers.js';

warnIfSkipped('issue-336.integration');

const shouldRun = COOLIFY_URL && COOLIFY_TOKEN;
const describeFn = shouldRun ? describe : describe.skip;

describeFn('#336 follow-ups (live)', () => {
  let client: CoolifyClient;

  beforeAll(() => {
    client = new CoolifyClient({
      baseUrl: COOLIFY_URL as string,
      accessToken: COOLIFY_TOKEN as string,
    });
  });

  describe('list_databases collision merge', () => {
    it('reports every standalone-* resource /resources knows about', async () => {
      const [databases, resources] = await Promise.all([
        client.listDatabases({ summary: true }),
        client.listResources() as Promise<ResourceListItem[]>,
      ]);

      const resourceDbUuids = resources
        .filter((r) => typeof r.type === 'string' && r.type.startsWith('standalone-'))
        .map((r) => r.uuid)
        .sort();
      const listedUuids = new Set(databases.map((db) => db.uuid));

      const dropped = resourceDbUuids.filter((uuid) => !listedUuids.has(uuid));
      expect(dropped).toEqual([]);
    });

    it('does not duplicate a database the plain endpoint already returned', async () => {
      const databases = await client.listDatabases({ summary: true });
      const uuids = databases.map((db) => db.uuid);
      expect(new Set(uuids).size).toBe(uuids.length);
    });

    it('every merged row carries a type, so overview counts stay typed', async () => {
      const databases = await client.listDatabases({ summary: true });
      for (const db of databases) {
        expect(typeof db.type).toBe('string');
        expect(db.type.length).toBeGreaterThan(0);
      }
    });
  });

  describe('find_issues severity accounting', () => {
    it('classifies every issue and keeps critical counts free of warnings', async () => {
      const report = await client.findInfrastructureIssues();

      for (const issue of report.issues) {
        expect(['critical', 'warning']).toContain(issue.severity);
      }

      const critical = report.issues.filter((i) => i.severity === 'critical');
      const warnings = report.issues.filter((i) => i.severity === 'warning');
      expect(report.summary.warnings).toBe(warnings.length);
      expect(report.summary.total_issues).toBe(report.issues.length);
      expect(report.summary.unhealthy_applications).toBe(
        critical.filter((i) => i.type === 'application').length,
      );
      expect(report.summary.unhealthy_databases).toBe(
        critical.filter((i) => i.type === 'database').length,
      );
      expect(report.summary.unhealthy_services).toBe(
        critical.filter((i) => i.type === 'service').length,
      );
      // Proxy-update warnings are type 'server' but must not count as unreachable.
      expect(report.summary.unreachable_servers).toBe(
        critical.filter((i) => i.type === 'server').length,
      );
    });

    it('flags resources running with unknown health when the estate has any', async () => {
      const [report, resources] = await Promise.all([
        client.findInfrastructureIssues(),
        client.listResources() as Promise<ResourceListItem[]>,
      ]);

      const unknown = resources.filter(
        (r) => r.status?.startsWith('running') && r.status?.endsWith(':unknown'),
      );
      const unknownWarnings = report.issues.filter(
        (i) => i.severity === 'warning' && i.issue.includes('health unknown'),
      );
      // Every running:unknown resource find_issues can see must produce a
      // warning. (>= because /resources also lists service sub-containers.)
      if (unknown.length === 0) {
        expect(unknownWarnings).toEqual([]);
      } else {
        expect(unknownWarnings.length).toBeGreaterThan(0);
      }
    });
  });

  describe('diagnose_app env-var accounting', () => {
    it('splits preview twins out without deduping the raw rows', async () => {
      const apps = (await client.listApplications({ summary: true })) as ApplicationSummary[];
      if (apps.length === 0) {
        console.warn(
          '[issue-336.integration] no applications on this estate — nothing to diagnose',
        );
        return;
      }

      const diag = await client.diagnoseApplication(apps[0].uuid);
      const env = diag.environment_variables;

      expect(env.count).toBe(env.variables.length);
      expect(env.production_count + env.preview_count).toBe(env.count);
      expect(env.distinct_keys).toBeLessThanOrEqual(env.count);
      expect(env.distinct_keys).toBe(new Set(env.variables.map((v) => v.key)).size);
      for (const variable of env.variables) {
        expect(typeof variable.is_preview).toBe('boolean');
      }
    });
  });
});
