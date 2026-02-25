import MiniSearch from 'minisearch';

const DOCS_FULL_URL = 'https://coolify.io/docs/llms-full.txt';
const DOCS_BASE_URL = 'https://coolify.io';

interface DocChunk {
  id: number;
  title: string;
  url: string;
  description: string;
  content: string;
}

export interface DocSearchResult {
  title: string;
  url: string;
  description: string;
  snippet: string;
  score: number;
}

/**
 * Lightweight full-text search over Coolify documentation.
 * Fetches llms-full.txt on first search, parses into chunks, indexes with MiniSearch (BM25).
 * The LLM calling this tool handles semantic understanding — we just need good ranking.
 */
export class DocsSearchEngine {
  private index: MiniSearch<DocChunk> | null = null;
  private chunks: DocChunk[] = [];
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
        response = await fetch(DOCS_FULL_URL, { signal: controller.signal });
      } finally {
        clearTimeout(timeout);
      }
      if (!response.ok) {
        throw new Error(`Failed to fetch Coolify docs: HTTP ${response.status}`);
      }
      const text = await response.text();

      this.chunks = parseDocs(text);

      this.index = new MiniSearch<DocChunk>({
        fields: ['title', 'description', 'content'],
        storeFields: ['title', 'url', 'description'],
        searchOptions: {
          boost: { title: 3, description: 2, content: 1 },
          prefix: true,
          fuzzy: 0.2,
        },
      });
      this.index.addAll(this.chunks);
    } catch (error) {
      this.loading = null;
      this.index = null;
      this.chunks = [];
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
      snippet: this.getSnippet(r.id, query),
      score: Math.round(r.score * 100) / 100,
    }));
  }

  private getSnippet(id: number, query: string): string {
    const chunk = this.chunks[id];
    if (!chunk) return '';
    const content = chunk.content;
    const queryTerms = query.toLowerCase().split(/\s+/);

    // Find best position — where query terms appear
    let bestPos = 0;
    let bestScore = -1;
    const lower = content.toLowerCase();
    for (let i = 0; i < lower.length - 100; i += 50) {
      const window = lower.slice(i, i + 300);
      const score = queryTerms.reduce((s, t) => s + (window.includes(t) ? 1 : 0), 0);
      if (score > bestScore) {
        bestScore = score;
        bestPos = i;
      }
    }

    const start = Math.max(0, bestPos);
    const end = Math.min(content.length, start + 300);
    let snippet = content.slice(start, end).trim();
    if (start > 0) snippet = '...' + snippet;
    if (end < content.length) snippet = snippet + '...';
    return snippet;
  }

  getChunkCount(): number {
    return this.chunks.length;
  }
}

/** Parse llms-full.txt into doc chunks. Exported for testing. */
export function parseDocs(text: string): DocChunk[] {
  const chunks: DocChunk[] = [];

  // Split on page boundaries: ---\n\n--- or end of frontmatter pairs
  // Each page starts with ---\nurl: ...\ndescription: ...\n---\n then markdown
  const pages = text.split(/\n---\n\n---\n/);

  for (const page of pages) {
    const parsed = parsePage(page);
    if (!parsed) continue;

    // Split large pages into sub-chunks at ## headers
    const sections = parsed.content.split(/\n(?=## )/);

    for (const section of sections) {
      const trimmed = section.trim();
      if (!trimmed || trimmed.length < 20) continue;

      // Extract section title if present
      const sectionTitle = trimmed.match(/^## (.+)/)?.[1];
      const title = sectionTitle ? `${parsed.title} > ${sectionTitle}` : parsed.title;

      chunks.push({
        id: chunks.length,
        title,
        url: parsed.url,
        description: parsed.description,
        content: trimmed.replace(/^## .+\n/, '').trim(),
      });
    }
  }

  return chunks;
}

interface ParsedPage {
  url: string;
  description: string;
  title: string;
  content: string;
}

function parsePage(raw: string): ParsedPage | null {
  // Handle frontmatter — may start with --- or just url:
  const frontmatterMatch = raw.match(
    /(?:---\n)?url:\s*(.+)\ndescription:\s*>?-?\n?([\s\S]*?)\n---\n([\s\S]*)/,
  );

  if (!frontmatterMatch) return null;

  const urlPath = frontmatterMatch[1].trim();
  const description = frontmatterMatch[2]
    .split('\n')
    .map((l) => l.trim())
    .join(' ')
    .trim();
  const content = frontmatterMatch[3].trim();

  // Extract H1 title from content
  const titleMatch = content.match(/^#\s+(.+)/m);
  const title = titleMatch?.[1] || urlPath;

  // Build full URL
  const url = urlPath.endsWith('.md')
    ? DOCS_BASE_URL + urlPath.replace(/\.md$/, '')
    : DOCS_BASE_URL + urlPath;

  return { url, description, title, content };
}
