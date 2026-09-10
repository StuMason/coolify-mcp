import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { mkdtempSync, rmSync, writeFileSync, utimesSync, chmodSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { TokenSource } from '../lib/token-source.js';
import { CoolifyClient } from '../lib/coolify-client.js';
import { runDoctor } from '../lib/doctor.js';

let dir: string;
const write = (name: string, contents: string): string => {
  const path = join(dir, name);
  writeFileSync(path, contents);
  return path;
};
/** mtime granularity is coarse enough that a same-millisecond rewrite can tie. */
const touchFuture = (path: string): void => {
  const when = new Date(Date.now() + 5_000);
  utimesSync(path, when, when);
};

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'coolify-token-'));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe('TokenSource: environment (#398)', () => {
  it('returns the configured token', () => {
    expect(new TokenSource({ accessToken: 'tok-1' }).current()).toBe('tok-1');
  });

  it('reports its origin so doctor can say a restart is needed', () => {
    expect(new TokenSource({ accessToken: 'tok-1' }).info()).toEqual({ origin: 'env' });
  });

  it('refresh is a no-op, because a subprocess cannot see a new env value', () => {
    const source = new TokenSource({ accessToken: 'tok-1' });
    expect(source.refresh()).toEqual({ changed: false });
    expect(source.current()).toBe('tok-1');
  });

  it('throws when neither a token nor a file is configured', () => {
    expect(() => new TokenSource({})).toThrow('Coolify access token is required');
  });
});

describe('TokenSource: file (#398)', () => {
  it('reads the token at construction', () => {
    const path = write('token', 'tok-file');
    expect(new TokenSource({ accessTokenFile: path }).current()).toBe('tok-file');
  });

  it('strips the trailing newline `echo` leaves behind', () => {
    // A Bearer header carrying a newline is rejected as malformed rather than
    // as a bad token, which sends people hunting a permissions problem they do
    // not have.
    const path = write('token', 'tok-file\n');
    expect(new TokenSource({ accessTokenFile: path }).current()).toBe('tok-file');
  });

  it('fails at construction when the file is missing, naming the path', () => {
    const path = join(dir, 'nope');
    expect(() => new TokenSource({ accessTokenFile: path })).toThrow(path);
  });

  it('fails at construction when the file is empty', () => {
    const path = write('token', '   \n');
    expect(() => new TokenSource({ accessTokenFile: path })).toThrow(/empty/);
  });

  it('picks up a rotated token with no restart', () => {
    // The whole point of the issue.
    const path = write('token', 'old-token');
    const source = new TokenSource({ accessTokenFile: path });
    expect(source.current()).toBe('old-token');

    writeFileSync(path, 'new-token');
    touchFuture(path);

    expect(source.current()).toBe('new-token');
  });

  it('takes precedence over an env token when both are set', () => {
    const path = write('token', 'from-file');
    expect(new TokenSource({ accessToken: 'from-env', accessTokenFile: path }).current()).toBe(
      'from-file',
    );
  });

  it('keeps the last good value when the file disappears mid-run', () => {
    // An atomic replace briefly unlinks, and a transient unmount should not
    // take down a working server. If the token really is gone the next call
    // gets a 401 that says so.
    const path = write('token', 'tok-1');
    const source = new TokenSource({ accessTokenFile: path });
    rmSync(path);

    expect(source.current()).toBe('tok-1');
  });

  it('keeps the last good value when the file is momentarily empty', () => {
    const path = write('token', 'tok-1');
    const source = new TokenSource({ accessTokenFile: path });
    writeFileSync(path, '');
    touchFuture(path);

    expect(source.current()).toBe('tok-1');
  });

  it('reports the path and when it was last read, never the value', () => {
    const path = write('token', 'super-secret');
    const info = new TokenSource({ accessTokenFile: path }).info();

    expect(info.origin).toBe('file');
    expect(info.path).toBe(path);
    expect(info.lastReadAt).toBeGreaterThan(0);
    expect(JSON.stringify(info)).not.toContain('super-secret');
  });

  it('refresh reports whether the value actually moved', () => {
    const path = write('token', 'tok-1');
    const source = new TokenSource({ accessTokenFile: path });

    expect(source.refresh()).toEqual({ changed: false });

    writeFileSync(path, 'tok-2');
    expect(source.refresh()).toEqual({ changed: true });
    expect(source.current()).toBe('tok-2');
  });

  it('does not re-read while the file is unchanged', () => {
    const path = write('token', 'tok-1');
    const source = new TokenSource({ accessTokenFile: path });
    const before = source.info().lastReadAt;

    source.current();
    source.current();

    expect(source.info().lastReadAt).toBe(before);
  });
});

