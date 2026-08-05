/**
 * Boots the real MCP server (dist/index.js, stdio) against a fixture backend
 * and exposes its tools as an AI SDK ToolSet, so evals exercise the exact
 * tool names, descriptions and schemas a client sees — not a re-declaration
 * that could drift.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { fileURLToPath } from 'node:url';
import { FIXTURE_TOKEN } from '../fixture/data.js';
import { startFixture, type FixtureHandle } from '../fixture/server.js';

const SERVER_ENTRY = fileURLToPath(new URL('../../../dist/index.js', import.meta.url));

export interface McpToolInfo {
  name: string;
  description?: string;
  inputSchema: unknown;
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export interface EvalContext {
  fixture: FixtureHandle;
  client: Client;
  /** Raw tools/list entries, annotations included. */
  toolInfo: McpToolInfo[];
  /** The same tools as an AI SDK ToolSet whose execute() round-trips through the server. */
  toolSet: ToolSet;
  /** Tool names the server marks read-only / destructive — derived, never hand-listed. */
  readOnlyTools: string[];
  destructiveTools: string[];
  close(): Promise<void>;
}

export async function createEvalContext(): Promise<EvalContext> {
  const fixture = await startFixture();

  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      COOLIFY_BASE_URL: fixture.url,
      COOLIFY_ACCESS_TOKEN: FIXTURE_TOKEN,
    },
  });
  const client = new Client({ name: 'coolify-mcp-evals', version: '0.0.0' });
  await client.connect(transport);

  const listed = await client.listTools();
  const toolInfo = listed.tools as unknown as McpToolInfo[];

  const toolSet: ToolSet = Object.fromEntries(
    toolInfo.map((t) => [
      t.name,
      tool({
        description: t.description,
        inputSchema: jsonSchema(t.inputSchema as Parameters<typeof jsonSchema>[0]),
        execute: async (args: unknown) => {
          const result = await client.callTool({
            name: t.name,
            arguments: args as Record<string, unknown>,
          });
          return JSON.stringify(result.content);
        },
      }),
    ]),
  );

  return {
    fixture,
    client,
    toolInfo,
    toolSet,
    readOnlyTools: toolInfo.filter((t) => t.annotations?.readOnlyHint === true).map((t) => t.name),
    destructiveTools: toolInfo
      .filter((t) => t.annotations?.destructiveHint === true)
      .map((t) => t.name),
    close: async () => {
      await client.close();
      await fixture.close();
    },
  };
}
