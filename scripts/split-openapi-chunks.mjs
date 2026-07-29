#!/usr/bin/env node
/**
 * Regenerate `docs/openapi-chunks/` from `docs/coolify-openapi.yaml`.
 *
 * The chunks are a developer-facing reference — CLAUDE.md and the contributing
 * guide both say "check the chunks before adding an endpoint". They were
 * previously hand-maintained, which meant they silently went stale the moment
 * the bundled spec was re-vendored, turning the reference into a trap.
 *
 * This splits the bundled spec by the first path segment so the chunks are
 * derived rather than curated. Run it whenever `docs/coolify-openapi.yaml`
 * changes; `npm run check:chunk-drift` fails CI if you forget.
 *
 * The split is deliberately line-based rather than parse-and-reserialise:
 * round-tripping through a YAML library would reformat the whole file and bury
 * the real upstream diff in noise.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

export const SPEC_PATH = path.join(ROOT, 'docs/coolify-openapi.yaml');
export const CHUNKS_DIR = path.join(ROOT, 'docs/openapi-chunks');

/**
 * First path segment -> chunk file. Segments with no entry land in
 * `untagged-api`, which is also where the bare instance-level routes
 * (`/version`, `/health`, `/enable`, `/disable`) live.
 */
export const GROUPS = {
  applications: 'applications-api',
  databases: 'databases-api',
  deploy: 'deployments-api',
  deployments: 'deployments-api',
  destinations: 'destinations-api',
  digitalocean: 'cloud-providers-api',
  hetzner: 'cloud-providers-api',
  projects: 'projects-api',
  resources: 'resources-api',
  security: 'private-keys-api',
  servers: 'servers-api',
  services: 'services-api',
  tags: 'tags-api',
  teams: 'teams-api',
  vultr: 'cloud-providers-api',
};

const HEADER = ['openapi: 3.1.0', 'info:', '  title: Coolify', "  version: '0.1'"];

/** Split the spec into its `paths:` entries and the trailing `components:` block. */
export function parseSpec(specText) {
  const lines = specText.split('\n');
  const pathsIdx = lines.findIndex((l) => /^paths:\s*$/.test(l));
  if (pathsIdx === -1) {
    throw new Error("Could not find a top-level 'paths:' key in the OpenAPI spec");
  }

  let pathsEnd = lines.length;
  for (let i = pathsIdx + 1; i < lines.length; i++) {
    if (/^[A-Za-z]/.test(lines[i])) {
      pathsEnd = i;
      break;
    }
  }

  const entries = [];
  let current = null;
  for (let i = pathsIdx + 1; i < pathsEnd; i++) {
    const match = /^ {2}(?:'([^']+)'|"([^"]+)"|(\/\S+)):\s*$/.exec(lines[i]);
    if (match) {
      if (current) entries.push(current);
      current = { path: match[1] ?? match[2] ?? match[3], lines: [lines[i]] };
    } else if (current) {
      current.lines.push(lines[i]);
    }
  }
  if (current) entries.push(current);

  const componentsIdx = lines.findIndex((l) => /^components:\s*$/.test(l));
  const components = componentsIdx === -1 ? [] : lines.slice(componentsIdx);

  return { entries, components };
}

/** Build the full chunk file set as a { filename -> contents } map. */
export function buildChunks(specText) {
  const { entries, components } = parseSpec(specText);

  const grouped = new Map();
  for (const entry of entries) {
    const segment = entry.path.split('/').filter(Boolean)[0] ?? '';
    const group = GROUPS[segment] ?? 'untagged-api';
    if (!grouped.has(group)) grouped.set(group, []);
    grouped.get(group).push(entry);
  }

  const files = {};
  for (const [group, groupEntries] of grouped) {
    const body = groupEntries
      .sort((a, b) => a.path.localeCompare(b.path))
      .flatMap((e) => trimTrailingBlanks(e.lines));
    files[`${group}.yaml`] = [...HEADER, 'paths:', ...body, ''].join('\n');
  }

  files['schemas.yaml'] = [...HEADER, 'paths: {}', ...trimTrailingBlanks(components), ''].join(
    '\n',
  );

  return files;
}

function trimTrailingBlanks(lines) {
  const out = [...lines];
  while (out.length && out[out.length - 1].trim() === '') out.pop();
  return out;
}

function main() {
  const check = process.argv.includes('--check');
  const files = buildChunks(fs.readFileSync(SPEC_PATH, 'utf8'));

  const existing = fs.existsSync(CHUNKS_DIR)
    ? fs.readdirSync(CHUNKS_DIR).filter((f) => f.endsWith('.yaml'))
    : [];
  const stale = existing.filter((f) => !(f in files));

  if (check) {
    const drifted = [
      ...stale.map((f) => `${f} (no longer produced by the spec)`),
      ...Object.entries(files)
        .filter(([name, contents]) => {
          const target = path.join(CHUNKS_DIR, name);
          return !fs.existsSync(target) || fs.readFileSync(target, 'utf8') !== contents;
        })
        .map(([name]) => name),
    ];

    if (drifted.length) {
      console.error('Chunk drift detected — docs/openapi-chunks/ is out of sync with the spec:');
      for (const f of drifted) console.error(`  - ${f}`);
      console.error('\nRun `npm run build:chunks` and commit the result.');
      process.exit(1);
    }
    console.log(`OK: ${Object.keys(files).length} chunk file(s) match the bundled spec.`);
    return;
  }

  fs.mkdirSync(CHUNKS_DIR, { recursive: true });
  for (const f of stale) fs.rmSync(path.join(CHUNKS_DIR, f));
  for (const [name, contents] of Object.entries(files)) {
    fs.writeFileSync(path.join(CHUNKS_DIR, name), contents);
  }
  console.log(
    `Wrote ${Object.keys(files).length} chunk file(s)` +
      (stale.length ? `, removed ${stale.length} stale file(s)` : ''),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
