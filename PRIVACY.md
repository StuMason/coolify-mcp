# Privacy Policy

**Last updated:** 11 September 2026

`@masonator/coolify-mcp` is a Model Context Protocol server that you run
yourself, either as a local process started by your MCP client or as an HTTP
service on your own infrastructure. There is no hosted service behind it and no
account to create.

This policy describes what the software does with data. It is written against
the code, and the "Where the code does this" notes point at the file that
implements each claim.

## What is collected about you

Nothing.

The server contains no telemetry, analytics, crash reporting, usage counting or
phone-home of any kind. The author receives no data from your installation,
including the fact that you installed it.

## Your Coolify API token

Your token is read from the `COOLIFY_ACCESS_TOKEN` environment variable, or from
a file named by `COOLIFY_ACCESS_TOKEN_FILE`. It is sent as an `Authorization:
Bearer` header to the Coolify instance you configured in `COOLIFY_BASE_URL`, and
to nothing else.

The token is never written to logs, never included in tool results, and never
sent to any host other than your own Coolify instance. Diagnostics report where
the token came from and, for a file, its path and age, but never its value.

If you set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` for a Coolify
instance behind Cloudflare Access, those ride the same requests and are subject
to the same rule: your Coolify instance and nowhere else.

### The token you type into the authorisation page

HTTP mode has one more case, and it is the only moment a person hands this
software a credential through a browser. On the authorisation page you paste
your own Coolify API token to prove you have access to the instance. The server
sends it to your Coolify instance once, to read the current team, and keeps only
the team name so the page can show you which estate you are approving.

That token is held for the length of that single request and then discarded. It
is never stored, never written to the audit log, and never used to act on your
behalf.

Where the code does this: `src/lib/coolify-client.ts`, `src/lib/token-source.ts`,
`src/lib/doctor.ts`, `src/lib/http-server.ts`.

## Outbound network connections

The server makes two kinds of outbound connection in local mode, and one more in
HTTP mode.

1. **Your Coolify instance.** Every tool call goes to the `COOLIFY_BASE_URL` you
   set. This is the entire point of the software.
2. **A documentation index refresh.** The `search_docs` tool ships with a
   bundled copy of the Coolify documentation index. The first time you use that
   tool, and only then, it checks `https://coolify.io/docs/llms.txt` once in the
   background for a newer copy. If you never call `search_docs`, this request
   never happens. Only an `If-None-Match`
   cache validator travels with that request. No credentials, no identifiers and
   no information about you or your estate are attached, and Cloudflare Access
   headers are deliberately excluded so they cannot leak off your estate. If the
   request fails, is blocked, or you are offline, the bundled index serves and
   nothing is reported.
3. **A client's metadata document, in HTTP mode only.** When a client
   authenticates with a `client_id` that is an https URL, the server fetches
   that URL to read the client's own metadata, and re-fetches it hourly while
   the client stays in use. Only a GET travels. No credentials are attached,
   redirects are not followed, the response is size-capped and time-bounded, and
   it goes through an SSRF guard. The document is held in memory and never
   written to disk. Be aware that the host serving it learns your server's IP
   address and roughly when someone authorised.

There are no other outbound connections. No third-party APIs, no CDNs at
runtime, no update checks and no analytics endpoints.

The documentation refresh has no off switch of its own. It fails soft, so
blocking it at the firewall costs you nothing but freshness.

Where the code does this: `src/lib/docs-search.ts`, `src/lib/oauth.ts`,
`src/lib/ssrf.ts`.

## Data that reaches your MCP client

Tool results are returned to whichever MCP client you connected, such as Claude
Desktop or Claude Code. Those results contain whatever you asked for, which may
include application names, domains, deployment logs and environment variable
keys from your own Coolify estate.

What that client then does with the data is governed by that client's own
privacy policy, not this one. If you would rather a category of data never
reached the model, do not call the tool that returns it. Read-only mode
(`MCP_READONLY`) and the destructive-action confirmations limit what the server
will do, not what it will show.

## Logs and the audit trail

The optional audit log writes one JSON line per tool call to standard error, on
the machine running the server. Each line records a timestamp, the tool name,
the action, resource identifiers drawn from a closed allowlist of uuid fields,
the outcome and why a refusal happened, how long the call took, the target
instance in fleet mode, and the OAuth client id in HTTP mode.

It records no other argument values, so secrets passed as arguments do not
appear, and it never records tokens.

In HTTP mode the caller's IP address is read from the forwarded-for header to
rate limit authorisation attempts. It is held in an in-memory window and is
never logged, never persisted and never transmitted.

Audit output is written to your own process's stderr. It is not transmitted
anywhere. Where it ends up is decided by whatever supervises the process, which
is your MCP client for a local server and your own logging setup for an HTTP
deployment.

Where the code does this: `src/lib/audit.ts`.

## Stored data

In HTTP mode the OAuth authorisation server keeps issued client registrations in
a state file on your own disk, written with `0600` permissions through a
temporary file and a rename. It goes to the path you set with
`MCP_OAUTH_STATE_FILE`, or to `/data/oauth-state.json` if you set nothing.

The file holds SHA-256 hashes, not the credentials themselves: authorisation
codes, access tokens and client secrets are all stored hashed. Nothing in that
file is a Coolify credential, so a copy of it does not grant access to your
estate.

In local stdio mode there is no authorisation server and nothing is written to
disk at all. The documentation index ships inside the package, and a refresh
replaces it in memory only, so a refreshed index is not cached anywhere and does
not survive a restart.

## Retention and deletion

The author holds no data about you, so there is nothing to retain and nothing to
delete. Everything the software writes lives on your machine and is removed when
you delete the files or uninstall the package.

## Third parties

None. Your data is not shared with, sold to, or processed by anyone.

## Children

This is developer tooling and is not directed at children.

## Changes

Material changes to this policy are recorded in
[CHANGELOG.md](CHANGELOG.md) alongside the release that makes them.

## Contact

Open an issue at
<https://github.com/StuMason/coolify-mcp/issues>, or email
<hey@stumason.dev>.
