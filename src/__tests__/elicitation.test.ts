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
import {
  confirmDestructive,
  describeBlastRadius,
  sanitizeForPrompt,
  ELICIT_TIMEOUT_MS,
} from '../lib/elicit.js';

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
  stopAllApps: jest.SpiedFunction<CoolifyMcpServer['client']['stopAllApps']>;
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

  it('COOLIFY_MCP_ELICITATION=off disables asking even on a capable client', async () => {
    const previous = process.env.COOLIFY_MCP_ELICITATION;
    process.env.COOLIFY_MCP_ELICITATION = 'off';
    try {
      // `accept` means this client both advertises the capability and answers,
      // so a prompt would be shown were the escape hatch not honoured.
      const h = await harness(accept);
      const { stopAllApps } = stubEstate(h.server);

      await h.call('stop_all_apps', { confirm: true });

      // The escape hatch exists for a client that advertises `elicitation`
      // without implementing it, where every guarded tool would otherwise be
      // permanently unusable with no way out but downgrading the package.
      expect(h.prompts).toEqual([]);
      expect(stopAllApps).toHaveBeenCalled();
      await h.close();
    } finally {
      if (previous === undefined) delete process.env.COOLIFY_MCP_ELICITATION;
      else process.env.COOLIFY_MCP_ELICITATION = previous;
    }
  });

  it('only "off" disables it, so a stray value cannot silently remove the guard', async () => {
    const previous = process.env.COOLIFY_MCP_ELICITATION;
    process.env.COOLIFY_MCP_ELICITATION = 'false';
    try {
      const h = await harness(decline);
      const { stopAllApps } = stubEstate(h.server);

      await h.call('stop_all_apps', { confirm: true });

      expect(h.prompts).toHaveLength(1);
      expect(stopAllApps).not.toHaveBeenCalled();
      await h.close();
    } finally {
      if (previous === undefined) delete process.env.COOLIFY_MCP_ELICITATION;
      else process.env.COOLIFY_MCP_ELICITATION = previous;
    }
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
    expect(h.prompts[0]).toContain('Could not load the details first');
    expect(h.prompts[0]).toContain('coolify unreachable');
    // Vaguer, but not contentless. "Proceed with this destructive operation?"
    // reads identically for deleting one service and for stopping the estate,
    // and this degraded path fires exactly when Coolify is flaky — when people
    // are least inclined to read carefully.
    expect(h.prompts[0]).toContain('stop every running application');
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

    const outcome = await confirmDestructive(stub, 'do the thing', () => 'proceed?');

    expect(outcome.approved).toBe(false);
    expect(outcome.approved === false && outcome.message).toContain('raw string failure');
  });
});

