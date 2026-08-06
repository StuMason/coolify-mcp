/**
 * Streamable HTTP mode (#303): web-standard request router wiring the SDK's
 * protected-resource pieces (createMcpHandler, requireBearerAuth, metadata)
 * to the OAuth 2.1 authorization server in `oauth.ts`.
 *
 * Everything here is fetch-shaped (Request in, Response out) so it runs
 * unchanged under any web-standard host; `http.ts` provides the thin Node
 * adapter. No framework, no cookies, no sessions — the authorize form is the
 * only HTML and carries its whole state in the form body.
 */

import {
  createMcpHandler,
  requireBearerAuth,
  type AuthInfo,
  type McpHttpHandler,
} from '@modelcontextprotocol/server';
import { CoolifyMcpServer } from './mcp-server.js';
import { OAuthProvider, OAuthErrorResponse } from './oauth.js';
import type { CoolifyConfig } from '../types/coolify.js';

export interface HttpServerConfig {
  coolify: CoolifyConfig;
  /** Public base URL of this container, e.g. https://mcp.example.com */
  publicUrl: string;
  accessTokenTtl: number;
  refreshTokenTtl: number;
  stateFile: string;
  readonly: boolean;
}

/**
 * Tier-2 proof of access: does this Coolify API token belong to someone with
 * access to the instance this container manages? `GET /teams/current` 401s on
 * a bad token and returns the token's team on a good one. The token is used
 * for exactly this one request and then discarded — never stored, never used
 * to act.
 */
export async function validateCoolifyToken(
  baseUrl: string,
  presentedToken: string,
): Promise<{ ok: true; teamName: string } | { ok: false }> {
  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/teams/current`, {
      headers: { Authorization: `Bearer ${presentedToken}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return { ok: false };
    const team = (await response.json()) as { name?: string };
    return { ok: true, teamName: typeof team.name === 'string' ? team.name : 'your team' };
  } catch {
    // Coolify unreachable is a "no": proof of access cannot be established.
    return { ok: false };
  }
}

/**
 * Fixed-window per-IP rate limiter for the endpoints that take guesses
 * (token, register, authorize POST). Deliberately simple: one container
 * serves one team, so the goal is blunting brute force, not fairness.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
  ) {}

  allow(key: string): boolean {
    const now = Date.now();
    const window = this.windows.get(key);
    if (!window || window.resetAt < now) {
      // Piggyback stale-entry cleanup on writes so the map cannot grow
      // unbounded across many source IPs.
      if (this.windows.size > 10_000) {
        for (const [k, w] of this.windows) {
          if (w.resetAt < now) this.windows.delete(k);
        }
      }
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    window.count += 1;
    return window.count <= this.limit;
  }
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
  });
}

function oauthError(error: OAuthErrorResponse): Response {
  return json({ error: error.code, error_description: error.description }, error.status);
}

function html(body: string, status = 200): Response {
  return new Response(body, {
    status,
    headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * The authorize page. One credential field, the rest of the OAuth request
 * carried as hidden fields. The form posts back to the same origin; there are
 * no cookies, so there is no ambient authority for CSRF to ride on.
 */
