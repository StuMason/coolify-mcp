import { describe, it, expect } from '@jest/globals';
import { DocsSearchEngine } from '../../lib/docs-search.js';

/**
 * Live-format canary. The docs search engine indexes coolify.io/docs/llms.txt,
 * a file Coolify can reshape without notice — the previous implementation was
 * silently dead in production for weeks after exactly such a change, because
 * unit tests only ever see a fixture frozen in the old format. This suite
 * fetches the real file: if upstream changes shape, this fails in CI instead
 * of users' clients. Needs the network, nothing else — no Coolify credentials.
 */
describe('docs search against the live index', () => {
  it('parses a sane number of entries from the real llms.txt', async () => {
    const engine = new DocsSearchEngine();
    await engine.ensureLoaded();

    // ~300 pages at the time of writing. 100 is the tripwire, not the target:
    // low enough to survive upstream pruning, high enough that a format
    // change (which yields zero) can never sneak under it.
    expect(engine.getEntryCount()).toBeGreaterThan(100);
  }, 30_000);

  it('answers the README example question with a relevant page', async () => {
    const engine = new DocsSearchEngine();
    const results = await engine.search('502 bad gateway');

    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toMatch(/^https:\/\/coolify\.io\/docs\//);
  }, 30_000);
});
