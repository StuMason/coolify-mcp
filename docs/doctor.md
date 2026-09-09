# Doctor

Most reports of "the MCP is broken" were the environment, not the server: a
`${VAR}` placeholder the client never expanded, a token pasted with a leading
space, a doubled `/api/v1`, or Cloudflare Access silently answering every
request with a login page. `doctor` checks for all of those in one command and
prints a fix line for each failure.

```bash
COOLIFY_BASE_URL="https://your-coolify-instance.com" COOLIFY_ACCESS_TOKEN="your-api-token" \
  npx @masonator/coolify-mcp doctor
```

Run it whatever client you configured. It reads the same variables the server
does (`COOLIFY_BASE_URL`, `COOLIFY_ACCESS_TOKEN`, the `CF_ACCESS_*` pair) and
honours the same `--header "Key: Value"` flags, so what it verifies is what
the server will actually do.

## What it checks

| Check          | What passes                                                                  | What it catches                                                                                                  |
| -------------- | ---------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `config`       | Both variables set, well-formed                                              | Unexpanded `${VAR}`, leading whitespace or control characters in the token, `/api/v1` on the base URL            |
| `reachability` | Coolify answers, with response time                                          | DNS/TLS/connection failures; **Cloudflare Access interception**, named specifically when the wall is a 302 to it |
| `token`        | Accepted by Coolify                                                          | 401 (bad token), 403 with the Member-role body (read-only role)                                                  |
| `version`      | Coolify version inside the tested range                                      | An untested Coolify; reported as a warning, not a failure                                                        |
| `abilities`    | Token grants `read` and `deploy`                                             | A token missing `deploy` (deploy tools will 403); abilities that exceed the team role                            |
| `api-shape`    | The routing catch-all still has the shape the v4.2 method fallback relies on | An upstream change that would silently break pre-4.2 compatibility                                               |
| `runtime`      | Node 20 or later                                                             | An older Node                                                                                                    |

Every probe is side-effect free. `read` is proven by the token check; `deploy`
is probed through the ability-gated `GET /deploy` with no parameters, so no
controller can act. `write` has no safe probe (Coolify has neither token
introspection nor a write-gated GET), so doctor reports it as undetermined
rather than guessing.

Each check reports one of `pass`, `warn`, `fail`, `skipped` or `inconclusive`.
Network probes time out after 10 seconds each.

## Reading the result

- **Exit code 0**: no failures and nothing inconclusive. Warnings are
  allowed; the summary line counts them.
- **Exit code 1**: at least one failure or inconclusive check. Details, with
  fix lines, are above the summary.
- **Exit code 2**: unknown arguments. `--help` prints usage and exits 0.

`--json` prints the same report as one JSON document (`{ ok, instances: [{
instance, checks }], checks }`) for scripts and issue reports. It is safe to
paste: doctor never prints a secret, only variable names and statuses, and
error messages have credentials in URLs masked.

## Scope

Doctor checks the default instance. With `COOLIFY_INSTANCES` configured it
still reports on the default only; per-instance doctor is tracked in #368.
