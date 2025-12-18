#!/usr/bin/env node

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CoolifyMcpServer } from './lib/mcp-server.js';
import type { CoolifyConfig } from './types/coolify.js';

async function main(): Promise<void> {
  const config: CoolifyConfig = {
    baseUrl: process.env.COOLIFY_BASE_URL || 'http://localhost:3000',
    accessToken: process.env.COOLIFY_ACCESS_TOKEN || '',
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
