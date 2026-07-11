# Coolify MCP Server

[![npm version](https://img.shields.io/npm/v/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![CI](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml)
[![Claude Desktop one-click install](https://img.shields.io/badge/Claude%20Desktop-one--click%20install-d97757)](https://github.com/StuMason/coolify-mcp/releases/latest/download/coolify-mcp.mcpb)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.StuMason%2Fcoolify-blue)](https://registry.modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Manage [Coolify](https://coolify.io/) through natural language — 42 token-optimized MCP tools for deploying, debugging, and operating your self-hosted PaaS from Claude, Cursor, or any MCP client.

📖 **Full docs: [coolify-mcp.stumason.dev](https://coolify-mcp.stumason.dev)** — install guide, tools reference, architecture, security model, v3 roadmap.

## Install

You need a running Coolify v4 instance and an API token (Coolify → Settings → API).

**Claude Desktop — one-click:** download [`coolify-mcp.mcpb`](https://github.com/StuMason/coolify-mcp/releases/latest/download/coolify-mcp.mcpb) and drag it into **Settings → Extensions**. You'll be prompted for your Coolify URL and token — no Node install, no JSON editing.

**Claude Code:**

```bash
claude mcp add coolify \
  -e COOLIFY_BASE_URL="https://your-coolify-instance.com" \
  -e COOLIFY_ACCESS_TOKEN="your-api-token" \
  -- npx @masonator/coolify-mcp@latest
```

**Any MCP client (JSON config):**

```json
{
  "mcpServers": {
    "coolify": {
      "command": "npx",
      "args": ["-y", "@masonator/coolify-mcp"],
      "env": {
        "COOLIFY_BASE_URL": "https://your-coolify-instance.com",
        "COOLIFY_ACCESS_TOKEN": "your-api-token"
      }
    }
  }
}
```

Behind Cloudflare Access or an auth proxy? Add `--header "Key: Value"` args (repeatable). Cursor, multiple Coolify instances, and proxy setups are covered in the [install guide](https://coolify-mcp.stumason.dev/guide/installation).

## Tools

| Category             | Tools                                                                                                                               |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**   | `get_infrastructure_overview`, `get_mcp_version`, `get_version`, `system` (health, list_resources, enable/disable API)              |
| **Diagnostics**      | `diagnose_app`, `diagnose_server`, `find_issues`                                                                                    |
| **Batch Operations** | `restart_project_apps`, `bulk_env_update`, `stop_all_apps`, `redeploy_project`                                                      |
| **Servers**          | `list_servers`, `get_server`, `validate_server`, `server_resources`, `server_domains`                                               |
| **Projects**         | `projects` (list, get, create, update, delete via action param)                                                                     |
| **Environments**     | `environments` (list, get, create, delete via action param)                                                                         |
| **Applications**     | `list_applications`, `get_application`, `application` (CRUD + delete_preview), `application_logs`                                   |
| **Databases**        | `list_databases`, `get_database`, `database` (create 8 types, delete), `database_backups` (CRUD schedules, executions incl. delete) |
| **Services**         | `list_services`, `get_service`, `service` (create, update, delete)                                                                  |
| **Control**          | `control` (start/stop/restart for apps, databases, services)                                                                        |
| **Env Vars**         | `env_vars` (CRUD + bulk_update for application, service, and database env vars)                                                     |
| **Storages**         | `storages` (list, create, update, delete persistent/file storages for apps, databases, services)                                    |
| **Scheduled Tasks**  | `scheduled_tasks` (list, create, update, delete, list_executions, run_once for apps and services)                                   |
| **Deployments**      | `list_deployments`, `deploy` (incl. wait-to-terminal-status), `deployment` (get, cancel, list_for_app)                              |
| **Private Keys**     | `private_keys` (list, get, create, update, delete via action param)                                                                 |
| **GitHub Apps**      | `github_apps` (list, get, create, update, delete, list_repos, list_branches)                                                        |
| **Teams**            | `teams` (list, get, get_members, get_current, get_current_members)                                                                  |
| **Cloud Tokens**     | `cloud_tokens` (Hetzner/DigitalOcean: list, get, create, update, delete, validate)                                                  |
| **Hetzner Cloud**    | `hetzner` (list_locations, list_server_types, list_images, list_ssh_keys, create_server)                                            |
| **Documentation**    | `search_docs` (full-text search across Coolify docs)                                                                                |

Full reference with parameters and examples: [tools docs](https://coolify-mcp.stumason.dev/tools/).

## Design

- **Token-optimized** — consolidated action-param tools keep the tool list at ~6,600 tokens instead of ~43,000 (85% less), so the server doesn't eat your context window before you've asked anything.
- **Summaries by default** — `list_*` tools return `uuid`/`name`/`status` projections (90–99% smaller than the raw API, measured against a real 21-app estate); `get_*` tools fetch full detail for one resource.
- **Smart lookup** — `diagnose_app` takes a UUID, name, or domain; `diagnose_server` takes a UUID, name, or IP.
- **Actionable responses** — results carry `_actions` hints (view logs, restart, next page) so the assistant knows the logical next step without extra tokens.
- **Verified deploys** — `deploy` with `wait: true` polls to a terminal status and returns a log tail on failure, instead of "the site returns 200 so it probably worked".

## Secure by default

Secrets are masked at the API boundary — a client granted "list" access never sees plaintext credentials unless you explicitly opt in with `reveal: true`:

- **`env_vars`** — variable values return as `***`
- **`system list_resources` (full mode)** — webhook HMAC secrets, basic-auth and database passwords, `internal/external_db_url` connection strings, compose bodies, Traefik labels, nested env vars
- **`deployment get`** — the raw upstream payload (server settings, log-drain tokens, webhook secrets) never leaves the client; responses are projected

Details: [security model](https://coolify-mcp.stumason.dev/concepts/security).

## Example prompts

```text
Give me an overview of my infrastructure
Diagnose my stuartmason.co.uk app
Find any issues in my infrastructure
Deploy application {uuid} and wait for it to finish
Update the DATABASE_URL env var for application {uuid}
Create a staging environment in project {uuid}
Restart all applications in project {uuid}
How do I fix a 502 Bad Gateway error in Coolify?
```

## Development

```bash
git clone https://github.com/StuMason/coolify-mcp.git
cd coolify-mcp && npm install
npm run build && npm test

COOLIFY_BASE_URL="https://your-coolify.com" COOLIFY_ACCESS_TOKEN="token" node dist/index.js
```

Contributions welcome — see [CONTRIBUTING.md](CONTRIBUTING.md) and the [contributor docs](https://coolify-mcp.stumason.dev/contributing/adding-tools).

## Links

- [Coolify](https://coolify.io/) — the open-source, self-hostable PaaS this server drives
- [MCP Registry](https://registry.modelcontextprotocol.io) — listed as `io.github.StuMason/coolify`
- [laravel-coolify](https://github.com/StuMason/laravel-coolify) — deploy Laravel to Coolify with a dashboard, Artisan commands, and generated Dockerfiles
- [Model Context Protocol](https://modelcontextprotocol.io/)

MIT © [Stu Mason](https://stumason.dev) — if this is useful, ⭐ the repo.
