/**
 * OAuth 2.1 authorization server + HTTP mode tests (#303).
 */

import { jest } from '@jest/globals';
import { createHash, randomBytes } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { OAuthProvider, OAuthErrorResponse, canonicalResource } from '../lib/oauth.js';
import {
  createHttpApp,
  normalizePublicUrl,
  validateCoolifyToken,
  RateLimiter,
  type HttpServerConfig,
} from '../lib/http-server.js';
import { CoolifyMcpServer, FLEET_ONLY_TOOLS, TOOL_ANNOTATIONS } from '../lib/mcp-server.js';
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
        redirect_uris: [
          'http://localhost:33418/callback',
          'http://127.0.0.1:33418/callback',
          'http://[::1]:33418/callback',
        ],
      });
      expect(result.client_id).toBeDefined();
    });

    it('rejects non-http schemes even on a loopback host, and fragments (#340)', () => {
      const provider = makeProvider();
      for (const uri of [
        'javascript://localhost/alert(1)',
        'file://localhost/etc/passwd',
        'data://127.0.0.1/text',
        'custom://[::1]/cb',
      ]) {
        expect(() => provider.registerClient({ redirect_uris: [uri] })).toThrow('https');
      }
      expect(() =>
        provider.registerClient({ redirect_uris: ['https://ok.example.com/cb#frag'] }),
      ).toThrow('fragment');
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

  it('carries extra headers (CF Access service token) without displacing the proven token', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ id: 0, name: 'Root Team' }), { status: 200 }),
    ) as typeof fetch;
    await validateCoolifyToken('https://coolify.example.com', 'good-token', {
      'CF-Access-Client-Id': 'id.access',
      'CF-Access-Client-Secret': 'cf-secret',
      // A hostile extra header must not be able to override the Authorization
      // header carrying the token under proof.
      Authorization: 'Bearer smuggled',
    });
    expect(global.fetch).toHaveBeenCalledWith(
      'https://coolify.example.com/api/v1/teams/current',
      expect.objectContaining({
        headers: expect.objectContaining({
          'CF-Access-Client-Id': 'id.access',
          'CF-Access-Client-Secret': 'cf-secret',
          Authorization: 'Bearer good-token',
        }),
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

  it('answers an unauthenticated POST /mcp with 401 + WWW-Authenticate before the SDK sees the body (#340)', async () => {
    const app = makeApp();
    // The audit line is written only past the bearer gate, so capturing stdout
    // shows whether the JSON-RPC body ever reached the handler.
    const written: string[] = [];
    const auditSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      written.push(args.map(String).join(' '));
    });
    try {
      const toolsCall = JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'tools/call',
        params: { name: 'get_mcp_version', arguments: {} },
      });
      const headers = {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      };

      const missing = await app.fetch(
        new Request(RESOURCE, { method: 'POST', headers, body: toolsCall }),
      );
      expect(missing.status).toBe(401);
      const challenge = missing.headers.get('www-authenticate') ?? '';
      expect(challenge).toMatch(/^Bearer /);
      expect(challenge).toContain(
        `resource_metadata="${ISSUER}/.well-known/oauth-protected-resource"`,
      );
      // Not the 200-with-isError anti-pattern: no JSON-RPC envelope comes back.
      expect(await missing.text()).not.toContain('"jsonrpc"');

      const bogus = await app.fetch(
        new Request(RESOURCE, {
          method: 'POST',
          headers: { ...headers, authorization: 'Bearer mcp_at_not_a_real_token' },
          body: toolsCall,
        }),
      );
      expect(bogus.status).toBe(401);
      expect(bogus.headers.get('www-authenticate')).toContain('error="invalid_token"');

      expect(written.some((line) => line.includes('"audit"'))).toBe(false);

      // The challenge points at metadata whose resource is exactly the URL the
      // client used, so discovery can start from the 401 alone.
      const prm = await app.fetch(new Request(`${ISSUER}/.well-known/oauth-protected-resource`));
      expect(((await prm.json()) as { resource: string }).resource).toBe(RESOURCE);
    } finally {
      auditSpy.mockRestore();
    }
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

  it('sends configured customHeaders (CF Access) on the authorize-time token validation', async () => {
    // The wiring the 2026-09-08 incident was about: createHttpApp must hand
    // config.coolify.customHeaders to validateCoolifyToken, or authorize
    // dies behind Cloudflare Access while /healthz stays green.
    const fetchMock = jest.fn(
      async () => new Response(JSON.stringify({ name: 'Root Team' }), { status: 200 }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const app = makeApp({
      coolify: {
        baseUrl: 'https://coolify.example.com',
        accessToken: 'env-token',
        customHeaders: { 'CF-Access-Client-Id': 'id.access', 'CF-Access-Client-Secret': 'cf-s' },
      },
    });
    const clientId = registerTestClient(app.provider);
    const { challenge } = pkcePair();
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
    expect(fetchMock).toHaveBeenCalledWith(
      'https://coolify.example.com/api/v1/teams/current',
      expect.objectContaining({
        headers: expect.objectContaining({
          'CF-Access-Client-Id': 'id.access',
          'CF-Access-Client-Secret': 'cf-s',
          Authorization: 'Bearer valid-team-token',
        }),
      }),
    );
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

describe('normalizePublicUrl', () => {
  it('accepts every shape SERVICE_FQDN and humans produce', () => {
    expect(normalizePublicUrl('https://mcp.example.com')).toBe('https://mcp.example.com');
    expect(normalizePublicUrl('mcp.example.com')).toBe('https://mcp.example.com');
    expect(normalizePublicUrl('  mcp.example.com/  ')).toBe('https://mcp.example.com');
    expect(normalizePublicUrl('https://mcp.example.com///')).toBe('https://mcp.example.com');
    expect(normalizePublicUrl('http://localhost:8080')).toBe('http://localhost:8080');
    expect(normalizePublicUrl('https://mcp.example.com/base/')).toBe(
      'https://mcp.example.com/base',
    );
    expect(normalizePublicUrl('https://mcp.example.com?utm=x#frag')).toBe(
      'https://mcp.example.com',
    );
  });

  it('rejects garbage and non-http protocols', () => {
    expect(() => normalizePublicUrl('')).toThrow();
    expect(() => normalizePublicUrl('   ')).toThrow();
    expect(() => normalizePublicUrl('ftp://mcp.example.com')).toThrow('unsupported protocol');
    expect(() => normalizePublicUrl('http://')).toThrow();
  });
});

describe('adversarial (#303 hardening)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  function makeApp(): ReturnType<typeof createHttpApp> {
    return createHttpApp({
      coolify: { baseUrl: 'https://coolify.example.com', accessToken: 'env-token' },
      publicUrl: ISSUER,
      accessTokenTtl: 3600,
      refreshTokenTtl: 28_800,
      stateFile: '',
      readonly: false,
    });
  }

  it('a tampered redirect_uri at the form POST renders an error, never a redirect', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ name: 'Root Team' }), { status: 200 }),
    ) as typeof fetch;
    const app = makeApp();
    const clientId = registerTestClient(app.provider);
    const { challenge } = pkcePair();
    const response = await app.fetch(
      new Request(`${ISSUER}/authorize`, {
        method: 'POST',
        body: new URLSearchParams({
          client_id: clientId,
          redirect_uri: 'https://attacker.example.com/steal',
          response_type: 'code',
          code_challenge: challenge,
          code_challenge_method: 'S256',
          coolify_token: 'anything',
        }).toString(),
      }),
    );
    expect(response.status).toBe(400);
    expect(response.headers.get('location')).toBeNull();
    // The proof-of-access call must never have been made for a request that
    // could not legitimately complete.
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it('a hostile client_name registered via DCR cannot script the authorize page', async () => {
    const app = makeApp();
    const registered = app.provider.registerClient({
      client_name: '</title><script>steal()</script>',
      redirect_uris: ['https://client.example.com/cb'],
    });
    const { challenge } = pkcePair();
    const query = new URLSearchParams({
      client_id: registered.client_id as string,
      redirect_uri: 'https://client.example.com/cb',
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const page = await (await app.fetch(new Request(`${ISSUER}/authorize?${query}`))).text();
    expect(page).not.toContain('<script>steal()');
  });

  it('advertises RFC 9207 and echoes iss on the redirect', async () => {
    global.fetch = jest.fn(
      async () => new Response(JSON.stringify({ name: 'Root Team' }), { status: 200 }),
    ) as typeof fetch;
    const app = makeApp();
    const metadata = (await (
      await app.fetch(new Request(`${ISSUER}/.well-known/oauth-authorization-server`))
    ).json()) as Record<string, unknown>;
    expect(metadata.authorization_response_iss_parameter_supported).toBe(true);

    const clientId = registerTestClient(app.provider);
    const { challenge } = pkcePair();
    const response = await app.fetch(
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
    expect(new URL(response.headers.get('location')!).searchParams.get('iss')).toBe(ISSUER);
  });

  it('serves both well-known path forms clients derive from the /mcp resource', async () => {
    const app = makeApp();
    for (const path of [
      '/.well-known/oauth-authorization-server/mcp',
      '/.well-known/oauth-protected-resource/mcp',
    ]) {
      const response = await app.fetch(new Request(`${ISSUER}${path}`));
      expect(response.status).toBe(200);
    }
  });

  it('rate limits registration hammering', async () => {
    const app = makeApp();
    let lastStatus = 0;
    for (let i = 0; i < 25; i += 1) {
      const response = await app.fetch(
        new Request(`${ISSUER}/register`, {
          method: 'POST',
          headers: { 'x-forwarded-for': '203.0.113.9' },
          body: JSON.stringify({ redirect_uris: ['https://client.example.com/cb'] }),
        }),
      );
      lastStatus = response.status;
    }
    expect(lastStatus).toBe(429);
  });

  it('answers garbage token requests with OAuth errors, not stack traces', async () => {
    const app = makeApp();
    const unknownGrant = await app.fetch(
      new Request(`${ISSUER}/token`, { method: 'POST', body: 'grant_type=password&user=admin' }),
    );
    // RFC 6749: unsupported_grant_type is a 400-class error.
    expect(unknownGrant.status).toBe(400);
    expect(((await unknownGrant.json()) as { error: string }).error).toBe('unsupported_grant_type');
    const unknownClient = await app.fetch(
      new Request(`${ISSUER}/token`, {
        method: 'POST',
        body: 'grant_type=authorization_code&client_id=forged&code=x',
      }),
    );
    expect(unknownClient.status).toBe(401);
    const emptyBody = await app.fetch(new Request(`${ISSUER}/token`, { method: 'POST' }));
    expect([400, 401]).toContain(emptyBody.status);
  });

  it('writes the state file owner-read-only (0600)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'oauth-perm-'));
    const stateFile = join(dir, 'state.json');
    try {
      const provider = makeProvider(stateFile);
      registerTestClient(provider);
      provider.flush();
      const mode = statSync(stateFile).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
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
      .filter((name) => !FLEET_ONLY_TOOLS.has(name as keyof typeof TOOL_ANNOTATIONS))
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

describe('Client ID Metadata Documents (#340)', () => {
  const CLIENT_URL = 'https://client.example.com/oauth/client.json';
  const CALLBACK = 'https://client.example.com/callback';
  const goodDocument = (): Record<string, unknown> => ({
    client_id: CLIENT_URL,
    client_name: 'Example Client',
    redirect_uris: [CALLBACK],
    token_endpoint_auth_method: 'none',
  });

  function makeCimdProvider(
    fetchClientMetadata: (url: string) => Promise<unknown>,
    overrides: { clientMetadataTtl?: number; stateFile?: string } = {},
  ): OAuthProvider {
    return new OAuthProvider({
      issuer: ISSUER,
      resource: RESOURCE,
      accessTokenTtl: 3600,
      refreshTokenTtl: 28_800,
      stateFile: overrides.stateFile ?? '',
      fetchClientMetadata,
      clientMetadataTtl: overrides.clientMetadataTtl,
    });
  }

  function authorizeParams(clientId: string, challenge: string): URLSearchParams {
    return new URLSearchParams({
      client_id: clientId,
      redirect_uri: CALLBACK,
      response_type: 'code',
      code_challenge: challenge,
      code_challenge_method: 'S256',
      resource: RESOURCE,
    });
  }

  it('advertises the flag alongside token_endpoint_auth_method none', () => {
    const metadata = makeProvider().authorizationServerMetadata();
    expect(metadata.client_id_metadata_document_supported).toBe(true);
    expect(metadata.token_endpoint_auth_methods_supported).toContain('none');
    // DCR stays as the fallback for clients that predate the document.
    expect(metadata.registration_endpoint).toBe(`${ISSUER}/register`);
  });

  it('resolves a URL client_id from its document and runs the whole code flow on it', async () => {
    const fetcher = jest.fn(async (url: string) => {
      expect(url).toBe(CLIENT_URL);
      return goodDocument();
    });
    const provider = makeCimdProvider(fetcher);
    const { verifier, challenge } = pkcePair();

    await provider.resolveClient(CLIENT_URL);
    const validated = provider.validateAuthorizationRequest(authorizeParams(CLIENT_URL, challenge));
    // The consent page shows where the registration came from, not only a chosen name.
    expect(validated.client.client_name).toBe('Example Client (client.example.com)');
    expect(validated.client.token_endpoint_auth_method).toBe('none');

    const { redirectTo } = provider.completeAuthorization(validated);
    const code = new URL(redirectTo).searchParams.get('code')!;

    await provider.resolveClient(CLIENT_URL);
    const tokens = provider.exchange(
      new URLSearchParams({
        grant_type: 'authorization_code',
        client_id: CLIENT_URL,
        code,
        redirect_uri: CALLBACK,
        code_verifier: verifier,
      }),
    );
    await expect(provider.verifyAccessToken(tokens.access_token as string)).resolves.toMatchObject({
      clientId: CLIENT_URL,
    });
    // One fetch served both the authorize and the token leg.
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('is a no-op for registered ids and for ids that are not URLs', async () => {
    const fetcher = jest.fn(async () => goodDocument());
    const provider = makeCimdProvider(fetcher);
    const registered = registerTestClient(provider);
    await provider.resolveClient(registered);
    await provider.resolveClient('mcp_client_does_not_exist');
    expect(fetcher).not.toHaveBeenCalled();
    expect(() =>
      provider.validateAuthorizationRequest(authorizeParams('mcp_client_does_not_exist', 'x')),
    ).toThrow(/unknown client_id/);
  });

  it.each([
    ['http://client.example.com/client.json', 'must use https'],
    ['https://user:pw@client.example.com/client.json', 'userinfo'],
    ['https://client.example.com', 'path component'],
    ['https://client.example.com/', 'path component'],
    ['https://client.example.com/a/../client.json', 'dot path segments'],
    ['https://client.example.com/client.json#frag', 'fragment'],
  ])('rejects the client identifier URL %s before fetching', async (clientId, reason) => {
    const fetcher = jest.fn(async () => goodDocument());
    const provider = makeCimdProvider(fetcher);
    await expect(provider.resolveClient(clientId)).rejects.toThrow(reason);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it.each([
    [
      'client_id mismatch',
      { ...goodDocument(), client_id: 'https://client.example.com/other.json' },
      'does not match',
    ],
    ['no redirect_uris', { ...goodDocument(), redirect_uris: [] }, 'redirect_uris'],
    [
      'non-https redirect',
      { ...goodDocument(), redirect_uris: ['http://client.example.com/cb'] },
      'unusable redirect_uri',
    ],
    [
      'secret-based auth',
      { ...goodDocument(), token_endpoint_auth_method: 'client_secret_post' },
      '"none"',
    ],
    ['embedded secret', { ...goodDocument(), client_secret: 'nope' }, 'client_secret'],
    ['not an object', ['nope'], 'JSON object'],
  ])(
    'rejects a document with %s and does not cache the failure',
    async (_label, document, reason) => {
      const fetcher = jest.fn(async () => document);
      const provider = makeCimdProvider(fetcher);
      await expect(provider.resolveClient(CLIENT_URL)).rejects.toThrow(reason);
      // One code for everything wrong with a document, on every leg.
      await expect(provider.resolveClient(CLIENT_URL)).rejects.toMatchObject({
        code: 'invalid_client',
        status: 401,
      });
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(() => provider.validateAuthorizationRequest(authorizeParams(CLIENT_URL, 'x'))).toThrow(
        /unknown client_id/,
      );
    },
  );

  it('surfaces a fetch failure as a generic invalid_client, logs the detail, and retries next time', async () => {
    const fetcher = jest
      .fn<(url: string) => Promise<unknown>>()
      .mockRejectedValueOnce(
        new Error('client.example.com answered 302; redirects are not followed'),
      )
      .mockResolvedValueOnce(goodDocument());
    const provider = makeCimdProvider(fetcher);
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const failure = provider.resolveClient(CLIENT_URL);
      await expect(failure).rejects.toMatchObject({ code: 'invalid_client', status: 401 });
      // The page must not become a probing oracle for public hosts: the
      // reason stays in the log, the caller gets one sentence.
      await expect(failure).rejects.toThrow(
        /^invalid_client: client_id metadata document could not be fetched$/,
      );
      expect(String(stderr.mock.calls[0][0])).toMatch(/client\.example\.com.*answered 302/);
    } finally {
      stderr.mockRestore();
    }
    await expect(provider.resolveClient(CLIENT_URL)).resolves.toBeUndefined();
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('fetches once for concurrent requests naming the same client_id', async () => {
    let release!: (value: unknown) => void;
    const fetcher = jest.fn(() => new Promise<unknown>((resolve) => (release = resolve)));
    const provider = makeCimdProvider(fetcher);
    const a = provider.resolveClient(CLIENT_URL);
    const b = provider.resolveClient(CLIENT_URL);
    release(goodDocument());
    await Promise.all([a, b]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('keeps a known client working through a document-host outage, for a bounded time', async () => {
    jest.useFakeTimers();
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const fetcher = jest
        .fn<(url: string) => Promise<unknown>>()
        .mockResolvedValueOnce(goodDocument())
        .mockRejectedValue(new Error('gave no response within 10000ms'));
      const provider = makeCimdProvider(fetcher);
      await provider.resolveClient(CLIENT_URL);
      // Past the hour: the refresh fails, the last good document serves.
      jest.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
      await expect(provider.resolveClient(CLIENT_URL)).resolves.toBeUndefined();
      expect(() =>
        provider.validateAuthorizationRequest(authorizeParams(CLIENT_URL, 'x')),
      ).not.toThrow();
      // Past the day of grace: the registration is gone until the host is back.
      jest.setSystemTime(Date.now() + 25 * 60 * 60 * 1000);
      await expect(provider.resolveClient(CLIENT_URL)).rejects.toMatchObject({
        code: 'invalid_client',
      });
    } finally {
      stderr.mockRestore();
      jest.useRealTimers();
    }
  });

  it('evicts lapsed documents on prune and caps the cache at 512 entries', async () => {
    jest.useFakeTimers();
    try {
      const provider = makeCimdProvider(async (url: string) => ({
        ...goodDocument(),
        client_id: url,
      }));
      const cache = (provider as unknown as { metadataClients: Map<string, unknown> })
        .metadataClients;
      for (let i = 0; i < 600; i++) {
        await provider.resolveClient(`https://client.example.com/c/${i}.json`);
      }
      expect(cache.size).toBe(512);
      expect(cache.has('https://client.example.com/c/599.json')).toBe(true);
      expect(cache.has('https://client.example.com/c/0.json')).toBe(false);

      jest.setSystemTime(Date.now() + 30 * 60 * 60 * 1000);
      // prune() runs at the top of every token exchange.
      expect(() => provider.exchange(new URLSearchParams({ grant_type: 'nope' }))).toThrow();
      expect(cache.size).toBe(0);
    } finally {
      jest.useRealTimers();
    }
  });

  it('re-fetches once the cache entry expires, so a client can change its redirect URIs', async () => {
    const fetcher = jest
      .fn<(url: string) => Promise<unknown>>()
      .mockResolvedValueOnce(goodDocument())
      .mockResolvedValueOnce({
        ...goodDocument(),
        redirect_uris: ['https://client.example.com/v2'],
      });
    const provider = makeCimdProvider(fetcher);
    jest.useFakeTimers();
    try {
      await provider.resolveClient(CLIENT_URL);
      jest.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);
      await provider.resolveClient(CLIENT_URL);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(() => provider.validateAuthorizationRequest(authorizeParams(CLIENT_URL, 'x'))).toThrow(
        /redirect_uri not registered/,
      );
    } finally {
      jest.useRealTimers();
    }
  });

  it('rejects a redirect_uri the document does not list, exactly as DCR does', async () => {
    const provider = makeCimdProvider(async () => goodDocument());
    await provider.resolveClient(CLIENT_URL);
    const params = authorizeParams(CLIENT_URL, 'x');
    params.set('redirect_uri', 'https://client.example.com/callback/'); // trailing slash: not an exact match
    expect(() => provider.validateAuthorizationRequest(params)).toThrow(
      /redirect_uri not registered/,
    );
  });

  it('never writes a metadata-document client to the state file', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'oauth-cimd-'));
    const stateFile = join(dir, 'state.json');
    try {
      const provider = makeCimdProvider(async () => goodDocument(), { stateFile });
      await provider.resolveClient(CLIENT_URL);
      const { verifier, challenge } = pkcePair();
      const validated = provider.validateAuthorizationRequest(
        authorizeParams(CLIENT_URL, challenge),
      );
      const code = new URL(provider.completeAuthorization(validated).redirectTo).searchParams.get(
        'code',
      )!;
      provider.exchange(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: CLIENT_URL,
          code,
          redirect_uri: CALLBACK,
          code_verifier: verifier,
        }),
      );
      provider.flush();
      const state = JSON.parse(readFileSync(stateFile, 'utf8')) as { clients: unknown[] };
      expect(state.clients).toEqual([]);
      // Tokens issued to it persist as usual (they only carry the id string).
      expect(readFileSync(stateFile, 'utf8')).toContain(CLIENT_URL);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('uses the SSRF-guarded fetch by default: a private-address client_id is refused without a socket', async () => {
    const provider = makeProvider();
    await expect(provider.resolveClient('https://127.0.0.1/client.json')).rejects.toThrow(
      /could not be fetched/,
    );
    await expect(
      provider.resolveClient('https://169.254.169.254/latest/client.json'),
    ).rejects.toThrow(/could not be fetched/);
  });

  it('runs the resolve step on every HTTP leg that takes a client_id', async () => {
    const app = createHttpApp({
      coolify: { baseUrl: 'https://coolify.example.com', accessToken: 'env-token' },
      publicUrl: ISSUER,
      accessTokenTtl: 3600,
      refreshTokenTtl: 28_800,
      stateFile: '',
      readonly: false,
    });
    // No fetcher injected here, so the real guard answers: a loopback
    // identifier is rejected on the page, never redirected, never fetched.
    const bad = 'https://127.0.0.1/client.json';
    const get = await app.fetch(
      new Request(`${ISSUER}/authorize?${authorizeParams(bad, 'x').toString()}`),
    );
    expect(get.status).toBe(400);
    expect(await get.text()).toContain('could not be fetched');

    const post = await app.fetch(
      new Request(`${ISSUER}/authorize`, {
        method: 'POST',
        body: authorizeParams(bad, 'x').toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(post.status).toBe(400);

    const token = await app.fetch(
      new Request(`${ISSUER}/token`, {
        method: 'POST',
        body: new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: bad,
          code: 'x',
        }).toString(),
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
      }),
    );
    expect(token.status).toBe(401);
    expect(((await token.json()) as { error: string }).error).toBe('invalid_client');
  });

  it('rejects an identifier that starts like a URL but does not parse, before fetching', async () => {
    const fetcher = jest.fn(async () => goodDocument());
    const provider = makeCimdProvider(fetcher);
    await expect(provider.resolveClient('https://[/client.json')).rejects.toThrow(
      /not a valid URL/,
    );
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('checks dot segments on the decoded path and tolerates a malformed escape', async () => {
    const fetcher = jest.fn(async () => goodDocument());
    const provider = makeCimdProvider(fetcher);
    await expect(
      provider.resolveClient('https://client.example.com/a/%2e%2e/client.json'),
    ).rejects.toThrow(/dot path segments/);
    expect(fetcher).not.toHaveBeenCalled();
    // A segment that is not valid percent-encoding is compared as sent, not
    // rejected outright: the document's client_id check settles it.
    await expect(
      provider.resolveClient('https://client.example.com/%E0%A4%A/client.json'),
    ).rejects.toThrow(/does not match/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('reports an unparseable redirect_uri in a document as invalid_client', async () => {
    const provider = makeCimdProvider(async () => ({
      ...goodDocument(),
      redirect_uris: ['not a url'],
    }));
    await expect(provider.resolveClient(CLIENT_URL)).rejects.toMatchObject({
      code: 'invalid_client',
      description: expect.stringMatching(/unusable redirect_uri: not a valid URL/),
    });
  });

  it('still authenticates confidential DCR clients by secret at the token endpoint', async () => {
    const provider = makeProvider();
    const registered = provider.registerClient({
      redirect_uris: ['https://client.example.com/callback'],
      token_endpoint_auth_method: 'client_secret_post',
    });
    const clientId = registered.client_id as string;
    const secret = registered.client_secret as string;
    const { verifier, challenge } = pkcePair();
    const { code } = authorize(provider, clientId, challenge);
    const exchange = (clientSecret?: string) =>
      provider.exchange(
        new URLSearchParams({
          grant_type: 'authorization_code',
          client_id: clientId,
          code,
          redirect_uri: 'https://client.example.com/callback',
          code_verifier: verifier,
          ...(clientSecret === undefined ? {} : { client_secret: clientSecret }),
        }),
      );
    expect(() => exchange()).toThrow(/client authentication failed/);
    expect(() => exchange('wrong')).toThrow(/client authentication failed/);
    expect(exchange(secret).access_token).toBeDefined();
  });

  it('rate-limits POST /authorize per IP', async () => {
    const app = createHttpApp({
      coolify: { baseUrl: 'https://coolify.example.com', accessToken: 'env-token' },
      publicUrl: ISSUER,
      accessTokenTtl: 3600,
      refreshTokenTtl: 28_800,
      stateFile: '',
      readonly: false,
    });
    const headers = {
      'x-forwarded-for': '203.0.113.10',
      'content-type': 'application/x-www-form-urlencoded',
    };
    let last = 0;
    for (let i = 0; i < 21; i++) {
      const res = await app.fetch(
        new Request(`${ISSUER}/authorize`, {
          method: 'POST',
          body: authorizeParams('mcp_client_nope', 'x').toString(),
          headers,
        }),
      );
      last = res.status;
    }
    expect(last).toBe(429);
  });

  it('rate-limits GET /authorize per IP only when the client_id is a URL', async () => {
    const app = createHttpApp({
      coolify: { baseUrl: 'https://coolify.example.com', accessToken: 'env-token' },
      publicUrl: ISSUER,
      accessTokenTtl: 3600,
      refreshTokenTtl: 28_800,
      stateFile: '',
      readonly: false,
    });
    const stderr = jest.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const headers = { 'x-forwarded-for': '203.0.113.9' };
      const statuses: number[] = [];
      for (let i = 0; i < 21; i++) {
        const res = await app.fetch(
          new Request(
            `${ISSUER}/authorize?${authorizeParams(`https://127.0.0.1/c/${i}.json`, 'x').toString()}`,
            { headers },
          ),
        );
        statuses.push(res.status);
      }
      expect(statuses.slice(0, 20).every((code) => code === 400)).toBe(true);
      expect(statuses[20]).toBe(429);

      // A registered-id page is in-memory work and keeps its old behaviour.
      const plain = await app.fetch(
        new Request(`${ISSUER}/authorize?${authorizeParams('mcp_client_nope', 'x').toString()}`, {
          headers,
        }),
      );
      expect(plain.status).toBe(400);
    } finally {
      stderr.mockRestore();
    }
  });
});
