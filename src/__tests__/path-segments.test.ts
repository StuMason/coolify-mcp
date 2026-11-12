/**
 * Identifiers can only ever name one resource on the route a method meant.
 *
 * Tool arguments are model-chosen text, and every client method interpolates
 * one or more of them into a request path. Unencoded, `x/../../other/route`
 * or `uuid/restart` reaches a different endpoint than the tool's own, which
 * matters most in read-only mode, where the mutating tools do not exist.
 */
import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { CoolifyClient, pathSegment } from '../lib/coolify-client.js';
import { CoolifyMcpServer } from '../lib/mcp-server.js';

const BASE = 'http://coolify.test';
const fetched: string[] = [];

beforeEach(() => {
  fetched.length = 0;
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    fetched.push(String(input));
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

/** Payloads that leave a single path segment on an unencoded interpolation. */
const HOSTILE = [
  'x/../../applications/target/start',
  'target/restart',
  'x?force=true',
  'x#',
  'x\\..\\..\\applications\\target\\start',
  '.\t.',
  '%2e%2e',
  'a%2fb',
  '..',
  '.',
  '',
];

describe('pathSegment', () => {
  it('encodes the characters that would end the path or start a query', () => {
    expect(pathSegment('a?c#d%f')).toBe('a%3Fc%23d%25f');
  });

  // Laravel decodes the path before matching a route, so an encoded separator
  // would still select a deeper route. Refusing is the only safe answer.
  it.each(['a/b', 'uuid/restart', 'a\\b', '/', 'production/../x'])(
    'refuses %j, because Coolify would decode an encoded separator',
    (value) => {
      expect(() => pathSegment(value)).toThrow('Invalid identifier');
    },
  );

  it('passes ordinary ids and numbers through unchanged', () => {
    expect(pathSegment('xs0sgs4gog044s4k4c88kgsc')).toBe('xs0sgs4gog044s4k4c88kgsc');
    expect(pathSegment(42)).toBe('42');
  });

  it.each(['', '.', '..'])('refuses %j, which encoding leaves meaningful', (value) => {
    expect(() => pathSegment(value)).toThrow('Invalid identifier');
  });
});

describe('CoolifyClient request paths', () => {
  const client = new CoolifyClient({ baseUrl: BASE, accessToken: 't' });

  it.each(HOSTILE)('getServer(%j) requests that one server or nothing', async (uuid) => {
    await client.getServer(uuid).catch(() => undefined);

    for (const url of fetched) {
      const parsed = new URL(url);
      expect(parsed.search).toBe('');
      const segments = parsed.pathname.split('/');
      expect(segments.slice(0, 4)).toEqual(['', 'api', 'v1', 'servers']);
      expect(segments).toHaveLength(5);
      expect(decodeURIComponent(segments[4])).toBe(uuid);
    }
  });

  it('refuses a dot segment that reaches the request layer unencoded', async () => {
    const request = (client as unknown as { request(path: string): Promise<unknown> }).request.bind(
      client,
    );

    for (const path of ['/servers/x/../../teams', '/servers/%2e%2E/x', '/servers/a\\b']) {
      await expect(request(path)).rejects.toThrow('Invalid identifier');
    }
    expect(fetched).toEqual([]);
  });
});

async function connect(options: { readonly?: boolean } = {}): Promise<Client> {
  const server = new CoolifyMcpServer({ baseUrl: BASE, accessToken: 't' }, options);
  const client = new Client({ name: 'test', version: '0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

describe('tool arguments cannot leave their route', () => {
  it('a read-only server cannot be steered to a mutating endpoint', async () => {
    const client = await connect({ readonly: true });
    try {
      const result = await client.callTool({
        name: 'get_server',
        arguments: { uuid: 'x/../../applications/target/start' },
      });

      expect(result.isError).toBe(true);
      expect(fetched.filter((url) => url.includes('/applications/'))).toEqual([]);
    } finally {
      await client.close();
    }
  });

  // Every string argument of every tool and action, set to a value that would
  // both traverse and inject a query parameter if it reached a path raw. Run
  // twice: once with the uuid fields hostile too, and once with them valid, so
  // the free-text fields beside them (environment names, tags) get past the
  // schema and reach the client. Catches a field nobody remembered to encode.
  it.each([
    ['hostile', 'zz/../../MARK/start?MARK=1'],
    ['valid', 'abc123'],
  ])(
    'no string argument of any tool reaches a request path raw (uuids %s)',
    async (_, uuid) => {
      const MARK = 'zz/../../MARK/start?MARK=1';
      const client = await connect();
      try {
        const { tools } = await client.listTools();
        for (const tool of tools) {
          const props = (tool.inputSchema.properties ?? {}) as Record<
            string,
            { type?: string; enum?: unknown[]; items?: { type?: string } }
          >;
          const actions = (props.action?.enum as string[] | undefined) ?? [undefined];
          for (const action of actions) {
            const args: Record<string, unknown> = {};
            for (const [key, schema] of Object.entries(props)) {
              const value = key.endsWith('uuid') || key.endsWith('uuids') ? uuid : MARK;
              if (key === 'action') args.action = action;
              else if (schema.enum) args[key] = schema.enum[0];
              else if (schema.type === 'string') args[key] = value;
              else if (schema.type === 'array' && schema.items?.type === 'string')
                args[key] = [value];
              else if (schema.type === 'boolean') args[key] = key !== 'wait';
              else if (schema.type === 'number' || schema.type === 'integer') args[key] = 1;
            }
            if (action === undefined) delete args.action;
            await client.callTool({ name: tool.name, arguments: args }).catch(() => undefined);
          }
        }

        expect(fetched.length).toBeGreaterThan(0);
        const leaked = fetched.filter((url) => {
          const parsed = new URL(url);
          return parsed.pathname.split('/').includes('MARK') || parsed.searchParams.has('MARK');
        });
        expect(leaked).toEqual([]);
      } finally {
        await client.close();
      }
    },
    60_000,
  );

  // Resource templates take their identifier from a URI, not a tool schema,
  // and are registered in read-only mode too.
  it.each([
    'coolify://application/x%2F..%2F..%2Fapplications%2Ftarget%2Fstart',
    'coolify://application/..',
    'coolify://application/%2e%2e',
  ])('resources/read %s stays on its route', async (uri) => {
    const client = await connect({ readonly: true });
    try {
      await client.readResource({ uri }).catch(() => undefined);
      for (const url of fetched) {
        const segments = new URL(url).pathname.split('/');
        expect(segments.slice(0, 4)).toEqual(['', 'api', 'v1', 'applications']);
        expect(segments).toHaveLength(5);
      }
    } finally {
      await client.close();
    }
  });
});
