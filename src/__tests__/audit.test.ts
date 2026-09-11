import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import {
  auditEnabled,
  auditedCall,
  markRefused,
  pickAction,
  pickUuids,
  type AuditEntry,
} from '../lib/audit.js';
import { CoolifyMcpServer } from '../lib/mcp-server.js';

describe('audit: what may be logged (#370)', () => {
  it('takes the action discriminator', () => {
    expect(pickAction({ action: 'delete' })).toBe('delete');
    expect(pickAction({ action: 'backup_set' })).toBe('backup_set');
  });

  it('refuses an action that is not enum-shaped', () => {
    // Actions come from zod enums, so this can only fire if something upstream
    // changed. Pinning the charset means a value smuggled through as `action`
    // cannot become a log line.
    expect(pickAction({ action: 'DROP TABLE users' })).toBeUndefined();
    expect(pickAction({ action: 'x'.repeat(200) })).toBeUndefined();
    expect(pickAction({ action: 42 })).toBeUndefined();
    expect(pickAction(null)).toBeUndefined();
  });

  it('takes only identifier-shaped keys from the allowlist', () => {
    const uuids = pickUuids({
      uuid: 'app-1',
      storage_uuid: 'stor-1',
      environment_uuid: 'env-1',
      name: 'my-app',
    });

    expect(uuids).toEqual(['app-1', 'stor-1', 'env-1']);
    expect(uuids).not.toContain('my-app');
  });

  it('NEVER takes an env var value, key or any other argument', () => {
    // The whole reason the picker is an allowlist. `env_vars` create carries
    // secrets in its arguments; a denylist would leak the first key nobody
    // thought of.
    const uuids = pickUuids({
      uuid: 'app-1',
      key: 'DATABASE_URL',
      value: 'postgres://user:hunter2@db/prod',
      content: 'BEGIN RSA PRIVATE KEY',
      token: 'glpat-secret',
      password: 'hunter2',
      private_key: '-----BEGIN-----',
      docker_compose_raw: 'services:',
    });

    expect(uuids).toEqual(['app-1']);
    const serialized = JSON.stringify(uuids);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('DATABASE_URL');
    expect(serialized).not.toContain('glpat');
  });

  it('drops identifier-shaped keys whose value is not identifier-shaped', () => {
    expect(pickUuids({ uuid: 'a b c' })).toBeUndefined();
    expect(pickUuids({ uuid: '../../etc/passwd' })).toBeUndefined();
    expect(pickUuids({ uuid: 'x'.repeat(200) })).toBeUndefined();
  });

  it('deduplicates repeated identifiers', () => {
    expect(pickUuids({ uuid: 'same', project_uuid: 'same' })).toEqual(['same']);
  });
});

describe('audit: enabling (#370)', () => {
  it('honours the transport default when the env says nothing', () => {
    expect(auditEnabled(true, {})).toBe(true);
    expect(auditEnabled(false, {})).toBe(false);
  });

  it('lets the env override in both directions', () => {
    expect(auditEnabled(true, { COOLIFY_MCP_AUDIT: 'off' })).toBe(false);
    expect(auditEnabled(false, { COOLIFY_MCP_AUDIT: 'on' })).toBe(true);
    expect(auditEnabled(true, { COOLIFY_MCP_AUDIT: '0' })).toBe(false);
    expect(auditEnabled(false, { COOLIFY_MCP_AUDIT: 'TRUE' })).toBe(true);
  });

  it('ignores a value it does not understand rather than guessing', () => {
    expect(auditEnabled(false, { COOLIFY_MCP_AUDIT: 'maybe' })).toBe(false);
    expect(auditEnabled(true, { COOLIFY_MCP_AUDIT: '' })).toBe(true);
  });
});

