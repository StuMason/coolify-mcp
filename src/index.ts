#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { CoolifyMcpServer } from './lib/mcp-server.js';
import { parseHeaders } from './lib/parse-headers.js';
import { checkStartupConfig } from './lib/startup-check.js';
import { registryFromEnv } from './lib/instances.js';

async function main(): Promise<void> {
  // One image, two transports (#303): MCP_TRANSPORT=http hands over to the
  // HTTP entry point, so a container platform needs an env var rather than a
  // command override. Anything else (including unset) is stdio, unchanged.
  if (process.env.MCP_TRANSPORT === 'http') {
    await import('./http.js');
    return;
  }

  // Startup self-check (#368): most "it's broken" reports are the
  // environment, so say what's wrong with it before failing somewhere deep.
  // stderr is safe on stdio — the protocol owns stdout only.
  const check = checkStartupConfig(process.env, 'stdio');
  for (const warning of check.warnings) console.error(`coolify-mcp: warning: ${warning}`);
  if (check.errors.length > 0) {
    console.error('coolify-mcp cannot start:');
    for (const problem of check.errors) console.error(`  - ${problem}`);
    process.exit(1);
  }

  if (!process.env.COOLIFY_ACCESS_TOKEN && !process.env.COOLIFY_INSTANCES) {
    throw new Error('COOLIFY_ACCESS_TOKEN environment variable is required');
  }

  // The instance registry (#367): the single-instance vars (with CF Access
  // headers and --header flags merged in) define "default"; COOLIFY_INSTANCES
  // adds more and switches on the fleet surface. Registry errors name the
  // entry and the problem, never a value.
  const registry = registryFromEnv(
    {
      ...process.env,
      // The historical localhost default applies only to a pure single-instance
      // config. With COOLIFY_INSTANCES set, a lingering COOLIFY_ACCESS_TOKEN
      // must not conjure a phantom "default" pointing at localhost — and then
      // become the instance every un-qualified call goes to.
      COOLIFY_BASE_URL:
        process.env.COOLIFY_BASE_URL ||
        (process.env.COOLIFY_INSTANCES ? undefined : 'http://localhost:3000'),
    },
    parseHeaders(process.argv),
  );

  const server = new CoolifyMcpServer(registry);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
