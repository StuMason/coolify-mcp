#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { CoolifyMcpServer } from './lib/mcp-server.js';
import { parseHeaders } from './lib/parse-headers.js';
import { checkStartupConfig, mergeCfAccessHeaders } from './lib/startup-check.js';
import type { CoolifyConfig } from './types/coolify.js';

async function main(): Promise<void> {
  // `npx @masonator/coolify-mcp doctor` (#368): diagnose the environment and
  // exit — checked before the transport switch so it works in any config.
  if (process.argv[2] === 'doctor') {
    const args = process.argv.slice(3);
    const unknown: string[] = [];
    for (let i = 0; i < args.length; i++) {
      if (args[i] === '--json') continue;
      if (args[i] === '--header') {
        i++; // its value
        continue;
      }
      unknown.push(args[i]);
    }
    if (unknown.length > 0) {
      console.log(
        'usage: coolify-mcp doctor [--json] [--header "Key: Value"]\n' +
          'Reads COOLIFY_BASE_URL, COOLIFY_ACCESS_TOKEN and the CF_ACCESS_* pair from the environment. Network probes time out after 10s each.',
      );
      process.exitCode = unknown.includes('--help') ? 0 : 2;
      return;
    }
    const { runDoctorCli } = await import('./lib/doctor.js');
    // exitCode + return (never process.exit): stdout may be a pipe (--json | jq)
    // and exit() would truncate whatever is still buffered.
    process.exitCode = await runDoctorCli(
      process.env,
      args.includes('--json'),
      fetch,
      console.log,
      parseHeaders(process.argv),
    );
    return;
  }

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

  // CF Access headers from env, overridable by --header flags (case-insensitively).
  const customHeaders = mergeCfAccessHeaders(process.env, parseHeaders(process.argv));

  const config: CoolifyConfig = {
    baseUrl: process.env.COOLIFY_BASE_URL || 'http://localhost:3000',
    accessToken: process.env.COOLIFY_ACCESS_TOKEN || '',
    customHeaders: Object.keys(customHeaders).length > 0 ? customHeaders : undefined,
  };

  if (!config.accessToken) {
    throw new Error('COOLIFY_ACCESS_TOKEN environment variable is required');
  }

  const server = new CoolifyMcpServer(config);
  const transport = new StdioServerTransport();

  await server.connect(transport);
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