describe('audit: one line per call, whatever happens (#370)', () => {
  const ok = { content: [{ type: 'text', text: '{"deployment":"queued"}' }] };
  const err = { content: [{ type: 'text', text: 'Error: uuid required' }] };

  it('tags a successful call ok and times it', async () => {
    const lines: AuditEntry[] = [];
    let clock = 1000;

    await auditedCall(
      { tool: 'deploy', args: { uuid: 'app-1' }, now: () => clock, write: (e) => lines.push(e) },
      () => {
        clock += 42;
        return ok;
      },
    );

    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      audit: 'tools/call',
      tool: 'deploy',
      uuids: ['app-1'],
      outcome: 'ok',
      duration_ms: 42,
    });
  });

  it('tags a handler error', async () => {
    const lines: AuditEntry[] = [];
    await auditedCall({ tool: 'application', args: {}, write: (e) => lines.push(e) }, () => err);
    expect(lines[0].outcome).toBe('error');
  });

  it('tags a raised confirmation as awaiting an answer, not as a success (#341)', async () => {
    const lines: AuditEntry[] = [];
    // What a guarded tool returns on round one of protocol revision
    // 2026-07-28: a question, carrying no `content` at all.
    const asked = { resultType: 'input_required', inputRequests: {}, requestState: 'sealed' };
    await auditedCall(
      { tool: 'application', args: { uuid: 'app-1' }, write: (e) => lines.push(e) },
      () => asked as never,
    );

    // `ok` here would report a destructive tool call as having succeeded when
    // nothing ran, and would double every guarded operation in any count of
    // successful destructive calls, since the retry writes a second line.
    expect(lines[0].outcome).toBe('awaiting_confirmation');
    expect(lines[0].reason).toBeUndefined();
  });

  it('tags a refusal, and keeps a decline apart from an error', async () => {
    const lines: AuditEntry[] = [];
    await auditedCall(
      { tool: 'application', args: { action: 'delete', uuid: 'a1' }, write: (e) => lines.push(e) },
      () => {
        markRefused('declined');
        return { content: [{ type: 'text', text: 'Nothing was changed.' }] };
      },
    );

    expect(lines[0]).toMatchObject({ outcome: 'refused', reason: 'declined', action: 'delete' });
  });

  it('still writes a line when the handler throws, then rethrows', async () => {
    // The case an audit log most needs to record is the one where something
    // broke, so a throw must not be the path that skips the record.
    const lines: AuditEntry[] = [];

    await expect(
      auditedCall({ tool: 'deploy', args: {}, write: (e) => lines.push(e) }, () => {
        throw new Error('socket hang up');
      }),
    ).rejects.toThrow('socket hang up');

    expect(lines).toHaveLength(1);
    expect(lines[0].outcome).toBe('error');
  });

  it('never puts the failure message in the line', async () => {
    const lines: AuditEntry[] = [];
    await auditedCall({ tool: 'env_vars', args: {}, write: (e) => lines.push(e) }, () => {
      throw new Error('connect ECONNREFUSED secret-host.internal:5432');
    }).catch(() => undefined);

    expect(JSON.stringify(lines[0])).not.toContain('secret-host');
  });

  it('carries the OAuth client id and the instance when it has them', async () => {
    const lines: AuditEntry[] = [];
    await auditedCall(
      {
        tool: 'deploy',
        args: { uuid: 'a1' },
        instance: 'prod',
        clientId: 'mcp_client_abc',
        write: (e) => lines.push(e),
      },
      () => ok,
    );

    expect(lines[0]).toMatchObject({ instance: 'prod', client_id: 'mcp_client_abc' });
  });
});

