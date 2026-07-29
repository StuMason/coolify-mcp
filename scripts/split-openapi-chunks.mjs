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

/**
 * Top-level spec keys that are deliberately NOT carried into the chunks.
 * `servers:` is the API base URL, which is meaningless in a per-resource
 * reference. Anything else appearing here is a decision someone has to make,
 * which is why {@link parseSpec} reports leftovers and a test asserts the set:
 * a new upstream top-level key should fail loudly rather than be silently
 * swallowed into schemas.yaml.
 */
export const DROPPED_TOP_LEVEL_KEYS = ['servers', 'tags'];

/** Top-level keys that make up the header shared by every chunk. */
const HEADER_KEYS = ['openapi', 'info'];

/**
 * Split the spec into its top-level sections.
 *
 * Sections are bounded by the next column-0 key rather than running to EOF, so
 * `components:` cannot absorb whatever upstream appends after it. The spec
 * currently has `tags:` after `components:`, which an unbounded slice would
 * have folded into schemas.yaml.
 */
export function parseSpec(specText) {
  const lines = specText.split('\n');

  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^([A-Za-z][\w-]*):/.exec(lines[i]);
    if (match) starts.push({ key: match[1], index: i });
  }

  const sections = new Map();
  for (let s = 0; s < starts.length; s++) {
    const { key, index } = starts[s];
    const end = s + 1 < starts.length ? starts[s + 1].index : lines.length;
    sections.set(key, trimTrailingBlanks(lines.slice(index, end)));
  }

  if (!sections.has('paths')) {
    throw new Error("Could not find a top-level 'paths:' key in the OpenAPI spec");
  }

  // Header is derived, not hardcoded, so an upstream bump to OpenAPI 3.2 or a
  // new info.version propagates instead of every chunk asserting stale metadata.
  const header = HEADER_KEYS.flatMap((k) => sections.get(k) ?? []);

  const entries = [];
  let current = null;
  for (const line of sections.get('paths').slice(1)) {
    const match = /^ {2}(?:'([^']+)'|"([^"]+)"|(\/\S+)):\s*$/.exec(line);
    if (match) {
      if (current) entries.push(current);
      current = { path: match[1] ?? match[2] ?? match[3], lines: [line] };
    } else if (current) {
      current.lines.push(line);
    }
  }
  if (current) entries.push(current);

  const known = new Set([...HEADER_KEYS, 'paths', 'components', ...DROPPED_TOP_LEVEL_KEYS]);
  const unknownTopLevelKeys = [...sections.keys()].filter((k) => !known.has(k));

  return {
    header,
    entries,
    components: sections.get('components') ?? [],
    unknownTopLevelKeys,
  };
}

/** Build the full chunk file set as a { filename -> contents } map. */
export function buildChunks(specText) {
  const { header, entries, components, unknownTopLevelKeys } = parseSpec(specText);

  if (unknownTopLevelKeys.length) {
    throw new Error(
      `Unrecognised top-level key(s) in the OpenAPI spec: ${unknownTopLevelKeys.join(', ')}. ` +
        'Decide whether they belong in the chunks and update HEADER_KEYS or ' +
        'DROPPED_TOP_LEVEL_KEYS in scripts/split-openapi-chunks.mjs.',
    );
  }

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
    files[`${group}.yaml`] = [...header, 'paths:', ...body, ''].join('\n');
  }

  files['schemas.yaml'] = [...header, 'paths: {}', ...components, ''].join('\n');

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

// Matches scripts/check-client-spec-drift.mjs. Comparing against a raw
// `file://${argv[1]}` template breaks on paths needing percent-encoding and on
// Windows, and it fails OPEN: --check would exit 0 having checked nothing.
const isMain = process.argv[1] === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