function authorizePage(params: URLSearchParams, clientName: string, error?: string): string {
  const hidden = [...params.entries()]
    .map(
      ([key, value]) =>
        `<input type="hidden" name="${escapeHtml(key)}" value="${escapeHtml(value)}">`,
    )
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Authorize ${escapeHtml(clientName)}</title>
  <style>
    body { font-family: system-ui, sans-serif; max-width: 26rem; margin: 12vh auto; padding: 0 1rem; color: #1a1a1a; }
    h1 { font-size: 1.2rem; }
    p { line-height: 1.5; color: #444; }
    label { display: block; font-weight: 600; margin: 1.2rem 0 0.3rem; }
    input[type=password] { width: 100%; padding: 0.6rem; font-size: 1rem; border: 1px solid #bbb; border-radius: 6px; box-sizing: border-box; }
    button { margin-top: 1.2rem; width: 100%; padding: 0.7rem; font-size: 1rem; border: 0; border-radius: 6px; background: #6b16ed; color: #fff; cursor: pointer; }
    .error { background: #fde8e8; border: 1px solid #f5b5b5; border-radius: 6px; padding: 0.6rem 0.8rem; color: #8a1f1f; }
    .note { font-size: 0.85rem; color: #666; }
  </style>
</head>
<body>
  <h1>Authorize ${escapeHtml(clientName)}</h1>
  <p><strong>${escapeHtml(clientName)}</strong> wants to manage your Coolify instance through this MCP server.</p>
  ${error ? `<p class="error">${escapeHtml(error)}</p>` : ''}
  <form method="post" action="authorize">
      ${hidden}
      <label for="coolify_token">Your Coolify API token</label>
      <input type="password" id="coolify_token" name="coolify_token" autocomplete="off" required>
      <p class="note">Used once to prove you have access to this Coolify instance, then discarded.
      It is never stored and never sent to the client. Create one under
      Keys &amp; Tokens &rarr; API tokens in your Coolify dashboard.</p>
      <button type="submit">Authorize</button>
  </form>
</body>
</html>`;
}

/** One JSON line per tool call: who, what, when. The defensibility feature. */
function auditToolCall(authInfo: AuthInfo | undefined, body: unknown): void {
  if (typeof body !== 'object' || body === null) return;
  const message = body as { method?: string; params?: { name?: string; arguments?: unknown } };
  if (message.method !== 'tools/call') return;
  console.error(
    JSON.stringify({
      audit: 'tools/call',
      tool: message.params?.name,
      client_id: authInfo?.clientId,
      at: new Date().toISOString(),
    }),
  );
}

export function createHttpApp(config: HttpServerConfig): {
  fetch: (request: Request) => Promise<Response>;
  provider: OAuthProvider;
} {
  const publicUrl = config.publicUrl.replace(/\/$/, '');
  const resourceUrl = `${publicUrl}/mcp`;

  const provider = new OAuthProvider({
    issuer: publicUrl,
    resource: resourceUrl,
    accessTokenTtl: config.accessTokenTtl,
    refreshTokenTtl: config.refreshTokenTtl,
    stateFile: config.stateFile,
  });

  const bearer = requireBearerAuth({
    verifier: { verifyAccessToken: (token) => provider.verifyAccessToken(token) },
    resourceMetadataUrl: `${publicUrl}/.well-known/oauth-protected-resource`,
  });

  const mcpHandler: McpHttpHandler = createMcpHandler(
    () =>
      new CoolifyMcpServer(config.coolify, {
        readonly: config.readonly,
        requireElicitation: true,
      }),
    {
      onerror: (error) => console.error('mcp handler:', error.message),
    },
  );

  // 20 guesses a minute per IP on the credential-bearing endpoints.
  const authLimiter = new RateLimiter(20, 60_000);

  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/$/, '') || '/';
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'local';

    if (path === '/healthz') {
      return json({ status: 'ok' });
    }

    if (
      path === '/.well-known/oauth-protected-resource' ||
      path === '/.well-known/oauth-protected-resource/mcp'
    ) {
      return json(provider.protectedResourceMetadata());
    }
    if (path === '/.well-known/oauth-authorization-server') {
      return json(provider.authorizationServerMetadata());
    }

    if (path === '/register' && request.method === 'POST') {
      if (!authLimiter.allow(`reg:${clientIp}`)) {
        return json({ error: 'too_many_requests' }, 429);
      }
      try {
        const metadata = (await request.json()) as Record<string, unknown>;
        return json(provider.registerClient(metadata), 201);
      } catch (error) {
        if (error instanceof OAuthErrorResponse) return oauthError(error);
        return json({ error: 'invalid_client_metadata' }, 400);
      }
    }

    if (path === '/authorize' && request.method === 'GET') {
      try {
        const validated = provider.validateAuthorizationRequest(url.searchParams);
        return html(
          authorizePage(url.searchParams, validated.client.client_name ?? 'An MCP client'),
        );
      } catch (error) {
        if (error instanceof OAuthErrorResponse) {
          // Client/redirect problems must not redirect (open-redirect guard);
          // render them instead.
          return html(
            `<p>Authorization request rejected: ${escapeHtml(error.description)}</p>`,
            400,
          );
        }
        throw error;
      }
    }

    if (path === '/authorize' && request.method === 'POST') {
      if (!authLimiter.allow(`auth:${clientIp}`)) {
        return html('<p>Too many attempts. Try again in a minute.</p>', 429);
      }
      const form = new URLSearchParams(await request.text());
      let validated;
      try {
        validated = provider.validateAuthorizationRequest(form);
      } catch (error) {
        if (error instanceof OAuthErrorResponse) {
          return html(
            `<p>Authorization request rejected: ${escapeHtml(error.description)}</p>`,
            400,
          );
        }
        throw error;
      }

      const presented = form.get('coolify_token') ?? '';
      const proof = presented
        ? await validateCoolifyToken(config.coolify.baseUrl, presented)
        : ({ ok: false } as const);
      // `presented` is not referenced past this line: used once as proof,
      // then gone. That property is the tier-2 design.
      if (!proof.ok) {
        form.delete('coolify_token');
        return html(
          authorizePage(
            form,
            validated.client.client_name ?? 'An MCP client',
            'That token was not accepted by your Coolify instance. Check it and try again.',
          ),
          401,
        );
      }

      const { redirectTo } = provider.completeAuthorization(validated);
      return new Response(null, {
        status: 302,
        headers: { location: redirectTo, 'cache-control': 'no-store' },
      });
    }

    if (path === '/token' && request.method === 'POST') {
      if (!authLimiter.allow(`token:${clientIp}`)) {
        return json({ error: 'too_many_requests' }, 429);
      }
      try {
        const body = new URLSearchParams(await request.text());
        return json(provider.exchange(body));
      } catch (error) {
        if (error instanceof OAuthErrorResponse) return oauthError(error);
        throw error;
      }
    }

    if (path === '/mcp') {
      const authResult = await bearer(request);
      if (authResult instanceof Response) return authResult;

      // The MCP handler consumes the body; clone first so the audit peek
      // cannot interfere with serving.
      let parsed: unknown;
      try {
        parsed = request.method === 'POST' ? await request.clone().json() : undefined;
      } catch {
        parsed = undefined;
      }
      auditToolCall(authResult, parsed);

      return mcpHandler.fetch(request, { authInfo: authResult });
    }

    return json({ error: 'not_found' }, 404);
  }

  return { fetch: handle, provider };
}
