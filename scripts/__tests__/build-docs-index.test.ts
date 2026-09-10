import { describe, it, expect, afterEach } from '@jest/globals';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MIN_ENTRIES,
  SOURCE_URL,
  fetchLive,
  refreshDocsIndex,
  validateIndex,
} from '../build-docs-index.mjs';

const page = (i: number): string => `- [Page ${i}](/pages/${i}): Description ${i}.`;
const goodIndex = (n = MIN_ENTRIES + 50): string =>
  ['# Docs', '- Section', ...Array.from({ length: n }, (_, i) => page(i)), ''].join('\n');

const bundleOf = (text: string, fetchedAt = '2026-08-01T00:00:00.000Z'): string =>
  JSON.stringify({ source: SOURCE_URL, fetched_at: fetchedAt, entries: 0, text }, null, 2) + '\n';

const liveWith = (text: string) => async () => ({
  source: SOURCE_URL,
  fetched_at: '2026-09-09T12:00:00.000Z',
  etag: '"e"',
  last_modified: null,
  entries: 150,
  text,
});

describe('validateIndex', () => {
  it('accepts a file the runtime parser reads in full', () => {
    expect(validateIndex(goodIndex())).toBe(MIN_ENTRIES + 50);
  });

  it('refuses a file with too few entries', () => {
    expect(() => validateIndex(goodIndex(10))).toThrow(/parsed to 10 entries/);
  });

  it('refuses a file with link lines the runtime parser rejects', () => {
    // The separator upstream might change one day: the same count of link
    // lines, none of which the server would parse. Must not ship.
    const reshaped = goodIndex().replace(/\): Description/g, ') — Description');
    expect(() => validateIndex(reshaped)).toThrow(/do not parse with the runtime parser/);
  });
});

describe('fetchLive', () => {
  it('rejects a non-OK response and validates the body with the runtime parser', async () => {
    const notOk = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    await expect(fetchLive(notOk)).rejects.toThrow('HTTP 503');

    const empty = (async () => ({
      ok: true,
      status: 200,
      headers: new Headers(),
      text: async () => '# nothing\n',
    })) as unknown as typeof fetch;
    await expect(fetchLive(empty)).rejects.toThrow(/parsed to 0 entries/);
  });
});

describe('refreshDocsIndex', () => {
  let dir: string;
  afterEach(() => rmSync(dir, { recursive: true, force: true }));
  const tmpBundle = (): string => {
    dir = mkdtempSync(join(tmpdir(), 'docs-index-'));
    return join(dir, 'coolify-docs.json');
  };

  it('writes the bundle when live differs, and leaves it alone when it does not', async () => {
    const bundlePath = tmpBundle();
    const text = goodIndex();
    const first = await refreshDocsIndex({ bundlePath, fetchLiveImpl: liveWith(text) });
    expect(first).toMatchObject({ code: 0, wrote: true });
    const written = JSON.parse(readFileSync(bundlePath, 'utf8')) as {
      text: string;
      entries: number;
    };
    expect(written.text).toBe(text);
    expect(written.entries).toBe(150);

    // Same content again: no rewrite, so fetched_at does not churn.
    const before = readFileSync(bundlePath, 'utf8');
    const second = await refreshDocsIndex({ bundlePath, fetchLiveImpl: liveWith(text) });
    expect(second).toMatchObject({ code: 0, wrote: false });
    expect(readFileSync(bundlePath, 'utf8')).toBe(before);
  });

  it('--check exits 0 when current and 1 when live differs, reporting the bundle age', async () => {
    const bundlePath = tmpBundle();
    const text = goodIndex();
    writeFileSync(bundlePath, bundleOf(text));
    const now = Date.parse('2026-08-11T00:00:00.000Z');

    const current = await refreshDocsIndex({
      bundlePath,
      check: true,
      fetchLiveImpl: liveWith(text),
      now,
    });
    expect(current.code).toBe(0);
    expect(current.message).toMatch(/fetched 10 day\(s\) ago/);

    const stale = await refreshDocsIndex({
      bundlePath,
      check: true,
      fetchLiveImpl: liveWith(text + page(999) + '\n'),
      now,
    });
    expect(stale.code).toBe(1);
    expect(stale.message).toMatch(/live differs/);
    expect(stale.wrote).toBe(false);
  });

  it('exits 2 and leaves the bundle untouched when live cannot be fetched or fails validation', async () => {
    const bundlePath = tmpBundle();
    writeFileSync(bundlePath, bundleOf(goodIndex()));
    const before = readFileSync(bundlePath, 'utf8');

    const down = await refreshDocsIndex({
      bundlePath,
      fetchLiveImpl: async () => {
        throw new Error('ENETUNREACH');
      },
    });
    expect(down).toMatchObject({ code: 2, wrote: false });
    expect(down.message).toMatch(/left untouched/);
    expect(readFileSync(bundlePath, 'utf8')).toBe(before);

    const checkDown = await refreshDocsIndex({
      bundlePath,
      check: true,
      fetchLiveImpl: async () => {
        throw new Error('ENETUNREACH');
      },
    });
    expect(checkDown.code).toBe(2);
  });
});
