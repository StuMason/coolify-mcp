#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { CoolifyMcpServer } from './lib/mcp-server.js';
import { parseHeaders } from './lib/parse-headers.js';
import type { CoolifyConfig } from './types/coolify.js';

async function main(): Promise<void> {
  // One image, two transports (#303): MCP_TRANSPORT=http hands over to the
  // HTTP entry point, so a container platform needs an env var rather than a
  // command override. Anything else (including unset) is stdio, unchanged.
  if (process.env.MCP_TRANSPORT === 'http') {
    await import('./http.js');
    return;
  }

  const customHeaders = parseHeaders(process.argv);

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