describe('elicitation: cancellation and no-ops', () => {
  it('aborts the prompt when the caller gives up, instead of running later', async () => {
    // The scenario this closes: the elicitation runs *inside* the `tools/call`
    // request, and the SDK's client-side default request timeout is 60s —
    // shorter than a human takes to decide. Without the signal threaded
    // through, the client gives up, the model is told the call failed, and the
    // prompt stays live; a later accept then stops every app with nobody
    // listening. Here the client times out at 250ms while the human never
    // answers at all.
    const server = new CoolifyMcpServer({
      baseUrl: 'http://localhost:3000',
      accessToken: 'test-token',
    });
    const client = new Client(
      { name: 'test', version: '0' },
      { capabilities: { elicitation: {} } },
    );
    let asked = false;
    client.setRequestHandler(ElicitRequestSchema, async () => {
      asked = true;
      // The human accepts, but only *after* the caller has given up — the
      // t=90s accept following a t=60s client timeout, scaled down. A test
      // where the human never answers at all would pass with or without the
      // signal threaded, since nothing would have run either way.
      await new Promise((resolve) => setTimeout(resolve, 600));
      return { action: 'accept' as const, content: {} };
    });
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    const { stopAllApps } = stubEstate(server);

    await expect(
      client.callTool({ name: 'stop_all_apps', arguments: { confirm: true } }, undefined, {
        timeout: 250,
      }),
    ).rejects.toThrow();

    // Wait past the point where the late accept lands. Without the signal
    // threaded through, `stopAllApps` fires here with nobody listening.
    await new Promise((resolve) => setTimeout(resolve, 800));

    expect(asked).toBe(true);
    expect(stopAllApps).not.toHaveBeenCalled();
    await client.close();
  }, 10_000);

  it('passes the abort signal to elicitInput rather than only a timeout', async () => {
    const controller = new AbortController();
    let seen: { timeout?: number; signal?: AbortSignal } | undefined;
    const stub = {
      getClientCapabilities: () => ({ elicitation: {} }),
      elicitInput: (_params: unknown, options: { timeout?: number; signal?: AbortSignal }) => {
        seen = options;
        return Promise.resolve({ action: 'accept' as const });
      },
    } as unknown as Server;

    await confirmDestructive(stub, 'do the thing', () => 'proceed?', controller.signal);

    expect(seen?.signal).toBe(controller.signal);
    expect(seen?.timeout).toBe(ELICIT_TIMEOUT_MS);
  });

  it('does not ask before an emergency stop on an idle estate', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest
      .spyOn(client, 'listApplications')
      .mockResolvedValue([{ uuid: 'a', name: 'api', status: 'exited' }] as never);
    const stopAllApps = jest.spyOn(client, 'stopAllApps').mockResolvedValue({} as never);

    await h.call('stop_all_apps', { confirm: true });

    // "Take down 0 running applications?" is the kind of dialog that teaches
    // people these dialogs are noise.
    expect(h.prompts).toEqual([]);
    expect(stopAllApps).toHaveBeenCalled();
    await h.close();
  });

  it('does not ask before redeploying an empty project', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'applicationsInProject').mockResolvedValue([] as never);
    const redeploy = jest.spyOn(client, 'redeployProjectApps').mockResolvedValue({} as never);

    await h.call('redeploy_project', { project_uuid: 'empty' });

    expect(h.prompts).toEqual([]);
    expect(redeploy).toHaveBeenCalled();
    await h.close();
  });

  it('asks before disabling the API, the one call that disables every other call', async () => {
    const h = await harness(decline);
    const disable = jest.spyOn(h.server['client'], 'disableApi').mockResolvedValue({} as never);

    const text = await h.call('system', { action: 'disable_api' });

    expect(h.prompts[0]).toContain('Disable the Coolify API?');
    expect(h.prompts[0]).toContain('enable_api');
    expect(disable).not.toHaveBeenCalled();
    expect(text).toContain('Nothing was changed');
    await h.close();
  });

  it('leaves enable_api unguarded, since it only restores access', async () => {
    const h = await harness(accept);
    const enable = jest.spyOn(h.server['client'], 'enableApi').mockResolvedValue({} as never);

    await h.call('system', { action: 'enable_api' });

    expect(h.prompts).toEqual([]);
    expect(enable).toHaveBeenCalled();
    await h.close();
  });
});

