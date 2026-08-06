/**
 * OAuth 2.1 authorization server + HTTP mode tests (#303).
 */

import { jest } from '@jest/globals';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuthProvider, OAuthErrorResponse, canonicalResource } from '../lib/oauth.js';
import {
  createHttpApp,
  validateCoolifyToken,
  RateLimiter,
  type HttpServerConfig,
} from '../lib/http-server.js';
import { CoolifyMcpServer, TOOL_ANNOTATIONS } from '../lib/mcp-server.js';
import { confirmDestructive } from '../lib/elicit.js';

const ISSUER = 'https://mcp.example.com';
const RESOURCE = `${ISSUER}/mcp`;

function makeProvider(stateFile = ''): OAuthProvider {
  return new OAuthProvider({
    issuer: ISSUER,
    resource: RESOURCE,
    accessTokenTtl: 3600,
    refreshTokenTtl: 28_800,
    stateFile,
  });
}

function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') };
}

function registerTestClient(provider: OAuthProvider): string {
  const registered = provider.registerClient({
    client_name: 'Test Client',
    redirect_uris: ['https://client.example.com/callback'],
    token_endpoint_auth_method: 'none',
  });
  return registered.client_id as string;
}

/** Drive the full happy path up to a code, returning what /token needs. */
function authorize(
  provider: OAuthProvider,
  clientId: string,
  challenge: string,
): { code: string; state: string | null } {
  const validated = provider.validateAuthorizationRequest(
    new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://client.example.com/callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
      state: 'client-state',
    }),
  );
  const { redirectTo } = provider.completeAuthorization(validated);
  const url = new URL(redirectTo);
  return { code: url.searchParams.get('code')!, state: url.searchParams.get('state') };
}

