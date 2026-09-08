/**
 * Reference-client interop for HTTP mode (#303).
 *
 * Drives the OAuth 2.1 authorization server and the /mcp endpoint with the
 * official MCP client SDK's own auth machinery — discovery, dynamic
 * registration, PKCE authorization, code exchange, refresh — over a real TCP
 * socket. If the reference implementation can complete the whole journey and
 * then list and call tools, a real remote client has no protocol-level reason
 * to fail. The only simulated part is the human: the browser form POST is
 * played by fetch.
 */

import { createServer, type Server as NodeHttpServer } from 'node:http';
import { AddressInfo } from 'node:net';
import {
  Client,
  StreamableHTTPClientTransport,
  discoverOAuthProtectedResourceMetadata,
  discoverAuthorizationServerMetadata,
  registerClient,
  startAuthorization,
  exchangeAuthorization,
  refreshAuthorization,
  type OAuthClientInformationFull,
  type AuthorizationServerMetadata,
} from '@modelcontextprotocol/client';
import { createHttpApp } from '../lib/http-server.js';

/**
 * Bridge a fetch-shaped handler onto a real Node listener (mirrors http.ts).
 * The handler and base URL are read lazily so the listener can bind to an
 * ephemeral port before the app (whose issuer bakes in that port) exists.
 */
function serve(
  handler: () => (request: Request) => Promise<Response>,
  baseUrl: () => string,
): NodeHttpServer {
  return createServer((req, res) => {
    void (async (): Promise<void> => {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = Buffer.concat(chunks);
      const request = new Request(`${baseUrl()}${req.url ?? '/'}`, {
        method: req.method,
        headers: Object.entries(req.headers).flatMap(([key, value]) =>
          value === undefined
            ? []
            : Array.isArray(value)
              ? value.map((v) => [key, v] as [string, string])
              : [[key, value] as [string, string]],
        ),
        body: body.length > 0 ? body : undefined,
      });
      const response = await handler()(request);
      res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
      if (response.body) {
        const reader = response.body.getReader();
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(value);
        }
      }
      res.end();
    })().catch(() => {
      res.writeHead(500);
      res.end();
    });
  });
}

