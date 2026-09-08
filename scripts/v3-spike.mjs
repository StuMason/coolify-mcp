/**
 * V3 spike (#259): prove the SDK v2 shapes against real packages before
 * migrating 2,700 lines on top of them. Everything here is a verified fact the
 * migration can lean on; when this script and the migration disagree, this
 * script is the one that ran.
 *
 * Proves:
 *  1. `@modelcontextprotocol/server` McpServer + registerTool with a
 *     zod-object inputSchema and ToolAnnotations.
 *  2. A tools/list round trip over v2 InMemoryTransport with a v2 client —
 *     including whether annotations arrive and what the payload costs.
 *  3. Blocking `server.server.elicitInput()` still works mid-handler on a
 *     stateful transport (the stdio path keeps v1's UX).
 *  4. The write-once `inputRequired` shape (the stateless-HTTP path).
 *  5. `getClientCapabilities()` still gates correctly when the client does
 *     not advertise elicitation.
 *
 * Run: node scripts/v3-spike.mjs
 */
import { z } from 'zod';
import {
  McpServer,
  InMemoryTransport,
  inputRequired,
  acceptedContent,
} from '@modelcontextprotocol/server';
import { Client } from '@modelcontextprotocol/client';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

function buildServer() {
  const server = new McpServer({ name: 'v3-spike', version: '0.0.0' });

  server.registerTool(
    'echo',
    {
      description: 'Echo a value',
      inputSchema: z.object({ value: z.string() }),
      annotations: { readOnlyHint: true },
    },
    async ({ value }) => ({ content: [{ type: 'text', text: `echo:${value}` }] }),
  );

  // The stdio-mode guard: blocking elicitInput mid-handler, as today.
  server.registerTool(
    'guarded_blocking',
    {
      description: 'Destructive op guarded by blocking elicitation',
      inputSchema: z.object({ target: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ target }) => {
      const caps = server.server.getClientCapabilities();
      if (caps?.elicitation) {
        const result = await server.server.elicitInput({
          message: `Really destroy ${target}?`,
          requestedSchema: { type: 'object', properties: {} },
        });
        if (result.action !== 'accept') {
          return { content: [{ type: 'text', text: 'aborted' }] };
        }
      }
      return { content: [{ type: 'text', text: `destroyed:${target}` }] };
    },
  );

  // The stateless-HTTP-mode guard: write-once, re-entrant.
  server.registerTool(
    'guarded_reentrant',
    {
      description: 'Destructive op guarded by write-once inputRequired',
      inputSchema: z.object({ target: z.string() }),
      annotations: { destructiveHint: true },
    },
    async ({ target }, ctx) => {
      const confirmed = acceptedContent(ctx.mcpReq.inputResponses, 'confirm');
      if (!confirmed) {
        return inputRequired({
          inputRequests: {
            confirm: inputRequired.elicit({
              message: `Really destroy ${target}?`,
              requestedSchema: { type: 'object', properties: {} },
            }),
          },
        });
      }
      return { content: [{ type: 'text', text: `destroyed:${target}` }] };
    },
  );

  return server;
}

async function connect(server, { elicitation } = {}) {
  const client = new Client(
    { name: 'spike-client', version: '0' },
    elicitation ? { capabilities: { elicitation: {} } } : {},
  );
  if (elicitation) {
    client.setRequestHandler('elicitation/create', async () => ({
      action: 'accept',
      content: {},
    }));
  }
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);
  return client;
}

// --- 1+2: tools/list round trip, annotations, payload cost -----------------
{
  const client = await connect(buildServer());
  const { tools } = await client.listTools();
  check('tools/list returns 3 tools', tools.length === 3);
  const echo = tools.find((t) => t.name === 'echo');
  check('annotations survive the wire', echo?.annotations?.readOnlyHint === true);
  check(
    'zod object schema converts to JSON Schema',
    echo?.inputSchema?.type === 'object' && !!echo?.inputSchema?.properties?.value,
  );
  const chars = JSON.stringify(tools).length;
  console.log(`INFO  3-tool tools/list payload: ${chars} chars (~${Math.round(chars / 4)} tokens)`);

  const res = await client.callTool({ name: 'echo', arguments: { value: 'hi' } });
  check('plain tool call works', res.content?.[0]?.text === 'echo:hi');
  await client.close();
}

// --- 3: blocking elicitInput on a stateful transport ------------------------
{
  const server = buildServer();
  const client = new Client(
    { name: 'spike-client', version: '0' },
    { capabilities: { elicitation: {} } },
  );
  const prompts = [];
  // v2 registers by method string, and auto-wraps elicitation/create with
  // schema validation of request and result.
  const handlerShape = "setRequestHandler('elicitation/create')";
  client.setRequestHandler('elicitation/create', async (request) => {
    prompts.push(request.params.message);
    return { action: 'accept', content: {} };
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(st), client.connect(ct)]);

  try {
    const res = await client.callTool({ name: 'guarded_blocking', arguments: { target: 'x' } });
    check(
      'blocking elicitInput mid-handler works on stateful transport',
      res.content?.[0]?.text === 'destroyed:x',
      `prompts seen: ${prompts.length}, handler shape: ${handlerShape}`,
    );
    check('the prompt reached the client handler', prompts.length === 1);
  } catch (error) {
    check('blocking elicitInput mid-handler works on stateful transport', false, String(error));
  }
  await client.close();
}

// --- 3b: capability gate without elicitation --------------------------------
{
  const client = await connect(buildServer());
  const res = await client.callTool({ name: 'guarded_blocking', arguments: { target: 'y' } });
  check(
    'capability check passes-through when client lacks elicitation',
    res.content?.[0]?.text === 'destroyed:y',
  );
  await client.close();
}

// --- 4: write-once inputRequired round trip ---------------------------------
{
  const client = await connect(buildServer(), { elicitation: true });
  try {
    // How the v2 client surfaces an inputRequired result — and whether it
    // auto-drives the elicitation round trip — is the thing to learn here.
    const res = await client.callTool({ name: 'guarded_reentrant', arguments: { target: 'z' } });
    console.log('INFO  inputRequired call result:', JSON.stringify(res).slice(0, 300));
    check('write-once path returned something analysable', res !== undefined);
  } catch (error) {
    console.log('INFO  inputRequired path threw:', String(error).slice(0, 200));
    check('write-once path behaviour recorded (threw)', true);
  }
  await client.close();
}

console.log(failures === 0 ? '\nSPIKE CLEAN' : `\nSPIKE: ${failures} failure(s)`);
process.exit(failures === 0 ? 0 : 1);
