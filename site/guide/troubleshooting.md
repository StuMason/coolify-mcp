# Troubleshooting

Common issues, what they look like, and how to fix them.

## The server connects but no tools appear

**Symptom**: The hammer icon in Claude Desktop (or equivalent in Cursor / VS Code) shows "0 tools" for `coolify`, or the model says it has no coolify tools available.

**Likely causes**:

- The MCP process crashed during startup. Check the client's MCP server log for an error.
- The client cached an old list. Restart the client fully.
- The wrong package name was set in the config. The correct name is `@masonator/coolify-mcp` (not `coolify-mcp`).

**Fix**:

1. Open the client's MCP log (Claude Desktop: `~/Library/Logs/Claude/mcp-server-coolify.log` on macOS).
2. Look for a Node error or a config error in the last 50 lines.
3. If you see `MODULE_NOT_FOUND` for `@masonator/coolify-mcp`, run `npx -y @masonator/coolify-mcp --help` from a terminal to force a fresh download.
4. Restart the client.

## Tools appear but every call returns an auth error

**Symptom**: Tools show up. Calling `get_version` (or any tool) returns something like:

```text
Error: Coolify API returned 401 Unauthorized
```

**Likely cause**: `COOLIFY_ACCESS_TOKEN` is missing, expired, or scoped wrong.

**Fix**:

1. Verify the token works directly:

   ```bash
   curl -H "Authorization: Bearer YOUR_TOKEN" https://your-coolify.example.com/api/v1/version
   ```

   You should get a JSON response with the version. If you get 401 here, the token is bad — regenerate it in Coolify under Settings → API Tokens.

2. Verify your MCP client config has the env var set under the right key (`env` block, not `args`).
3. Verify the token does not have leading/trailing whitespace — copy-paste from Coolify often picks up a space.
4. Restart the MCP client after changing config.

## Connection error / "ECONNREFUSED" / timeout

**Symptom**: Tool calls return something like:

```text
Error: fetch failed
Cause: connect ECONNREFUSED 1.2.3.4:443
```

**Likely causes**:

- `COOLIFY_BASE_URL` is wrong (missing `https://`, has a trailing slash, points at the dashboard URL instead of the API host)
- The Coolify instance is unreachable from the machine running the MCP client (VPN required? Firewall? Wrong IP after a Coolify move?)
- TLS cert chain issues if you're behind a corporate proxy

**Fix**:

1. From the same machine running the MCP client, run:

   ```bash
   curl -v https://your-coolify.example.com/api/v1/health
   ```

2. If `curl` fails too, it's a network issue — not an MCP issue. Fix the network path first.
3. If `curl` works but the MCP doesn't, double-check the env var matches exactly what `curl` used (including protocol, host, and lack of trailing slash).

## "Validation failed" / 422 on a create or update

**Symptom**: A `create_*` or `update` call returns:

```text
{"message":"Validation failed.","errors":{"some_field":["This field is not allowed."]}}
```

**Likely cause**: Coolify's API silently drops fields that aren't on the controller's `$allowedFields` allowlist. Worse, the allowlist is different for `create_*` vs `update`. The OpenAPI spec doesn't fully reflect this.

**Fix**: see the [Coolify API gotchas](/concepts/coolify-api-gotchas) page. The most common case: `dockerfile_target_build` is accepted on `update` but silently dropped on every `create_*`. `is_buildtime` (one word) is the correct env-var field name, not `is_build_time` (two words).

## env_vars list returns `***` for every value

**Not a bug.** Since v2.9.0, `env_vars list` masks the plaintext `value` and `real_value` of every variable to prevent leaking secrets to the LLM. If you genuinely need to see the value, pass `reveal: true` on the list call. See [Security model](/concepts/security) for the full reasoning.

## Hetzner tool returns 401 even with a valid token

**Symptom**: `hetzner` tool actions (`list_locations`, `list_server_types`, etc.) all return:

```text
{"message":"Unauthenticated."}
```

…but other tools (`get_version`, `list_servers`) work fine with the same token.

**Likely cause**: Coolify's Hetzner endpoints are scoped to a higher-privilege token than most team-level tokens. You need a token with the right scope **and** a configured Hetzner cloud-provider token UUID set up under Coolify's Cloud Providers.

**Fix**: see [Coolify API gotchas](/concepts/coolify-api-gotchas#hetzner-endpoints-exist-but-are-auth-scope-gated) for the path and scope notes.

## Deploy never finishes / hangs the client

**Symptom**: Calling `deploy` blocks the MCP transaction for minutes. The model appears to be doing nothing.

**Cause**: Not a bug in v2.x — deploys are synchronous tool calls. A deployment can take 2–10 minutes depending on the build. The MCP client is waiting for the tool to return.

**Workaround**: Use `deployment list_for_app` periodically to check status instead of waiting for the original `deploy` call. v3 will fix this properly with the [Tasks primitive](/roadmap/v3-vision#tasks-sep-1686).

## Custom HTTP header isn't reaching Coolify (Cloudflare Zero Trust, etc.)

**Symptom**: Set `--header "CF-Access-Client-Id: ..."` but Cloudflare still blocks the request.

**Likely causes**:

- Header name has a typo (case-sensitivity varies by middleware)
- You're trying to set `Authorization` or `Content-Type` — these are filtered with a warning to prevent silent token override
- The header was set on a flag the MCP client doesn't pass through to the spawned process

**Fix**: see [Installation → Custom HTTP headers](/guide/installation#custom-http-headers).

## Something else?

Search the [issue tracker](https://github.com/StuMason/coolify-mcp/issues?q=) first — chances are someone hit the same thing. If not, open a new issue with:

- The MCP client + version
- The exact tool call and arguments (redact any tokens)
- The full error text
- The output of `npx -y @masonator/coolify-mcp --version`
- The output of `curl -v https://your-coolify.example.com/api/v1/version` (with the bearer header)
