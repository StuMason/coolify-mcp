import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { CoolifyMcpServer, FLEET_ONLY_TOOLS, TOOL_ANNOTATIONS } from '../lib/mcp-server.js';
import { InstanceRegistry, UnknownInstanceError, registryFromEnv } from '../lib/instances.js';

const PROD = 'https://prod.example.com';
const STAGING = 'https://staging.example.com';
const PROD_TOKEN = '1|prodsentineltokenprodsentineltokenprodsentin';
const STAGING_TOKEN = '2|stagingsentineltokenstagingsentineltokenstag';

function fleetRegistry(): InstanceRegistry {
  return new InstanceRegistry([
    { name: 'prod', baseUrl: PROD, accessToken: PROD_TOKEN },
    { name: 'staging', baseUrl: STAGING, accessToken: STAGING_TOKEN },
  ]);
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

/**
 * A fetch that answers for both hosts and makes the routing visible: the
 * version string carries the hostname, and each host has one running app.
 */
function fleetFetch(): jest.Mock {
  return jest.fn(async (url: unknown) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname.replace('/api/v1', '');
    if (path === '/version') return new Response(`4.1.2 via ${parsed.hostname}`, { status: 200 });
    if (path === '/applications') {
      return jsonResponse([
        {
          uuid: `app-${parsed.hostname}`,
          name: `api-${parsed.hostname}`,
          status: 'running:healthy',
        },
      ]);
    }
    return jsonResponse({ message: 'Not found.', docs: 'https://coolify.io/docs' }, 404);
  });
}

interface Harness {
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
  listTools: () => Promise<
    Array<{ name: string; inputSchema: { properties?: Record<string, unknown> } }>
  >;
  prompts: string[];
  close: () => Promise<void>;
}

async function connect(server: CoolifyMcpServer, withElicitation = false): Promise<Harness> {
  const client = new Client(
    { name: 'fleet-test', version: '0' },
    withElicitation ? { capabilities: { elicitation: {} } } : {},
  );
  const prompts: string[] = [];
  if (withElicitation) {
    client.setRequestHandler('elicitation/create', async (request) => {
      prompts.push(request.params.message);
      return { action: 'decline' as const };
    });
  }
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return {
    prompts,
    call: async (name, args) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        content: Array<{ type: string; text: string }>;
      };
      return result.content.map((c) => c.text).join('\n');
    },
    listTools: async () =>
      (await client.listTools()).tools as unknown as Array<{
        name: string;
        inputSchema: { properties?: Record<string, unknown> };
      }>,
    close: () => client.close(),
  };
}

