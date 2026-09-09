import { describe, it, expect } from '@jest/globals';
import { DocsSearchEngine, parseDocsIndex } from '../../lib/docs-search.js';
import { countUnparsedLinkLines } from '../../lib/docs-index-parse.mjs';

/**
 * Live-format canary. The docs search engine indexes coolify.io/docs/llms.txt,
 * a file Coolify can reshape without notice — an earlier implementation was
 * silently dead in production for weeks after exactly such a change, because
 * unit tests only ever see a fixture frozen in the old format. Since #372 the
 * engine serves a bundled copy first, so this suite has to look at the real
 * file directly rather than through the engine, or it would pass forever on
 * the bundle. Needs the network, nothing else — no Coolify credentials.
 */
describe('docs search against the live index', () => {
  it('parses a sane number of entries from the real llms.txt with the runtime parser', async () => {
    const response = await fetch('https://coolify.io/docs/llms.txt');
    expect(response.ok).toBe(true);
    const text = await response.text();

    // ~270 pages at the time of writing. 100 is the tripwire, not the target:
    // low enough to survive upstream pruning, high enough that a format
    // change (which yields zero) can never sneak under it.
    expect(parseDocsIndex(text).length).toBeGreaterThan(100);
    // And no link line the parser cannot read: a partial reshape must fail
    // here too, not degrade quietly into section labels.
    expect(countUnparsedLinkLines(text)).toBe(0);
  }, 30_000);

  it('swaps the live index in behind a search that was answered from the bundle', async () => {
    const engine = new DocsSearchEngine();
    const results = await engine.search('502 bad gateway');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].url).toMatch(/^https:\/\/coolify\.io\/docs\//);

    // The refresh is fire-and-forget; give it the budget it has in production.
    // A 304 (bundle current) leaves the source as bundled and is also fine.
    const deadline = Date.now() + 10_000;
    while (engine.status().source !== 'live' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    expect(engine.getEntryCount()).toBeGreaterThan(100);
  }, 30_000);
});
