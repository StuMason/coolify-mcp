[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/stumason-coolify-mcp-badge.png)](https://mseep.ai/app/stumason-coolify-mcp)

# Coolify MCP Server

A Model Context Protocol (MCP) server for [Coolify](https://coolify.io/), enabling AI assistants to manage and debug your Coolify instances through natural language.

## Features

This MCP server provides 46 tools focused on **debugging, management, and deployment**:

| Category         | Tools                                                                                                    |
| ---------------- | -------------------------------------------------------------------------------------------------------- |
| **Servers**      | list, get, validate, resources, domains                                                                  |
| **Projects**     | list, get, create, update, delete                                                                        |
| **Environments** | list, get, create, delete                                                                                |
| **Applications** | list, get, update, delete, start, stop, restart, logs, env vars (CRUD), create (private-gh, private-key) |
| **Databases**    | list, get, start, stop, restart                                                                          |
| **Services**     | list, get, start, stop, restart, env vars (list, create, delete)                                         |
| **Deployments**  | list, get, deploy, list by application                                                                   |

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

## Pagination & Summary Mode

All list endpoints support optional pagination and summary mode to reduce response size:

```bash
# Pagination - get page 2 with 10 items per page
list_applications(page=2, per_page=10)

# Summary mode - returns only essential fields (uuid, name, status, etc.)
list_applications(summary=true)

# Combine both for optimal performance
list_servers(page=1, per_page=20, summary=true)
```

**Summary mode reduces response size by ~90%** - perfect for getting an overview before requesting full details on specific items.

## Example Prompts

### Debugging & Monitoring

```
Show me all servers and their status
What resources are running on server {uuid}?
Get the logs for application {uuid}
What environment variables are set for application {uuid}?
Show me recent deployments for application {uuid}
List all applications in summary mode
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

### Servers

- `get_version` - Get Coolify API version
- `list_servers` - List all servers
- `get_server` - Get server details
- `get_server_resources` - Get resources running on a server
- `get_server_domains` - Get domains configured on a server
- `validate_server` - Validate server connection

### Projects

- `list_projects` - List all projects
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

- `list_applications` - List all applications
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

- `list_databases` - List all databases
- `get_database` - Get database details
- `start_database` - Start a database
- `stop_database` - Stop a database
- `restart_database` - Restart a database

### Services

- `list_services` - List all services
- `get_service` - Get service details
- `start_service` - Start a service
- `stop_service` - Stop a service
- `restart_service` - Restart a service
- `list_service_envs` - List service environment variables
- `create_service_env` - Create service environment variable
- `delete_service_env` - Delete service environment variable

### Deployments

- `list_deployments` - List running deployments
- `get_deployment` - Get deployment details
- `deploy` - Deploy by tag or UUID
- `list_application_deployments` - List deployments for an application

## Contributing

Contributions welcome! Please open an issue first to discuss major changes.

## License

MIT

## Support

- [GitHub Issues](https://github.com/stumason/coolify-mcp/issues)
- [Coolify Community](https://coolify.io/docs/contact)