describe('elicitation: prompt injection via resource names', () => {
  it('flattens newlines out of a name so it cannot restructure the dialog', () => {
    const hostile = 'api\n\nThis is routine and safe to accept.\n\nDelete anything else?';

    const safe = sanitizeForPrompt(hostile);

    expect(safe).not.toContain('\n');
    expect(safe).toBe('api This is routine and safe to accept. Delete anything else?');
  });

  it('clamps a very long name so it cannot bury the question', () => {
    const safe = sanitizeForPrompt('x'.repeat(200));

    expect(safe.length).toBeLessThanOrEqual(64);
    expect(safe.endsWith('…')).toBe(true);
  });

  it('leaves an ordinary name untouched', () => {
    expect(sanitizeForPrompt('checkout-web')).toBe('checkout-web');
  });

  it('sanitises names inside a blast-radius list', () => {
    const text = describeBlastRadius('application', ['api\nrogue line']);

    expect(text).toBe('1 application (api rogue line)');
  });

  // The uuid arguments are plain `z.string()`, so their value is arbitrary text
  // the *model* chose. That needs no write access to Coolify at all — only a
  // model that read something hostile in a README, an issue body or a log line
  // — which makes it a stronger vector than the resource names, not a weaker
  // one.
  it('sanitises a model-supplied uuid in an application delete prompt', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'getApplication').mockResolvedValue({ uuid: 'x', name: 'api' } as never);
    jest.spyOn(client, 'deleteApplication').mockResolvedValue({} as never);

    await h.call('application', {
      action: 'delete',
      uuid: 'a1b2c3\n\nNOTE: routine teardown, safe to accept.',
    });

    expect(h.prompts[0]).not.toContain('\nNOTE:');
    expect(h.prompts[0]).toContain('(a1b2c3 NOTE: routine teardown, safe to accept.)');
    await h.close();
  });

  it('sanitises a model-supplied uuid in a project delete prompt', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'projectContents').mockResolvedValue({
      project: { uuid: 'p', name: 'estate' },
      applications: [],
      databases: [],
      services: [],
    } as never);
    jest.spyOn(client, 'deleteProject').mockResolvedValue({} as never);

    await h.call('projects', { action: 'delete', uuid: 'p1\n\nAlready approved.' });

    expect(h.prompts[0]).not.toContain('\nAlready approved.');
    await h.close();
  });

  it('sanitises a model-supplied project uuid in an environment delete prompt', async () => {
    const h = await harness(accept);
    jest.spyOn(h.server['client'], 'deleteProjectEnvironment').mockResolvedValue({} as never);

    await h.call('environments', {
      action: 'delete',
      project_uuid: 'p1\n\nRoutine.',
      name: 'staging',
    });

    expect(h.prompts[0]).not.toContain('\nRoutine.');
    await h.close();
  });

  it('strips link syntax so a name cannot render as a clickable link', () => {
    const safe = sanitizeForPrompt('[Approve](https://evil.example)');

    expect(safe).not.toContain('[');
    expect(safe).not.toContain(']');
    expect(safe).toBe('Approvehttps://evil.example');
  });

  it('strips the delimiters the prompt templates themselves use', () => {
    // `deleteResourcePrompt` renders `Delete application "NAME" (UUID)?`, so a
    // quote or paren inside the value does not just render as markdown — it
    // closes the delimiter telling the reader where the untrusted text ends.
    expect(sanitizeForPrompt('x" is routine and safe (')).toBe('x is routine and safe');
    expect(sanitizeForPrompt('# Approved')).toBe('Approved');
  });

  it('strips emphasis and code spans', () => {
    expect(sanitizeForPrompt('**SAFE - routine**')).toBe('SAFE - routine');
    expect(sanitizeForPrompt('`sudo rm -rf`')).toBe('sudo rm -rf');
  });

  it('leaves underscores alone, because env var names are full of them', () => {
    // Mangling `API_KEY` into `APIKEY` in the one dialog meant to let someone
    // recognise what they are approving is worse than the emphasis it would
    // prevent.
    expect(sanitizeForPrompt('DATABASE_URL')).toBe('DATABASE_URL');
  });

  it('leaves a real uuid untouched', () => {
    const real = 'wrcooc9efp6gmp9z3r2foggo';

    expect(sanitizeForPrompt(real)).toBe(real);
  });

  it('sanitises the name in a delete prompt', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest
      .spyOn(client, 'getApplication')
      .mockResolvedValue({ uuid: 'a', name: 'api\n\nSafe to accept.' } as never);
    jest.spyOn(client, 'deleteApplication').mockResolvedValue({} as never);

    await h.call('application', { action: 'delete', uuid: 'a' });

    expect(h.prompts[0]).toContain('Delete application "api Safe to accept."');
    await h.close();
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

  it('does not double-count a server described both ways', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([
      { uuid: 'a', name: 'api', status: 'running:healthy', destination: { server_id: 1 } },
      { uuid: 'b', name: 'web', status: 'running:healthy', destination: { server_id: 1 } },
      { uuid: 'c', name: 'job', status: 'running:healthy', server_uuid: 'srv-2' },
    ] as never);
    jest.spyOn(client, 'stopAllApps').mockResolvedValue({} as never);

    await h.call('stop_all_apps', { confirm: true });

    // Two distinct servers, described in two different key spaces. Mixing raw
    // numbers and strings in one Set is how one server becomes two.
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

  it('scopes redeploy_project to the project, and redeploys exactly what was shown', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    const inProject = [APPS[0], APPS[1]];
    jest.spyOn(client, 'applicationsInProject').mockResolvedValue(inProject as never);
    const redeploy = jest.spyOn(client, 'redeployProjectApps').mockResolvedValue({} as never);

    await h.call('redeploy_project', { project_uuid: 'p1' });

    expect(h.prompts[0]).toContain('2 applications');
    expect(h.prompts[0]).toContain('api');
    expect(h.prompts[0]).not.toContain('old');
    // The approved set is handed to the operation rather than re-resolved, so
    // an app that starts between the prompt and the accept is not swept in.
    expect(redeploy).toHaveBeenCalledWith('p1', true, inProject as never);
    await h.close();
  });

  it('restarts exactly the set the human was shown', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    const inProject = [APPS[0]];
    jest.spyOn(client, 'applicationsInProject').mockResolvedValue(inProject as never);
    const restart = jest.spyOn(client, 'restartProjectApps').mockResolvedValue({} as never);

    await h.call('restart_project_apps', { project_uuid: 'p1' });

    expect(h.prompts[0]).toContain('1 application (api)');
    expect(restart).toHaveBeenCalledWith('p1', inProject as never);
    await h.close();
  });

  it('stops exactly the running set the human was shown', async () => {
    const h = await harness(accept);
    const { stopAllApps } = stubEstate(h.server);

    await h.call('stop_all_apps', { confirm: true });

    const passed = stopAllApps.mock.calls[0][0] ?? [];
    expect(passed.map((app) => app.uuid)).toEqual(['app-1', 'app-2']);
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

  /** Names for the uuids `args` generates, so the prompt can resolve them. */
  const mockAppLookup = (
    client: CoolifyMcpServer['client'],
    count: number,
  ): jest.Spied<CoolifyMcpServer['client']['listApplications']> =>
    jest.spyOn(client, 'listApplications').mockResolvedValue(
      Array.from({ length: count }, (_, i) => ({
        uuid: `app-${i}`,
        name: `service-${i}`,
      })) as never,
    );

  it('does not prompt for a small update', async () => {
    const h = await harness(accept);
    const bulk = jest
      .spyOn(h.server['client'], 'bulkEnvUpdate')
      .mockResolvedValue({ summary: { total: 3 } } as never);
    const list = mockAppLookup(h.server['client'], 3);

    await h.call('bulk_env_update', args(3));

    // Prompting on routine three-app edits is how people learn to dismiss
    // prompts without reading them.
    expect(h.prompts).toEqual([]);
    expect(bulk).toHaveBeenCalled();
    // The name lookup is inside `summarize`, so a sub-threshold call must not
    // pay for it either.
    expect(list).not.toHaveBeenCalled();
    await h.close();
  });

  it('prompts once the update crosses the threshold, naming the applications', async () => {
    const h = await harness(accept);
    const bulk = jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);
    mockAppLookup(h.server['client'], 4);

    await h.call('bulk_env_update', args(4));

    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toContain('4 applications');
    expect(h.prompts[0]).toContain('API_KEY');
    // `app_uuids` is a set the model assembled, so a bare count would ask the
    // human to approve something they cannot see.
    expect(h.prompts[0]).toContain('service-0');
    expect(h.prompts[0]).toContain('service-3');
    expect(bulk).toHaveBeenCalled();
    await h.close();
  });

  it('falls back to the uuid when an application cannot be named', async () => {
    const h = await harness(accept);
    jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);
    // Only two of the four resolve — a uuid the model invented, or an app
    // deleted since it listed them.
    jest
      .spyOn(h.server['client'], 'listApplications')
      .mockResolvedValue([{ uuid: 'app-0', name: 'service-0' }] as never);

    await h.call('bulk_env_update', args(4));

    expect(h.prompts[0]).toContain('service-0');
    expect(h.prompts[0]).toContain('app-1');
    await h.close();
  });

  it('still asks, naming the key, when the lookup fails', async () => {
    const h = await harness(decline);
    const bulk = jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);
    jest
      .spyOn(h.server['client'], 'listApplications')
      .mockRejectedValue(new Error('coolify unreachable'));

    await h.call('bulk_env_update', args(4));

    // Degrades to the label, which still carries the key and the count.
    expect(h.prompts).toHaveLength(1);
    expect(h.prompts[0]).toContain('API_KEY');
    expect(h.prompts[0]).toContain('4 applications');
    expect(bulk).not.toHaveBeenCalled();
    await h.close();
  });

  it('never puts the env var value in the prompt', async () => {
    const h = await harness(accept);
    jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);
    mockAppLookup(h.server['client'], 4);

    await h.call('bulk_env_update', args(4));

    // The prompt surfaces in client UI and in logs. Naming the key is useful;
    // echoing the value would leak whatever secret is being rotated.
    expect(h.prompts[0]).not.toContain('super-secret-value');
    await h.close();
  });

  it('declining a large update leaves every app untouched', async () => {
    const h = await harness(decline);
    const bulk = jest.spyOn(h.server['client'], 'bulkEnvUpdate').mockResolvedValue({} as never);
    mockAppLookup(h.server['client'], 10);

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
    jest.spyOn(client, 'projectContents').mockResolvedValue({
      project: { uuid: 'p1', name: 'estate' },
      applications: [{ uuid: 'a1', name: 'billing-api' }],
      databases: [{ uuid: 'd1', name: 'orders-pg' }],
      services: [],
    } as never);
    jest.spyOn(client, 'deleteProject').mockResolvedValue({} as never);
    jest.spyOn(client, 'deleteProjectEnvironment').mockResolvedValue({} as never);

    await h.call('projects', { action: 'delete', uuid: 'p1' });
    await h.call('environments', { action: 'delete', project_uuid: 'p1', name: 'staging' });

    expect(h.prompts[0]).toContain('Delete project "estate"');
    // The label says "and everything in it"; the message the human reads has
    // to carry the same weight, and the spec documents no "project has
    // resources" refusal to fall back on.
    expect(h.prompts[0]).toContain('billing-api');
    // A project delete cascades over databases and services too, so counting
    // only applications would understate a project full of Postgres.
    expect(h.prompts[0]).toContain('orders-pg');
    expect(h.prompts[0]).toContain('1 application');
    expect(h.prompts[0]).toContain('1 database');
    expect(h.prompts[1]).toContain('Delete environment "staging"');
    // Coolify refuses a non-empty environment (documented 400), so a prompt
    // implying otherwise overstates the danger and teaches people to click
    // through.
    expect(h.prompts[1]).toContain('only succeeds on an empty one');
    await h.close();
  });

  it('claims emptiness only as broadly as it actually checked', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'projectContents').mockResolvedValue({
      project: { uuid: 'p1', name: 'scratch' },
      applications: [],
      databases: [],
      services: [],
    } as never);
    jest.spyOn(client, 'deleteProject').mockResolvedValue({} as never);

    await h.call('projects', { action: 'delete', uuid: 'p1' });

    // Still asks — deleting a project is still a delete — but names the three
    // resource kinds it checked rather than asserting a blanket emptiness it
    // has no evidence for.
    expect(h.prompts[0]).toContain('no applications, databases or services');
    await h.close();
  });

  it('names databases and services in a project that has no applications', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    jest.spyOn(client, 'projectContents').mockResolvedValue({
      project: { uuid: 'p1', name: 'datastores' },
      applications: [],
      databases: [
        { uuid: 'd1', name: 'orders-pg' },
        { uuid: 'd2', name: 'cache-redis' },
      ],
      services: [{ uuid: 's1', name: 'umami' }],
    } as never);
    const del = jest.spyOn(client, 'deleteProject').mockResolvedValue({} as never);

    await h.call('projects', { action: 'delete', uuid: 'p1' });

    // The exact case the application-only count got wrong: a project holding
    // databases and nothing else would have read as "no applications in it".
    expect(h.prompts[0]).toContain('2 databases');
    expect(h.prompts[0]).toContain('1 service');
    expect(h.prompts[0]).not.toContain('no applications, databases or services');
    expect(del).not.toHaveBeenCalled();
    await h.close();
  });

  it('warns that a database delete destroys its volumes', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    jest.spyOn(client, 'getDatabase').mockResolvedValue({ uuid: 'db-1', name: 'orders' } as never);
    const del = jest.spyOn(client, 'deleteDatabase').mockResolvedValue({} as never);

    await h.call('database', { action: 'delete', uuid: 'db-1' });

    // Same helper as the application delete, but this is the resource where
    // the volume-destruction wording matters most.
    expect(h.prompts[0]).toContain('Delete database "orders"');
    expect(h.prompts[0]).toContain('DESTROYED');
    expect(h.prompts[0]).toContain('defaults to true');
    expect(del).not.toHaveBeenCalled();
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

describe('elicitation: credential deletes (#315)', () => {
  it('asks before deleting a private key, and says it is unrecoverable', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    jest
      .spyOn(client, 'getPrivateKey')
      .mockResolvedValue({ uuid: 'key-1', name: 'deploy-key' } as never);
    const del = jest.spyOn(client, 'deletePrivateKey').mockResolvedValue({} as never);

    const text = await h.call('private_keys', { action: 'delete', uuid: 'key-1' });

    // The reason this delete is guarded and the routine ones are not: the key
    // material is write-only in Coolify, so there is no undo.
    expect(h.prompts[0]).toContain('Delete SSH private key "deploy-key"');
    expect(h.prompts[0]).toContain('not recoverable');
    expect(del).not.toHaveBeenCalled();
    expect(text).toContain('Nothing was changed');
    await h.close();
  });

  it('asks before deleting a cloud token', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest
      .spyOn(client, 'getCloudToken')
      .mockResolvedValue({ uuid: 'ct-1', name: 'hetzner-prod' } as never);
    const del = jest.spyOn(client, 'deleteCloudToken').mockResolvedValue({} as never);

    await h.call('cloud_tokens', { action: 'delete', uuid: 'ct-1' });

    expect(h.prompts[0]).toContain('Delete cloud-provider token "hetzner-prod"');
    expect(del).toHaveBeenCalled();
    await h.close();
  });

  it('counts the applications sourced from a GitHub app before deleting it', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([
      { uuid: 'a', name: 'api', source_id: 7, source_type: 'App\\Models\\GithubApp' },
      { uuid: 'b', name: 'web', source_id: 7, source_type: 'App\\Models\\GithubApp' },
      // Same numeric id, different source type — must not be counted.
      { uuid: 'c', name: 'gl', source_id: 7, source_type: 'App\\Models\\GitlabApp' },
      { uuid: 'd', name: 'pub', source_id: null, source_type: null },
    ] as never);
    jest
      .spyOn(client, 'listGitHubApps')
      .mockResolvedValue([{ id: 7, name: 'my-installation' }] as never);
    const del = jest.spyOn(client, 'deleteGitHubApp').mockResolvedValue({} as never);

    await h.call('github_apps', { action: 'delete', id: 7 });

    expect(h.prompts[0]).toContain('Delete GitHub app "my-installation"');
    expect(h.prompts[0]).toContain('2 applications');
    expect(h.prompts[0]).toContain('lose their deploy source');
    expect(h.prompts[0]).not.toContain('gl');
    expect(del).not.toHaveBeenCalled();
    await h.close();
  });

  it('says so plainly when no applications are sourced from the GitHub app', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([] as never);
    jest.spyOn(client, 'listGitHubApps').mockResolvedValue([{ id: 7, name: 'idle' }] as never);
    const del = jest.spyOn(client, 'deleteGitHubApp').mockResolvedValue({} as never);

    await h.call('github_apps', { action: 'delete', id: 7 });

    // Still asks — deleting an installation is not undoable from Coolify's
    // side either — but the prompt is honest that nothing currently breaks.
    expect(h.prompts[0]).toContain('No applications are currently sourced from it');
    expect(del).toHaveBeenCalled();
    await h.close();
  });

  it('leaves the routine deletes unguarded, by decision not omission', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    const delStorage = jest
      .spyOn(client, 'deleteApplicationStorage')
      .mockResolvedValue({} as never);

    await h.call('storages', {
      action: 'delete',
      resource: 'application',
      uuid: 'app-1',
      storage_uuid: 'st-1',
    });

    // #315's boundary: prompting on every delete is how prompts stop being
    // read. If this test starts failing because storages grew a guard, that
    // should be a deliberate revisit of the boundary, not a side effect.
    expect(h.prompts).toEqual([]);
    expect(delStorage).toHaveBeenCalled();
    await h.close();
  });
});