describe('registryFromEnv', () => {
  it('builds a single "default" instance from the classic vars, with no fleet surface', () => {
    const registry = registryFromEnv({
      COOLIFY_BASE_URL: 'https://coolify.example.com/',
      COOLIFY_ACCESS_TOKEN: PROD_TOKEN,
    });
    expect(registry.isFleet).toBe(false);
    expect(registry.names).toEqual(['default']);
    expect(registry.default.baseUrl).toBe('https://coolify.example.com');
    expect(registry.get()).toBe(registry.default);
    expect(registry.get('')).toBe(registry.default);
  });

  it('keeps the classic vars as the default when COOLIFY_INSTANCES is added alongside', () => {
    const registry = registryFromEnv({
      COOLIFY_BASE_URL: PROD,
      COOLIFY_ACCESS_TOKEN: PROD_TOKEN,
      CF_ACCESS_CLIENT_ID: 'id',
      CF_ACCESS_CLIENT_SECRET: 'secret',
      COOLIFY_INSTANCES: JSON.stringify([
        { name: 'staging', url: `${STAGING}/`, token: STAGING_TOKEN, headers: { 'X-Proxy': 'v' } },
      ]),
    });
    expect(registry.isFleet).toBe(true);
    expect(registry.names).toEqual(['default', 'staging']);
    // CF Access headers belong to the default instance only.
    expect(registry.default.customHeaders?.['CF-Access-Client-Id']).toBe('id');
    const staging = registry.get('staging');
    expect(staging.baseUrl).toBe(STAGING);
    expect(staging.customHeaders).toEqual({ 'X-Proxy': 'v' });
  });

  it('makes the first COOLIFY_INSTANCES entry the default when the classic vars are absent', () => {
    const registry = registryFromEnv({
      COOLIFY_INSTANCES: JSON.stringify([
        { name: 'prod', url: PROD, token: PROD_TOKEN },
        { name: 'staging', url: STAGING, token: STAGING_TOKEN },
      ]),
    });
    expect(registry.default.name).toBe('prod');
    expect(registry.isFleet).toBe(true);
  });

  it('names the unknown instance and lists the valid ones', () => {
    const registry = fleetRegistry();
    expect(() => registry.get('nope')).toThrow(UnknownInstanceError);
    expect(() => registry.get('nope')).toThrow('Configured instances: prod, staging');
    // "all" is reserved for fan-out on the tools that support it, not a name.
    expect(() => registry.get('all')).toThrow(UnknownInstanceError);
  });

  it('rejects every malformed COOLIFY_INSTANCES shape with a message that names the entry', () => {
    const bad: Array<[string, string]> = [
      ['not json', 'not valid JSON'],
      ['{"name":"x"}', 'must be a JSON array'],
      ['[42]', 'is not an object'],
      ['[{"url":"https://x","token":"t"}]', 'needs a "name"'],
      ['[{"name":"bad name!","url":"https://x","token":"t"}]', 'needs a "name"'],
      ['[{"name":"all","url":"https://x","token":"t"}]', 'reserved'],
      ['[{"name":"p","url":"x.example.com","token":"t"}]', 'needs a "url"'],
      ['[{"name":"p","url":"https://x"}]', 'needs a "token"'],
      ['[{"name":"p","url":"https://x","token":"${COOLIFY_TOKEN}"}]', 'unexpanded'],
      [
        '[{"name":"p","url":"https://x","token":"t","headers":"nope"}]',
        '"headers" must be an object',
      ],
      ['[{"name":"p","url":"https://x","token":"t","headers":{"H":1}}]', 'must be a string'],
      [
        '[{"name":"p","url":"https://x","token":"t"},{"name":"p","url":"https://y","token":"u"}]',
        'configured twice',
      ],
    ];
    for (const [json, expected] of bad) {
      expect(() => registryFromEnv({ COOLIFY_INSTANCES: json })).toThrow(expected);
    }
    expect(() => registryFromEnv({})).toThrow('No Coolify instance configured');
  });

  it('never echoes a token in a registry error', () => {
    const cases = [
      '[{"name":"bad name","url":"https://x","token":"sentinelsecret"}]',
      '[{"name":"p","url":"nope","token":"sentinelsecret"}]',
      '[{"name":"p","url":"https://x","token":"sentinelsecret${X}"}]',
    ];
    for (const json of cases) {
      let message = '';
      try {
        registryFromEnv({ COOLIFY_INSTANCES: json });
      } catch (error) {
        message = (error as Error).message;
      }
      expect(message).not.toBe('');
      expect(message).not.toContain('sentinelsecret');
    }
  });
});