describe('CoolifyClient: one retry on 401 after a rotation (#398)', () => {
  const okResponse = (body: unknown): Response =>
    ({
      ok: true,
      status: 200,
      statusText: 'OK',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => JSON.stringify(body),
    }) as Response;

  const unauthorized = (): Response =>
    ({
      ok: false,
      status: 401,
      statusText: 'Unauthorized',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => JSON.stringify({ message: 'Unauthenticated.' }),
    }) as Response;

  const bearerOf = (call: unknown[]): string =>
    ((call[1] as { headers: Record<string, string> }).headers.Authorization ?? '').replace(
      'Bearer ',
      '',
    );

  it('retries once with the rotated token and succeeds', async () => {
    const path = write('token', 'old-token');
    const client = new CoolifyClient({ baseUrl: 'http://localhost:3000', accessTokenFile: path });
    const fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;

    fetchMock.mockImplementationOnce(async () => {
      // The rotation lands while the first call is in flight.
      writeFileSync(path, 'new-token');
      return unauthorized();
    });
    fetchMock.mockImplementationOnce(async () => okResponse([{ uuid: 's1', name: 'srv' }]));

    // Deliberately not getVersion(): it builds its URL and calls fetch()
    // directly rather than going through request(), so it gets the current
    // token but not the retry.
    await expect(client.listServers()).resolves.toBeDefined();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(bearerOf(fetchMock.mock.calls[0])).toBe('old-token');
    expect(bearerOf(fetchMock.mock.calls[1])).toBe('new-token');
  });

  it('does NOT retry when the token has not changed', async () => {
    // A genuinely invalid token must fail on the first call. Retrying would
    // double every failure and hide the real problem behind a slower one.
    const path = write('token', 'bad-token');
    const client = new CoolifyClient({ baseUrl: 'http://localhost:3000', accessTokenFile: path });
    const fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(unauthorized());

    await expect(client.listServers()).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('does NOT retry a non-401, because a retry could double-fire a write', async () => {
    const path = write('token', 'tok-1');
    const client = new CoolifyClient({ baseUrl: 'http://localhost:3000', accessTokenFile: path });
    const fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: 'Server Error',
      headers: new Headers({ 'Content-Type': 'application/json' }),
      text: async () => JSON.stringify({ message: 'boom' }),
    } as Response);

    await expect(client.listServers()).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('never retries when the token came from the environment', async () => {
    const client = new CoolifyClient({
      baseUrl: 'http://localhost:3000',
      accessToken: 'env-token',
    });
    const fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(unauthorized());

    await expect(client.listServers()).rejects.toThrow();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends the rotated token on the next ordinary call, with no 401 needed', async () => {
    const path = write('token', 'tok-1');
    const client = new CoolifyClient({ baseUrl: 'http://localhost:3000', accessTokenFile: path });
    const fetchMock = jest.fn<typeof fetch>();
    global.fetch = fetchMock;
    fetchMock.mockResolvedValue(okResponse([]));

    await client.listServers();
    writeFileSync(path, 'tok-2');
    touchFuture(path);
    await client.listServers();

    expect(bearerOf(fetchMock.mock.calls[0])).toBe('tok-1');
    expect(bearerOf(fetchMock.mock.calls[1])).toBe('tok-2');
  });
});

describe('CoolifyClient: unreadable token file (#398)', () => {
  it('refuses to construct rather than failing on every later call', () => {
    const path = write('token', 'tok');
    chmodSync(path, 0o000);
    let threw = false;
    try {
      new CoolifyClient({ baseUrl: 'http://localhost:3000', accessTokenFile: path });
    } catch {
      threw = true;
    } finally {
      chmodSync(path, 0o600);
    }
    // Running as root defeats the permission bit, so only assert when it bit.
    if (process.getuid?.() !== 0) expect(threw).toBe(true);
  });
});

describe('doctor reports the token source (#398)', () => {
  const offline = (async () => {
    throw new Error('offline');
  }) as unknown as typeof fetch;

  const run = async (env: NodeJS.ProcessEnv) =>
    (
      await runDoctor({ COOLIFY_BASE_URL: 'https://coolify.example.com', ...env }, offline)
    ).instances[0].checks.find((c) => c.check === 'config');

  it('says a token from the environment needs a restart to rotate', async () => {
    const config = await run({ COOLIFY_ACCESS_TOKEN: 'tok' });

    expect(config?.status).toBe('pass');
    expect(config?.detail).toContain('needs a restart');
  });

  it('names the file, its age, and that no restart is needed', async () => {
    const path = write('token', 'tok');
    const config = await run({ COOLIFY_ACCESS_TOKEN_FILE: path });

    expect(config?.status).toBe('pass');
    expect(config?.detail).toContain(path);
    expect(config?.detail).toContain('no restart needed');
  });

  it('never puts the token value in the report', async () => {
    const path = write('token', 'super-secret-token');
    const config = await run({ COOLIFY_ACCESS_TOKEN_FILE: path });

    expect(JSON.stringify(config)).not.toContain('super-secret-token');
  });

  it('fails when the file is configured but empty', async () => {
    // Looks configured from the outside and produces a bare 401 on every call
    // — exactly the class of problem doctor exists to name.
    const path = write('token', '\n');
    const config = await run({ COOLIFY_ACCESS_TOKEN_FILE: path });

    expect(config?.status).toBe('fail');
    expect(config?.detail).toContain('empty file');
  });

  it('fails when the file is configured but missing', async () => {
    const config = await run({ COOLIFY_ACCESS_TOKEN_FILE: join(dir, 'gone') });

    expect(config?.status).toBe('fail');
    expect(config?.detail).toContain('unreadable');
  });

  it('still fails when neither source is configured, and points at both', async () => {
    const config = await run({});

    expect(config?.status).toBe('fail');
    expect(config?.detail).toContain('COOLIFY_ACCESS_TOKEN is unset');
    expect(config?.detail).toContain('COOLIFY_ACCESS_TOKEN_FILE');
  });
});