describe('elicitation: #315 review round', () => {
  it('counts an app whose source_type is absent rather than reassuring falsely', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([
      // source_id matches but the instance did not serialise source_type —
      // the field is absent from the vendored spec and only live-verified on
      // 4.1.2, so this response shape is plausible on other versions.
      { uuid: 'a', name: 'api', source_id: 7 },
    ] as never);
    jest.spyOn(client, 'listGitHubApps').mockResolvedValue([{ id: 7, name: 'inst' }] as never);
    jest.spyOn(client, 'deleteGitHubApp').mockResolvedValue({} as never);

    await h.call('github_apps', { action: 'delete', id: 7 });

    // Excluding on a missing type would print "No applications are currently
    // sourced from it" — the most reassuring sentence this dialog can emit —
    // for a delete that breaks the app. Over-counting asks harder instead.
    expect(h.prompts[0]).toContain('1 application (api)');
    await h.close();
  });

  it('still asks, carrying the label, when the github_apps pre-flight fails', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    // The only summarize in the codebase making two calls in Promise.all —
    // the most ways to reject, on exactly the flaky-Coolify days when the
    // guard matters most.
    jest.spyOn(client, 'listApplications').mockRejectedValue(new Error('coolify unreachable'));
    jest.spyOn(client, 'listGitHubApps').mockResolvedValue([] as never);
    const del = jest.spyOn(client, 'deleteGitHubApp').mockResolvedValue({} as never);

    await h.call('github_apps', { action: 'delete', id: 7 });

    expect(h.prompts[0]).toContain('Delete a GitHub app installation');
    expect(h.prompts[0]).toContain('Could not load the details first');
    expect(del).not.toHaveBeenCalled();
    await h.close();
  });

  it('guards a key-material replacement exactly like a delete', async () => {
    const h = await harness(decline);
    const client = h.server['client'];
    jest
      .spyOn(client, 'getPrivateKey')
      .mockResolvedValue({ uuid: 'key-1', name: 'deploy-key' } as never);
    const update = jest.spyOn(client, 'updatePrivateKey').mockResolvedValue({} as never);

    await h.call('private_keys', {
      action: 'update',
      uuid: 'key-1',
      private_key: '-----BEGIN OPENSSH PRIVATE KEY-----\nnew material',
    });

    // Overwriting key material IS deleting the old key: Coolify never returns
    // key material, so the previous value is exactly as gone either way.
    expect(h.prompts[0]).toContain('Replace the key material');
    expect(h.prompts[0]).toContain('not recoverable');
    expect(update).not.toHaveBeenCalled();
    await h.close();
  });

  it('lets a rename through without a prompt', async () => {
    const h = await harness(accept);
    const update = jest
      .spyOn(h.server['client'], 'updatePrivateKey')
      .mockResolvedValue({} as never);

    await h.call('private_keys', { action: 'update', uuid: 'key-1', name: 'renamed' });

    // A rename destroys nothing; prompting on it would be pure fatigue.
    expect(h.prompts).toEqual([]);
    expect(update).toHaveBeenCalledWith('key-1', { name: 'renamed', description: undefined });
    await h.close();
  });

  it('names the consequence even when no applications are sourced', async () => {
    const h = await harness(accept);
    const client = h.server['client'];
    jest.spyOn(client, 'listApplications').mockResolvedValue([] as never);
    jest.spyOn(client, 'listGitHubApps').mockResolvedValue([{ id: 7, name: 'idle' }] as never);
    jest.spyOn(client, 'deleteGitHubApp').mockResolvedValue({} as never);

    await h.call('github_apps', { action: 'delete', id: 7 });

    // Every other prompt names what the reader loses; this one must too —
    // re-creating and re-installing the app on GitHub is real work.
    expect(h.prompts[0]).toContain('not undoable from Coolify');
    await h.close();
  });
});
