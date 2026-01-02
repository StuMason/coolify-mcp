[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/stumason-coolify-mcp-badge.png)](https://mseep.ai/app/stumason-coolify-mcp)

# Coolify MCP Server

A Model Context Protocol (MCP) server for [Coolify](https://coolify.io/), enabling AI assistants to manage and debug your Coolify instances through natural language.

## Features

This MCP server provides **58 tools** focused on **debugging, management, and deployment**:

| Category           | Tools                                                                                                    |
| ------------------ | -------------------------------------------------------------------------------------------------------- |
| **Infrastructure** | overview (all resources at once)                                                                         |
| **Servers**        | list, get, validate, resources, domains                                                                  |
| **Projects**       | list, get, create, update, delete                                                                        |
| **Environments**   | list, get, create, delete                                                                                |
| **Applications**   | list, get, update, delete, start, stop, restart, logs, env vars (CRUD), create (private-gh, private-key) |
| **Databases**      | list, get, start, stop, restart, backups (list, get), backup executions (list, get)                      |
| **Services**       | list, get, create, update, delete, start, stop, restart, env vars (list, create, delete)                 |
| **Deployments**    | list, get, deploy, cancel, list by application                                                           |
| **Private Keys**   | list, get, create, update, delete                                                                        |

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

| Endpoint          | Full Response | Summary Response | Reduction |
| ----------------- | ------------- | ---------------- | --------- |
| list_applications | ~170KB        | ~4.4KB           | **97%**   |
| list_services     | ~367KB        | ~1.2KB           | **99%**   |
| list_servers      | ~4KB          | ~0.4KB           | **90%**   |

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

```
Give me an overview of my infrastructure
Show me all my applications
What's running on my servers?
```

### Debugging & Monitoring

```
Get the logs for application {uuid}
What's the status of application {uuid}?
What environment variables are set for application {uuid}?
Show me recent deployments for application {uuid}
What resources are running on server {uuid}?
```

### Application Management

```
Restart application {uuid}
Stop the database {uuid}
Start service {uuid}
Deploy application {uuid} with force rebuild
Update the DATABASE_URL env var for application {uuid}
```

### Project Setup

```
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
- `get_infrastructure_overview` - Get a high-level overview of all infrastructure (servers, projects, applications, databases, services)

### Servers

- `list_servers` - List all servers (returns summary)
- `get_server` - Get server details
- `get_server_resources` - Get resources running on a server
- `get_server_domains` - Get domains configured on a server
- `validate_server` - Validate server connection

### Projects

- `list_projects` - List all projects (returns summary)
- `get_project` - Get project details
- `create_project` - Create a new project
- `update_project` - Update a project
- `delete_project` - Delete a project

### Environments

- `list_environments` - List environments in a project
- `get_environment` - Get environment details
- `create_environment` - Create environment in a project
- `delete_environment` - Delete an environment

### Applications

- `list_applications` - List all applications (returns summary)
- `get_application` - Get application details
- `create_application_private_gh` - Create app from private GitHub repo (GitHub App)
- `create_application_private_key` - Create app from private repo using deploy key
- `update_application` - Update an application
- `delete_application` - Delete an application
- `start_application` - Start an application
- `stop_application` - Stop an application
- `restart_application` - Restart an application
- `get_application_logs` - Get application logs
- `list_application_envs` - List application environment variables
- `create_application_env` - Create application environment variable
- `update_application_env` - Update application environment variable
- `delete_application_env` - Delete application environment variable

### Databases

- `list_databases` - List all databases (returns summary)
- `get_database` - Get database details
- `start_database` - Start a database
- `stop_database` - Stop a database
- `restart_database` - Restart a database
- `list_database_backups` - List scheduled backups for a database
- `get_database_backup` - Get details of a scheduled backup
- `list_backup_executions` - List execution history for a scheduled backup
- `get_backup_execution` - Get details of a specific backup execution

### Services

- `list_services` - List all services (returns summary)
- `get_service` - Get service details
- `create_service` - Create a one-click service (e.g., pocketbase, mysql, redis, wordpress)
- `update_service` - Update a service
- `delete_service` - Delete a service
- `start_service` - Start a service
- `stop_service` - Stop a service
- `restart_service` - Restart a service
- `list_service_envs` - List service environment variables
- `create_service_env` - Create service environment variable
- `delete_service_env` - Delete service environment variable

### Deployments

- `list_deployments` - List running deployments (returns summary)
- `get_deployment` - Get deployment details
- `deploy` - Deploy by tag or UUID
- `cancel_deployment` - Cancel a running deployment
- `list_application_deployments` - List deployments for an application

### Private Keys

- `list_private_keys` - List all private keys (SSH keys for deployments)
- `get_private_key` - Get private key details
- `create_private_key` - Create a new private key for deployments
- `update_private_key` - Update a private key
- `delete_private_key` - Delete a private key

## Contributing

Contributions welcome! Please open an issue first to discuss major changes.

## License

MIT

## Support

- [GitHub Issues](https://github.com/stumason/coolify-mcp/issues)
- [Coolify Community](https://coolify.io/docs/contact)
