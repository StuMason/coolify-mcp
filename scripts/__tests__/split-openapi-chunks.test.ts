import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from '@jest/globals';
import yaml from 'js-yaml';
import {
  parseSpec,
  buildChunks,
  GROUPS,
  DROPPED_TOP_LEVEL_KEYS,
  SPEC_PATH,
  CHUNKS_DIR,
} from '../split-openapi-chunks.mjs';
import { SPEC_PATH as DRIFT_SPEC_PATH } from '../check-client-spec-drift.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const SAMPLE = [
  'openapi: 3.1.0',
  'info:',
  '  title: Coolify',
  "  version: '0.1'",
  'paths:',
  '  /applications:',
  '    get:',
  '      summary: List',
  "  '/databases/{uuid}':",
  '    get:',
  '      summary: Get',
  '  /tags:',
  '    get:',
  '      summary: Tags',
  '  /something-unmapped:',
  '    get:',
  '      summary: Unmapped',
  'components:',
  '  schemas:',
  '    Thing:',
  '      type: object',
].join('\n');

describe('parseSpec', () => {
  it('splits the paths block into one entry per path key, quoted or not', () => {
    const { entries } = parseSpec(SAMPLE);
    expect(entries.map((e) => e.path)).toEqual([
      '/applications',
      '/databases/{uuid}',
      '/tags',
      '/something-unmapped',
    ]);
  });

  it('keeps each path key with its own body lines', () => {
    const { entries } = parseSpec(SAMPLE);
    expect(entries[0].lines).toEqual(['  /applications:', '    get:', '      summary: List']);
  });

  it('captures the components block separately from paths', () => {
    const { components } = parseSpec(SAMPLE);
    expect(components[0]).toBe('components:');
    expect(components.join('\n')).toContain('Thing:');
  });

  it('throws when there is no top-level paths key', () => {
    expect(() => parseSpec('openapi: 3.1.0\ncomponents: {}')).toThrow(/paths/);
  });
});

describe('buildChunks', () => {
  it('routes each path to its mapped chunk file', () => {
    const files = buildChunks(SAMPLE);
    expect(Object.keys(files).sort()).toEqual(
      [
        'applications-api.yaml',
        'databases-api.yaml',
        'schemas.yaml',
        'tags-api.yaml',
        'untagged-api.yaml',
      ].sort(),
    );
  });

  it('sends unmapped first segments to untagged-api', () => {
    const files = buildChunks(SAMPLE);
    expect(files['untagged-api.yaml']).toContain('/something-unmapped:');
  });

  it('puts components in schemas.yaml with an empty paths key', () => {
    const files = buildChunks(SAMPLE);
    expect(files['schemas.yaml']).toContain('paths: {}');
    expect(files['schemas.yaml']).toContain('Thing:');
  });

  it('emits chunks that are themselves valid YAML', () => {
    const files = buildChunks(SAMPLE);
    for (const contents of Object.values(files)) {
      expect(() => yaml.load(contents)).not.toThrow();
    }
  });
});

describe('committed chunks vs the bundled spec', () => {
  const spec = yaml.load(fs.readFileSync(SPEC_PATH, 'utf8')) as {
    paths: Record<string, unknown>;
    components?: { schemas?: Record<string, unknown> };
  };

  const chunkFiles = fs.readdirSync(CHUNKS_DIR).filter((f) => f.endsWith('.yaml'));

  it('is regenerated — running the splitter produces exactly what is committed', () => {
    const files = buildChunks(fs.readFileSync(SPEC_PATH, 'utf8'));
    expect(chunkFiles.sort()).toEqual(Object.keys(files).sort());
    for (const [name, contents] of Object.entries(files)) {
      expect(fs.readFileSync(path.join(CHUNKS_DIR, name), 'utf8')).toBe(contents);
    }
  });

  it('carries every spec path exactly once across the chunk set', () => {
    const seen: string[] = [];
    for (const f of chunkFiles) {
      const chunk = yaml.load(fs.readFileSync(path.join(CHUNKS_DIR, f), 'utf8')) as {
        paths?: Record<string, unknown>;
      };
      seen.push(...Object.keys(chunk.paths ?? {}));
    }
    // No path lost, none invented, none duplicated across chunks.
    expect([...new Set(seen)].sort()).toEqual(Object.keys(spec.paths).sort());
    expect(seen.length).toBe(new Set(seen).size);
  });

  // Key-level assertions cannot catch the realistic failure for a line-based
  // splitter: a dropped or duplicated line INSIDE a body leaves the key present
  // and the content wrong. Compare the parsed bodies.
  it('carries every path body verbatim, not just the keys', () => {
    const merged: Record<string, unknown> = {};
    for (const f of chunkFiles) {
      const chunk = yaml.load(fs.readFileSync(path.join(CHUNKS_DIR, f), 'utf8')) as {
        paths?: Record<string, unknown>;
      };
      Object.assign(merged, chunk.paths ?? {});
    }
    expect(merged).toEqual(spec.paths);
  });

  it('carries every schema into schemas.yaml', () => {
    const schemas = yaml.load(fs.readFileSync(path.join(CHUNKS_DIR, 'schemas.yaml'), 'utf8')) as {
      components?: { schemas?: Record<string, unknown> };
    };
    // Deep equality, not key names: a re-vendor that rewrites a request body
    // under an existing schema name would pass a keys-only check.
    expect(schemas.components?.schemas).toEqual(spec.components?.schemas);
  });

  it('maps every first path segment in the spec to a real group or the untagged fallback', () => {
    const segments = new Set(
      Object.keys(spec.paths).map((p) => p.split('/').filter(Boolean)[0] ?? ''),
    );
    for (const segment of segments) {
      const group = GROUPS[segment as keyof typeof GROUPS] ?? 'untagged-api';
      expect(fs.existsSync(path.join(CHUNKS_DIR, `${group}.yaml`))).toBe(true);
    }
  });

  it('drops only the top-level keys we have explicitly decided to drop', () => {
    // `servers:` (the API base URL) and `tags:` (upstream's tag directory) are
    // deliberately not carried into a per-resource reference. Asserting the set
    // means a NEW upstream top-level key fails here — a decision to make, not
    // something to be silently swallowed into schemas.yaml.
    expect(DROPPED_TOP_LEVEL_KEYS).toEqual(['servers', 'tags']);

    for (const key of DROPPED_TOP_LEVEL_KEYS) {
      for (const f of chunkFiles) {
        const contents = fs.readFileSync(path.join(CHUNKS_DIR, f), 'utf8');
        expect(contents).not.toMatch(new RegExp(`^${key}:`, 'm'));
      }
    }
  });

  it('refuses to generate when the spec grows an unrecognised top-level key', () => {
    const withUnknown = [
      'openapi: 3.1.0',
      'info:',
      '  title: Coolify',
      'paths:',
      '  /a:',
      '    get: {}',
      'webhooks:',
      '  something: else',
    ].join('\n');

    expect(() => buildChunks(withUnknown)).toThrow(/Unrecognised top-level key/);
  });

  it('keeps the drift checker and the splitter reading the same spec file', () => {
    // Comparing SPEC_PATH to a literal only restates the splitter's own
    // constant — it cannot notice the two scripts drifting apart. Compare the
    // modules to each other instead.
    expect(SPEC_PATH).toBe(DRIFT_SPEC_PATH);
    expect(SPEC_PATH).toBe(path.join(ROOT, 'docs/coolify-openapi.yaml'));
  });
});