describe('HTTP mode interop with the reference MCP client', () => {
  let coolifyMock: NodeHttpServer;
  let mcpServer: NodeHttpServer;
  let publicUrl = '';
  let resourceUrl = '';

  beforeAll(async () => {
    // A pretend Coolify: accepts exactly one token on /teams/current.
    coolifyMock = createServer((req, res) => {
      if (
        req.url === '/api/v1/teams/current' &&
        req.headers.authorization === 'Bearer users-own-coolify-token'
      ) {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ id: 0, name: 'Root Team' }));
        return;
      }
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ message: 'Unauthenticated.' }));
    });
    await new Promise<void>((resolve) => coolifyMock.listen(0, resolve));
    const coolifyPort = (coolifyMock.address() as AddressInfo).port;

    // Bind first so the ephemeral port is known, then build the app with its
    // issuer set to the real origin.
    let appFetch: (request: Request) => Promise<Response> = async () =>
      new Response(null, { status: 503 });
    mcpServer = serve(
      () => appFetch,
      () => publicUrl,
    );
    await new Promise<void>((resolve) => mcpServer.listen(0, resolve));
    const port = (mcpServer.address() as AddressInfo).port;
    publicUrl = `http://127.0.0.1:${port}`;
    resourceUrl = `${publicUrl}/mcp`;
    const app = createHttpApp({
      coolify: { baseUrl: `http://127.0.0.1:${coolifyPort}`, accessToken: 'container-env-token' },
      publicUrl,
      accessTokenTtl: 3600,
      refreshTokenTtl: 28_800,
      stateFile: '',
      readonly: false,
    });
    appFetch = app.fetch;
  });

  afterAll(async () => {
    await new Promise((resolve) => mcpServer.close(resolve));
    await new Promise((resolve) => coolifyMock.close(resolve));
  });

  it('completes discovery → registration → PKCE → tools, with the SDK doing the client half', async () => {
    // 1. RFC 9728 discovery from the resource URL.
    const prm = await discoverOAuthProtectedResourceMetadata(resourceUrl);
    expect(prm.resource).toBe(resourceUrl);
    expect(prm.authorization_servers).toEqual([publicUrl]);

    // 2. RFC 8414 AS metadata.
    const metadata = (await discoverAuthorizationServerMetadata(
      prm.authorization_servers![0],
    )) as AuthorizationServerMetadata;
    expect(metadata.issuer).toBe(publicUrl);

    // 3. RFC 7591 dynamic registration, exactly as a remote client does it.
    const clientInformation = (await registerClient(publicUrl, {
      metadata,
      clientMetadata: {
        client_name: 'Interop Test Client',
        redirect_uris: ['http://127.0.0.1:45678/callback'],
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
      },
    })) as OAuthClientInformationFull;
    expect(clientInformation.client_id).toMatch(/^mcp_client_/);

    // 4. PKCE authorization request, verifier generated by the SDK.
    const { authorizationUrl, codeVerifier } = await startAuthorization(publicUrl, {
      metadata,
      clientInformation,
      redirectUrl: 'http://127.0.0.1:45678/callback',
      resource: new URL(resourceUrl),
      state: 'interop-state',
    });

    // 5. The human: load the form, then submit it with a valid Coolify token.
    const formPage = await fetch(authorizationUrl);
    expect(formPage.status).toBe(200);
    expect(await formPage.text()).toContain('Interop Test Client');

    const form = new URLSearchParams(authorizationUrl.searchParams);
    form.set('coolify_token', 'users-own-coolify-token');
    const redirect = await fetch(`${publicUrl}/authorize`, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      redirect: 'manual',
    });
    expect(redirect.status).toBe(302);
    const callback = new URL(redirect.headers.get('location')!);
    expect(callback.searchParams.get('state')).toBe('interop-state');
    const code = callback.searchParams.get('code')!;
    const iss = callback.searchParams.get('iss') ?? undefined;

    // 6. Code exchange — the SDK validates the RFC 9207 iss echo itself.
    const tokens = await exchangeAuthorization(publicUrl, {
      metadata,
      clientInformation,
      authorizationCode: code,
      iss,
      codeVerifier,
      redirectUri: 'http://127.0.0.1:45678/callback',
      resource: new URL(resourceUrl),
    });
    expect(tokens.access_token).toMatch(/^mcp_at_/);

    // 7. Real MCP session over the network with the issued token.
    const client = new Client({ name: 'interop-test', version: '0.0.0' });
    const transport = new StreamableHTTPClientTransport(new URL(resourceUrl), {
      authProvider: { token: async () => tokens.access_token },
    });
    await client.connect(transport);
    try {
      const tools = await client.listTools();
      const names = tools.tools.map((tool) => tool.name);
      expect(names).toContain('get_infrastructure_overview');
      expect(names).toContain('stop_all_apps');
      expect(names.length).toBeGreaterThanOrEqual(44);

      const version = await client.callTool({ name: 'get_mcp_version', arguments: {} });
      expect(JSON.stringify(version.content)).toContain('coolify-mcp');
    } finally {
      await client.close();
    }

    // 8. Refresh rotation through the SDK, and the old token really dies.
    const refreshed = await refreshAuthorization(publicUrl, {
      metadata,
      clientInformation,
      refreshToken: tokens.refresh_token!,
      resource: new URL(resourceUrl),
    });
    expect(refreshed.access_token).not.toBe(tokens.access_token);
    await expect(
      refreshAuthorization(publicUrl, {
        metadata,
        clientInformation,
        refreshToken: tokens.refresh_token!,
        resource: new URL(resourceUrl),
      }),
    ).rejects.toThrow();
  }, 30_000);

  it('answers an unauthenticated POST /mcp with a transport-level 401 on the wire (#340)', async (): Promise<void> => {
    const response = await fetch(resourceUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json, text/event-stream',
      },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(response.status).toBe(401);
    const challenge = response.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^Bearer /);
    expect(challenge).toContain(
      `resource_metadata="${publicUrl}/.well-known/oauth-protected-resource"`,
    );
    expect(await response.text()).not.toContain('"jsonrpc"');

    // ...and the metadata it points at answers, with the resource the client typed.
    const prm = await fetch(`${publicUrl}/.well-known/oauth-protected-resource`);
    expect(prm.status).toBe(200);
    expect(((await prm.json()) as { resource: string }).resource).toBe(resourceUrl);
  });
});
