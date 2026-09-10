# Coolify MCP Server

[![npm version](https://img.shields.io/npm/v/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![CI](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml)
[![Claude Desktop one-click install](https://img.shields.io/badge/Claude%20Desktop-one--click%20install-d97757)](https://github.com/StuMason/coolify-mcp/releases/latest/download/coolify-mcp.mcpb)
[![MCP Registry](https://img.shields.io/badge/MCP%20Registry-io.github.StuMason%2Fcoolify-blue)](https://registry.modelcontextprotocol.io)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Manage [Coolify](https://coolify.io/) from Claude, Cursor, or any MCP client: 45 tools for deploying, debugging, and operating your self-hosted PaaS in plain English. Destructive operations ask a human first; secrets stay masked.

📖 **[coolify-mcp.stumason.dev](https://coolify-mcp.stumason.dev)** · [Tool reference](docs/tools.md) · [Prompts and resources](docs/prompts-and-resources.md) · [Remote / HTTP mode](docs/http-mode.md) · [Fleet](docs/fleet.md) · [Doctor](docs/doctor.md) · [Safety and security](docs/security.md) · [Changelog](CHANGELOG.md)

## Install

You need a running Coolify v4 instance and an API token (Coolify → Keys & Tokens → API tokens). Pick one of three ways to run the server.

**Claude Desktop, one-click.** Download [`coolify-mcp.mcpb`](https://github.com/StuMason/coolify-mcp/releases/latest/download/coolify-mcp.mcpb) and drag it into **Settings → Extensions**. You are prompted for your Coolify URL and token. No Node install, no JSON editing.

**Locally, in any MCP client.** Claude Code:

```bash
claude mcp add coolify \
  -e COOLIFY_BASE_URL="https://your-coolify-instance.com" \
  -e COOLIFY_ACCESS_TOKEN="your-api-token" \
  -- npx @masonator/coolify-mcp@latest
```

Codex CLI is the same with `codex mcp add` and `--env`. For Cursor, Claude Desktop or anything that takes a JSON config:

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

**Remotely, as a container inside your Coolify.** Deploy the server next to the Coolify it manages and connect claude.ai, Claude Desktop or Claude Code to `https://your-domain/mcp`. Your Coolify token stays server-side; clients authenticate with OAuth 2.1. Five-minute setup in [docs/http-mode.md](docs/http-mode.md).

### Then run doctor

Whatever you configured, verify it in one command:

```bash
COOLIFY_BASE_URL="https://your-coolify-instance.com" COOLIFY_ACCESS_TOKEN="your-api-token" \
  npx @masonator/coolify-mcp doctor
```

It checks the config for the classic traps (unexpanded `${VAR}`, pasted whitespace, a doubled `/api/v1`), that Coolify is reachable and not hidden behind a Cloudflare Access login, that the token is accepted and can deploy, and that your Coolify version is in the tested range. Each failure comes with a one-line fix. Add `--json` for scripts. It never prints a secret. Every check is described in the [doctor guide](docs/doctor.md).

### Behind a proxy or Cloudflare Access

Add `--header "Key: Value"` args (repeatable) for a generic auth proxy. For Cloudflare Access, set `CF_ACCESS_CLIENT_ID` and `CF_ACCESS_CLIENT_SECRET` (an Access service token) and every request to Coolify carries them, in both local and remote mode. [Setup](docs/http-mode.md#coolify-behind-cloudflare-access).

## What it does

Every tool takes an `action`; run one with no arguments and it lists what it accepts. The [tool reference](docs/tools.md) has the full table. In short:

- **Work out what is wrong.** `diagnose_app` and `diagnose_server` take a name, domain, IP or UUID; `find_issues` scans the estate; `logs` reads any container.
- **Deploy and roll back.** `deploy` waits for a terminal status and returns the log tail on failure. Start, stop and restart anything with `control`.
- **Create and destroy.** Applications, databases (8 engines), services, projects and environments, with `environments verify_app` to prove a binding before you mutate it.
- **Handle the configuration.** Env vars, storages, scheduled tasks, backups, tags, private keys, GitHub apps, cloud tokens. Secrets come back masked unless you ask for one exact key.
- **Move across the whole estate.** `bulk_env_update`, `redeploy_project`, `stop_all_apps`, each behind a human confirmation that states the blast radius.
- **Search the Coolify docs** with `search_docs`.

Lists return `uuid`/`name`/`status` summaries, 90–99% smaller than the raw API; `get_*` tools fetch one resource in full. The whole tool list costs about 6,600 tokens of context.

## Workflows, not just tools

Three prompts ship as slash commands: `troubleshoot_application`, `explain_failed_deploy` and `estate_health`. Pick one and the model walks the workflow with the tools it already has. Two resources, `coolify://overview` and `coolify://application/{uuid}`, are reads your client can attach; both go through the same masking as every tool call, and neither offers a way to ask for plaintext. A prompt whose tools are not registered is not listed, so read-only mode never offers a dead end. [Prompts and resources](docs/prompts-and-resources.md).

## Several Coolify instances

Set `COOLIFY_INSTANCES` to a JSON array of `{ name, url, token }` alongside your default config. Every tool then takes an optional `instance`, `list_instances` reports what is configured, and every destructive confirmation names the instance it targets. Single-instance installs are byte-identical. A fleet is one trust domain; agencies with a Coolify per client should run one server per client. [Fleet guide](docs/fleet.md).

## Safe to point at production

Destructive operations stop and ask **you**, in your own client, before anything happens, on clients that support elicitation (Claude Code, VS Code Copilot). In remote mode the guard fails closed. Secrets are masked at the API boundary, log output is wrapped as untrusted data so a poisoned log line cannot issue instructions, and an eval suite red-teams both claims on every change. [Details](docs/security.md).

Works against Coolify v4.0 through v4.3. The v4.2 GET-to-POST change and the v4.2 secrets and Member-role restrictions are handled; see [compatibility](docs/tools.md#coolify-version-compatibility).

## Coolify's own MCP server, and when you want this one

Coolify ships an MCP server of its own, built into the product. Enable it in **Settings → Advanced** (and per team), point your client at `https://your-coolify/mcp`, and there is nothing to install: it runs inside the instance, so no third-party code ever holds your token. If you run one Coolify, with one team, and you mostly want to ask it questions, use that. It is the shortest path and it costs you nothing.

At the time of writing Coolify documents its server as read-only, with write operations planned. It is moving quickly, so check [the Coolify docs](https://coolify.io/docs/integrations/mcp) for where it has got to. There is also an [official CLI](https://github.com/coollabsio/coolify-cli) if you would rather script than converse.

This server is for the jobs those two do not cover yet.

|                           | Coolify's built-in `/mcp`     | Official CLI          | This server                                                                                                                    |
| ------------------------- | ----------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Where it runs             | Inside your Coolify           | Your shell            | Your machine, or a container inside your Coolify                                                                               |
| Install                   | Nothing                       | One binary            | `npx`, a one-click Claude Desktop extension, or a container                                                                    |
| Transport                 | Streamable HTTP               | Not an MCP server     | stdio and HTTP, so it also works in clients that only speak stdio                                                              |
| Coolify instances         | One                           | One context at a time | One or many; in fleet mode every tool takes an `instance`                                                                      |
| Writes                    | Documented as read-only today | Yes                   | Yes                                                                                                                            |
| Before a destructive call | Not applicable                | You typed it          | Stops and asks you in your own client, naming the blast radius, on clients that support elicitation; fails closed in HTTP mode |
| When something is broken  | Not applicable                | Shell exit codes      | `doctor` names the cause and the one-line fix                                                                                  |

A rough rule. One instance and read-only questions, with no setup: use Coolify's. Scripting and CI: use the CLI. Several instances, writes you want a human gate in front of, a client that only speaks stdio, or you want to be told _why_ it is broken: this one.

Other third-party Coolify MCP servers exist. Choose on transport, on how many instances you need to reach from one connection, and on what happens the moment before something is deleted.

## Example prompts

```text
Give me an overview of my infrastructure
Diagnose my stuartmason.co.uk app
Find any issues in my infrastructure
Deploy application {uuid} and wait for it to finish
Update the DATABASE_URL env var for application {uuid}
Restart all applications in project {uuid} on instance staging
How do I fix a 502 Bad Gateway error in Coolify?
```

## Development

```bash
git clone https://github.com/StuMason/coolify-mcp.git
cd coolify-mcp && npm install
npm run build && npm test

COOLIFY_BASE_URL="https://your-coolify.com" COOLIFY_ACCESS_TOKEN="token" node dist/index.js
```

Tool descriptions are prompts, so `evals/` measures whether a model picks the right tool and whether attacker-controlled output can make it misbehave; contract snapshots gate every PR. See [evals/README.md](evals/README.md). Contributions welcome: [CONTRIBUTING.md](CONTRIBUTING.md) and the architecture and API-gotcha notes in [CLAUDE.md](CLAUDE.md).

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
