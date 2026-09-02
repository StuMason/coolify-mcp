#!/usr/bin/env node

/**
 * HTTP mode entry point (#303): Streamable HTTP transport + OAuth 2.1,
 * deployable as a container next to the Coolify instance it manages.
 *
 * stdio (`index.ts`) remains the default and is untouched — this is an
 * additive second transport over the same 45 tools.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { createHttpApp, normalizePublicUrl } from './lib/http-server.js';
import type { CoolifyConfig } from './types/coolify.js';

/**
 * Cap on buffered request bodies. The largest legitimate request this server
 * sees is a tools/call with a compose file in it — comfortably under 1MB —
 * so 5MB is generous headroom while keeping "stream garbage forever" from
 * being a free memory exhaustion.
 */
const MAX_BODY_BYTES = 5 * 1024 * 1024;

class BodyTooLarge extends Error {}

/**
 * Minimal Node → web-standard adapter. The app is fetch-shaped
 * (Request in, Response out); this is the only Node-specific code.
 */
async function toRequest(req: IncomingMessage, base: string): Promise<Request> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    total += (chunk as Buffer).length;
    if (total > MAX_BODY_BYTES) throw new BodyTooLarge();
    chunks.push(chunk as Buffer);
  }
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

function main(): void {
  // Collect every configuration problem before failing, so the person staring
  // at Coolify's deploy log fixes the lot in one pass instead of one per boot.
  const problems: string[] = [];
  const baseUrl = process.env.COOLIFY_BASE_URL || '';
  const accessToken = process.env.COOLIFY_ACCESS_TOKEN || '';
  const rawPublicUrl = process.env.MCP_PUBLIC_URL || '';

  if (!baseUrl) {
    problems.push(
      'COOLIFY_BASE_URL is not set. Set it to your Coolify URL, e.g. https://coolify.example.com',
    );
  }
  if (!accessToken) {
    problems.push(
      'COOLIFY_ACCESS_TOKEN is not set. Create one in Coolify under Keys & Tokens → API tokens',
    );
  }

  let publicUrl = '';
  if (!rawPublicUrl) {
    problems.push(
      'MCP_PUBLIC_URL is not set. Set it to the public URL of this container, e.g. https://mcp.example.com (on Coolify, ${SERVICE_FQDN_COOLIFYMCP} provides it)',
    );
  } else {
    try {
      publicUrl = normalizePublicUrl(rawPublicUrl);
      if (publicUrl.startsWith('http://') && process.env.MCP_ALLOW_INSECURE_HTTP !== 'true') {
        // OAuth over plaintext hands bearer tokens to the network. Refuse
        // unless someone says, explicitly and greppably, that they are
        // developing locally.
        problems.push(
          `MCP_PUBLIC_URL is ${publicUrl} — it must be https. For local development only, set MCP_ALLOW_INSECURE_HTTP=true`,
        );
      }
    } catch {
      problems.push(`MCP_PUBLIC_URL is not a usable URL: "${rawPublicUrl}"`);
    }
  }

  if (problems.length > 0) {
    console.error('coolify-mcp http mode cannot start:');
    for (const problem of problems) console.error(`  - ${problem}`);
    process.exit(1);
  }

  const coolify: CoolifyConfig = { baseUrl, accessToken };
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
        if (error instanceof BodyTooLarge) {
          res.writeHead(413, { 'content-type': 'application/json' });
          res.end(JSON.stringify({ error: 'payload_too_large' }));
          req.destroy();
          return;
        }
        console.error('http:', error instanceof Error ? error.message : String(error));
        if (!res.headersSent) {
          res.writeHead(500, { 'content-type': 'application/json' });
        }
        res.end(JSON.stringify({ error: 'internal_error' }));
      });
  });

  // Receive-side timeouts. These bound reading the request (headers + body),
  // not writing the response, so long-lived SSE streams are unaffected.
  server.headersTimeout = 15_000;
  server.requestTimeout = 30_000;

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
