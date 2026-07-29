/**
 * Elicitation tests (#261).
 *
 * These drive a real `Client` over an in-memory transport rather than stubbing
 * `getClientCapabilities()`, because the thing most likely to be wrong here is
 * the capability negotiation itself: a server that elicits against a client
 * that never advertised support fails at runtime in exactly the environment
 * (Claude Desktop, claude.ai) where nobody is watching a test suite. Declaring
 * the capability on the client and letting the SDK negotiate is the only way
 * the "absent" branch is genuinely absent.
 *
 * Every Coolify call is spied, so no test here talks to an API.
 */
import { describe, it, expect, jest } from '@jest/globals';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { ElicitRequestSchema, type ElicitResult } from '@modelcontextprotocol/sdk/types.js';
import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CoolifyMcpServer } from '../lib/mcp-server.js';
import { confirmDestructive, describeBlastRadius, ELICIT_TIMEOUT_MS } from '../lib/elicit.js';

type Answer = (message: string) => ElicitResult | Promise<ElicitResult>;

const accept: Answer = () => ({ action: 'accept', content: {} });
const decline: Answer = () => ({ action: 'decline' });
const cancel: Answer = () => ({ action: 'cancel' });

interface Harness {
  server: CoolifyMcpServer;
  call: (name: string, args: Record<string, unknown>) => Promise<string>;
  /** Every prompt the client was shown, in order. */
  prompts: string[];
  close: () => Promise<void>;
}

/**
 * Connect a client to a fresh server.
 *
 * Passing no `answer` builds a client that never declares the elicitation
 * capability — the fallback case, and the one that must keep working.
 */
async function harness(answer?: Answer): Promise<Harness> {
  const server = new CoolifyMcpServer({
    baseUrl: 'http://localhost:3000',
    accessToken: 'test-token',
  });
  const client = new Client(
    { name: 'test', version: '0' },
    answer ? { capabilities: { elicitation: {} } } : {},
  );

  const prompts: string[] = [];
  if (answer) {
    client.setRequestHandler(ElicitRequestSchema, async (request) => {
      const { message } = request.params as { message: string };
      prompts.push(message);
      return answer(message);
    });
  }

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

  return {
    server,
    prompts,
    call: async (name, args) => {
      const result = (await client.callTool({ name, arguments: args })) as {
        content: Array<{ type: string; text: string }>;
      };
      return result.content.map((c) => c.text).join('\n');
    },
    close: async () => {
      await client.close();
    },
  };
}

/**
 * Two running apps on two servers, plus one that is genuinely down.
 *
 * Shaped like the real `GET /applications` response, which nests
 * `destination.server_id` and does **not** populate the flat `server_uuid`.
 * An earlier version of this fixture set `server_uuid`, which made the
 * server-count assertion pass against a response shape Coolify never sends —
 * verified against a live 4.1.2 instance.
 */
const APPS = [
  {
    uuid: 'app-1',
    name: 'api',
    status: 'running:healthy',
    destination: { server_id: 1 },
    project_uuid: 'p1',
  },
  {
    uuid: 'app-2',
    name: 'worker',
    status: 'running:healthy',
    destination: { server_id: 2 },
    project_uuid: 'p1',
  },
  {
    uuid: 'app-3',
    name: 'old',
    status: 'exited',
    destination: { server_id: 1 },
    project_uuid: 'p2',
  },
];

function stubEstate(server: CoolifyMcpServer): {
  stopAllApps: jest.SpiedFunction<() => Promise<unknown>>;
} {
  const client = server['client'];
  jest.spyOn(client, 'listApplications').mockResolvedValue(APPS as never);
  const stopAllApps = jest
    .spyOn(client, 'stopAllApps')
    .mockResolvedValue({ summary: { total: 2, succeeded: 2, failed: 0 } } as never);
  return { stopAllApps };
}

