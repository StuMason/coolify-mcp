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

  const bundle = {
    source: 'test',
    fetched_at: '2026-09-09T00:00:00.000Z',
    entries: 9,
    text: SAMPLE_INDEX,
  };
  const okResponse = (body: string) =>
    ({ ok: true, text: async () => body }) as unknown as Response;
  /** A refresh that never resolves: proves searches do not wait on it. */
  const hangingFetch = () => new Promise<Response>(() => {});
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    mockFetch = jest.spyOn(global, 'fetch');
  });

  afterEach(() => {
    mockFetch.mockRestore();
  });

  it('serves from the bundle immediately, without waiting on the network', async () => {
    mockFetch.mockImplementation(hangingFetch);
    const engine = new DocsSearchEngine({ bundle });

    const results = await engine.search('install');

    expect(results[0].title).toBe('Installation');
    expect(engine.status()).toMatchObject({ source: 'bundled', bundledAt: bundle.fetched_at });
  });

  it('starts exactly one background refresh, and swaps in the live index when it parses', async () => {
    const live = SAMPLE_INDEX + '- [Brand New Page](/new-page): Added upstream after the bundle.\n';
    mockFetch.mockResolvedValue(okResponse(live));
    const engine = new DocsSearchEngine({ bundle });

    await engine.search('install');
    await engine.search('compose');
    await settle();

    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(engine.status().source).toBe('live');
    expect((await engine.search('brand new'))[0].title).toBe('Brand New Page');
  });

  it('never sends credential headers off-estate, even with CF Access configured (#373)', async () => {
    // The CF Access service token rides only on Coolify base-URL requests.
    // The refresh goes to coolify.io — assert it carries no headers at all.
    process.env.CF_ACCESS_CLIENT_ID = 'id.access';
    process.env.CF_ACCESS_CLIENT_SECRET = 'cf-secret';
    try {
      mockFetch.mockResolvedValue(okResponse(SAMPLE_INDEX));
      await new DocsSearchEngine({ bundle }).search('install');
      await settle();
      const init = mockFetch.mock.calls[0][1] as RequestInit;
      expect(init.headers).toBeUndefined();
    } finally {
      delete process.env.CF_ACCESS_CLIENT_ID;
      delete process.env.CF_ACCESS_CLIENT_SECRET;
    }
  });

  it('ranks the obviously right page first', async () => {
    const engine = new DocsSearchEngine({ bundle, refresh: false });

    const results = await engine.search('installation');

    expect(results[0].title).toBe('Installation');
    expect(results[0].url).toBe('https://coolify.io/docs/get-started/installation');
    expect(results[0].score).toBeGreaterThan(0);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('respects the limit parameter', async () => {
    const results = await new DocsSearchEngine({ bundle, refresh: false }).search('coolify', 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it.each([
    ['a network error', () => Promise.reject(new Error('network down'))],
    ['a non-OK response', () => Promise.resolve({ ok: false, status: 404 } as unknown as Response)],
    [
      'a live file that parses to zero entries',
      () => Promise.resolve(okResponse('---\nurl: /docs/x.md\n---\n\n# Old format\n')),
    ],
  ])('keeps serving the bundle when the refresh meets %s', async (_label, impl) => {
    mockFetch.mockImplementation(impl as typeof fetch);
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const engine = new DocsSearchEngine({ bundle });
      const results = await engine.search('install');
      await settle();
      expect(results[0].title).toBe('Installation');
      expect(engine.status().source).toBe('bundled');
      // No retry storm: one attempt per process.
      await engine.search('install');
      expect(mockFetch).toHaveBeenCalledTimes(1);
    } finally {
      stderr.mockRestore();
    }
  });

  it('logs once when the live file parses to zero entries, so a format change is not silent', async () => {
    mockFetch.mockResolvedValue(okResponse('# nothing here\n'));
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await new DocsSearchEngine({ bundle }).search('install');
      await settle();
      expect(stderr).toHaveBeenCalledTimes(1);
      expect(String(stderr.mock.calls[0][0])).toMatch(/zero entries/);
    } finally {
      stderr.mockRestore();
    }
  });

  it('treats a bundle that parses to zero entries as a broken build, not an empty corpus', async () => {
    const engine = new DocsSearchEngine({
      bundle: { ...bundle, text: '# empty\n' },
      refresh: false,
    });
    await expect(engine.search('anything')).rejects.toThrow(/zero entries/);
  });

  it('ships a real bundle that answers real questions offline', async () => {
    // The default constructor loads src/data/coolify-docs.json. This is the
    // acceptance test from #372: results with no network at all.
    mockFetch.mockImplementation(() => Promise.reject(new Error('ENETUNREACH')));
    const engine = new DocsSearchEngine();

    const results = await engine.search('docker compose');

    expect(engine.getEntryCount()).toBeGreaterThan(200);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toMatch(/^https:\/\/coolify\.io\/docs\//);
    expect(engine.status().bundledAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});
