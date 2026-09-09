import type { APIRoute } from 'astro';
import { VERSION } from '../data/tools.ts';
import readme from '../../../README.md?raw';
import tools from '../../../docs/tools.md?raw';
import httpMode from '../../../docs/http-mode.md?raw';
import fleet from '../../../docs/fleet.md?raw';
import doctor from '../../../docs/doctor.md?raw';
import security from '../../../docs/security.md?raw';

// The whole reference as one plain-text document, for a client that wants
// context rather than a map. The markdown is imported verbatim from the repo
// at build time (`?raw`), so this is exactly what docs/ says on the commit the
// site was built from. Keep the import list in step with DOCS in data/tools.ts.
export const prerender = true;

const body = [
  `# coolify-mcp v${VERSION}: full documentation`,
  '',
  'Concatenated from README.md and docs/ at build time. Relative links refer to https://github.com/StuMason/coolify-mcp.',
  '',
  readme,
  '\n---\n',
  tools,
  '\n---\n',
  httpMode,
  '\n---\n',
  fleet,
  '\n---\n',
  doctor,
  '\n---\n',
  security,
].join('\n');

export const GET: APIRoute = () =>
  new Response(body, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
