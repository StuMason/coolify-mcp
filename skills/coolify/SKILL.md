---
name: coolify
description: Operate a Coolify self-hosted PaaS through the @masonator/coolify-mcp server. Use this skill whenever the user asks Claude to inspect, deploy, restart, debug, or manage anything on Coolify — including applications, databases, services, servers, projects, environments, deployments, environment variables, private keys, GitHub apps, teams, or cloud provider tokens. Trigger even when the user does not say the word "Coolify" but clearly refers to their self-hosted infra (e.g. "redeploy my-api", "why is my postgres down", "restart the staging app", "what's running on my Hetzner box"). Prefer this skill over generic shell or HTTP tools whenever Coolify MCP tools are available.
---

# Coolify MCP Skill

This skill teaches Claude how to use the Coolify MCP server (`@masonator/coolify-mcp`) effectively. The server exposes ~38 token-optimized tools that wrap the Coolify API for managing self-hosted apps, databases, services, and infrastructure.

## When to use this skill

Use it for any user request that touches a Coolify-managed resource, even when the user phrases the request in product terms ("redeploy the API", "restart postgres", "check why staging is unhealthy") rather than naming Coolify explicitly. If a Coolify MCP tool exists for the job, prefer it over `curl`, the Coolify HTTP API directly, SSH, or generic shell access — the MCP tools return summarized, token-cheap responses and include `_actions` hints for the natural next step.

If the Coolify MCP server is not configured in the current session, tell the user how to install it (see "Setup" below) instead of guessing.

## Mental model

Coolify resources form a hierarchy: **Server → Project → Environment → (Application | Database | Service)**. Most "smart lookup" tools accept either a UUID _or_ a human-friendly identifier (name, domain, IP), so you usually don't need to look up UUIDs first. Start broad (`get_infrastructure_overview`, `find_issues`) and narrow down with `diagnose_app` / `diagnose_server` before taking action.

The API splits "list" (cheap, summarized) from "get" (full detail). Always start with a list/overview call and only fetch full details for the specific resource you care about — this keeps responses small and fast.

## Core workflow

1. **Orient.** If you don't already know the relevant resource, call `get_infrastructure_overview` (one call returns a summary of everything) or `find_issues` (scans for unhealthy resources). For a known target, jump straight to `diagnose_app` or `diagnose_server`.
2. **Diagnose before acting.** For application problems, `diagnose_app <name|domain|uuid>` returns status, recent logs, env vars, and deployment history in one shot. Read it before restarting or redeploying — the cause is often visible there.
3. **Act.** Use `control` to start/stop/restart, `deploy` to trigger a build, `application` / `database` / `service` for CRUD, and `env_vars` for environment variables.
4. **Verify.** After a deploy or restart, call `deployment` for status, then `application_logs` (or `diagnose_app` again) to confirm the resource came back healthy.
5. **Report back.** Summarize what you changed, link the resource by name, and surface anything from `_actions` that the user might want to do next.

## Tool reference

Tool names below are the MCP tool identifiers exposed by `@masonator/coolify-mcp`. Many are dispatchers that take an `action` argument (e.g. `application` with `action: "create_github"`).

### Infrastructure & diagnostics

- `get_version` — Coolify API version.
- `get_mcp_version` — Installed MCP server version.
- `get_infrastructure_overview` — One-shot summary of every resource. **Start here** when you don't know what's there.
- `find_issues` — Infra-wide scan for unhealthy resources. Use when the user says something vague like "what's broken".
- `diagnose_app` — Status + recent logs + env vars + deployment history for one app. Accepts UUID, name, or domain.
- `diagnose_server` — Health, resources, domains, validation for one server. Accepts UUID, name, or IP.

### Servers

`list_servers`, `get_server`, `server_resources`, `server_domains`, `validate_server`.

### Projects & environments

`projects` (list/get/create/update/delete), `environments` (list/get/create/delete).

### Applications

