import type { APIRoute } from 'astro';
import { DOCS, TOOL_COUNT, VERSION, rawUrl } from '../data/tools.ts';

// llms.txt (https://llmstxt.org): a map of the documentation for anything
// reading this site on a person's behalf — which, for an MCP server, is most
// of the audience. Generated at build from the same data the page uses, so it
// cannot drift from it. /llms-full.txt carries the documents themselves.
export const prerender = true;

const SITE = 'https://coolify-mcp.stumason.dev';

const body = [
  '# coolify-mcp',
  '',
  `> Open-source MCP server (v${VERSION}, MIT) that lets Claude, Cursor or any MCP client operate a self-hosted Coolify platform: ${TOOL_COUNT} tools for deploying, diagnosing, configuring and operating applications, databases and services. Destructive operations ask a human first; secrets are masked at the API boundary. Runs locally over stdio, or as a container inside Coolify with OAuth 2.1 for remote clients, and can manage several Coolify instances at once.`,
  '',
  'Install: `npx @masonator/coolify-mcp` with COOLIFY_BASE_URL and COOLIFY_ACCESS_TOKEN in the environment. Verify a setup with `npx @masonator/coolify-mcp doctor`.',
  '',
  '## Docs',
  '',
  `- [README](${rawUrl('README.md')}): install paths, what it does, safety summary`,
  ...DOCS.map((d) => `- [${d.t}](${rawUrl(d.file)}): ${d.d}`),
  '',
  '## Optional',
  '',
  `- [Full documentation in one file](${SITE}/llms-full.txt)`,
  `- [Source](https://github.com/StuMason/coolify-mcp)`,
  `- [npm](https://www.npmjs.com/package/@masonator/coolify-mcp)`,
  `- [Evals and red teaming](${rawUrl('evals/README.md')}): how tool selection and prompt-injection resistance are measured`,
  '',
].join('\n');

export const GET: APIRoute = () =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
