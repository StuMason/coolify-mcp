import MiniSearch from 'minisearch';
import { createRequire } from 'node:module';
import { parseDocsIndex, countUnparsedLinkLines } from './docs-index-parse.mjs';

export { parseDocsIndex };

const DOCS_INDEX_URL = 'https://coolify.io/docs/llms.txt';
/** A background refresh is best effort; it must never hold a search up. */
const REFRESH_TIMEOUT_MS = 5_000;

type DocEntry = ReturnType<typeof parseDocsIndex>[number];

export interface DocSearchResult {
  title: string;
  url: string;
  description: string;
  section: string;
  score: number;
}

/** The shape scripts/build-docs-index.mjs writes to src/data/coolify-docs.json. */
export interface DocsBundle {
  source: string;
  fetched_at: string;
  entries: number;
  text: string;
  /** Sent as If-None-Match on the background refresh; a 304 means the bundle is current. */
  etag?: string | null;
  last_modified?: string | null;
}

export interface DocsSearchStatus {
  /** Where the entries currently being served came from. */
  source: 'bundled' | 'live';
  entries: number;
  /** When the bundled copy was fetched from coolify.io; empty if the bundle could not be read. */
  bundledAt: string;
}

export interface DocsSearchOptions {
  /** Loads the bundled index; defaults to the copy shipped in the package. */
  loadBundle?: () => DocsBundle;
  /** Set false to never touch the network (tests, air-gapped installs). */
  refresh?: boolean;
}

const require = createRequire(import.meta.url);

function loadShippedBundle(): DocsBundle {
  // The build copies src/data/ to dist/data/, so this resolves the same way
  // from the TypeScript source (tests) and from the compiled output.
  return require('../data/coolify-docs.json') as DocsBundle;
}

const REBUILD_HINT = 'rebuild it with `npm run docs:index`';

/**
 * Search over the official Coolify docs index (llms.txt).
 *
 * The index ships inside the package (#372): `src/data/coolify-docs.json`,
 * written by `npm run docs:index` and refreshed at release time, so
 * `search_docs` works offline, behind egress rules, and while coolify.io is
 * having a moment. The first search builds the in-memory index from that
 * bundle and starts one background refresh from the live URL; if that
 * succeeds and parses, the fresher entries replace the bundled ones for the
 * rest of the process. A search never waits on the network.
 *
 * The one exception: a bundle that is missing or parses to nothing is a
 * broken build, and then the live index is tried once, synchronously, so an
 * install that can heal itself does. Failing that, every search throws
 * with the rebuild command, never a silently empty result.
 *
 * Why llms.txt and not the full-content dump: ~46KB, a stable spec'd shape
 * (a markdown link list), and every page comes with a human-written one-line
 * description. The tool's job is routing the model to the right page, not
 * serving snippets — the caller can fetch the page itself for depth.
 */
export class DocsSearchEngine {
  private index: MiniSearch<DocEntry> | null = null;
  private entries: DocEntry[] = [];
  private source: DocsSearchStatus['source'] = 'bundled';
  private bundle: DocsBundle | null = null;
  private refreshStarted = false;
  private readonly loadBundle: () => DocsBundle;
  private readonly refresh: boolean;

  constructor(options: DocsSearchOptions = {}) {
    // Nothing is read here: the bundle is loaded on first use so a packaging
    // mistake breaks search_docs, not the construction of every tool.
    this.loadBundle = options.loadBundle ?? loadShippedBundle;
    this.refresh = options.refresh ?? true;
  }

  async ensureLoaded(): Promise<void> {
    if (this.index) {
      this.startBackgroundRefresh();
      return;
    }

    let problem: string | null = null;
    try {
      this.bundle = this.loadBundle();
      const entries = parseDocsIndex(this.bundle.text);
      if (entries.length === 0) {
        problem = 'the bundled Coolify docs index parsed to zero entries';
      } else {
        this.install(entries, 'bundled');
      }
    } catch (error) {
      problem = `the bundled Coolify docs index could not be read (${error instanceof Error ? error.message : String(error)})`;
    }

    if (problem === null) {
      this.startBackgroundRefresh();
      return;
    }

    // Broken build. Try the live index once, in the foreground, so the
    // recovery path exists; a silently empty index is exactly the failure
    // mode that let an earlier implementation stay broken in production.
    if (this.refresh && !this.refreshStarted) {
      this.refreshStarted = true;
      await this.refreshFromLive();
    }
    if (!this.index) {
      throw new Error(`${problem} — ${REBUILD_HINT}`);
    }
  }

  private startBackgroundRefresh(): void {
    if (!this.refresh || this.refreshStarted) return;
    this.refreshStarted = true;
    // Fire and forget: outcome is reflected in status(), never in a search.
    void this.refreshFromLive();
  }

  private install(entries: DocEntry[], source: DocsSearchStatus['source']): void {
    const index = new MiniSearch<DocEntry>({
      fields: ['title', 'description', 'section'],
      storeFields: ['title', 'url', 'description', 'section'],
      searchOptions: {
        boost: { title: 3, description: 1, section: 1 },
        prefix: true,
        fuzzy: 0.2,
      },
    });
    index.addAll(entries);
    this.index = index;
    this.entries = entries;
    this.source = source;
  }

  /**
   * Replace the bundled entries with the live index when it can be fetched
   * and parsed. Every failure is swallowed on purpose (the bundle is the
   * answer), except that a live file which parses to nothing, or only
   * partly, is logged once: that is a format change upstream, which the
   * next `docs:index` refresh would refuse and the operator should know.
   */
  private async refreshFromLive(): Promise<void> {
    const controller = new AbortController();
    // Armed across headers AND body, so a server that answers promptly and
    // then stalls the body cannot hold the socket past the budget.
    const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
    try {
      // Only a cache validator travels: CF Access credentials ride on
      // Coolify base-URL requests and must never leave the estate (#373).
      const headers: Record<string, string> = {};
      if (this.bundle?.etag) headers['if-none-match'] = this.bundle.etag;
      const response = await fetch(DOCS_INDEX_URL, { signal: controller.signal, headers });
      if (response.status === 304) return; // the bundle is the live index
      if (!response.ok) return;
      const text = await response.text();
      const entries = parseDocsIndex(text);
      const unparsed = countUnparsedLinkLines(text);
      if (entries.length === 0 || unparsed > 0) {
        console.error(
          `search_docs: live llms.txt parsed to ${entries.length} entries with ${unparsed} unparsed link lines (format change upstream?); serving the bundled index`,
        );
        return;
      }
      this.install(entries, 'live');
    } catch {
      // Offline, egress-blocked, slow, or coolify.io down: the bundle serves.
    } finally {
      clearTimeout(timeout);
    }
  }

  async search(query: string, limit: number = 5): Promise<DocSearchResult[]> {
    await this.ensureLoaded();
    if (!this.index) {
      throw new Error('Documentation index failed to load');
    }
    const results = this.index.search(query).slice(0, limit);
    return results.map((r) => ({
      title: r.title,
      url: r.url,
      description: r.description,
      section: r.section,
      score: Math.round(r.score * 100) / 100,
    }));
  }

  getEntryCount(): number {
    return this.entries.length;
  }

  status(): DocsSearchStatus {
    return {
      source: this.source,
      entries: this.entries.length,
      bundledAt: this.bundle?.fetched_at ?? '',
    };
  }
}