- `list_applications`, `get_application`
- `application` — dispatcher: `create_public`, `create_github`, `create_key`, `create_dockerimage`, `update`, `delete`
- `application_logs` — fetch app stdout/stderr
- `env_vars` — requires `resource: "application" | "service"`. For `application`: list/create/update/delete. For `service`: list/create/delete (no `update` — service env update is not supported).
- `control` — start / stop / restart

### Databases

- `list_databases`, `get_database`
- `database` — create/delete. Supported engines: PostgreSQL, MySQL, MariaDB, MongoDB, Redis, KeyDB, ClickHouse, Dragonfly.
- `database_backups` — schedule + execution tracking
- `control` — start / stop / restart

### Services

`list_services`, `get_service`, `service` (create/update/delete), `env_vars` (with `resource: "service"` — list/create/delete only), `control`.

### Deployments

- `list_deployments` — currently running deployments
- `deploy` — trigger a deploy by tag or UUID
- `deployment` — status, cancel, list-by-app, paginated logs

### Access & integrations

- `private_keys` — SSH key CRUD
- `github_apps` — GitHub integration CRUD
- `teams` — list / get / get_members / get_current / get_current_members
- `cloud_tokens` — Hetzner / DigitalOcean credential CRUD + `validate`

### Docs

- `search_docs` — full-text search across Coolify documentation. Use this before guessing about Coolify behavior.

## Output and reporting conventions

Coolify MCP responses include an `_actions` field suggesting the natural next operations and pagination metadata. When you finish a task, mention any `_actions` that look relevant so the user can decide whether to keep going. Reference resources by their human-readable name (and short UUID prefix in parentheses) rather than dumping full UUIDs — it's easier for the user to scan.

Keep responses focused on what changed, the current state, and any issues. Don't paste raw JSON unless the user asks for it.

## Examples

### Example 1 — "my-api is throwing 500s"

1. `diagnose_app` with `query: "my-api"` → read status, last deployment, tail of logs, env vars.
2. If a recent deploy failed: `deployment` (action `get`) with the failed deployment id and `lines` (optionally `page`) — logs are excluded by default unless `lines` is set.
3. If env var or config is wrong: fix with `env_vars` (`resource: "application"`, action `update`) then `deploy` to redeploy.
4. After redeploy: `deployment` with the new deployment id and `lines` to watch status/log output, then confirm with `diagnose_app` again.

### Example 2 — "what's broken across my infra"

1. `find_issues` → returns unhealthy resources across all servers.
2. For each, call `diagnose_app` or `diagnose_server` to get specifics.
3. Summarize a prioritized list for the user before touching anything.

### Example 3 — "spin up a new postgres for the staging project"

1. `projects` (action `list`) → find the staging project and record its `project_uuid` and associated `server_uuid`.
2. `environments` (action `list`) → confirm the target environment name (for example, `staging`).
3. `database` (action `create`, type `postgresql`, `server_uuid: "<server_uuid>"`, `project_uuid: "<project_uuid>"`, `environment_name: "staging"`) → create the database in that project/environment.
4. `control` (action `start`) if it doesn't auto-start, then `get_database` to return connection details to the user.

## Setup (only if the MCP server isn't already configured)

Claude Code:

```bash
claude mcp add coolify \
  -e COOLIFY_BASE_URL="https://your-coolify-instance.com" \
  -e COOLIFY_ACCESS_TOKEN="your-api-token" \
  -- npx @masonator/coolify-mcp@latest
```

Claude Desktop (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "coolify": {
      "command": "npx",
      "args": ["-y", "@masonator/coolify-mcp"],
      "env": {
        "COOLIFY_ACCESS_TOKEN": "your-api-token",
        "COOLIFY_BASE_URL": "https://your-coolify-instance.com"
      }
    }
  }
}
```

`COOLIFY_ACCESS_TOKEN` is required; `COOLIFY_BASE_URL` defaults to `http://localhost:3000`.

## Safety notes

Destructive actions — `delete` on applications/databases/services/projects/environments, `control` stop on production resources, deleting private keys or cloud tokens — should be confirmed with the user before execution. When in doubt, describe what you're about to do and wait for a go-ahead. For routine reads, diagnostics, restarts of obviously broken resources, and redeploys of the user's own app on request, just do the work.