describe('elicitation: capability gating', () => {
  it('runs without asking when the client never advertised elicitation', async () => {
    const h = await harness();
    const { stopAllApps } = stubEstate(h.server);

    const text = await h.call('stop_all_apps', { confirm: true });

    // The whole progressive-enhancement promise: an old client is not a
    // blocked client.
    expect(stopAllApps).toHaveBeenCalled();
    expect(h.prompts).toEqual([]);
    expect(text).toContain('succeeded');
    await h.close();
  });

  it('asks, then runs, when the client accepts', async () => {
    const h = await harness(accept);
    const { stopAllApps } = stubEstate(h.server);

    await h.call('stop_all_apps', { confirm: true });

    expect(h.prompts).toHaveLength(1);
    expect(stopAllApps).toHaveBeenCalled();
    await h.close();
  });

  it('does not run when the client declines', async () => {
    const h = await harness(decline);
    const { stopAllApps } = stubEstate(h.server);

    const text = await h.call('stop_all_apps', { confirm: true });

    expect(stopAllApps).not.toHaveBeenCalled();
    expect(text).toContain('the user declined');
    expect(text).toContain('Nothing was changed');
    await h.close();
  });

  it('does not run when the client cancels, and says so distinctly', async () => {
    const h = await harness(cancel);
    const { stopAllApps } = stubEstate(h.server);

    const text = await h.call('stop_all_apps', { confirm: true });

    expect(stopAllApps).not.toHaveBeenCalled();
    // Distinct from a decline: dismissing a dialog is not the same answer as
    // saying no, and a model reading the transcript should be able to tell.
    expect(text).toContain('cancelled the prompt');
    await h.close();
  });

  it('fails closed when the elicitation request itself errors', async () => {
    const h = await harness(() => {
      throw new Error('client blew up');
    });
    const { stopAllApps } = stubEstate(h.server);

    const text = await h.call('stop_all_apps', { confirm: true });

    // A client that advertised the capability and then failed to answer has
    // not given consent. Proceeding here would make the guard decorative.
    expect(stopAllApps).not.toHaveBeenCalled();
    expect(text).toContain('could not confirm with the user');
    await h.close();
  });

  it('still asks when the blast-radius lookup fails', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockRejectedValue(new Error('coolify unreachable'));
    const stopAllApps = jest.spyOn(client, 'stopAllApps').mockResolvedValue({} as never);

    await h.call('stop_all_apps', { confirm: true });

    // Losing the details is a reason to ask a vaguer question, not to skip the
    // question — and the human should be told the lookup failed.
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toContain('Could not load details first');
    expect(h.prompts[0]).toContain('coolify unreachable');
    expect(stopAllApps).toHaveBeenCalled();
    await h.close();
  });

  it('waits longer than the SDK default, because a human is reading it', () => {
    expect(ELICIT_TIMEOUT_MS).toBeGreaterThan(60_000);
  });

  // Both catch blocks stringify whatever was thrown. Nothing guarantees a
  // rejection is an Error — an SDK or a transport can reject with a plain
  // object — and a guard that throws while reporting a failure is a guard that
  // fails open.
  it('survives a non-Error rejection from the blast-radius lookup', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockRejectedValue('just a string' as never);
    const stopAllApps = jest.spyOn(client, 'stopAllApps').mockResolvedValue({} as never);

    await h.call('stop_all_apps', { confirm: true });

    expect(h.prompts[0]).toContain('just a string');
    expect(stopAllApps).toHaveBeenCalled();
    await h.close();
  });

  it('aborts when the client handler throws a bare string', async () => {
    const h = await harness(() => {
      throw 'client threw a string';
    });
    const { stopAllApps } = stubEstate(h.server);

    const text = await h.call('stop_all_apps', { confirm: true });

    expect(stopAllApps).not.toHaveBeenCalled();
    expect(text).toContain('could not confirm with the user');
    await h.close();
  });

  // Over a real transport the SDK always wraps a rejection into an `McpError`,
  // so the non-Error branch in the `elicitInput` catch cannot be reached from
  // the test above no matter what the client handler throws. Reaching it needs
  // `elicitInput` itself to reject with a non-Error, which only a stub can do.
  it('stringifies a non-Error rejection from elicitInput itself', async () => {
    const stub = {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: () => Promise.reject('raw string failure'),
    } as unknown as Server;

    const outcome = await confirmDestructive(stub, () => 'proceed?');

    expect(outcome.approved).toBe(false);
    expect(outcome.approved === false && outcome.message).toContain('raw string failure');
  });
});