describe('fleet mode (#367)', () => {
  const realFetch = global.fetch;
  let fetchMock: jest.Mock;
  beforeEach(() => {
    fetchMock = fleetFetch();
    global.fetch = fetchMock as unknown as typeof fetch;
  });
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('single-instance servers expose no fleet surface at all', async () => {
    const h = await connect(new CoolifyMcpServer({ baseUrl: PROD, accessToken: PROD_TOKEN }));
    const tools = await h.listTools();
    expect(tools.some((t) => t.name === 'list_instances')).toBe(false);
    expect(tools.some((t) => 'instance' in (t.inputSchema.properties ?? {}))).toBe(false);
    await h.close();
  });

  it('adds an optional `instance` to every tool and registers list_instances', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry()));
    const tools = await h.listTools();
    expect(tools.some((t) => t.name === 'list_instances')).toBe(true);
    for (const tool of tools) {
      if (FLEET_ONLY_TOOLS.has(tool.name as keyof typeof TOOL_ANNOTATIONS)) continue;
      expect(tool.inputSchema.properties?.instance).toMatchObject({ type: 'string' });
    }
    await h.close();
  });

  it('keeps the annotations table and a fleet server exactly in step', () => {
    const server = new CoolifyMcpServer(fleetRegistry());
    const registered = (server as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    expect(Object.keys(TOOL_ANNOTATIONS).sort()).toEqual(Object.keys(registered).sort());
    for (const name of FLEET_ONLY_TOOLS) expect(registered[name]).toBeDefined();
  });

  it('routes each call to the named instance, defaulting to the first', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry()));
    expect(await h.call('get_version', { instance: 'staging' })).toContain('staging.example.com');
    expect(await h.call('get_version', {})).toContain('prod.example.com');
    // The token that went with the request belongs to that instance.
    const stagingCall = fetchMock.mock.calls.find(([url]) => String(url).startsWith(STAGING));
    const headers = (stagingCall?.[1] as RequestInit).headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${STAGING_TOKEN}`);
    await h.close();
  });

  it('keeps concurrent calls against different instances apart', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry()));
    const [staging, prod] = await Promise.all([
      h.call('get_infrastructure_overview', { instance: 'staging' }),
      h.call('get_infrastructure_overview', { instance: 'prod' }),
    ]);
    expect(staging).not.toContain('prod.example.com');
    expect(prod).not.toContain('staging.example.com');
    for (const [url] of fetchMock.mock.calls) {
      expect(String(url)).toMatch(/^https:\/\/(prod|staging)\.example\.com\//);
    }
    await h.close();
  });

  it('rejects an unknown instance with the list of valid names, before any request', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry()));
    const text = await h.call('get_version', { instance: 'nope' });
    expect(text).toContain('Unknown instance "nope"');
    expect(text).toContain('prod, staging');
    expect(fetchMock).not.toHaveBeenCalled();
    await h.close();
  });

  it('list_instances reports name, url, default and live version — never a token', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry()));
    const text = await h.call('list_instances', {});
    const rows = JSON.parse(text) as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.name)).toEqual(['prod', 'staging']);
    expect(rows[0].default).toBe(true);
    expect(rows[1].default).toBe(false);
    expect(rows[1].version).toContain('staging.example.com');
    expect(text).not.toContain('sentineltoken');
    await h.close();
  });

  it('names the instance in every destructive confirmation', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry()), true);
    await h.call('stop_all_apps', { instance: 'staging', confirm: true });
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toContain('staging');
    expect(h.prompts[0]).not.toContain('prod');
    await h.close();
  });

  it('never forwards `instance` into a Coolify request body', async () => {
    // Several handlers rest-spread their args into the request body
    // (application update, database, github_apps, database_backups) and
    // upstream 422s on unknown fields — so `instance` must be stripped at
    // the chokepoint, not trusted to each handler.
    fetchMock.mockImplementation(async (url: unknown, init?: unknown) => {
      const method = (init as RequestInit | undefined)?.method ?? 'GET';
      if (method === 'POST') return jsonResponse({ uuid: 'backup-1' }, 201);
      return jsonResponse({ message: 'Not found.', docs: 'x' }, 404);
    });
    const h = await connect(new CoolifyMcpServer(fleetRegistry()));
    const text = await h.call('database_backups', {
      action: 'create',
      database_uuid: 'db-1',
      frequency: '0 0 * * *',
      instance: 'staging',
    });
    expect(text).toContain('backup-1');
    const post = fetchMock.mock.calls.find(
      ([, init]) => (init as RequestInit | undefined)?.method === 'POST',
    );
    expect(String(post?.[0])).toBe(`${STAGING}/api/v1/databases/db-1/backups`);
    const body = JSON.parse(String((post?.[1] as RequestInit).body)) as Record<string, unknown>;
    expect(body).not.toHaveProperty('instance');
    expect(body.frequency).toBe('0 0 * * *');
    await h.close();
  });

  it('list_instances takes no instance argument, so a wrong name can never break it', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry()));
    const tools = await h.listTools();
    const listInstances = tools.find((t) => t.name === 'list_instances');
    expect(listInstances?.inputSchema.properties?.instance).toBeUndefined();
    // An unknown key is dropped by the schema rather than rejected.
    const text = await h.call('list_instances', { instance: 'nope' });
    expect(text).toContain('"prod"');
    await h.close();
  });

  it('read-only fleet servers still carry the instance argument and list_instances', async () => {
    const h = await connect(new CoolifyMcpServer(fleetRegistry(), { readonly: true }));
    const tools = await h.listTools();
    expect(tools.some((t) => t.name === 'list_instances')).toBe(true);
    expect(tools.some((t) => t.name === 'stop_all_apps')).toBe(false);
    for (const tool of tools) {
      if (FLEET_ONLY_TOOLS.has(tool.name as keyof typeof TOOL_ANNOTATIONS)) continue;
      expect(tool.inputSchema.properties?.instance).toBeDefined();
    }
    await h.close();
  });
});
