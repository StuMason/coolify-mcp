#!/usr/bin/env node
/**
 * Keeps server.json (MCP registry) and manifest.json (MCPB bundle) versions
 * in lockstep with package.json. Wired into the npm `version` lifecycle so
 * `npm version patch|minor|major` bumps all three files in the same commit.
 * Guarded by src/__tests__/manifests.test.ts.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const pkg = JSON.parse(readFileSync('package.json', 'utf8'));

const serverJson = JSON.parse(readFileSync('server.json', 'utf8'));
serverJson.version = pkg.version;
for (const p of serverJson.packages ?? []) {
  p.version = pkg.version;
}
writeFileSync('server.json', JSON.stringify(serverJson, null, 2) + '\n');

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = pkg.version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, 2) + '\n');

console.log(`Synced server.json + manifest.json to v${pkg.version}`);
