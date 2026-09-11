# Safety and security

Two controls make it reasonable to point this at production: destructive
operations ask a human first, and secrets are masked before the model sees a
response. The [HTTP mode guide](http-mode.md#security-posture) covers the
additional posture of the remote server.

## Ask before it hurts

Destructive operations pause and ask **you**, not the model, on clients that
support [elicitation](https://modelcontextprotocol.io/specification/2025-06-18/changelog):
Claude Code and VS Code Copilot today. The prompt states the blast radius
before you answer:

```text
EMERGENCY STOP: take down 12 running applications
(api, worker, dashboard, analytics, scheduler, mailer, search, billing and 4 more)
across 3 servers?
```

In [fleet mode](fleet.md) every prompt also names the instance it targets.

Confirmation is asked for on `stop_all_apps`, `redeploy_project`,
`restart_project_apps`, `system disable_api`, application / database /
service / project / environment deletes, the credential deletes
(`private_keys`, `cloud_tokens`, `github_apps`, none recoverable from Coolify
once gone), and `bulk_env_update` across more than three apps. Routine deletes
(storages, scheduled tasks, individual env vars, backup schedules) deliberately
stay unprompted: a dialog on every delete is how dialogs stop being read.
Deleting a resource spells out whether its **persistent volumes** go with it.
`delete_volumes` defaults to `true` upstream, so leaving the flag unset is the
destructive choice, not the cautious one.

Prompts are skipped where there is nothing to confirm: an emergency stop on an
idle estate, or a redeploy of an empty project, just runs.

This is progressive enhancement, not a new requirement: clients without
elicitation support (Claude Desktop, claude.ai) behave exactly as before over
stdio. Once a client does advertise support, a decline, a cancel or a timeout
all abort the call. In HTTP mode the guard fails closed instead: a client that
cannot elicit gets a refusal on the dangerous tools, because a model filling
in `confirm: true` is the model confirming with itself.

These tools also carry the MCP `destructiveHint` annotation, so on a client
that honours annotations **and** supports elicitation you may answer two
dialogs in a row: the client's own permission prompt, then this one. That is
the client's prompt plus the server's, not a bug. Allowlisting the tool in
your client removes the first and leaves this one as the gate.

Set `COOLIFY_MCP_ELICITATION=off` to turn the confirmations off entirely. It
exists for the case where a client advertises elicitation support but does not
actually implement it. Without it, every guarded tool would return
`could not confirm with the user` with no way to recover. It is an escape
hatch, not a normal setting.

> **If confirmations time out before you can answer them**, raise your
> client's MCP tool timeout. The prompt runs inside the tool call, and the MCP
> SDK's default request timeout is 60 seconds. The server aborts cleanly when
> the client gives up (nothing runs behind your back), but you will see the
> call fail rather than the dialog you were reading.

## Secure by default

The server makes requests to one host it was not configured with: in HTTP
mode, the URL a client presents as its `client_id` (a Client ID Metadata
Document). That fetch goes through the SSRF guard in `src/lib/ssrf.ts`
(public addresses only, pinned DNS, no redirects, size and time caps), is
rate-limited per IP, and reports one generic sentence on failure so the
authorize page cannot be used to probe other hosts.

Secrets are masked at the API boundary. A client granted "list" access never
sees plaintext credentials unless you explicitly opt in with `reveal: true`:

- **`env_vars`**: variable values return as `***`. `reveal: true` is accepted
  only with an exact `key`; the tool then returns only that matching row.
  Bulk plaintext reads of every variable are rejected. Coolify exposes env
  vars through a collection endpoint, not a per-variable GET or a `reveal`
  query flag, so the token must have `read:sensitive` access (and the required
  owner/admin role on newer versions). If the API omits both value fields, the
  tool returns a capability error instead of claiming the value was revealed.
- **`system list_resources` (full mode)**: webhook HMAC secrets, basic-auth
  and database passwords, `internal/external_db_url` connection strings,
  compose bodies, Traefik labels, nested env vars.
- **`get_database` / `get_service`**: the same credential fields are masked on
  the detail endpoints, and any embedded server row is projected down to
  uuid/name/ip so its sentinel token and log-drain config never leave the
  client.
- **`get_server`**: sentinel and log-drain credentials are always masked, with
  no reveal.
- **`private_keys`**: key material is never returned, with no reveal; name,
  fingerprint and public key identify a key.
- **`deployment get`**: the raw upstream payload (server settings, log-drain
  tokens, webhook secrets) never leaves the client; responses are projected.

Log output (`logs`, `application_logs`, deployment logs) is wrapped in a
tamper-evident untrusted-data boundary with a per-call nonce, so a poisoned
log line reads as data, not instructions. The evals red-team suite regresses
this: see [evals/README.md](../evals/README.md).

## Rotating the token without a restart

`COOLIFY_ACCESS_TOKEN` is read once when the process starts. A stdio server is
spawned once per client session, and a subprocess never sees a later change to
its parent's environment, so rotating that variable does not reach a server that
is already running: the new token only takes effect when the whole client
session restarts.

That matters more than it sounds, because rotation is the remediation step for a
leaked token. The moment you most need a new token to take effect is the moment
the old design made you restart everything.

Point `COOLIFY_ACCESS_TOKEN_FILE` at a file instead:

```bash
COOLIFY_BASE_URL="https://coolify.example.com" \
COOLIFY_ACCESS_TOKEN_FILE="$HOME/.coolify/token" \
npx @masonator/coolify-mcp
```

The file is read at startup and re-read whenever its modification time changes,
so writing a new token into it takes effect on the next tool call with nothing
to restart. It is the same shape as a Kubernetes or Docker secret mount. When
both variables are set the file wins.

Two details worth knowing:

- **A trailing newline is stripped.** `echo token > file` appends one, and a
  bearer header carrying a newline is rejected as malformed rather than as a bad
  token, which sends people hunting a permissions problem they do not have.
- **A `401` triggers exactly one retry**, and only when re-reading the file
  actually produced a different token. A rotation that lands mid-call recovers
  instead of surfacing an error; a genuinely invalid token still fails on the
  first call rather than doubling every failure.

`doctor` reports which source the token came from, and for a file its path and
how long ago it changed. It never prints the value.

## Startup and doctor never print a secret

The startup self-check and [`doctor`](doctor.md) report variable names and
statuses, never values. Error messages that embed a URL have any
`user:pass@` credentials masked. Instance names, not tokens, appear in every
fleet error.

## Reporting a vulnerability

Open a [private security advisory](https://github.com/StuMason/coolify-mcp/security/advisories/new)
on GitHub rather than a public issue.
