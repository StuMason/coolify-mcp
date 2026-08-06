# HTTP mode: run coolify-mcp as a container inside Coolify

Deploy this server next to the Coolify instance it manages and connect remote
MCP clients (claude.ai, Claude Desktop, Claude Code) over Streamable HTTP with
OAuth 2.1. Nothing runs on your laptop, and your Coolify API token never
leaves the container.

stdio remains the default and is unchanged. HTTP mode is opt-in, and it is a
bigger decision than it looks: you are putting a service on the internet that
brokers control of your infrastructure. That is the same trust model as
exposing the Coolify API itself, but say it out loud before you do it.

## How authentication works

- **Your Coolify API token is container configuration** (`COOLIFY_ACCESS_TOKEN`),
  exactly as in stdio mode. It stays server-side. No client ever receives it.
- **OAuth 2.1 authenticates the human.** When a client connects, your browser
  opens an authorization page asking for _your own_ Coolify API token as proof
  that you have access to this Coolify instance. The container validates it
  against `GET /teams/current`, then discards it — it is never stored and
  never used to act.
- The client ends up holding a **short-lived, revocable MCP token**, bound to
  this server. Access tokens last 1 hour, refresh tokens 8 hours by default,
  so someone removed from Coolify loses MCP access within hours.
- There is **no secrets database**. The `/data` volume holds OAuth artefacts
  only: registered clients and token _hashes_.

Everyone who authorizes against a container gets that container's token
privileges. For a privilege split, run two containers: one with a read-write
token, one with `MCP_READONLY=true` (or a Member-role token, read-only from
Coolify v4.2).

## Destructive operations require a human

In HTTP mode the elicitation guard fails closed: destructive tools
(`stop_all_apps`, deletes, key overwrites) refuse unless the client supports
elicitation so a human can confirm in client UI. Clients without elicitation
support get the read surface and safe operations only. This is deliberate — a
model confirming with itself via a `confirm: true` parameter is not a
credible control on an internet-facing service.

## Deploy on Coolify

Create a new **Docker Compose** resource with:

```yaml
services:
  coolify-mcp:
    image: ghcr.io/stumason/coolify-mcp:latest
    command: dist/http.js
    environment:
      - SERVICE_FQDN_COOLIFYMCP_8080
      - COOLIFY_BASE_URL=${COOLIFY_BASE_URL:?set to your Coolify URL}
      - COOLIFY_ACCESS_TOKEN=${COOLIFY_ACCESS_TOKEN:?create under Keys & Tokens}
      - MCP_PUBLIC_URL=${SERVICE_FQDN_COOLIFYMCP}
      - MCP_READONLY=${MCP_READONLY:-false}
    volumes:
      - coolify-mcp-data:/data
    healthcheck:
      test:
        [
          'CMD',
          'node',
          '-e',
          "fetch('http://localhost:8080/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))",
        ]
      interval: 30s
      timeout: 5s
      retries: 3

volumes:
  coolify-mcp-data:
```

Coolify fills `SERVICE_FQDN_COOLIFYMCP` with the domain it assigns and
terminates TLS at its proxy. Set `COOLIFY_BASE_URL` and `COOLIFY_ACCESS_TOKEN`
in the resource's environment tab.

Then add `https://<your-domain>/mcp` to your MCP client as a remote server.
The client discovers the OAuth endpoints itself (RFC 9728 / RFC 8414) and
registers dynamically (RFC 7591); there is nothing to pre-configure.

## Configuration reference

| Variable                  | Default                  | Purpose                                              |
| ------------------------- | ------------------------ | ---------------------------------------------------- |
| `COOLIFY_BASE_URL`        | required                 | The Coolify instance to manage                       |
| `COOLIFY_ACCESS_TOKEN`    | required                 | The token the container acts with                    |
| `MCP_PUBLIC_URL`          | required                 | Public https URL of this container                   |
| `MCP_PORT` (or `PORT`)    | `8080`                   | Listen port                                          |
| `MCP_READONLY`            | `false`                  | Register only read-only tools                        |
| `MCP_ACCESS_TOKEN_TTL`    | `3600`                   | Access token lifetime, seconds                       |
| `MCP_REFRESH_TOKEN_TTL`   | `28800`                  | Refresh token lifetime, seconds                      |
| `MCP_OAUTH_STATE_FILE`    | `/data/oauth-state.json` | OAuth state persistence                              |
| `MCP_ALLOW_INSECURE_HTTP` | unset                    | Local development only: allow a non-https public URL |

## Security posture, in one place

- PKCE (S256) required on every authorization; `plain` is rejected.
- Tokens are audience-bound to this server (RFC 8707 resource indicators) and
  opaque; the state file stores SHA-256 hashes, never tokens.
- Refresh tokens rotate on every use; a replayed refresh token revokes the
  whole grant chain (OAuth 2.1 reuse detection).
- Rate limiting on `/token`, `/register` and the authorization form.
- Every tool call is audit-logged to stdout as JSON: client id, tool, time.
- Secrets masking is identical to stdio mode; `reveal: true` is no easier to
  reach remotely than locally, and destructive operations are harder.
- Refuses to boot with a plain-http public URL unless
  `MCP_ALLOW_INSECURE_HTTP=true` is set explicitly.
