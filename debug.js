import { CoolifyMcpServer } from './dist/lib/mcp-server.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

const server = new CoolifyMcpServer({
  baseUrl: process.env.COOLIFY_BASE_URL || 'https://coolify.dev',
  accessToken: process.env.COOLIFY_ACCESS_TOKEN || 'your-token-here',
});

const transport = new StdioServerTransport();
await server.connect(transport);
