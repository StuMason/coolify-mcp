import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { DocsSearchEngine, parseDocsIndex } from '../lib/docs-search.js';

// Sample llms.txt content: a markdown link list with section labels, exactly
// the shape coolify.io/docs/llms.txt serves.
const SAMPLE_INDEX = `# Docs

- [Coolify](/): Coolify is an open-source Platform as a Service.
- Get Started

  - **Setup**
  - [Introduction](/get-started/introduction): Coolify is an open-source self-hosted PaaS alternative.
  - [Installation](/get-started/installation): Install Coolify on Linux servers with the automated setup script.
  - [Upgrading](/get-started/upgrade): Upgrade self-hosted Coolify automatically or manually.

  - **Learn**
  - [Concepts](/get-started/concepts): Learn core Coolify concepts including servers and projects.
- Applications
  - [Applications](/applications): Deploy web applications with build packs and environment variables.
  - [Docker Compose](/applications/docker-compose): Deploy Docker Compose applications with custom domains.
- [External link](https://example.com/page): A fully-qualified URL passes through untouched.
- [No description](/bare-link)
`;

describe('parseDocsIndex', () => {
  it('parses link items with titles, urls and descriptions', () => {
    const entries = parseDocsIndex(SAMPLE_INDEX);

    const install = entries.find((e) => e.title === 'Installation');
    expect(install).toBeDefined();
    expect(install!.url).toBe('https://coolify.io/docs/get-started/installation');
    expect(install!.description).toContain('automated setup script');
  });

  it('tracks the nearest section label for each entry', () => {
    const entries = parseDocsIndex(SAMPLE_INDEX);

    expect(entries.find((e) => e.title === 'Installation')!.section).toBe('Setup');
    expect(entries.find((e) => e.title === 'Concepts')!.section).toBe('Learn');
    expect(entries.find((e) => e.title === 'Docker Compose')!.section).toBe('Applications');
  });

  it('passes absolute URLs through untouched', () => {
    const entries = parseDocsIndex(SAMPLE_INDEX);
    expect(entries.find((e) => e.title === 'External link')!.url).toBe('https://example.com/page');
  });

  it('accepts link items with no description', () => {
    const entries = parseDocsIndex(SAMPLE_INDEX);
    const bare = entries.find((e) => e.title === 'No description');
    expect(bare).toBeDefined();
    expect(bare!.description).toBe('');
  });

  it('does not double-prefix paths that already carry /docs', () => {
    const entries = parseDocsIndex(
      '- [Authorization](/docs/api-reference/authorization): Bearer tokens.',
    );
    expect(entries[0].url).toBe('https://coolify.io/docs/api-reference/authorization');
  });

  it('returns zero entries for content with no link items', () => {
    // The old llms-full.txt frontmatter format is exactly this case — the
    // engine must treat it as a hard error, which the engine tests pin.
    expect(parseDocsIndex('---\nurl: /docs/x.md\ndescription: y\n---\n\n# X\n\nBody.')).toEqual([]);
  });
});

describe('DocsSearchEngine', () => {
  let mockFetch: jest.Spied<typeof fetch>;
  let engine: DocsSearchEngine;

  beforeEach(() => {
    engine = new DocsSearchEngine();
    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  const okResponse = (body: string) =>
    ({ ok: true, text: async () => body }) as unknown as Response;

  it('fetches and indexes the docs index on first search only', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(SAMPLE_INDEX));

    await engine.search('install');
    await engine.search('compose');

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(engine.getEntryCount()).toBeGreaterThan(5);
  });

  it('ranks the obviously right page first', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(SAMPLE_INDEX));

    const results = await engine.search('installation');

    expect(results[0].title).toBe('Installation');
    expect(results[0].url).toBe('https://coolify.io/docs/get-started/installation');
    expect(results[0].score).toBeGreaterThan(0);
  });

  it('respects the limit parameter', async () => {
    mockFetch.mockResolvedValueOnce(okResponse(SAMPLE_INDEX));

    const results = await engine.search('coolify', 2);

    expect(results.length).toBeLessThanOrEqual(2);
  });

  it('throws when the fetch fails, and recovers on the next call', async () => {
    mockFetch.mockRejectedValueOnce(new Error('network down'));
    await expect(engine.search('install')).rejects.toThrow('network down');

    mockFetch.mockResolvedValueOnce(okResponse(SAMPLE_INDEX));
    const results = await engine.search('install');
    expect(results.length).toBeGreaterThan(0);
  });

  it('throws on a non-OK response', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 404 } as unknown as Response);
    await expect(engine.search('install')).rejects.toThrow('HTTP 404');
  });

  it('treats an index that parses to zero entries as an error, not an empty result', async () => {
    // This is the regression test for the silent failure: the previous
    // implementation indexed zero chunks from a changed upstream format and
    // returned [] for every query, indefinitely, with no error.
    mockFetch.mockResolvedValueOnce(okResponse('---\nurl: /docs/x.md\n---\n\n# Old format\n'));

    await expect(engine.search('anything')).rejects.toThrow(/zero entries/);
  });
});