describe('elicitation: blast radius in the prompt', () => {
  it('names the running apps and the server count for stop_all_apps', async () => {
    const h = await harness(accept);
    stubEstate(h.server);

    await h.call('stop_all_apps', { confirm: true });

    const prompt = h.prompts[0];
    expect(prompt).toContain('2 running applications');
    expect(prompt).toContain('api');
    expect(prompt).toContain('worker');
    expect(prompt).toContain('across 2 servers');
    // The stopped app is not part of the blast radius and must not pad the count.
    expect(prompt).not.toContain('old');
    await h.close();
  });

  it('omits the server count when everything is on one server', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([
      { uuid: 'a', name: 'api', status: 'running:healthy', destination: { server_id: 1 } },
      { uuid: 'b', name: 'web', status: 'running:healthy', destination: { server_id: 1 } },
    ] as never);
    jest.spyOn(client, 'stopAllApps').mockResolvedValue({} as never);

    await h.call('stop_all_apps', { confirm: true });

    expect(h.prompts[0]).toContain('2 running applications');
    expect(h.prompts[0]).not.toContain('servers');
    await h.close();
  });

  // Coolify's built-in localhost server is `server_id: 0`. A `.filter(Boolean)`
  // here would discard it, so an estate split across the localhost server and
  // one remote would report "1 server" instead of 2 — undercounting the blast
  // radius, which is the one direction a confirmation must never be wrong in.
  it('counts server_id 0, which is falsy but real', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([
      { uuid: 'a', name: 'api', status: 'running:healthy', destination: { server_id: 0 } },
      { uuid: 'b', name: 'web', status: 'running:healthy', destination: { server_id: 1 } },
    ] as never);
    jest.spyOn(client, 'stopAllApps').mockResolvedValue({} as never);

    await h.call('stop_all_apps', { confirm: true });

    expect(h.prompts[0]).toContain('across 2 servers');
    await h.close();
  });

  // The flat field is still read as a fallback in case a future Coolify
  // populates it on the list endpoint.
  it('falls back to a flat server_uuid when no destination is present', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([
      { uuid: 'a', name: 'api', status: 'running:healthy', server_uuid: 's1' },
      { uuid: 'b', name: 'web', status: 'running:healthy', server_uuid: 's2' },
    ] as never);
    jest.spyOn(client, 'stopAllApps').mockResolvedValue({} as never);

    await h.call('stop_all_apps', { confirm: true });

    expect(h.prompts[0]).toContain('across 2 servers');
    await h.close();
  });

  it('scopes redeploy_project to the project being redeployed', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue(APPS as never);
    const redeploy = jest.spyOn(client, 'redeployProjectApps').mockResolvedValue({} as never);

    await h.call('redeploy_project', { project_uuid: 'p1' });

    expect(h.prompts[0]).toContain('2 applications');
    expect(h.prompts[0]).toContain('api');
    expect(h.prompts[0]).not.toContain('old');
    expect(redeploy).toHaveBeenCalled();
    await h.close();
  });

  it('truncates long lists rather than printing sixty names', () => {
    const many = Array.from({ length: 12 }, (_, i) => `app-${i}`);

    const text = describeBlastRadius('application', many);

    expect(text).toContain('12 applications');
    expect(text).toContain('and 4 more');
    expect(text).not.toContain('app-8');
  });

  it('pluralises a single resource correctly', () => {
    expect(describeBlastRadius('application', ['solo'])).toBe('1 application (solo)');
  });

  it('handles an empty set without inventing a name list', () => {
    expect(describeBlastRadius('application', [])).toBe('0 applications');
  });
});