describe('OAuthProvider', () => {
  describe('client registration', () => {
    it('registers a public client and echoes RFC 7591 metadata', () => {
      const provider = makeProvider();
      const result = provider.registerClient({
        client_name: 'Claude',
        redirect_uris: ['https://claude.ai/api/mcp/auth_callback'],
      });
      expect(result.client_id).toMatch(/^mcp_client_/);
      expect(result.client_secret).toBeUndefined();
      expect(result.token_endpoint_auth_method).toBe('none');
      expect(result.response_types).toEqual(['code']);
    });

    it('issues a secret for confidential clients and stores only its hash', () => {
      const provider = makeProvider();
      const result = provider.registerClient({
        redirect_uris: ['https://client.example.com/cb'],
        token_endpoint_auth_method: 'client_secret_post',
      });
      expect(result.client_secret).toMatch(/^mcp_secret_/);
    });

    it('rejects missing redirect_uris, non-https redirects, and unknown auth methods', () => {
      const provider = makeProvider();
      expect(() => provider.registerClient({})).toThrow(OAuthErrorResponse);
      expect(() =>
        provider.registerClient({ redirect_uris: ['http://evil.example.com/cb'] }),
      ).toThrow('https');
      expect(() =>
        provider.registerClient({
          redirect_uris: ['https://ok.example.com/cb'],
          token_endpoint_auth_method: 'client_secret_basic',
        }),
      ).toThrow('token_endpoint_auth_method');
    });

    it('allows loopback redirect URIs over http', () => {
      const provider = makeProvider();
      const result = provider.registerClient({
        redirect_uris: ['http://localhost:33418/callback', 'http://127.0.0.1:33418/callback'],
      });
      expect(result.client_id).toBeDefined();
    });
  });

  describe('authorization request validation', () => {
    it('rejects unknown clients, unregistered redirect URIs, and missing PKCE', () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);

      expect(() =>
        provider.validateAuthorizationRequest(new URLSearchParams({ client_id: 'nope' })),
      ).toThrow('unknown client_id');

      expect(() =>
        provider.validateAuthorizationRequest(
          new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'https://attacker.example.com/cb',
          }),
        ),
      ).toThrow('redirect_uri');

      const { challenge } = pkcePair();
      expect(() =>
        provider.validateAuthorizationRequest(
          new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'https://client.example.com/callback',
            response_type: 'code',
            code_challenge: challenge,
            code_challenge_method: 'plain',
          }),
        ),
      ).toThrow('S256');
    });

    it('rejects a resource parameter naming a different server (RFC 8707)', () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const { challenge } = pkcePair();
      expect(() =>
        provider.validateAuthorizationRequest(
          new URLSearchParams({
            client_id: clientId,
            redirect_uri: 'https://client.example.com/callback',
            response_type: 'code',
            code_challenge: challenge,
            code_challenge_method: 'S256',
            resource: 'https://other-server.example.com/mcp',
          }),
        ),
      ).toThrow('invalid_target');
    });
  });

  describe('code exchange', () => {
    it('completes the full PKCE flow and issues working tokens', async () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const { verifier, challenge } = pkcePair();
      const { code, state } = authorize(provider, clientId, challenge);
      expect(state).toBe('client-state');

      const tokens = provider.exchange(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: 'https://client.example.com/callback',
          code_verifier: verifier,
        }),
      );
      expect(tokens.access_token).toMatch(/^mcp_at_/);
      expect(tokens.refresh_token).toMatch(/^mcp_rt_/);
      expect(tokens.expires_in).toBe(3600);

      const verified = await provider.verifyAccessToken(tokens.access_token as string);
      expect(verified.clientId).toBe(clientId);
      expect(verified.resource?.href).toBe(new URL(RESOURCE).href);
    });

    it('rejects a wrong verifier and burns the code either way (single use)', () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const { verifier, challenge } = pkcePair();
      const { code } = authorize(provider, clientId, challenge);

      const attempt = (v: string): Record<string, unknown> =>
        provider.exchange(
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: 'https://client.example.com/callback',
            code_verifier: v,
          }),
        );

      expect(() => attempt('wrong-verifier')).toThrow('PKCE');
      // The failed attempt consumed the code; the correct verifier is too late.
      expect(() => attempt(verifier)).toThrow('invalid or expired');
    });

    it('rejects a redirect_uri mismatch at exchange time', () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const { verifier, challenge } = pkcePair();
      const { code } = authorize(provider, clientId, challenge);
      expect(() =>
        provider.exchange(
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: 'https://client.example.com/other',
            code_verifier: verifier,
          }),
        ),
      ).toThrow('redirect_uri mismatch');
    });

    it("rejects another client's code", () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const otherId = registerTestClient(provider);
      const { verifier, challenge } = pkcePair();
      const { code } = authorize(provider, clientId, challenge);
      expect(() =>
        provider.exchange(
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: otherId,
            code,
            redirect_uri: 'https://client.example.com/callback',
            code_verifier: verifier,
          }),
        ),
      ).toThrow('invalid or expired');
    });
  });

  describe('refresh rotation and reuse detection', () => {
    function issueViaFlow(provider: OAuthProvider, clientId: string): Record<string, unknown> {
      const { verifier, challenge } = pkcePair();
      const { code } = authorize(provider, clientId, challenge);
      return provider.exchange(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: 'https://client.example.com/callback',
          code_verifier: verifier,
        }),
      );
    }

    it('rotates the refresh token on use', async () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const first = issueViaFlow(provider, clientId);

      const second = provider.exchange(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: first.refresh_token as string,
        }),
      );
      expect(second.refresh_token).not.toBe(first.refresh_token);
      await expect(
        provider.verifyAccessToken(second.access_token as string),
      ).resolves.toBeDefined();
    });

    it('revokes the whole grant family when a rotated refresh token is replayed', async () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const first = issueViaFlow(provider, clientId);
      const second = provider.exchange(
        new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: first.refresh_token as string,
        }),
      );

      // Replay of the rotated-away token: the OAuth 2.1 leak signal.
      expect(() =>
        provider.exchange(
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: first.refresh_token as string,
          }),
        ),
      ).toThrow('reuse detected');

      // Every descendant dies with it, including the freshly issued pair.
      await expect(provider.verifyAccessToken(second.access_token as string)).rejects.toThrow(
        'not valid',
      );
      expect(() =>
        provider.exchange(
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: second.refresh_token as string,
          }),
        ),
      ).toThrow('invalid');
    });

    it('refuses a refresh token used as an access token, and vice versa', async () => {
      const provider = makeProvider();
      const clientId = registerTestClient(provider);
      const tokens = issueViaFlow(provider, clientId);
      await expect(provider.verifyAccessToken(tokens.refresh_token as string)).rejects.toThrow(
        'not valid',
      );
      expect(() =>
        provider.exchange(
          new URLSearchParams({
            grant_type: 'refresh_token',
            client_id: clientId,
            refresh_token: tokens.access_token as string,
          }),
        ),
      ).toThrow('invalid');
    });
  });

  describe('persistence', () => {
    it('round-trips state through the file and never writes raw tokens', () => {
      const dir = mkdtempSync(join(tmpdir(), 'oauth-test-'));
      const stateFile = join(dir, 'state.json');
      try {
        const provider = makeProvider(stateFile);
        const clientId = registerTestClient(provider);
        const { verifier, challenge } = pkcePair();
        const { code } = authorize(provider, clientId, challenge);
        const tokens = provider.exchange(
          new URLSearchParams({
            grant_type: 'authorization_code',
            client_id: clientId,
            code,
            redirect_uri: 'https://client.example.com/callback',
            code_verifier: verifier,
          }),
        );
        provider.flush();

        const raw = readFileSync(stateFile, 'utf8');
        expect(raw).not.toContain(tokens.access_token as string);
        expect(raw).not.toContain(tokens.refresh_token as string);
        expect(raw).not.toContain(code);

        // A fresh provider over the same file still honours the tokens.
        const reloaded = makeProvider(stateFile);
        return expect(
          reloaded.verifyAccessToken(tokens.access_token as string),
        ).resolves.toMatchObject({ clientId });
      } finally {
        rmSync(dir, { recursive: true, force: true });
      }
    });
  });

  it('canonicalResource strips fragments and trailing slashes', () => {
    expect(canonicalResource('https://a.example.com/mcp#frag')).toBe('https://a.example.com/mcp');
    expect(canonicalResource('https://a.example.com/mcp/')).toBe('https://a.example.com/mcp');
  });
});

