/**
 * Parse llms.txt — a markdown link list — into doc entries.
 *
 * Plain JavaScript on purpose: the runtime (docs-search.ts) and the bundle
 * script (scripts/build-docs-index.mjs) must read the file with the same
 * parser, or the script can accept a file the server then parses to
 * nothing (#372 review). TypeScript consumes it through allowJs.
 *
 * The shape, per the llms.txt convention:
 *   - Plain list items and bold items ("- Get Started", "  - **Setup**") are
 *     section labels for the links nested under them.
 *   - Link items carry the page: "- [Title](/path): one-line description".
 *     The description after the colon is optional; paths are relative to the
 *     docs root (the site serves them under /docs), and absolute URLs pass
 *     through untouched.
 */

const DOCS_BASE_URL = 'https://coolify.io/docs';

/**
 * @typedef {object} DocEntry
 * @property {number} id
 * @property {string} title
 * @property {string} url
 * @property {string} description
 * @property {string} section
 */

const LINK_ITEM = /^\s*-\s*\[([^\]]+)\]\(([^)\s]+)\)(?::\s*(.*))?\s*$/;
/** Anything that starts like a link item, whether or not it parses as one. */
const LOOKS_LIKE_LINK = /^\s*-\s*\[/;

/**
 * @param {string} text
 * @returns {DocEntry[]}
 */
export function parseDocsIndex(text) {
  /** @type {DocEntry[]} */
  const entries = [];
  let section = '';

  for (const line of text.split('\n')) {
    const link = line.match(LINK_ITEM);
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

/**
 * Lines that look like link items but do not parse as one. Zero on a file
 * in the known format; anything else is upstream changing shape, which the
 * bundle script refuses to ship and the runtime reports.
 *
 * @param {string} text
 * @returns {number}
 */
export function countUnparsedLinkLines(text) {
  let unparsed = 0;
  for (const line of text.split('\n')) {
    if (LOOKS_LIKE_LINK.test(line) && !LINK_ITEM.test(line)) unparsed++;
  }
  return unparsed;
}

/**
 * @param {string} path
 * @returns {string}
 */
function buildUrl(path) {
  if (/^https?:\/\//.test(path)) return path;
  if (path.startsWith('/docs/') || path === '/docs') return `https://coolify.io${path}`;
  return `${DOCS_BASE_URL}${path.startsWith('/') ? '' : '/'}${path}`;
}
