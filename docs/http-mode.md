# HTTP mode: run coolify-mcp as a container inside Coolify

Deploy this server next to the Coolify instance it manages and connect remote
MCP clients — claude.ai, Claude Desktop, Claude Code, anything that speaks
Streamable HTTP with OAuth 2.1. Nothing runs on your laptop, and your Coolify
API token never leaves the container.

This guide is written from a real deployment on a live estate, including the
mistakes we made so you don't have to. Claude Desktop's OAuth connector flow
is verified working against it end to end.

stdio remains the default transport and is unchanged. HTTP mode is opt-in,
and it is a bigger decision than it looks: you are putting a service on the
internet that brokers control of your infrastructure. That is the same trust
model as exposing the Coolify API itself, but say it out loud before you do
it.

## Install in five minutes

Everything happens in the Coolify UI. HTTP mode is selected by one
environment variable, so there are no command overrides and no compose file
to write.

1. **+ New Resource → Public Repository**
   - Repository: `https://github.com/StuMason/coolify-mcp`
   - Branch: `v3` _(check this after creation — the branch picker sometimes
     sticks on `main`, and `main` will restart-loop; see troubleshooting)_
   - Build Pack: **Dockerfile**
   - Ports Exposes: **`8080`**
2. **Domain:** set one, **with the https scheme**: `https://mcp.example.com`.
   The scheme matters — `http://` means the proxy never gets a TLS router and
   the site 503s. Do **not** put Cloudflare Access or another login wall in
   front of it; MCP clients cannot log in through one, and the server carries
   its own auth.
3. **Environment tab**, four variables:

   | Variable               | Value                                         |
   | ---------------------- | --------------------------------------------- |
   | `MCP_TRANSPORT`        | `http`                                        |
   | `COOLIFY_BASE_URL`     | See reachability note below                   |
   | `COOLIFY_ACCESS_TOKEN` | A **fresh** token, Keys & Tokens → API tokens |
   | `MCP_PUBLIC_URL`       | The domain from step 2 (bare domain is fine)  |

4. **Storages tab:** add a **volume** mounted at **`/data`**. Without it,
   every redeploy wipes OAuth state and all your clients have to log in
   again.
5. **Health check:** path **`/healthz`**, port **`8080`**.
6. **Deploy.** The log must end with `coolify-mcp http mode on :8080` and the
   app goes `running:healthy`. If it prints `cannot start`, it lists every
   missing setting with instructions — fix them all in one pass and redeploy.

Verify from anywhere:

```bash
curl https://mcp.example.com/healthz
# {"status":"ok"}
curl https://mcp.example.com/.well-known/oauth-authorization-server
# JSON with "issuer": "https://mcp.example.com"
```

### `COOLIFY_BASE_URL` must be reachable from inside the container

The container calls the Coolify API (and the authorize page validates tokens
against it). If your Coolify dashboard sits behind Cloudflare Access or
another auth proxy, those calls hit the proxy and fail. Enable **Connect To
Predefined Network** on the resource and use the internal address:

```text
COOLIFY_BASE_URL=http://coolify:8080
```

A Coolify with no auth proxy in front can simply use its public URL.

## Or: let the assistant install it for you

Already running coolify-mcp locally over stdio? You hold the upgrade path in
your hands — the MCP can deploy its own HTTP mode. Paste this at your
assistant:

```text
Deploy the coolify-mcp HTTP container on my Coolify:
create an application from the public repo https://github.com/StuMason/coolify-mcp,
branch v3, dockerfile build pack, port 8080, domain https://mcp.MYDOMAIN.
Env vars: MCP_TRANSPORT=http, MCP_PUBLIC_URL=mcp.MYDOMAIN,
COOLIFY_BASE_URL and COOLIFY_ACCESS_TOKEN as I give them to you.
Add a persistent volume at /data, enable a health check on /healthz port
8080, deploy it, then curl /healthz and the oauth-authorization-server
metadata to prove it's up.
```

That is not hypothetical: the reference deployment this guide describes was
configured exactly that way — domain fix, health check, volume and deploys
all done through the `application`, `storages` and `deploy` tools. The same
path upgrades it later: "redeploy the coolify-mcp app" after a new release.

## Connect your clients

Add `https://mcp.example.com/mcp` as a remote MCP server. The client
discovers the OAuth endpoints itself (RFC 9728 / RFC 8414) and registers
dynamically (RFC 7591) — there is nothing to pre-configure.

- **Claude Desktop / claude.ai:** Settings → Connectors → Add custom
  connector → paste the `/mcp` URL. Your browser opens the authorize page:
  paste a Coolify API token, done. _(Verified working end to end.)_
- **Claude Code:**

  ```bash
  claude mcp add --transport http coolify-remote https://mcp.example.com/mcp
  ```

  Then `/mcp` → authenticate.

