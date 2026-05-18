---
layout: home

hero:
  name: coolify-mcp
  text: A Coolify control surface for your AI assistant
  tagline: 42 token-optimized MCP tools. Use it with Claude, Cursor, or any MCP client to manage your self-hosted infrastructure through natural language.
  image:
    src: /favicon.svg
    alt: coolify-mcp
  actions:
    - theme: brand
      text: Get started →
      link: /guide/installation
    - theme: alt
      text: Quickstart
      link: /guide/quickstart
    - theme: alt
      text: GitHub
      link: https://github.com/StuMason/coolify-mcp

features:
  - icon: ⚡
    title: Ready-to-use MCP server
    details: Set one environment variable and start. Works in Claude Desktop, Claude Code, Cursor, and any other MCP-aware client.
  - icon: 🎯
    title: 42 consolidated tools
    details: v2.0 collapsed 60+ tools into a small set of action-driven tools. The count is at 42 today after new tool families landed in v2.11. LLM tool-list tokens dropped ~85% (43k → 6.6k).
  - icon: 🔒
    title: Secure by default
    details: env_vars list responses mask secrets. Opt-in reveal. Bulk-update doesn't echo values back. Token never leaves your machine.
  - icon: 🩺
    title: Smart diagnostics
    details: Tools like diagnose_app and find_issues combine multiple endpoints into one call. The LLM can answer "why is this broken?" without making 5 separate tool calls.
  - icon: 🚀
    title: Tested against a live server
    details: Every release is verified against a production Coolify. Known quirks in the Coolify API are documented in the repo so contributors do not need to rediscover them.
  - icon: 🛣️
    title: Public v3 roadmap
    details: Resources, Tasks, Prompts, and a streamable HTTP transport. The next major version reframes coolify-mcp as a live, subscribable surface. RFCs are published here first.
---

<div style="max-width: 960px; margin: 4rem auto 0; padding: 0 1.5rem;">

## Install in 60 seconds

For Claude Desktop, Claude Code, Cursor, or any MCP-aware client, add this to your MCP config:

```json
{
  "mcpServers": {
    "coolify": {
      "command": "npx",
      "args": ["-y", "@masonator/coolify-mcp"],
      "env": {
        "COOLIFY_BASE_URL": "https://your-coolify.example.com",
        "COOLIFY_ACCESS_TOKEN": "your-api-token"
      }
    }
  }
}
```

Restart the client. Ask your assistant: _"What's the Coolify version?"_ It should reply with your instance's version string.

See [Installation](/guide/installation) for per-client details, [Quickstart](/guide/quickstart) for things to try.

## What you can do with it

```mermaid
mindmap
  root((coolify-mcp))
    Infrastructure
      Servers
      Projects
      Environments
      Hetzner provisioning
    Applications
      Public / GitHub / Key / DockerImage
      Build config + healthchecks
      Deployments + logs
      Preview cleanup
    Data
      Postgres / MySQL / MariaDB
      Mongo / Redis / KeyDB
      Clickhouse / Dragonfly
      Backups + restore
    Operations
      Env vars (with masking)
      Bulk env update
      Restart / stop fleet
      Storages
      Scheduled tasks
    Insight
      diagnose_app
      diagnose_server
      find_issues
      infrastructure_overview
      Docs search
```

## What's coming in v3

Three new MCP primitives that reshape the experience:

- **Resources** — subscribe to `coolify://applications/{uuid}` and get pushed updates on status change
- **Tasks** — `deploy` returns immediately with a task ID; client polls or streams progress instead of blocking for minutes
- **Prompts** — `/diagnose-app`, `/cleanup-stale-previews`, `/promote-staging-to-prod` as single-command shortcuts
- **Streamable HTTP transport** — host coolify-mcp alongside Coolify itself. Each instance is a single URL.

[Read the v3 vision →](/roadmap/v3-vision)

## License & contributing

MIT licensed, open contribution. The [contributing guide](/contributing/adding-tools) explains how to add a tool from scratch: types → client → MCP layer → tests → CHANGELOG.

</div>
