/**
 * Boots the real MCP server (dist/index.js, stdio) against a fixture backend
 * and exposes its tools as an AI SDK ToolSet, so evals exercise the exact
 * tool names, descriptions and schemas a client sees — not a re-declaration
 * that could drift.
 */

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { jsonSchema, tool, type ToolSet } from 'ai';
import { existsSync } from 'node:fs';
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
  // First command a contributor hits after editing a tool description; a clear
  // message beats an opaque stdio transport error if the build is stale.
  if (!existsSync(SERVER_ENTRY)) {
    throw new Error(
      `Server build not found at ${SERVER_ENTRY}. Run \`npm run build\` in the repo root first.`,
    );
  }

  const fixture = await startFixture();
  try {
    return await connectHarness(fixture);
  } catch (err) {
    // The fixture HTTP server is already listening; if the client fails to
    // connect (stale build, transport mismatch) leaving it open makes vitest
    // hang on the handle instead of reporting the real error. Close it, rethrow.
    await fixture.close().catch(() => {});
    throw err;
  }
}

async function connectHarness(fixture: FixtureHandle): Promise<EvalContext> {
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [SERVER_ENTRY],
    env: {
      ...process.env,
      COOLIFY_BASE_URL: fixture.url,
      COOLIFY_ACCESS_TOKEN: FIXTURE_TOKEN,
    },
  });
  // Advertise elicitation and DECLINE every prompt — i.e. a cautious human who
  // says "no" to any destructive confirmation. This makes the eval faithful to
  // production: the server gates destructive tools (control, deploy, database,
  // …) behind `confirmDestructive`, which only fires when the client advertises
  // this capability; without it the guard fail-opens and the op runs, so the
  // harness would otherwise measure the model's raw inclination with the
  // human-in-the-loop safety net removed (the FINDINGS #5 caveat). Declining
  // means a destructive call the model makes is blocked before it mutates —
  // exactly what a real client's user would do faced with "restart app-api?".
  const client = new Client(
    { name: 'coolify-mcp-evals', version: '0.0.0' },
    { capabilities: { elicitation: {} } },
  );
  client.setRequestHandler(ElicitRequestSchema, async () => ({ action: 'decline' as const }));
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
          // `result.isError` isn't special-cased: a tool error round-trips to
          // the model as an ordinary result, which is exactly what a real AI
          // SDK client sees, so the eval measures the same behaviour.
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