## How authentication works

- **Your Coolify API token is container configuration**
  (`COOLIFY_ACCESS_TOKEN`), exactly as in stdio mode. It stays server-side.
  No client ever receives it.
- **OAuth 2.1 authenticates the human.** The authorize page asks for _your
  own_ Coolify API token as proof that you have access to this Coolify
  instance. The container validates it against `GET /teams/current`, then
  discards it — never stored, never used to act. Before you paste anything,
  the page tells you to check the address bar; only your own server should
  ever ask for a Coolify token.
- The client ends up holding a **short-lived, revocable MCP token** bound to
  this server. Access tokens last 1 hour (refreshed silently); refresh tokens
  8 hours, so someone removed from Coolify loses MCP access within hours.
- There is **no secrets database.** The `/data` volume holds OAuth artefacts
  only: registered clients and token _hashes_.

Everyone who authorizes against a container gets that container's token
privileges. For a privilege split, run two containers: one with a read-write
token, one with `MCP_READONLY=true`.

## Destructive operations require a human

In HTTP mode the elicitation guard fails closed: destructive tools
(`stop_all_apps`, deletes, key overwrites) refuse unless the client supports
elicitation so a human can confirm in client UI. Clients without elicitation
(claude.ai and Claude Desktop today) get the read surface and routine
operations — deploys, restarts, env vars — and a clear refusal on the
dangerous ones. That refusal is the feature working, not a bug: a model
confirming with itself via a `confirm: true` parameter is not a credible
control on an internet-facing service.

## Configuration reference

| Variable                  | Default                  | Purpose                                              |
| ------------------------- | ------------------------ | ---------------------------------------------------- |
| `MCP_TRANSPORT`           | stdio                    | `http` selects HTTP mode                             |
| `COOLIFY_BASE_URL`        | required                 | The Coolify instance to manage                       |
| `COOLIFY_ACCESS_TOKEN`    | required                 | The token the container acts with                    |
| `MCP_PUBLIC_URL`          | required                 | Public https URL of this container                   |
| `MCP_PORT` (or `PORT`)    | `8080`                   | Listen port                                          |
| `MCP_READONLY`            | `false`                  | Register only read-only tools                        |
| `MCP_ACCESS_TOKEN_TTL`    | `3600`                   | Access token lifetime, seconds                       |
| `MCP_REFRESH_TOKEN_TTL`   | `28800`                  | Refresh token lifetime, seconds                      |
| `MCP_OAUTH_STATE_FILE`    | `/data/oauth-state.json` | OAuth state persistence                              |
| `MCP_ALLOW_INSECURE_HTTP` | unset                    | Local development only: allow a non-https public URL |

## Troubleshooting — every one of these happened to us

**Container restart-loops, log shows nothing useful.** You are deploying the
`main` branch. `main` has no HTTP mode: the container starts the stdio
server, waits on stdin forever, fails the health check, and Coolify restarts
it. Set the branch to `v3` and redeploy.

**`https://` 503s, `http://` 404s.** The domain was saved with the `http://`
scheme, so the proxy created no TLS router. Change the Domains field to
`https://…` and redeploy — labels only regenerate on deploy.

**Status stuck on `unknown`.** The health check isn't enabled, or points at
`/`. Set path `/healthz`, port `8080`.

**Log says `cannot start` with a list.** Exactly what it says: every missing
or malformed variable, with instructions. Fix the lot, redeploy once.

**Authorize page rejects a token you know is good.** The _container_ can't
reach Coolify — see the `COOLIFY_BASE_URL` reachability note. The token is
validated by the container, not by your browser.

**Clients ask to log in again after every deploy.** The `/data` volume is
missing, so OAuth state dies with the container. Add it under Storages.

## Security posture, in one place

- PKCE (S256) required on every authorization; `plain` is rejected.
- Tokens are audience-bound to this server (RFC 8707) and opaque; the state
  file stores SHA-256 hashes, never tokens. RFC 9207 `iss` on every redirect.
- Refresh tokens rotate on every use; a replayed refresh token revokes the
  whole grant chain (OAuth 2.1 reuse detection).
- Rate limiting on `/token`, `/register` and the authorization form; 5MB
  request-body cap; receive timeouts.
- Every tool call is audit-logged to stdout as JSON: client id, tool, time —
  visible straight in Coolify's log view.
- Secrets masking is identical to stdio mode; `reveal: true` is no easier to
  reach remotely than locally, and destructive operations are harder.
- Refuses to boot with a plain-http public URL unless
  `MCP_ALLOW_INSECURE_HTTP=true` is set explicitly.
- Interop is proven in CI: the test suite drives the official MCP client
  SDK's auth machinery through discovery, registration, PKCE, exchange and
  refresh against this server on every run.