describe('elicitation: bulk_env_update threshold', () => {
  const args = (count: number): Record<string, unknown> => ({
    app_uuids: Array.from({ length: count }, (_, i) => `app-${i}`),
    key: 'API_KEY',
    value: 'super-secret-value',
  });

  it('does not prompt for a small update', async () => {
    const h = await harness(accept);
    const bulk = jest
      .spyOn(h.server['client'], 'bulkEnvUpdate')
      .mockResolvedValue({ summary: { total: 3 } } as never);

    await h.call('bulk_env_update', args(3));

    // Prompting on routine three-app edits is how people learn to dismiss
    // prompts without reading them.
    expect(h.prompts).toEqual([]);
    expect(bulk).toHaveBeenCalled();
    await h.close();
  });

  it('prompts once the update crosses the threshold', async () => {
    const h = await harness(accept);
    const bulk = jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);

    await h.call('bulk_env_update', args(4));

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toContain('4 applications');
    expect(h.prompts[0]).toContain('API_KEY');
    expect(bulk).toHaveBeenCalled();
    await h.close();
  });

  it('never puts the env var value in the prompt', async () => {
    const h = await harness(accept);
    jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);

    await h.call('bulk_env_update', args(4));

    // The prompt surfaces in client UI and in logs. Naming the key is useful;
    // echoing the value would leak whatever secret is being rotated.
    expect(h.prompts[0]).not.toContain('super-secret-value');
    await h.close();
  });

  it('declining a large update leaves every app untouched', async () => {
    const h = await harness(decline);
    const bulk = jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);

    await h.call('bulk_env_update', args(10));

    expect(bulk).not.toHaveBeenCalled();
    await h.close();
  });
});

describe('elicitation: delete prompts', () => {
  it('warns that omitting delete_volumes still destroys the data', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'getApplication').mockResolvedValue({ uuid: 'app-1', name: 'api' } as never);
    jest.spyOn(client, 'deleteApplication').mockResolvedValue({} as never);

    await h.call('application', { action: 'delete', uuid: 'app-1' });

    // The trap this exists to close: `delete_volumes` is documented
    // `default: true`, so "I left the optional flag off" is the destructive
    // path, not the cautious one.
    expect(h.prompts[0]).toContain('DESTROYED');
    expect(h.prompts[0]).toContain('defaults to true');
    expect(h.prompts[0]).toContain('api');
    await h.close();
  });

  it('says volumes are kept only when delete_volumes is explicitly false', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'getApplication').mockResolvedValue({ uuid: 'app-1', name: 'api' } as never);
    jest.spyOn(client, 'deleteApplication').mockResolvedValue({} as never);

    await h.call('application', { action: 'delete', uuid: 'app-1', delete_volumes: false });

    expect(h.prompts[0]).toContain('Persistent volumes are kept');
    expect(h.prompts[0]).not.toContain('DESTROYED');
    await h.close();
  });

  it('declining a delete does not call the API', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    jest.spyOn(client, 'getDatabase').mockResolvedValue({ uuid: 'db-1', name: 'prod-pg' } as never);
    const del = jest.spyOn(client, 'deleteDatabase').mockResolvedValue({} as never);

    const text = await h.call('database', {
      action: 'delete',
      uuid: 'db-1',
      delete_volumes: true,
    });

    expect(del).not.toHaveBeenCalled();
    expect(text).toContain('Nothing was changed');
    await h.close();
  });

  it('prompts for service deletes too', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'getService').mockResolvedValue({ uuid: 'svc-1', name: 'umami' } as never);
    const del = jest.spyOn(client, 'deleteService').mockResolvedValue({} as never);

    await h.call('service', { action: 'delete', uuid: 'svc-1' });

    expect(h.prompts[0]).toContain('Delete service "umami"');
    expect(del).toHaveBeenCalled();
    await h.close();
  });

  it('prompts for project and environment deletes', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'getProject').mockResolvedValue({ uuid: 'p1', name: 'estate' } as never);
    jest.spyOn(client, 'deleteProject').mockResolvedValue({} as never);
    jest.spyOn(client, 'deleteProjectEnvironment').mockResolvedValue({} as never);

    await h.call('projects', { action: 'delete', uuid: 'p1' });
    await h.call('environments', { action: 'delete', project_uuid: 'p1', name: 'staging' });

    expect(h.prompts[0]).toContain('Delete project "estate"');
    expect(h.prompts[1]).toContain('Delete environment "staging"');
    await h.close();
  });

  it('leaves non-delete actions unprompted', async () => {
    const h = await harness(accept);
    jest
      .spyOn(h.server['client'], 'listApplications')
      .mockResolvedValue([{ uuid: 'app-1', name: 'api' }] as never);

    await h.call('list_applications', {});

    expect(h.prompts).toEqual([]);
    await h.close();
  });
});
