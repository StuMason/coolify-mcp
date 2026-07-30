// @ts-check
import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import sitemap from '@astrojs/sitemap';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SITE = 'https://coolify-mcp.stumason.dev';

/**
 * Tool count, read from the server source at build time and inlined.
 *
 * Never hardcode this on the page. The old site said "42 consolidated tools"
 * in one block and "44" in the hero of the same page, and the star count was
 * quoted three different ways across the repo. Anything a human has to remember
 * to update is wrong within a release or two.
 *
 * Done here rather than in a module the page imports, because that module gets
 * bundled into dist/ and `import.meta.url` no longer points anywhere near the
 * repo root at runtime. Here it runs exactly once, at build, in the site dir.
 */
function countTools() {
  const src = readFileSync(
    fileURLToPath(new URL('../src/lib/mcp-server.ts', import.meta.url)),
    'utf8',
  );
  const n = (src.match(/this\.defineTool\(/g) ?? []).length;
  if (n < 20) {
    throw new Error(
      `Counted only ${n} tools in src/lib/mcp-server.ts — the registration shape has probably ` +
        `changed. Fix that rather than shipping a wrong number on the marketing site.`,
    );
  }
  return n;
}

export default defineConfig({
  site: SITE,
  // SSR, not static: the contact form posts to /api/contact, which needs a
  // server at runtime. The landing page itself is prerendered.
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  integrations: [sitemap()],
  /**
   * The old VitePress site had ~14 indexed pages. Collapsing to one page would
   * 404 every one of them — including five linked from the README of a repo
   * with 500+ stars, and whatever Google still has indexed. 301s send that
   * authority to the new page instead of throwing it away.
   *
   * Deep sections point at the anchor that replaced them, not just `/`, so an
   * inbound link about security lands on the security copy.
   */
  redirects: {
    '/guide': '/#install',
    '/guide/installation': '/#install',
    '/guide/quickstart': '/#install',
    '/guide/troubleshooting': '/#install',
    '/tools': '/#tools',
    '/tools/': '/#tools',
    '/concepts': '/#tools',
    '/concepts/how-it-works': '/#tools',
    '/concepts/mcp-primer': '/#tools',
    '/concepts/security': '/#safety',
    '/concepts/coolify-api-gotchas': '/#tools',
    '/contributing': 'https://github.com/StuMason/coolify-mcp/blob/main/CONTRIBUTING.md',
    '/contributing/adding-tools':
      'https://github.com/StuMason/coolify-mcp/blob/main/CONTRIBUTING.md',
    '/contributing/testing': 'https://github.com/StuMason/coolify-mcp/blob/main/CONTRIBUTING.md',
    '/contributing/pr-flow': 'https://github.com/StuMason/coolify-mcp/blob/main/CONTRIBUTING.md',
    '/roadmap': 'https://github.com/StuMason/coolify-mcp/issues',
    '/roadmap/': 'https://github.com/StuMason/coolify-mcp/issues',
    '/roadmap/v3-vision': 'https://github.com/StuMason/coolify-mcp/issues/259',
    '/changelog': 'https://github.com/StuMason/coolify-mcp/blob/main/CHANGELOG.md',
    '/hire': '/#hire',
  },
  // Astro's built-in checkOrigin rejected same-origin browser submissions to
  // /api/contact with a 403 — verified with a real browser fetch, and with the
  // configured `site` pointed at the dev host so origin, host and site all
  // matched. Rather than ship a contact form that silently 403s in production,
  // the origin check is done explicitly in the endpoint, where it is testable.
  security: { checkOrigin: false },
  build: { inlineStylesheets: 'always' },
  vite: {
    define: { __TOOL_COUNT__: JSON.stringify(countTools()) },
    build: { assetsInlineLimit: 4096 },
  },
});
