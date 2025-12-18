[![MseeP.ai Security Assessment Badge](https://mseep.net/pr/stumason-coolify-mcp-badge.png)](https://mseep.ai/app/stumason-coolify-mcp)

# Coolify MCP Server

A Model Context Protocol (MCP) server implementation for [Coolify](https://coolify.io/), enabling AI assistants to interact with your Coolify instances through natural language.

## Example Prompts

Here are example prompts you can use with MCP-compatible AI assistants to interact with your Coolify instance:

### Server Management

```
# List and Inspect Servers
- Show me all Coolify servers in my instance
- What's the status of server {uuid}?
- Show me the resources running on server {uuid}
- What domains are configured for server {uuid}?
- Can you validate the connection to server {uuid}?

# Resource Monitoring
- How much CPU and memory is server {uuid} using?
- List all resources running on server {uuid}
- Show me the current status of all servers
```

### Project Management

```
# Project Operations
- List all my Coolify projects
- Create a new project called "my-webapp" with description "My web application"
- Show me the details of project {uuid}
- Update project {uuid} to change its name to "new-name"
- Delete project {uuid}

# Environment Management
- Show me the environments in project {uuid}
- Get details of the production environment in project {uuid}
- What variables are set in the staging environment of project {uuid}?
```

### Application and Service Management

```
# Application Management
- List all applications
- Show me details of application {uuid}
- Create a new application called "my-nodejs-app"
- Delete application {uuid}

# Service Operations
- Show me all running services
- Create a new WordPress service:
  - Name: my-blog
  - Project UUID: {project_uuid}
  - Server UUID: {server_uuid}
  - Type: wordpress-with-mysql
- What's the status of service {uuid}?
- Delete service {uuid} and clean up its resources
```

### Database Management

```
# Database Operations
- List all databases
- Show me the configuration of database {uuid}
- Update database {uuid}:
  - Increase memory limit to 1GB
  - Change public port to 5432
  - Update password
- Delete database {uuid} and clean up volumes

# Database Types
- Create a PostgreSQL database
- Set up a Redis instance
- Configure a MongoDB database
- Initialize a MySQL database
```

### Deployment Management

```
# Deployment Operations
- Show me all active deployments
- What's the status of deployment {uuid}?
- Deploy application {uuid}
- Force rebuild and deploy application {uuid}
- List recent deployments for application {uuid}
```

## Installation

### Prerequisites

- Node.js >= 18
- A running Coolify instance
- Coolify API access token

### Setup in AI Tools

#### Claude Desktop

```json
"coolify": {
    "command": "npx",
    "args": [
        "-y", "@masonator/coolify-mcp"
    ],
    "env": {
        "COOLIFY_ACCESS_TOKEN": "0|your-secret-token",
        "COOLIFY_BASE_URL": "https://your-coolify-instance.com"
    }
}
```

#### Cursor

```bash
env COOLIFY_ACCESS_TOKEN:0|your-secret-token COOLIFY_BASE_URL:https://your-coolify-instance.com npx -y @stumason/coolify-mcp
```

## Development

### Local Setup

```bash
# Clone the repository
git clone https://github.com/stumason/coolify-mcp.git
cd coolify-mcp

# Install dependencies
npm install

# Build the project
npm run build

# Run tests
npm test
```

### Environment Variables

```bash
# Required
COOLIFY_ACCESS_TOKEN=your_access_token_here

# Optional (defaults to http://localhost:3000)
COOLIFY_BASE_URL=https://your.coolify.instance
```

## API Reference

### Resource Types

#### Application

```typescript
interface Application {
  uuid: string;
  name: string;
  // Additional properties based on your Coolify instance
}
```

#### Service

```typescript
interface Service {
  id: number;
  uuid: string;
  name: string;
  type: ServiceType; // Various types like 'wordpress', 'mysql', etc.
  status: 'running' | 'stopped' | 'error';
  project_uuid: string;
  environment_uuid: string;
  server_uuid: string;
  domains?: string[];
}
```

#### Database

```typescript
interface Database {
  id: number;
  uuid: string;
  name: string;
  type: 'postgresql' | 'mysql' | 'mongodb' | 'redis' | /* other types */;
  status: 'running' | 'stopped' | 'error';
  is_public: boolean;
  public_port?: number;
  // Additional configuration based on database type
}
```

#### Deployment

```typescript
interface Deployment {
  id: number;
  uuid: string;
  application_uuid: string;
  status: string;
  created_at: string;
  updated_at: string;
}
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request. For major changes, please open an issue first to discuss what you would like to change.

## License

MIT

## Support

For support, please:

1. Check the [issues](https://github.com/stumason/coolify-mcp/issues) page
2. Create a new issue if needed
3. Join the Coolify community
