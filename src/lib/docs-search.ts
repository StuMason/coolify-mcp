import MiniSearch from 'minisearch';
import { createRequire } from 'node:module';

const DOCS_INDEX_URL = 'https://coolify.io/docs/llms.txt';
const DOCS_BASE_URL = 'https://coolify.io/docs';
/** A background refresh is best effort; it must never hold a search up. */
const REFRESH_TIMEOUT_MS = 5_000;

interface DocEntry {
  id: number;
  title: string;
  url: string;
  description: string;
  section: string;
}

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
}

export interface DocsSearchStatus {
  /** Where the entries currently being served came from. */
  source: 'bundled' | 'live';
  entries: number;
  /** When the bundled copy was fetched from coolify.io. */
  bundledAt: string;
}

export interface DocsSearchOptions {
  /** The bundled index; defaults to the copy shipped in the package. */
  bundle?: DocsBundle;
  /** Set false to never touch the network (tests, air-gapped installs). */
  refresh?: boolean;
}

const require = createRequire(import.meta.url);

function loadShippedBundle(): DocsBundle {
  // The build copies src/data/ to dist/data/, so this resolves the same way
  // from the TypeScript source (tests) and from the compiled output.
  return require('../data/coolify-docs.json') as DocsBundle;
}

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
 * Why llms.txt and not the full-content dump: ~46KB, a stable spec'd shape
 * (a markdown link list), and every page comes with a human-written one-line
 * description. The tool's job is routing the model to the right page, not
 * serving snippets — the caller can fetch the page itself for depth.
 */
export class DocsSearchEngine {
  private index: MiniSearch<DocEntry> | null = null;
  private entries: DocEntry[] = [];
  private source: DocsSearchStatus['source'] = 'bundled';
  private refreshStarted = false;
  private readonly bundle: DocsBundle;
  private readonly refresh: boolean;

  constructor(options: DocsSearchOptions = {}) {
    this.bundle = options.bundle ?? loadShippedBundle();
    this.refresh = options.refresh ?? true;
  }

  /**
   * Build the index from the bundle if it is not built yet. Synchronous by
   * design: there is nothing to wait for. Kept as a Promise-returning method
   * so callers that awaited the old network load keep working.
   */
  async ensureLoaded(): Promise<void> {
    if (!this.index) {
      const entries = parseDocsIndex(this.bundle.text);
      // A bundle that parses to nothing is a broken build, not an empty
      // corpus. Fail loudly — a silently empty index is exactly the failure
      // mode that let an earlier implementation stay broken in production.
      if (entries.length === 0) {
        throw new Error(
          'The bundled Coolify docs index parsed to zero entries — rebuild it with `npm run docs:index`',
        );
      }
      this.install(entries, 'bundled');
    }
    if (this.refresh && !this.refreshStarted) {
      this.refreshStarted = true;
      // Fire and forget: outcome is reflected in status(), never in a search.
      void this.refreshFromLive();
    }
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
   * answer), except that a live file which parses to zero entries is logged
   * once: that is a format change upstream, which the next `docs:index`
   * refresh would otherwise carry into the bundle unnoticed.
   */
  private async refreshFromLive(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), REFRESH_TIMEOUT_MS);
      let response: Response;
      try {
        // Deliberately no headers: this is the one request the server makes
        // off-estate, and CF Access credentials must never ride on it (#373).
        response = await fetch(DOCS_INDEX_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) return;
      const entries = parseDocsIndex(await response.text());
      if (entries.length === 0) {
        console.error(
          'search_docs: live llms.txt parsed to zero entries (format change upstream?); serving the bundled index',
        );
        return;
      }
      this.install(entries, 'live');
    } catch {
      // Offline, egress-blocked, slow, or coolify.io down: the bundle serves.
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
    return { source: this.source, entries: this.entries.length, bundledAt: this.bundle.fetched_at };
  }
}

/**
 * Parse llms.txt — a markdown link list — into doc entries.
 * Exported for testing.
 *
 * The shape, per the llms.txt convention:
 *   - Plain list items and bold items ("- Get Started", "  - **Setup**") are
 *     section labels for the links nested under them.
 *   - Link items carry the page: "- [Title](/path): one-line description".
 *     The description after the colon is optional; paths are relative to the
 *     docs root (the site serves them under /docs), and absolute URLs pass
 *     through untouched.
 */
export function parseDocsIndex(text: string): DocEntry[] {
  const entries: DocEntry[] = [];
  let section = '';

  for (const line of text.split('\n')) {
    const link = line.match(/^\s*-\s*\[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?\s*$/);
    if (link) {
      const [, title, path, description] = link;
      entries.push({
        id: entries.length,
        title: title.trim(),
        url: buildUrl(path.trim()),
        description: (description ?? '').trim(),
        section,
      });
      continue;
    }
    // A list item that is not a link is a section label; so is a heading.
    const label =
      line.match(/^\s*-\s*\*\*(.+?)\*\*\s*$/) ??
      line.match(/^\s*-\s+([^[\s].*?)\s*$/) ??
      line.match(/^#+\s+(.+?)\s*$/);
    if (label) section = label[1];
  }

  return entries;
}

function buildUrl(path: string): string {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/docs/') || path === '/docs') return `https://coolify.io${path}`;
  return `${DOCS_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}
