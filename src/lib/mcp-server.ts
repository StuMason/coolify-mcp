/**
 * Coolify MCP Server
 * Model Context Protocol server for Coolify API
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { z } from 'zod';
import { CoolifyClient } from './coolify-client.js';
import { SERVICE_TYPES, type CoolifyConfig } from '../types/coolify.js';

const VERSION = '0.3.0';

/**
 * Wrap tool handler with error handling
 */
function wrapHandler<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return fn()
    .then((result) => ({
      content: [
        { type: 'text' as const, text: JSON.stringify(result, null, 2) },
      ],
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
      capabilities: {
        tools: {},
      },
    });

    this.client = new CoolifyClient(config);
    this.registerTools();
  }

  async connect(transport: Transport): Promise<void> {
    await this.client.validateConnection();
    await super.connect(transport);
  }

  private registerTools(): void {
    // =========================================================================
    // Version
    // =========================================================================

    this.tool('get_version', 'Get Coolify API version', {}, async () =>
      wrapHandler(() => this.client.getVersion()),
    );

    // =========================================================================
    // Server Tools
    // =========================================================================

    this.tool('list_servers', 'List all Coolify servers', {}, async () =>
      wrapHandler(() => this.client.listServers()),
    );

    this.tool(
      'get_server',
      'Get details of a specific Coolify server',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getServer(uuid)),
    );

    this.tool(
      'create_server',
      'Create a new Coolify server',
      {
        name: z.string().describe('Server name'),
        ip: z.string().describe('Server IP address'),
        private_key_uuid: z
          .string()
          .describe('UUID of the private key to use'),
        description: z.string().optional().describe('Server description'),
        port: z.number().optional().describe('SSH port (default: 22)'),
        user: z.string().optional().describe('SSH user (default: root)'),
        is_build_server: z
          .boolean()
          .optional()
          .describe('Is this a build server?'),
        instant_validate: z
          .boolean()
          .optional()
          .describe('Validate server immediately?'),
      },
      async (args) => wrapHandler(() => this.client.createServer(args)),
    );

    this.tool(
      'update_server',
      'Update a Coolify server',
      {
        uuid: z.string().describe('Server UUID'),
        name: z.string().optional().describe('Server name'),
        description: z.string().optional().describe('Server description'),
        ip: z.string().optional().describe('Server IP address'),
        port: z.number().optional().describe('SSH port'),
        user: z.string().optional().describe('SSH user'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateServer(uuid, data)),
    );

    this.tool(
      'delete_server',
      'Delete a Coolify server',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.deleteServer(uuid)),
    );

    this.tool(
      'get_server_resources',
      'Get resources running on a Coolify server',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.getServerResources(uuid)),
    );

    this.tool(
      'get_server_domains',
      'Get domains configured on a Coolify server',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.getServerDomains(uuid)),
    );

    this.tool(
      'validate_server',
      'Validate a Coolify server connection',
      { uuid: z.string().describe('Server UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.validateServer(uuid)),
    );

    // =========================================================================
    // Project Tools
    // =========================================================================

    this.tool('list_projects', 'List all Coolify projects', {}, async () =>
      wrapHandler(() => this.client.listProjects()),
    );

    this.tool(
      'get_project',
      'Get details of a specific Coolify project',
      { uuid: z.string().describe('Project UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getProject(uuid)),
    );

    this.tool(
      'create_project',
      'Create a new Coolify project',
      {
        name: z.string().describe('Project name'),
        description: z.string().optional().describe('Project description'),
      },
      async (args) => wrapHandler(() => this.client.createProject(args)),
    );

    this.tool(
      'update_project',
      'Update a Coolify project',
      {
        uuid: z.string().describe('Project UUID'),
        name: z.string().optional().describe('Project name'),
        description: z.string().optional().describe('Project description'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateProject(uuid, data)),
    );

    this.tool(
      'delete_project',
      'Delete a Coolify project',
      { uuid: z.string().describe('Project UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.deleteProject(uuid)),
    );

    // =========================================================================
    // Environment Tools
    // =========================================================================

    this.tool(
      'list_project_environments',
      'List all environments in a Coolify project',
      { project_uuid: z.string().describe('Project UUID') },
      async ({ project_uuid }) =>
        wrapHandler(() => this.client.listProjectEnvironments(project_uuid)),
    );

    this.tool(
      'get_project_environment',
      'Get details of a specific environment in a Coolify project',
      {
        project_uuid: z.string().describe('Project UUID'),
        environment: z.string().describe('Environment name or UUID'),
      },
      async ({ project_uuid, environment }) =>
        wrapHandler(() =>
          this.client.getProjectEnvironment(project_uuid, environment),
        ),
    );

    this.tool(
      'create_project_environment',
      'Create a new environment in a Coolify project',
      {
        project_uuid: z.string().describe('Project UUID'),
        name: z.string().describe('Environment name'),
        description: z.string().optional().describe('Environment description'),
      },
      async ({ project_uuid, ...data }) =>
        wrapHandler(() =>
          this.client.createProjectEnvironment(project_uuid, data),
        ),
    );

    this.tool(
      'delete_project_environment',
      'Delete an environment from a Coolify project',
      { environment_uuid: z.string().describe('Environment UUID') },
      async ({ environment_uuid }) =>
        wrapHandler(() =>
          this.client.deleteProjectEnvironment(environment_uuid),
        ),
    );

    // =========================================================================
    // Application Tools
    // =========================================================================

    this.tool(
      'list_applications',
      'List all Coolify applications',
      {},
      async () => wrapHandler(() => this.client.listApplications()),
    );

    this.tool(
      'get_application',
      'Get details of a specific Coolify application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getApplication(uuid)),
    );

    this.tool(
      'update_application',
      'Update a Coolify application',
      {
        uuid: z.string().describe('Application UUID'),
        name: z.string().optional().describe('Application name'),
        description: z.string().optional().describe('Application description'),
        fqdn: z.string().optional().describe('Fully qualified domain name'),
        git_repository: z.string().optional().describe('Git repository URL'),
        git_branch: z.string().optional().describe('Git branch'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateApplication(uuid, data)),
    );

    this.tool(
      'delete_application',
      'Delete a Coolify application',
      {
        uuid: z.string().describe('Application UUID'),
        delete_configurations: z.boolean().optional(),
        delete_volumes: z.boolean().optional(),
        docker_cleanup: z.boolean().optional(),
        delete_connected_networks: z.boolean().optional(),
      },
      async ({ uuid, ...options }) =>
        wrapHandler(() =>
          this.client.deleteApplication(uuid, {
            deleteConfigurations: options.delete_configurations,
            deleteVolumes: options.delete_volumes,
            dockerCleanup: options.docker_cleanup,
            deleteConnectedNetworks: options.delete_connected_networks,
          }),
        ),
    );

    this.tool(
      'get_application_logs',
      'Get logs from a Coolify application',
      {
        uuid: z.string().describe('Application UUID'),
        lines: z
          .number()
          .optional()
          .describe('Number of log lines (default: 100)'),
      },
      async ({ uuid, lines }) =>
        wrapHandler(() => this.client.getApplicationLogs(uuid, lines)),
    );

    this.tool(
      'start_application',
      'Start a Coolify application',
      {
        uuid: z.string().describe('Application UUID'),
        force: z.boolean().optional().describe('Force start'),
        instant_deploy: z.boolean().optional().describe('Deploy instantly'),
      },
      async ({ uuid, force, instant_deploy }) =>
        wrapHandler(() =>
          this.client.startApplication(uuid, { force, instant_deploy }),
        ),
    );

    this.tool(
      'stop_application',
      'Stop a Coolify application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.stopApplication(uuid)),
    );

    this.tool(
      'restart_application',
      'Restart a Coolify application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.restartApplication(uuid)),
    );

    // =========================================================================
    // Application Environment Variables
    // =========================================================================

    this.tool(
      'list_application_envs',
      'List environment variables for a Coolify application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.listApplicationEnvVars(uuid)),
    );

    this.tool(
      'create_application_env',
      'Create an environment variable for a Coolify application',
      {
        uuid: z.string().describe('Application UUID'),
        key: z.string().describe('Environment variable key'),
        value: z.string().describe('Environment variable value'),
        is_preview: z.boolean().optional(),
        is_literal: z.boolean().optional(),
        is_multiline: z.boolean().optional(),
        is_build_time: z.boolean().optional(),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.createApplicationEnvVar(uuid, data)),
    );

    this.tool(
      'update_application_env',
      'Update an environment variable for a Coolify application',
      {
        uuid: z.string().describe('Application UUID'),
        key: z.string().describe('Environment variable key'),
        value: z.string().describe('Environment variable value'),
        is_preview: z.boolean().optional(),
        is_literal: z.boolean().optional(),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateApplicationEnvVar(uuid, data)),
    );

    this.tool(
      'delete_application_env',
      'Delete an environment variable from a Coolify application',
      {
        uuid: z.string().describe('Application UUID'),
        env_uuid: z.string().describe('Environment variable UUID'),
      },
      async ({ uuid, env_uuid }) =>
        wrapHandler(() => this.client.deleteApplicationEnvVar(uuid, env_uuid)),
    );

    // =========================================================================
    // Database Tools
    // =========================================================================

    this.tool('list_databases', 'List all Coolify databases', {}, async () =>
      wrapHandler(() => this.client.listDatabases()),
    );

    this.tool(
      'get_database',
      'Get details of a specific Coolify database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getDatabase(uuid)),
    );

    this.tool(
      'update_database',
      'Update a Coolify database',
      {
        uuid: z.string().describe('Database UUID'),
        name: z.string().optional().describe('Database name'),
        description: z.string().optional().describe('Database description'),
        image: z.string().optional().describe('Docker image'),
        is_public: z.boolean().optional().describe('Is publicly accessible'),
        public_port: z.number().optional().describe('Public port'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateDatabase(uuid, data)),
    );

    this.tool(
      'delete_database',
      'Delete a Coolify database',
      {
        uuid: z.string().describe('Database UUID'),
        delete_configurations: z.boolean().optional(),
        delete_volumes: z.boolean().optional(),
        docker_cleanup: z.boolean().optional(),
        delete_connected_networks: z.boolean().optional(),
      },
      async ({ uuid, ...options }) =>
        wrapHandler(() =>
          this.client.deleteDatabase(uuid, {
            deleteConfigurations: options.delete_configurations,
            deleteVolumes: options.delete_volumes,
            dockerCleanup: options.docker_cleanup,
            deleteConnectedNetworks: options.delete_connected_networks,
          }),
        ),
    );

    this.tool(
      'start_database',
      'Start a Coolify database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.startDatabase(uuid)),
    );

    this.tool(
      'stop_database',
      'Stop a Coolify database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.stopDatabase(uuid)),
    );

    this.tool(
      'restart_database',
      'Restart a Coolify database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.restartDatabase(uuid)),
    );

    // =========================================================================
    // Database Backups
    // =========================================================================

    this.tool(
      'list_database_backups',
      'List backups for a Coolify database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.listDatabaseBackups(uuid)),
    );

    this.tool(
      'create_database_backup',
      'Create a backup configuration for a Coolify database',
      {
        uuid: z.string().describe('Database UUID'),
        frequency: z.string().describe('Backup frequency (cron expression)'),
        enabled: z.boolean().optional().describe('Is backup enabled'),
        save_s3: z.boolean().optional().describe('Save to S3'),
        s3_storage_uuid: z.string().optional().describe('S3 storage UUID'),
        databases_to_backup: z
          .string()
          .optional()
          .describe('Databases to backup'),
        dump_all: z.boolean().optional().describe('Dump all databases'),
        backup_now: z.boolean().optional().describe('Run backup immediately'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.createDatabaseBackup(uuid, data)),
    );

    // =========================================================================
    // Service Tools
    // =========================================================================

    this.tool('list_services', 'List all Coolify services', {}, async () =>
      wrapHandler(() => this.client.listServices()),
    );

    this.tool(
      'get_service',
      'Get details of a specific Coolify service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getService(uuid)),
    );

    this.tool(
      'create_service',
      'Create a new Coolify service',
      {
        type: z.enum(SERVICE_TYPES).describe('Service type'),
        project_uuid: z.string().describe('Project UUID'),
        server_uuid: z.string().describe('Server UUID'),
        name: z.string().optional().describe('Service name'),
        description: z.string().optional().describe('Service description'),
        environment_name: z.string().optional().describe('Environment name'),
        environment_uuid: z.string().optional().describe('Environment UUID'),
        destination_uuid: z.string().optional().describe('Destination UUID'),
        instant_deploy: z.boolean().optional().describe('Deploy instantly'),
      },
      async (args) => wrapHandler(() => this.client.createService(args)),
    );

    this.tool(
      'update_service',
      'Update a Coolify service',
      {
        uuid: z.string().describe('Service UUID'),
        name: z.string().optional().describe('Service name'),
        description: z.string().optional().describe('Service description'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateService(uuid, data)),
    );

    this.tool(
      'delete_service',
      'Delete a Coolify service',
      {
        uuid: z.string().describe('Service UUID'),
        delete_configurations: z.boolean().optional(),
        delete_volumes: z.boolean().optional(),
        docker_cleanup: z.boolean().optional(),
        delete_connected_networks: z.boolean().optional(),
      },
      async ({ uuid, ...options }) =>
        wrapHandler(() =>
          this.client.deleteService(uuid, {
            deleteConfigurations: options.delete_configurations,
            deleteVolumes: options.delete_volumes,
            dockerCleanup: options.docker_cleanup,
            deleteConnectedNetworks: options.delete_connected_networks,
          }),
        ),
    );

    this.tool(
      'start_service',
      'Start a Coolify service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.startService(uuid)),
    );

    this.tool(
      'stop_service',
      'Stop a Coolify service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.stopService(uuid)),
    );

    this.tool(
      'restart_service',
      'Restart a Coolify service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.restartService(uuid)),
    );

    // =========================================================================
    // Service Environment Variables
    // =========================================================================

    this.tool(
      'list_service_envs',
      'List environment variables for a Coolify service',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.listServiceEnvVars(uuid)),
    );

    this.tool(
      'create_service_env',
      'Create an environment variable for a Coolify service',
      {
        uuid: z.string().describe('Service UUID'),
        key: z.string().describe('Environment variable key'),
        value: z.string().describe('Environment variable value'),
        is_preview: z.boolean().optional(),
        is_literal: z.boolean().optional(),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.createServiceEnvVar(uuid, data)),
    );

    this.tool(
      'delete_service_env',
      'Delete an environment variable from a Coolify service',
      {
        uuid: z.string().describe('Service UUID'),
        env_uuid: z.string().describe('Environment variable UUID'),
      },
      async ({ uuid, env_uuid }) =>
        wrapHandler(() => this.client.deleteServiceEnvVar(uuid, env_uuid)),
    );

    // =========================================================================
    // Deployment Tools
    // =========================================================================

    this.tool(
      'list_deployments',
      'List all running Coolify deployments',
      {},
      async () => wrapHandler(() => this.client.listDeployments()),
    );

    this.tool(
      'get_deployment',
      'Get details of a specific Coolify deployment',
      { uuid: z.string().describe('Deployment UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getDeployment(uuid)),
    );

    this.tool(
      'deploy',
      'Deploy an application by tag or UUID',
      {
        tag_or_uuid: z.string().describe('Tag or UUID to deploy'),
        force: z.boolean().optional().describe('Force rebuild'),
      },
      async ({ tag_or_uuid, force }) =>
        wrapHandler(() => this.client.deployByTagOrUuid(tag_or_uuid, force)),
    );

    this.tool(
      'list_application_deployments',
      'List all deployments for a specific application',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.listApplicationDeployments(uuid)),
    );

    // =========================================================================
    // Team Tools
    // =========================================================================

    this.tool('list_teams', 'List all Coolify teams', {}, async () =>
      wrapHandler(() => this.client.listTeams()),
    );

    this.tool(
      'get_team',
      'Get details of a specific Coolify team',
      { id: z.number().describe('Team ID') },
      async ({ id }) => wrapHandler(() => this.client.getTeam(id)),
    );

    this.tool(
      'get_team_members',
      'Get members of a specific Coolify team',
      { id: z.number().describe('Team ID') },
      async ({ id }) => wrapHandler(() => this.client.getTeamMembers(id)),
    );

    this.tool(
      'get_current_team',
      'Get the current authenticated team',
      {},
      async () => wrapHandler(() => this.client.getCurrentTeam()),
    );

    this.tool(
      'get_current_team_members',
      'Get members of the current authenticated team',
      {},
      async () => wrapHandler(() => this.client.getCurrentTeamMembers()),
    );

    // =========================================================================
    // Private Key Tools
    // =========================================================================

    this.tool('list_private_keys', 'List all private keys', {}, async () =>
      wrapHandler(() => this.client.listPrivateKeys()),
    );

    this.tool(
      'get_private_key',
      'Get details of a specific private key',
      { uuid: z.string().describe('Private key UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getPrivateKey(uuid)),
    );

    this.tool(
      'create_private_key',
      'Create a new private key',
      {
        name: z.string().describe('Key name'),
        private_key: z.string().describe('Private key content'),
        description: z.string().optional().describe('Key description'),
      },
      async (args) => wrapHandler(() => this.client.createPrivateKey(args)),
    );

    this.tool(
      'update_private_key',
      'Update a private key',
      {
        uuid: z.string().describe('Private key UUID'),
        name: z.string().optional().describe('Key name'),
        description: z.string().optional().describe('Key description'),
        private_key: z.string().optional().describe('Private key content'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updatePrivateKey(uuid, data)),
    );

    this.tool(
      'delete_private_key',
      'Delete a private key',
      { uuid: z.string().describe('Private key UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.deletePrivateKey(uuid)),
    );

    // =========================================================================
    // Cloud Token Tools
    // =========================================================================

    this.tool(
      'list_cloud_tokens',
      'List all cloud provider tokens (Hetzner, DigitalOcean)',
      {},
      async () => wrapHandler(() => this.client.listCloudTokens()),
    );

    this.tool(
      'get_cloud_token',
      'Get details of a specific cloud provider token',
      { uuid: z.string().describe('Cloud token UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getCloudToken(uuid)),
    );

    this.tool(
      'create_cloud_token',
      'Create a new cloud provider token',
      {
        provider: z
          .enum(['hetzner', 'digitalocean'])
          .describe('Cloud provider'),
        token: z.string().describe('API token'),
        name: z.string().describe('Token name'),
      },
      async (args) => wrapHandler(() => this.client.createCloudToken(args)),
    );

    this.tool(
      'update_cloud_token',
      'Update a cloud provider token',
      {
        uuid: z.string().describe('Cloud token UUID'),
        name: z.string().optional().describe('Token name'),
      },
      async ({ uuid, ...data }) =>
        wrapHandler(() => this.client.updateCloudToken(uuid, data)),
    );

    this.tool(
      'delete_cloud_token',
      'Delete a cloud provider token',
      { uuid: z.string().describe('Cloud token UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.deleteCloudToken(uuid)),
    );

    this.tool(
      'validate_cloud_token',
      'Validate a cloud provider token',
      { uuid: z.string().describe('Cloud token UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.validateCloudToken(uuid)),
    );
  }
}
