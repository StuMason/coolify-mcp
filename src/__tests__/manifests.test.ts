import { readFileSync } from 'node:fs';

/**
 * Guards against the distribution manifests drifting from package.json —
 * server.json sat at 2.7.3 while npm was on 2.13.0 because nothing enforced
 * the sync. scripts/sync-manifests.mjs (npm `version` lifecycle) keeps them
 * aligned; this test fails the build if they ever diverge again.
 */
const read = (file: string): Record<string, unknown> =>
  JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>;

describe('distribution manifests', () => {
  const pkg = read('package.json') as unknown as {
    version: string;
    mcpName: string;
    description: string;
  };

  it('server.json (MCP registry) matches package.json', () => {
    const serverJson = read('server.json') as unknown as {
      name: string;
      version: string;
      packages: Array<{ identifier: string; version: string }>;
    };
    expect(serverJson.version).toBe(pkg.version);
    expect(serverJson.name).toBe(pkg.mcpName);
    for (const p of serverJson.packages) {
      expect(p.version).toBe(pkg.version);
    }
  });

  it('manifest.json (MCPB bundle) matches package.json', () => {
    const manifest = read('manifest.json') as unknown as { version: string; server: unknown };
    expect(manifest.version).toBe(pkg.version);
    expect(manifest.server).toBeDefined();
  });
});
