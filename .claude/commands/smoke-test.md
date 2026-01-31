---
description: 'Build and run smoke tests against the live Coolify server'
allowed-tools: ['Bash', 'Read', 'Grep', 'Glob']
---

# Smoke Test

Build the project and run integration smoke tests against the live Coolify instance to verify fixes work end-to-end.

## Workflow

### 1. Build

```bash
npm run build
```

If build fails, stop and report the error.

### 2. Run integration tests

```bash
npm run test:integration -- --testPathPattern=smoke
```

Report which tests passed and failed.

### 3. Quick manual checks (optional)

If an argument is provided (e.g. `/smoke-test version`), run targeted checks:

#### version

Verify the VERSION export matches package.json:

```bash
node --input-type=module -e "import { VERSION } from './dist/lib/mcp-server.js'; import { createRequire } from 'module'; const r = createRequire(import.meta.url); const pkg = r('./package.json'); console.log('MCP VERSION:', VERSION, VERSION === pkg.version ? 'OK' : 'MISMATCH (expected ' + pkg.version + ')');"
```

#### errors

Trigger a validation error against the live API to confirm error handling works:

```bash
node --input-type=module -e "
import { config } from 'dotenv'; config();
import { CoolifyClient } from './dist/lib/coolify-client.js';
const client = new CoolifyClient({ baseUrl: process.env.COOLIFY_URL, accessToken: process.env.COOLIFY_TOKEN });
const servers = await client.listServers();
try {
  await client.createService({ server_uuid: servers[0].uuid, project_uuid: 'nonexistent', environment_name: 'production', docker_compose_raw: 'services:\n  test:\n    image: nginx' });
} catch (e) { console.log('Error handled:', e.message); }
"
```

#### connect

Just verify API connectivity:

```bash
node --input-type=module -e "
import { config } from 'dotenv'; config();
import { CoolifyClient } from './dist/lib/coolify-client.js';
const client = new CoolifyClient({ baseUrl: process.env.COOLIFY_URL, accessToken: process.env.COOLIFY_TOKEN });
const v = await client.getVersion(); console.log('Coolify API:', v);
const servers = await client.listServers(); console.log('Servers:', servers.length);
"
```

### 4. Report

Summarize results concisely: what passed, what failed, any issues found.
