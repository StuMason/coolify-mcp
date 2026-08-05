# Coolify MCP Server

[![npm version](https://img.shields.io/npm/v/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![CI](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml)
[![Claude Desktop one-click install](https://img.shields.io/badge/Claude%20Desktop-one--click%20install-d97757)](https://github.com/StuMason/coolify-mcp/releases/latest/download/coolify-mcp.mcpb)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.StuMason%2Fcoolify-blue)](https://registry.modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Manage [Coolify](https://coolify.io/) from Claude, Cursor, or any MCP client: 44 consolidated tools for deploying, debugging, and operating your self-hosted PaaS in plain English.

📖 **[coolify-mcp.stumason.dev](https://coolify-mcp.stumason.dev)**: what it does, how to install it, and why it is safe to point at production.

This README is the full reference: every tool, every gotcha, every parameter.

## Install

You need a running Coolify v4 instance and an API token (Coolify → Settings → API).

**Claude Desktop, one-click:** download [`coolify-mcp.mcpb`](https://github.com/StuMason/coolify-mcp/releases/latest/download/coolify-mcp.mcpb) and drag it into **Settings → Extensions**. You'll be prompted for your Coolify URL and token. No Node install, no JSON editing.

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

Behind Cloudflare Access or an auth proxy? Add `--header "Key: Value"` args (repeatable). The same config works in Cursor, Claude Code and any other MCP client, and can be repeated for multiple Coolify instances.

## Tools

| Category             | Tools                                                                                                                                                                     |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**   | `get_infrastructure_overview`, `get_mcp_version`, `get_version`, `system` (health, list_resources, enable/disable API)                                                    |
| **Diagnostics**      | `diagnose_app`, `diagnose_server`, `find_issues`                                                                                                                          |
| **Batch Operations** | `restart_project_apps`, `bulk_env_update`, `stop_all_apps`, `redeploy_project`                                                                                            |
| **Servers**          | `list_servers`, `get_server`, `validate_server`, `server_resources`, `server_domains`                                                                                     |
| **Projects**         | `projects` (list, get, create, update, delete via action param)                                                                                                           |
| **Environments**     | `environments` (list, get, create, delete via action param)                                                                                                               |
| **Applications**     | `list_applications`, `get_application`, `application` (CRUD + delete_preview)                                                                                             |
| **Databases**        | `list_databases`, `get_database`, `database` (create 8 types, delete), `database_backups` (CRUD schedules, executions incl. delete)                                       |
| **Services**         | `list_services`, `get_service`, `service` (create, update, delete, list_containers; per-container `update_application` + `start/stop/restart_application`, Coolify v4.2+) |
| **Control**          | `control` (start/stop/restart for apps, databases, services)                                                                                                              |
| **Logs**             | `logs` (container logs for app, database, service; services need `container`), `application_logs` (superseded by `logs`)                                                  |
| **Tags**             | `tags` (list, attach, detach for apps, databases, services; tag resources then `deploy` them together; Coolify v4.2+)                                                     |
| **Env Vars**         | `env_vars` (CRUD + bulk_update for application, service, and database env vars)                                                                                           |
| **Storages**         | `storages` (list, create, update, delete persistent/file storages for apps, databases, services)                                                                          |
| **Scheduled Tasks**  | `scheduled_tasks` (list, create, update, delete, list_executions, run_once for apps and services)                                                                         |
| **Deployments**      | `list_deployments`, `deploy` (incl. wait-to-terminal-status), `deployment` (get, cancel, list_for_app)                                                                    |
| **Private Keys**     | `private_keys` (list, get, create, update, delete via action param)                                                                                                       |
| **GitHub Apps**      | `github_apps` (list, get, create, update, delete, list_repos, list_branches)                                                                                              |
| **Teams**            | `teams` (list, get, get_members, get_current, get_current_members)                                                                                                        |
| **Cloud Tokens**     | `cloud_tokens` (Hetzner/DigitalOcean: list, get, create, update, delete, validate)                                                                                        |
| **Hetzner Cloud**    | `hetzner` (list_locations, list_server_types, list_images, list_ssh_keys, create_server)                                                                                  |
| **Documentation**    | `search_docs` (full-text search across Coolify docs)                                                                                                                      |

Every tool takes an `action` parameter; run one with no arguments and it lists what it accepts.

## Design

- **Token-optimized.** Consolidated action-param tools keep the tool list at ~6,600 tokens instead of ~43,000, so the server doesn't eat your context window before you've asked anything.
- **Summaries by default.** `list_*` tools return `uuid`/`name`/`status` projections, 90–99% smaller than the raw API measured against a real 21-app estate. `get_*` tools fetch full detail for one resource.
- **Smart lookup.** `diagnose_app` takes a UUID, name, or domain; `diagnose_server` takes a UUID, name, or IP.
- **Actionable responses.** Results carry `_actions` hints (view logs, restart, next page) so the assistant knows the logical next step without extra tokens.
- **Verified deploys.** `deploy` with `wait: true` polls to a terminal status and returns a log tail on failure, instead of "the site returns 200 so it probably worked".

## Ask before it hurts

Destructive operations pause and ask **you**, not the model, on clients that support [elicitation](https://modelcontextprotocol.io/specification/2025-06-18/changelog): Claude Code and VS Code Copilot today. The prompt states the blast radius before you answer:

```text
EMERGENCY STOP: take down 12 running applications
(api, worker, cockpit, umami, scheduler, mailer, search, billing and 4 more)
across 3 servers?
```

Confirmation is asked for on `stop_all_apps`, `redeploy_project`, `restart_project_apps`, `system disable_api`, application / database / service / project / environment deletes, the credential deletes (`private_keys`, `cloud_tokens`, `github_apps`, none recoverable from Coolify once gone), and `bulk_env_update` across more than three apps. Routine deletes (storages, scheduled tasks, individual env vars, backup schedules) deliberately stay unprompted: a dialog on every delete is how dialogs stop being read. Deleting a resource spells out whether its **persistent volumes** go with it. `delete_volumes` defaults to `true` upstream, so leaving the flag unset is the destructive choice, not the cautious one.

Prompts are skipped where there is nothing to confirm: an emergency stop on an idle estate, or a redeploy of an empty project, just runs.

This is progressive enhancement, not a new requirement: clients without elicitation support (Claude Desktop, claude.ai) behave exactly as before. Once a client does advertise support, a decline, a cancel or a timeout all abort the call.

These tools also carry the MCP `destructiveHint` annotation, so on a client that honours annotations **and** supports elicitation you may answer two dialogs in a row: the client's own permission prompt, then this one. That is the client's prompt plus the server's, not a bug. Allowlisting the tool in your client removes the first and leaves this one as the gate.

Set `COOLIFY_MCP_ELICITATION=off` to turn the confirmations off entirely. It exists for the case where a client advertises elicitation support but does not actually implement it. Without it, every guarded tool would return `could not confirm with the user` with no way to recover. It is an escape hatch, not a normal setting.

> **If confirmations time out before you can answer them**, raise your client's MCP tool timeout. The prompt runs inside the tool call, and the MCP SDK's default request timeout is 60 seconds. The server aborts cleanly when the client gives up (nothing runs behind your back), but you will see the call fail rather than the dialog you were reading.

## Secure by default

Secrets are masked at the API boundary. A client granted "list" access never sees plaintext credentials unless you explicitly opt in with `reveal: true`:

- **`env_vars`**: variable values return as `***`
- **`system list_resources` (full mode)**: webhook HMAC secrets, basic-auth and database passwords, `internal/external_db_url` connection strings, compose bodies, Traefik labels, nested env vars
- **`deployment get`**: the raw upstream payload (server settings, log-drain tokens, webhook secrets) never leaves the client; responses are projected

Destructive operations also ask a human first; see [Ask before it hurts](#ask-before-it-hurts) above.

## Coolify version compatibility

Works against Coolify v4.0 through v4.2+. Two v4.2 changes are worth knowing about:

- **Secrets are hidden by default.** From v4.2 Coolify strips sensitive fields from API responses unless the token has sensitive-read scope, so `reveal: true` can return a variable with no value at all. That is the server withholding it, not a bug here; issue a token with sensitive-read scope if you need plaintext back.
- **Member-role tokens are read-only.** From v4.2 a token belonging to a Member-role user can view resources but cannot deploy, start, stop, create, update or delete. Those calls return 403. Promote the user or use a token from a role with write access.

State-changing endpoints also moved from GET to POST in v4.2. The client handles this for you across both eras, so no action is needed.

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

Contributions welcome; see [CONTRIBUTING.md](CONTRIBUTING.md) and the architecture notes in [CLAUDE.md](CLAUDE.md).

## Work with me

I'm Stu Mason. I build MCP servers, AI integrations and agentic systems for agencies, SMEs and enterprise. This repo is what that work looks like in the open.

- **An MCP server for your product.** Give Claude, Cursor and every other AI client a proper way into your API, like this one.
- **Answers from your own stuff.** AI that answers from your documents and data, with the receipts, instead of guessing. Can stay on your own servers.
- **Work that runs itself.** Jobs on a schedule that sort, check and report, with a person signing off before anything goes out.

White-label under your own name if you're an agency. And if a job doesn't need AI, I'll say so before anyone's paid for anything.

📮 [hey@stumason.dev](mailto:hey@stumason.dev) · [stumason.dev](https://stumason.dev) · [coolify-mcp.stumason.dev](https://coolify-mcp.stumason.dev/#hire)

## Links

- [Coolify](https://coolify.io/): the open-source, self-hostable PaaS this server drives
- [MCP Registry](https://registry.modelcontextprotocol.io): listed as `io.github.StuMason/coolify`
- [laravel-coolify](https://github.com/StuMason/laravel-coolify): deploy Laravel to Coolify with a dashboard, Artisan commands, and generated Dockerfiles
- [Model Context Protocol](https://modelcontextprotocol.io/)

MIT © [Stu Mason](https://stumason.dev). If this is useful, ⭐ the repo.
