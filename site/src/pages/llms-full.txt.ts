import type { APIRoute } from 'astro';
import { DOCS, VERSION } from '../data/tools.ts';
import readme from '../../../README.md?raw';

// The whole reference as one plain-text document, for a client that wants
// context rather than a map. The markdown is imported verbatim from the repo
// at build time (`?raw`), so this is exactly what docs/ says on the commit the
// site was built from.
//
// Which files: every DOCS entry under docs/, in DOCS order. The changelog is
// linked from /llms.txt but not inlined — it is long, and history is not
// reference. Adding a doc means adding it to DOCS; a DOCS entry with no file
// behind it fails the build here rather than silently dropping out.
export const prerender = true;

const files = import.meta.glob('../../../docs/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const sections = DOCS.filter((d) => d.file.startsWith('docs/')).map((d) => {
  const key = `../../../${d.file}`;
  const text = files[key];
  if (typeof text !== 'string') {
    throw new Error(`llms-full.txt: DOCS lists ${d.file} but no such file was found at build`);
  }
  return text;
});

const body = [
  `# coolify-mcp v${VERSION}: full documentation`,
  '',
  'Concatenated from README.md and docs/ at build time. Relative links refer to https://github.com/StuMason/coolify-mcp.',
  '',
  readme,
  ...sections.flatMap((text) => ['\n---\n', text]),
].join('\n');

export const GET: APIRoute = () =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