describe('audit: through a live server (#370)', () => {
  let errors: string[];
  let spy: ReturnType<typeof jest.spyOn>;

  beforeEach(() => {
    errors = [];
    spy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      errors.push(args.map(String).join(' '));
    });
  });

  afterEach(() => {
    spy.mockRestore();
    delete process.env.COOLIFY_MCP_AUDIT;
  });

  async function connect(options?: { auditByDefault?: boolean }) {
    const server = new CoolifyMcpServer(
      { baseUrl: 'http://localhost:3000', accessToken: 'test-token' },
      options,
    );
    const client = new Client({ name: 'test', version: '0' }, {});
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);
    return { server, client, close: () => client.close() };
  }

  const auditLines = (lines: string[]): AuditEntry[] =>
    lines.filter((l) => l.includes('"audit"')).map((l) => JSON.parse(l) as AuditEntry);

  it('writes nothing over stdio by default', async () => {
    const h = await connect();
    await h.client.callTool({ name: 'get_mcp_version', arguments: {} });

    expect(auditLines(errors)).toHaveLength(0);
    await h.close();
  });

  it('writes a line when the transport default turns it on', async () => {
    const h = await connect({ auditByDefault: true });
    await h.client.callTool({ name: 'get_mcp_version', arguments: {} });

    const lines = auditLines(errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tool: 'get_mcp_version', outcome: 'ok' });
    await h.close();
  });

  it('writes a line over stdio when the env asks for one', async () => {
    process.env.COOLIFY_MCP_AUDIT = 'on';
    const h = await connect();
    await h.client.callTool({ name: 'get_mcp_version', arguments: {} });

    expect(auditLines(errors)).toHaveLength(1);
    await h.close();
  });

  it('records a handler refusal without echoing the arguments', async () => {
    // env_vars create carries a secret in `value`. This call satisfies the
    // schema and is refused by the handler, so it reaches the audit wrapper —
    // and the line still must not contain the secret.
    process.env.COOLIFY_MCP_AUDIT = 'on';
    const h = await connect();

    await h.client.callTool({
      name: 'env_vars',
      arguments: {
        resource: 'application',
        action: 'create',
        uuid: 'app-1',
        key: 'DATABASE_URL',
        value: 'postgres://user:hunter2@db/prod',
      },
    });

    const lines = auditLines(errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({ tool: 'env_vars', action: 'create', uuids: ['app-1'] });
    const serialized = JSON.stringify(lines[0]);
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('postgres://');
    expect(serialized).not.toContain('DATABASE_URL');
    await h.close();
  });

  it('records a declined destructive call as refused, not as an error', async () => {
    process.env.COOLIFY_MCP_AUDIT = 'on';
    const server = new CoolifyMcpServer(
      { baseUrl: 'http://localhost:3000', accessToken: 'test-token' },
      { auditByDefault: true },
    );
    jest
      .spyOn(server['client'], 'getApplication')
      .mockResolvedValue({ uuid: 'app-1', name: 'api' } as never);
    const del = jest.spyOn(server['client'], 'deleteApplication');

    const client = new Client(
      { name: 'test', version: '0' },
      { capabilities: { elicitation: {} } },
    );
    client.setRequestHandler('elicitation/create', async () => ({ action: 'decline' as const }));
    const [ct, st] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(st), client.connect(ct)]);

    await client.callTool({
      name: 'application',
      arguments: { action: 'delete', uuid: 'app-1' },
    });

    const lines = auditLines(errors);
    expect(lines).toHaveLength(1);
    expect(lines[0]).toMatchObject({
      tool: 'application',
      action: 'delete',
      uuids: ['app-1'],
      outcome: 'refused',
      reason: 'declined',
    });
    expect(del).not.toHaveBeenCalled();
    await client.close();
  });

  it('KNOWN LIMIT: a call rejected by schema validation produces no line', async () => {
    // Pinned deliberately rather than left to be discovered. The SDK validates
    // arguments against the tool schema and returns an error before any server
    // code runs, so there is no seam to audit from without reaching into SDK
    // internals. Nothing executed and no credential was used, so the gap is
    // narrow — but it is a gap, and a test that fails when the SDK grows a hook
    // is how we find out we can close it.
    process.env.COOLIFY_MCP_AUDIT = 'on';
    const h = await connect();

    const result = (await h.client.callTool({
      name: 'env_vars',
      arguments: { resource: 'application', action: 'create' },
    })) as { isError?: boolean };

    expect(result.isError).toBe(true);
    expect(auditLines(errors)).toHaveLength(0);
    await h.close();
  });
});
