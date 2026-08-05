import MiniSearch from 'minisearch';

const DOCS_INDEX_URL = 'https://coolify.io/docs/llms.txt';
const DOCS_BASE_URL = 'https://coolify.io/docs';

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

/**
 * Search over the official Coolify docs index (llms.txt).
 *
 * This used to fetch llms-full.txt — the ~40MB full-content dump — and run a
 * bespoke frontmatter parser over it. Coolify changed that file's format and
 * the parser silently produced zero chunks: the index "loaded", every search
 * returned an empty result, and nothing errored. llms.txt is the better
 * corpus anyway: ~46KB, a stable spec'd shape (a markdown link list), and
 * every page comes with a human-written one-line description. The tool's job
 * is routing the model to the right page, not serving snippets — the caller
 * can fetch the page itself for depth.
 */
export class DocsSearchEngine {
  private index: MiniSearch<DocEntry> | null = null;
  private entries: DocEntry[] = [];
  private loading: Promise<void> | null = null;

  async ensureLoaded(): Promise<void> {
    if (this.index) return;
    if (this.loading) return this.loading;
    this.loading = this.loadAndIndex();
    return this.loading;
  }

  private async loadAndIndex(): Promise<void> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);
      let response: Response;
      try {
        response = await fetch(DOCS_INDEX_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch Coolify docs index: HTTP ${response.status}`);
      }
      const text = await response.text();

      this.entries = parseDocsIndex(text);

      // Zero entries from a 200 response means the format changed, not that
      // the docs are empty. Fail loudly — a silently empty index is exactly
      // the failure mode that let the previous implementation stay broken in
      // production unnoticed.
      if (this.entries.length === 0) {
        throw new Error(
          'Parsed zero entries from the Coolify docs index — llms.txt format may have changed',
        );
      }

      this.index = new MiniSearch<DocEntry>({
        fields: ['title', 'description', 'section'],
        storeFields: ['title', 'url', 'description', 'section'],
        searchOptions: {
          boost: { title: 3, description: 1, section: 1 },
          prefix: true,
          fuzzy: 0.2,
        },
      });
      this.index.addAll(this.entries);
    } catch (error) {
      this.loading = null;
      this.index = null;
      this.entries = [];
      throw error;
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
