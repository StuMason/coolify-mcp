#!/usr/bin/env node

/**
 * HTTP mode entry point (#303): Streamable HTTP transport + OAuth 2.1,
 * deployable as a container next to the Coolify instance it manages.
 *
 * stdio (`index.ts`) remains the default and is untouched — this is an
 * additive second transport over the same 44 tools.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHttpApp } from './lib/http-server.js';
import type { CoolifyConfig } from './types/coolify.js';

/**
 * Minimal Node → web-standard adapter. The app is fetch-shaped
 * (Request in, Response out); this is the only Node-specific code.
 */
async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const body = Buffer.concat(chunks);
  return new Request(`${base}${req.url ?? '/'}`, {
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
}

async function writeResponse(response: Response, res: ServerResponse): Promise<void> {
  res.writeHead(response.status, Object.fromEntries(response.headers.entries()));
  if (response.body) {
    // Stream rather than buffer: SSE-upgraded MCP responses stay live.
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} environment variable is required`);
  return value;
}

function main(): void {
  const coolify: CoolifyConfig = {
    baseUrl: requireEnv('COOLIFY_BASE_URL'),
    accessToken: requireEnv('COOLIFY_ACCESS_TOKEN'),
  };

  const publicUrl = requireEnv('MCP_PUBLIC_URL').replace(/\/$/, '');
  if (!publicUrl.startsWith('https://') && process.env.MCP_ALLOW_INSECURE_HTTP !== 'true') {
    // OAuth over plaintext hands bearer tokens to the network. Refuse unless
    // someone says, explicitly and greppably, that they are developing locally.
    throw new Error(
      'MCP_PUBLIC_URL must be https. For local development only, set MCP_ALLOW_INSECURE_HTTP=true',
    );
  }

  const port = Number(process.env.MCP_PORT || process.env.PORT || 8080);
  const readonly = process.env.MCP_READONLY === 'true';

  const app = createHttpApp({
    coolify,
    publicUrl,
    accessTokenTtl: Number(process.env.MCP_ACCESS_TOKEN_TTL || 3600),
    // Short by design: "removed from Coolify" should mean "loses MCP access"
    // within hours, because tier-2 re-checks proof of access at re-authorize.
    refreshTokenTtl: Number(process.env.MCP_REFRESH_TOKEN_TTL || 28_800),
    stateFile: process.env.MCP_OAUTH_STATE_FILE || '/data/oauth-state.json',
    readonly,
  });

  const server = createServer((req, res) => {
    toRequest(req, publicUrl)
      .then((request) => app.fetch(request))
      .then((response) => writeResponse(response, res))
      .catch((error: unknown) => {
        console.error('http:', error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'internal_error' }));
      });
  });

  server.listen(port, () => {
    console.error(
      `coolify-mcp http mode on :${port} (public: ${publicUrl}${readonly ? ', read-only' : ''})`,
    );
  });

  const shutdown = (): void => {
    app.provider.flush();
    server.close(() => process.exit(0));
    // Belt and braces: if a live SSE stream keeps close() waiting, leave anyway.
    setTimeout(() => process.exit(0), 3000).unref();
  };
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main();
