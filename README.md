# Coolify MCP Server

[![npm version](https://img.shields.io/npm/v/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![npm downloads](https://img.shields.io/npm/dm/@masonator/coolify-mcp.svg)](https://www.npmjs.com/package/@masonator/coolify-mcp)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![Node.js Version](https://img.shields.io/node/v/@masonator/coolify-mcp.svg)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.8-blue.svg)](https://www.typescriptlang.org/)
[![CI](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/StuMason/coolify-mcp/actions/workflows/ci.yml)
[![codecov](https://codecov.io/gh/StuMason/coolify-mcp/branch/main/graph/badge.svg)](https://codecov.io/gh/StuMason/coolify-mcp)
[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/stumason-coolify-mcp-badge.png)](https://mseep.ai/app/stumason-coolify-mcp)

> **The most comprehensive MCP server for Coolify** - 34 optimized tools, smart diagnostics, and batch operations for managing your self-hosted PaaS through AI assistants.

A Model Context Protocol (MCP) server for [Coolify](https://coolify.io/), enabling AI assistants to manage and debug your Coolify instances through natural language.

## Features

This MCP server provides **34 token-optimized tools** for **debugging, management, and deployment**:

| Category             | Tools                                                                                                                       |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Infrastructure**   | `get_infrastructure_overview`, `get_mcp_version`, `get_version`                                                             |
| **Diagnostics**      | `diagnose_app`, `diagnose_server`, `find_issues`                                                                            |
| **Batch Operations** | `restart_project_apps`, `bulk_env_update`, `stop_all_apps`, `redeploy_project`                                              |
| **Servers**          | `list_servers`, `get_server`, `validate_server`, `server_resources`, `server_domains`                                       |
| **Projects**         | `projects` (list, get, create, update, delete via action param)                                                             |
| **Environments**     | `environments` (list, get, create, delete via action param)                                                                 |
| **Applications**     | `list_applications`, `get_application`, `application` (CRUD), `application_logs`                                            |
| **Databases**        | `list_databases`, `get_database`, `database` (create 8 types, delete), `database_backups` (CRUD schedules, view executions) |
| **Services**         | `list_services`, `get_service`, `service` (create, update, delete)                                                          |
| **Control**          | `control` (start/stop/restart for apps, databases, services)                                                                |
| **Env Vars**         | `env_vars` (CRUD for application and service env vars)                                                                      |
| **Deployments**      | `list_deployments`, `deploy`, `deployment` (get, cancel, list_for_app)                                                      |
| **Private Keys**     | `private_keys` (list, get, create, update, delete via action param)                                                         |

### Token-Optimized Design

The server uses **85% fewer tokens** than a naive implementation (6,600 vs 43,000) by consolidating related operations into single tools with action parameters. This prevents context window exhaustion in AI assistants.

## Installation

### Prerequisites

- Node.js >= 18
- A running Coolify instance
- Coolify API access token (generate in Coolify Settings > API)

### Claude Desktop

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json` on macOS):

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

### Claude Code

```bash
claude mcp add coolify \
  -e COOLIFY_BASE_URL="https://your-coolify-instance.com" \
  -e COOLIFY_ACCESS_TOKEN="your-api-token" \
  -- npx @masonator/coolify-mcp@latest
```

> **Note:** Use `@latest` tag (not `-y` flag) for reliable startup in Claude Code CLI.

### Cursor

```bash
env COOLIFY_ACCESS_TOKEN=your-api-token COOLIFY_BASE_URL=https://your-coolify-instance.com npx -y @masonator/coolify-mcp
```

## Context-Optimized Responses

### Why This Matters

The Coolify API returns extremely verbose responses - a single application can contain 91 fields including embedded 3KB server objects and 47KB docker-compose files. When listing 20+ applications, responses can exceed 200KB, which quickly exhausts the context window of AI assistants like Claude Desktop.

**This MCP server solves this by returning optimized summaries by default.**

### How It Works

| Tool Type                     | Returns                                  | Use Case                            |
| ----------------------------- | ---------------------------------------- | ----------------------------------- |
| `list_*`                      | Summaries only (uuid, name, status, etc) | Discovery, finding resources        |
| `get_*`                       | Full details for a single resource       | Deep inspection, debugging          |
| `get_infrastructure_overview` | All resources summarized in one call     | Start here to understand your setup |

### Response Size Comparison

| Endpoint              | Full Response | Summary Response | Reduction |
| --------------------- | ------------- | ---------------- | --------- |
| list_applications     | ~170KB        | ~4.4KB           | **97%**   |
| list_services         | ~367KB        | ~1.2KB           | **99%**   |
| list_servers          | ~4KB          | ~0.4KB           | **90%**   |
| list_application_envs | ~3KB/var      | ~0.1KB/var       | **97%**   |

### Recommended Workflow

1. **Start with overview**: `get_infrastructure_overview` - see everything at once
2. **Find your target**: `list_applications` - get UUIDs of what you need
3. **Dive deep**: `get_application(uuid)` - full details for one resource
4. **Take action**: `restart_application(uuid)`, `get_application_logs(uuid)`, etc.

### Pagination

All list endpoints still support optional pagination for very large deployments:

```bash
# Get page 2 with 10 items per page
list_applications(page=2, per_page=10)
```

## Example Prompts

### Getting Started

```text
Give me an overview of my infrastructure
Show me all my applications
What's running on my servers?
```

### Debugging & Monitoring

```text
Diagnose my stuartmason.co.uk app
What's wrong with my-api application?
Check the status of server 192.168.1.100
Find any issues in my infrastructure
Get the logs for application {uuid}
What environment variables are set for application {uuid}?
Show me recent deployments for application {uuid}
What resources are running on server {uuid}?
```

### Application Management

```text
Restart application {uuid}
Stop the database {uuid}
Start service {uuid}
Deploy application {uuid} with force rebuild
Update the DATABASE_URL env var for application {uuid}
```

### Project Setup

```text
Create a new project called "my-app"
Create a staging environment in project {uuid}
Deploy my app from private GitHub repo org/repo on branch main
```

## Environment Variables

| Variable               | Required | Default                 | Description               |
| ---------------------- | -------- | ----------------------- | ------------------------- |
| `COOLIFY_ACCESS_TOKEN` | Yes      | -                       | Your Coolify API token    |
| `COOLIFY_BASE_URL`     | No       | `http://localhost:3000` | Your Coolify instance URL |

## Development

```bash
# Clone and install
git clone https://github.com/stumason/coolify-mcp.git
cd coolify-mcp
npm install

# Build
npm run build

# Test
npm test

# Run locally
COOLIFY_BASE_URL="https://your-coolify.com" \
COOLIFY_ACCESS_TOKEN="your-token" \
node dist/index.js
```

## Available Tools

### Infrastructure

- `get_version` - Get Coolify API version
- `get_mcp_version` - Get coolify-mcp server version (useful to verify which version is installed)
- `get_infrastructure_overview` - Get a high-level overview of all infrastructure (servers, projects, applications, databases, services)

### Diagnostics (Smart Lookup)

These tools accept human-friendly identifiers instead of just UUIDs:

- `diagnose_app` - Get comprehensive app diagnostics (status, logs, env vars, deployments). Accepts UUID, name, or domain (e.g., "stuartmason.co.uk" or "my-app")
- `diagnose_server` - Get server diagnostics (status, resources, domains, validation). Accepts UUID, name, or IP address (e.g., "coolify-apps" or "192.168.1.100")
- `find_issues` - Scan entire infrastructure for unhealthy apps, databases, services, and unreachable servers

### Servers

- `list_servers` - List all servers (returns summary)
- `get_server` - Get server details
- `get_server_resources` - Get resources running on a server
- `get_server_domains` - Get domains configured on a server
- `validate_server` - Validate server connection

### Projects

- `projects` - Manage projects with `action: list|get|create|update|delete`

### Environments

- `environments` - Manage environments with `action: list|get|create|delete`

### Applications

- `list_applications` - List all applications (returns summary)
- `get_application` - Get application details
- `application_logs` - Get application logs
- `application` - Create, update, or delete apps with `action: create_github|create_key|update|delete`
- `env_vars` - Manage env vars with `resource: application, action: list|create|update|delete`
- `control` - Start/stop/restart with `resource: application, action: start|stop|restart`

### Databases

- `list_databases` - List all databases (returns summary)
- `get_database` - Get database details
- `database` - Create or delete databases with `action: create|delete, type: postgresql|mysql|mariadb|mongodb|redis|keydb|clickhouse|dragonfly`
- `database_backups` - Manage backup schedules with `action: list_schedules|get_schedule|create|update|delete|list_executions|get_execution`
  - Configure frequency, retention policies, S3 storage
  - Enable/disable schedules without deletion
  - View backup execution history
- `control` - Start/stop/restart with `resource: database, action: start|stop|restart`

### Services

- `list_services` - List all services (returns summary)
- `get_service` - Get service details
- `service` - Create, update, or delete services with `action: create|update|delete`
- `env_vars` - Manage env vars with `resource: service, action: list|create|delete`
- `control` - Start/stop/restart with `resource: service, action: start|stop|restart`

### Deployments

- `list_deployments` - List running deployments (returns summary)
- `deploy` - Deploy by tag or UUID
- `deployment` - Manage deployments with `action: get|cancel|list_for_app`

### Private Keys

- `private_keys` - Manage SSH keys with `action: list|get|create|update|delete`

### Batch Operations

Power user tools for operating on multiple resources at once:

- `restart_project_apps` - Restart all applications in a project
- `bulk_env_update` - Update or create an environment variable across multiple applications (upsert behavior)
- `stop_all_apps` - Emergency stop all running applications (requires confirmation)
- `redeploy_project` - Redeploy all applications in a project with force rebuild

## Why Coolify MCP?

- **Context-Optimized**: Responses are 90-99% smaller than raw API, preventing context window exhaustion
- **Smart Lookup**: Find apps by domain (`stuartmason.co.uk`), servers by IP, not just UUIDs
- **Batch Operations**: Restart entire projects, bulk update env vars, emergency stop all apps
- **Production Ready**: 98%+ test coverage, TypeScript strict mode, comprehensive error handling
- **Always Current**: Weekly OpenAPI drift detection ensures the server stays in sync with Coolify

## Related Links

- [Coolify](https://coolify.io/) - The open-source & self-hostable Heroku/Netlify/Vercel alternative
- [Model Context Protocol](https://modelcontextprotocol.io/) - The protocol powering AI tool integrations
- [MCP Server Registry](https://github.com/modelcontextprotocol/servers) - Official MCP server directory

## Contributing

Contributions welcome! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT - see [LICENSE](LICENSE) for details.

## Support

- [GitHub Issues](https://github.com/StuMason/coolify-mcp/issues)
- [Coolify Community](https://coolify.io/docs/contact)

---

<p align="center">
  <strong>If you find this useful, please ⭐ star the repo!</strong>
</p>