describe('validateCoolifyToken (tier-2 proof of access)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('accepts a token /teams/current accepts', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ id: 0, name: 'Root Team' }), { status: 200 }),
    ) as typeof fetch;
    const result = await validateCoolifyToken('https://coolify.example.com', 'good-token');
    expect(result).toEqual({ ok: true, teamName: 'Root Team' });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://coolify.example.com/api/v1/teams/current',
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: 'Bearer good-token' }),
      }),
    );
  });

  it('refuses on 401 and on network failure', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 401 })) as typeof fetch;
    expect(await validateCoolifyToken('https://coolify.example.com', 'bad')).toEqual({ ok: false });

    global.fetch = jest.fn(async () => {
      throw new Error('unreachable');
    }) as typeof fetch;
    expect(await validateCoolifyToken('https://coolify.example.com', 'any')).toEqual({ ok: false });
  });
});

describe('RateLimiter', () => {
  it('blocks after the limit inside one window', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(true);
    expect(limiter.allow('ip')).toBe(false);
    expect(limiter.allow('other-ip')).toBe(true);
  });
});

describe('HTTP app routes', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function makeApp(overrides: Partial<HttpServerConfig> = {}): ReturnType<typeof createHttpApp> {
    return createHttpApp({
      coolify: { baseUrl: 'https://coolify.example.com', accessToken: 'env-token' },
      publicUrl: ISSUER,
      accessTokenTtl: 3600,
      refreshTokenTtl: 28_800,
      stateFile: '',
      readonly: false,
      ...overrides,
    });
  }

  it('serves AS and protected-resource metadata', async () => {
    const app = makeApp();
    const as = await app.fetch(new Request(`${ISSUER}/.well-known/oauth-authorization-server`));
    expect(as.status).toBe(200);
    const asBody = (await as.json()) as Record<string, unknown>;
    expect(asBody.issuer).toBe(ISSUER);
    expect(asBody.code_challenge_methods_supported).toEqual(['S256']);

    const pr = await app.fetch(new Request(`${ISSUER}/.well-known/oauth-protected-resource`));
    const prBody = (await pr.json()) as Record<string, unknown>;
    expect(prBody.resource).toBe(RESOURCE);
    expect(prBody.authorization_servers).toEqual([ISSUER]);
  });

  it('registers a client over HTTP', async () => {
    const app = makeApp();
    const response = await app.fetch(
      new Request(`${ISSUER}/register`, {
        method: 'POST',
        body: JSON.stringify({ redirect_uris: ['https://client.example.com/cb'] }),
      }),
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as Record<string, unknown>;
    expect(body.client_id).toMatch(/^mcp_client_/);
  });

  it('renders the authorize form with state carried as hidden fields, escaped', async () => {
    const app = makeApp();
    const clientId = registerTestClient(app.provider);
    const { challenge } = pkcePair();
    const query = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://client.example.com/callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: '"><script>alert(1)</script>',
    });
    const response = await app.fetch(new Request(`${ISSUER}/authorize?${query}`));
    expect(response.status).toBe(200);
    const page = await response.text();
    expect(page).toContain('Test Client');
    expect(page).toContain('name="coolify_token"');
    expect(page).not.toContain('<script>alert(1)</script>');
  });

  it('refuses to render the form for an unknown client instead of redirecting', async () => {
    const app = makeApp();
    const response = await app.fetch(new Request(`${ISSUER}/authorize?client_id=nope`));
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
  });

  it('re-renders with an error when the presented Coolify token is refused', async () => {
    global.fetch = jest.fn(async () => new Response('{}', { status: 401 })) as typeof fetch;
    const app = makeApp();
    const clientId = registerTestClient(app.provider);
    const { challenge } = pkcePair();
    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://client.example.com/callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      coolify_token: 'not-a-real-token',
    });
    const response = await app.fetch(
      new Request(`${ISSUER}/authorize`, { method: 'POST', body: form.toString() }),
    );
    expect(response.status).toBe(401);
    const page = await response.text();
    expect(page).toContain('not accepted');
    // The refused credential must not be echoed back into the page.
    expect(page).not.toContain('not-a-real-token');
  });

  it('completes authorize → token over HTTP when proof of access succeeds', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ name: 'Root Team' }), { status: 200 }),
    ) as typeof fetch;
    const app = makeApp();
    const clientId = registerTestClient(app.provider);
    const { verifier, challenge } = pkcePair();

    const form = new URLSearchParams({
      client_id: clientId,
      redirect_uri: 'https://client.example.com/callback',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      state: 'abc',
      coolify_token: 'valid-team-token',
    });
    const authResponse = await app.fetch(
      new Request(`${ISSUER}/authorize`, { method: 'POST', body: form.toString() }),
    );
    expect(authResponse.status).toBe(302);
    const location = new URL(authResponse.headers.get('location')!);
    expect(location.origin + location.pathname).toBe('https://client.example.com/callback');
    expect(location.searchParams.get('state')).toBe('abc');
    const code = location.searchParams.get('code')!;

    const tokenResponse = await app.fetch(
      new Request(`${ISSUER}/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: 'https://client.example.com/callback',
          code_verifier: verifier,
        }).toString(),
      }),
    );
    expect(tokenResponse.status).toBe(200);
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;
    expect(tokens.access_token).toMatch(/^mcp_at_/);
  });

  it('guards /mcp with bearer auth and advertises the resource metadata on 401', async () => {
    const app = makeApp();
    const noToken = await app.fetch(new Request(`${ISSUER}/mcp`, { method: 'POST', body: '{}' }));
    expect(noToken.status).toBe(401);
    expect(noToken.headers.get('www-authenticate')).toContain('oauth-protected-resource');

    const badToken = await app.fetch(
      new Request(`${ISSUER}/mcp`, {
        method: 'POST',
        headers: { authorization: 'Bearer mcp_at_forged' },
        body: '{}',
      }),
    );
    expect(badToken.status).toBe(401);
  });

  it('answers healthz without auth', async () => {
    const app = makeApp();
    const response = await app.fetch(new Request(`${ISSUER}/healthz`));
    expect(response.status).toBe(200);
  });

  it('serves the MCP protocol end-to-end behind the bearer gate', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ name: 'Root Team' }), { status: 200 }),
    ) as typeof fetch;
    const app = makeApp({ readonly: true });
    const clientId = registerTestClient(app.provider);
    const { verifier, challenge } = pkcePair();

    const authResponse = await app.fetch(
      new Request(`${ISSUER}/authorize`, {
        method: 'POST',
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: 'https://client.example.com/callback',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          coolify_token: 'valid',
        }).toString(),
      }),
    );
    const code = new URL(authResponse.headers.get('location')!).searchParams.get('code')!;
    const tokenResponse = await app.fetch(
      new Request(`${ISSUER}/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: 'https://client.example.com/callback',
          code_verifier: verifier,
        }).toString(),
      }),
    );
    const { access_token } = (await tokenResponse.json()) as { access_token: string };

    const mcpRequest = (body: unknown): Request =>
      new Request(`${ISSUER}/mcp`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${access_token}`,
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
        },
        body: JSON.stringify(body),
      });

    const initResponse = await app.fetch(
      mcpRequest({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'oauth-test', version: '0.0.0' },
        },
      }),
    );
    expect(initResponse.status).toBe(200);
    expect(await initResponse.text()).toContain('coolify');

    const listResponse = await app.fetch(
      mcpRequest({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    );
    expect(listResponse.status).toBe(200);
    const listText = await listResponse.text();
    // Read-only surface over HTTP: observability tools present, the emergency
    // stop absent.
    expect(listText).toContain('get_infrastructure_overview');
    expect(listText).not.toContain('stop_all_apps');
  });
});

describe('HTTP-mode server posture (#303)', () => {
  const config = { baseUrl: 'https://coolify.example.com', accessToken: 'env-token' };

  it('read-only mode registers only read-only-annotated tools', () => {
    const readonly = new CoolifyMcpServer(config, { readonly: true });
    const registered = (readonly as unknown as { _registeredTools: Record<string, unknown> })
      ._registeredTools;
    const readOnlyNames = Object.entries(TOOL_ANNOTATIONS)
      .filter(
        ([, annotations]) => (annotations as { readOnlyHint?: boolean }).readOnlyHint === true,
      )
      .map(([name]) => name)
      .sort();
    expect(Object.keys(registered).sort()).toEqual(readOnlyNames);
    expect(registered['stop_all_apps']).toBeUndefined();
    expect(registered['get_infrastructure_overview']).toBeDefined();
  });

  it('confirmDestructive fails closed when requireHuman is set and the client cannot be asked', async () => {
    const fakeServer = {
      getClientCapabilities: () => undefined,
    } as unknown as Parameters<typeof confirmDestructive>[0];

    const closed = await confirmDestructive(
      fakeServer,
      'Stop everything',
      () => 'Sure?',
      undefined,
      {
        requireHuman: true,
      },
    );
    expect(closed.approved).toBe(false);
    if (!closed.approved) {
      expect(closed.message).toContain('does not support elicitation');
    }

    // Default (stdio) behaviour is unchanged: pass through.
    const open = await confirmDestructive(fakeServer, 'Stop everything', () => 'Sure?');
    expect(open.approved).toBe(true);
  });
});
