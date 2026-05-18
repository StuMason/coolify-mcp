# Roadmap

The high-level shape of where coolify-mcp is going. Concrete RFCs and design docs live underneath this page.

## Where we are (v2.x)

coolify-mcp v2.11.0 is firmly in MCP's "tools-only" era. 42 consolidated tools cover most of the Coolify API surface. Token usage is ~6.6k (down 85% from v1's ~43k). The codebase is well-tested, well-documented, and the contributor cadence is healthy.

Recent landings:

- v2.11.0 — `system` tool consolidation + 4 new tool families (storages, scheduled_tasks, hetzner, system)
- v2.10.0 — application build-config + health*check fields wired through `create*\*`
- v2.9.0 — env_vars masking by default, defensive non-JSON parsing
- v2.8.x — `--header` flag, application params, env_vars field rename

## Where v3 is heading

The MCP spec has grown a lot since v2.0's tool-consolidation milestone. The headline additions:

- **Resources** — server-exposed data the client subscribes to
- **Prompts** — pre-built workflows users invoke as slash commands
- **Tasks** — long-running tool calls with progress / retry / expiry
- **Tool annotations** — `readOnlyHint`, `destructiveHint`, `idempotentHint`
- **`outputSchema` + `structuredContent`** — typed responses for reliable chaining
- **Elicitation** — server asks the user mid-call for clarification
- **Streamable HTTP transport** — remote-hostable MCP servers

v3 adopts the ones that move the needle for an infrastructure-management server. See [v3 vision](/roadmap/v3-vision) for the per-primitive design and rationale.

## Tier 1 — incremental wins (v2.12 / v2.13)

Can land before the v3 architecture work, with no breaking changes:

- SDK upgrade `@modelcontextprotocol/sdk` 1.23 → 1.29
- Tool annotations on all 42 tools
- `outputSchema` on every `list_*` and `get_*` tool
- Human `title` field on every tool

## Tier 2 — v3.0.0

Architecture additions, will be a major release:

- **Resources** — `coolify://servers/*`, `coolify://applications/*`, `coolify://deployments/*` as subscribe-able resources
- **Tasks** — for `deploy`, `redeploy_project`, `bulk_env_update`, `restart_project_apps`, `stop_all_apps`
- **Prompts** — `/diagnose-app`, `/audit-security`, `/cleanup-stale-previews`, `/setup-environment-clone`
- **Progress notifications** on long-running tools that don't fit the Tasks shape

## Tier 3 — v3.x ecosystem play

- **Streamable HTTP transport** alongside stdio
- **Webhook → notification bridge** — Coolify webhook events become MCP notifications
- **OAuth** — replace static token env-var with proper OAuth flows when Coolify ships it
- **Elicitation** on ambiguous operations

## Discussion

This is a living document. If you have thoughts on the v3 shape, please [open an issue](https://github.com/StuMason/coolify-mcp/issues) — the goal is to bake decisions in the open before any code lands.
