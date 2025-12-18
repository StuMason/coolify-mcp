/**
 * Coolify MCP Server
 * Model Context Protocol server for Coolify API
 *
 * Tools focused on debugging, management, and deployment:
 * - Servers: list, get, validate, resources, domains
 * - Projects: CRUD
 * - Environments: CRUD
 * - Applications: list, get, update, delete, start/stop/restart, logs, env vars, deploy (private-gh, private-key)
 * - Databases: list, get, start/stop/restart
 * - Services: list, get, start/stop/restart, env vars
 * - Deployments: list, get, deploy
 *
 * Note: @ts-nocheck is required because the MCP SDK's tool() method causes
 * TypeScript type instantiation depth errors with 40+ zod-typed tools.
 * The client and types are still fully type-checked.
 */
/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { CoolifyClient } from './coolify-client.js';
import type { CoolifyConfig } from '../types/coolify.js';

const VERSION = '0.3.0';

/** Wrap tool handler with consistent error handling */
function wrapHandler<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return fn()
    .then((result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }))
    .catch((error) => ({
      content: [
        {
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    }));
}

/**
 * Coolify MCP Server
 */
export class CoolifyMcpServer extends McpServer {
  private readonly client: CoolifyClient;

  constructor(config: CoolifyConfig) {
    super({
      name: 'coolify',
      version: VERSION,
      capabilities: { tools: {} },
    });

    this.client = new CoolifyClient(config);
    this.registerTools();
  }

  async connect(transport: Transport): Promise<void> {
    await this.client.validateConnection();
    await super.connect(transport);
  }

  private registerTools(): void {
    // Version
    this.tool('get_version', 'Get Coolify API version', {}, async () =>
      wrapHandler(() => this.client.getVersion()),
    );

    // =========================================================================
    // Servers (5 tools)
    // =========================================================================
    this.tool('list_servers', 'List all servers', {}, async () =>
      wrapHandler(() => this.client.listServers()),
    );

    this.tool(
      'get_server',
      'Get server details',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getServer(uuid)),
    );

    this.tool(
      'get_server_resources',
      'Get resources running on a server',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getServerResources(uuid)),
    );

    this.tool(
      'get_server_domains',
      'Get domains configured on a server',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getServerDomains(uuid)),
    );

    this.tool(
      'validate_server',
      'Validate server connection',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.validateServer(uuid)),
    );

    // =========================================================================
    // Projects (5 tools)
    // =========================================================================
    this.tool('list_projects', 'List all projects', {}, async () =>
      wrapHandler(() => this.client.listProjects()),
    );

    this.tool(
      'get_project',
      'Get project details',
      { uuid: z.string().describe('Project UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getProject(uuid)),
    );

    this.tool(
      'create_project',
      'Create a new project',
      {
        name: z.string().describe('Project name'),
        description: z.string().optional().describe('Description'),
      },
      async (args) => wrapHandler(() => this.client.createProject(args)),
    );

    this.tool(
      'update_project',
      'Update a project',
      {
        uuid: z.string().describe('Project UUID'),
        name: z.string().optional().describe('Project name'),
        description: z.string().optional().describe('Description'),
      },
      async ({ uuid, ...data }) => wrapHandler(() => this.client.updateProject(uuid, data)),
    );

    this.tool(
      'delete_project',
      'Delete a project',
      { uuid: z.string().describe('Project UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.deleteProject(uuid)),
    );

    // =========================================================================
    // Environments (4 tools)
    // =========================================================================
    this.tool(
      'list_environments',
      'List environments in a project',
      { project_uuid: z.string().describe('Project UUID') },
      async ({ project_uuid }) =>
        wrapHandler(() => this.client.listProjectEnvironments(project_uuid)),
    );

    this.tool(
      'get_environment',
      'Get environment details',
      {
        project_uuid: z.string().describe('Project UUID'),
        environment: z.string().describe('Environment name or UUID'),
      },
      async ({ project_uuid, environment }) =>
        wrapHandler(() => this.client.getProjectEnvironment(project_uuid, environment)),
    );

    this.tool(
      'create_environment',
      'Create environment in a project',
      {
        project_uuid: z.string().describe('Project UUID'),
        name: z.string().describe('Environment name'),
        description: z.string().optional().describe('Description'),
      },
      async ({ project_uuid, ...data }) =>
        wrapHandler(() => this.client.createProjectEnvironment(project_uuid, data)),
    );

    this.tool(
      'delete_environment',
      'Delete an environment',
      { environment_uuid: z.string().describe('Environment UUID') },
      async ({ environment_uuid }) =>
        wrapHandler(() => this.client.deleteProjectEnvironment(environment_uuid)),
    );

    // =========================================================================
    // Applications (15 tools)
    // =========================================================================
    this.tool('list_applications', 'List all applications', {}, async () =>
      wrapHandler(() => this.client.listApplications()),
    );

    this.tool(
      'get_application',
      'Get application details',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getApplication(uuid)),
    );

    this.tool(
      'create_application_private_gh',
      'Create app from private GitHub repo (GitHub App)',
      {
        project_uuid: z.string().describe('Project UUID'),
        server_uuid: z.string().describe('Server UUID'),
        github_app_uuid: z.string().describe('GitHub App UUID'),
        git_repository: z.string().describe('Repository (org/repo)'),
        git_branch: z.string().describe('Branch'),
        environment_name: z.string().optional().describe('Environment name'),
        destination_uuid: z.string().optional().describe('Destination UUID'),
        build_pack: z.string().optional().describe('Build pack'),
        ports_exposes: z.string().optional().describe('Ports to expose'),
      },
      async (args) => wrapHandler(() => this.client.createApplicationPrivateGH(args)),
    );

    this.tool(
      'create_application_private_key',
      'Create app from private repo using deploy key',
      {
        project_uuid: z.string().describe('Project UUID'),
        server_uuid: z.string().describe('Server UUID'),
        private_key_uuid: z.string().describe('Private key UUID'),
        git_repository: z.string().describe('Repository URL'),
        git_branch: z.string().describe('Branch'),
        environment_name: z.string().optional().describe('Environment name'),
        destination_uuid: z.string().optional().describe('Destination UUID'),
        build_pack: z.string().optional().describe('Build pack'),
        ports_exposes: z.string().optional().describe('Ports to expose'),
      },
      async (args) => wrapHandler(() => this.client.createApplicationPrivateKey(args)),
    );

    this.tool(
      'update_application',
      'Update an application',
      {
        uuid: z.string().describe('Application UUID'),
        name: z.string().optional().describe('Name'),
        description: z.string().optional().describe('Description'),
        fqdn: z.string().optional().describe('Domain'),
        git_branch: z.string().optional().describe('Git branch'),
      },
      async ({ uuid, ...data }) => wrapHandler(() => this.client.updateApplication(uuid, data)),
    );

    this.tool(
      'delete_application',
      'Delete an application',
      {
        uuid: z.string().describe('Application UUID'),
        delete_volumes: z.boolean().optional().describe('Delete volumes'),
      },
      async ({ uuid, delete_volumes }) =>
        wrapHandler(() => this.client.deleteApplication(uuid, { deleteVolumes: delete_volumes })),
    );

    this.tool(
      'start_application',
      'Start an application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.startApplication(uuid)),
    );

    this.tool(
      'stop_application',
      'Stop an application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.stopApplication(uuid)),
    );

    this.tool(
      'restart_application',
      'Restart an application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.restartApplication(uuid)),
    );

    this.tool(
      'get_application_logs',
      'Get application logs',
      {
        uuid: z.string().describe('Application UUID'),
        lines: z.number().optional().describe('Number of lines'),
      },
      async ({ uuid, lines }) => wrapHandler(() => this.client.getApplicationLogs(uuid, lines)),
    );

    // Application env vars
    this.tool(
      'list_application_envs',
      'List application environment variables',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.listApplicationEnvVars(uuid)),
    );

    this.tool(
      'create_application_env',
      'Create application environment variable',
      {
        uuid: z.string().describe('Application UUID'),
        key: z.string().describe('Variable key'),
        value: z.string().describe('Variable value'),
        is_build_time: z.boolean().optional().describe('Build time variable'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.createApplicationEnvVar(uuid, data)),
    );

    this.tool(
      'update_application_env',
      'Update application environment variable',
      {
        uuid: z.string().describe('Application UUID'),
        key: z.string().describe('Variable key'),
        value: z.string().describe('Variable value'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateApplicationEnvVar(uuid, data)),
    );

    this.tool(
      'delete_application_env',
      'Delete application environment variable',
      {
        uuid: z.string().describe('Application UUID'),
        env_uuid: z.string().describe('Env variable UUID'),
      },
      async ({ uuid, env_uuid }) =>
        wrapHandler(() => this.client.deleteApplicationEnvVar(uuid, env_uuid)),
    );

    // =========================================================================
    // Databases (5 tools)
    // =========================================================================
    this.tool('list_databases', 'List all databases', {}, async () =>
      wrapHandler(() => this.client.listDatabases()),
    );

    this.tool(
      'get_database',
      'Get database details',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getDatabase(uuid)),
    );

    this.tool(
      'start_database',
      'Start a database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.startDatabase(uuid)),
    );

    this.tool(
      'stop_database',
      'Stop a database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.stopDatabase(uuid)),
    );

    this.tool(
      'restart_database',
      'Restart a database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.restartDatabase(uuid)),
    );

    // =========================================================================
    // Services (8 tools)
    // =========================================================================
    this.tool('list_services', 'List all services', {}, async () =>
      wrapHandler(() => this.client.listServices()),
    );

    this.tool(
      'get_service',
      'Get service details',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getService(uuid)),
    );

    this.tool(
      'start_service',
      'Start a service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.startService(uuid)),
    );

    this.tool(
      'stop_service',
      'Stop a service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.stopService(uuid)),
    );

    this.tool(
      'restart_service',
      'Restart a service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.restartService(uuid)),
    );

    // Service env vars
    this.tool(
      'list_service_envs',
      'List service environment variables',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.listServiceEnvVars(uuid)),
    );

    this.tool(
      'create_service_env',
      'Create service environment variable',
      {
        uuid: z.string().describe('Service UUID'),
        key: z.string().describe('Variable key'),
        value: z.string().describe('Variable value'),
      },
      async ({ uuid, ...data }) => wrapHandler(() => this.client.createServiceEnvVar(uuid, data)),
    );

    this.tool(
      'delete_service_env',
      'Delete service environment variable',
      {
        uuid: z.string().describe('Service UUID'),
        env_uuid: z.string().describe('Env variable UUID'),
      },
      async ({ uuid, env_uuid }) =>
        wrapHandler(() => this.client.deleteServiceEnvVar(uuid, env_uuid)),
    );

    // =========================================================================
    // Deployments (4 tools)
    // =========================================================================
    this.tool('list_deployments', 'List running deployments', {}, async () =>
      wrapHandler(() => this.client.listDeployments()),
    );

    this.tool(
      'get_deployment',
      'Get deployment details',
      { uuid: z.string().describe('Deployment UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getDeployment(uuid)),
    );

    this.tool(
      'deploy',
      'Deploy by tag or UUID',
      {
        tag_or_uuid: z.string().describe('Tag or UUID'),
        force: z.boolean().optional().describe('Force rebuild'),
      },
      async ({ tag_or_uuid, force }) =>
        wrapHandler(() => this.client.deployByTagOrUuid(tag_or_uuid, force)),
    );

    this.tool(
      'list_application_deployments',
      'List deployments for an application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.listApplicationDeployments(uuid)),
    );
  }
}
