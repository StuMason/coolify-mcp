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
 * - Services: list, get, update, start/stop/restart, env vars
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
import {
  CoolifyClient,
  type ServerSummary,
  type ProjectSummary,
  type ApplicationSummary,
  type DatabaseSummary,
  type ServiceSummary,
} from './coolify-client.js';
import type { CoolifyConfig } from '../types/coolify.js';

const VERSION = '1.1.1';

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
      capabilities: { tools: {}, prompts: {} },
    });

    this.client = new CoolifyClient(config);
    this.registerTools();
    this.registerPrompts();
  }

  async connect(transport: Transport): Promise<void> {
    await super.connect(transport);
  }

  private registerTools(): void {
    // Version tools
    this.tool('get_version', 'Get Coolify API version', {}, async () =>
      wrapHandler(() => this.client.getVersion()),
    );

    this.tool(
      'get_mcp_version',
      'Get the version of this MCP server (coolify-mcp). Useful to verify which version is installed.',
      {},
      async () => ({
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ version: VERSION, name: '@masonator/coolify-mcp' }, null, 2),
          },
        ],
      }),
    );

    // Infrastructure Overview - high-level view of all resources
    this.tool(
      'get_infrastructure_overview',
      'Get a high-level overview of all infrastructure (servers, projects, applications, databases, services). Returns counts and summaries. Start here to understand the infrastructure.',
      {},
      async () =>
        wrapHandler(async () => {
          const results = await Promise.allSettled([
            this.client.listServers({ summary: true }),
            this.client.listProjects({ summary: true }),
            this.client.listApplications({ summary: true }),
            this.client.listDatabases({ summary: true }),
            this.client.listServices({ summary: true }),
          ]);

          const extract = <T>(result: PromiseSettledResult<T>): T | [] =>
            result.status === 'fulfilled' ? result.value : [];

          const servers = extract(results[0]) as ServerSummary[];
          const projects = extract(results[1]) as ProjectSummary[];
          const applications = extract(results[2]) as ApplicationSummary[];
          const databases = extract(results[3]) as DatabaseSummary[];
          const services = extract(results[4]) as ServiceSummary[];

          const errors = results
            .map((r, i) => {
              if (r.status === 'rejected') {
                const names = ['servers', 'projects', 'applications', 'databases', 'services'];
                return `${names[i]}: ${r.reason instanceof Error ? r.reason.message : String(r.reason)}`;
              }
              return null;
            })
            .filter(Boolean);

          return {
            summary: {
              servers: servers.length,
              projects: projects.length,
              applications: applications.length,
              databases: databases.length,
              services: services.length,
            },
            servers,
            projects,
            applications,
            databases,
            services,
            ...(errors.length > 0 && { errors }),
          };
        }),
    );

    // =========================================================================
    // Servers (5 tools)
    // =========================================================================
    this.tool(
      'list_servers',
      'List all servers (returns summary: uuid, name, ip, status). Use get_server for full details.',
      {
        page: z.number().optional().describe('Page number for pagination'),
        per_page: z.number().optional().describe('Items per page (default: all)'),
      },
      async ({ page, per_page }) =>
        wrapHandler(() => this.client.listServers({ page, per_page, summary: true })),
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
    this.tool(
      'list_projects',
      'List all projects (returns summary: uuid, name, description). Use get_project for full details.',
      {
        page: z.number().optional().describe('Page number for pagination'),
        per_page: z.number().optional().describe('Items per page (default: all)'),
      },
      async ({ page, per_page }) =>
        wrapHandler(() => this.client.listProjects({ page, per_page, summary: true })),
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
      'Delete an environment. Environment must be empty (no resources).',
      {
        project_uuid: z.string().describe('Project UUID'),
        environment_name_or_uuid: z.string().describe('Environment name or UUID'),
      },
      async ({ project_uuid, environment_name_or_uuid }) =>
        wrapHandler(() =>
          this.client.deleteProjectEnvironment(project_uuid, environment_name_or_uuid),
        ),
    );

    // =========================================================================
    // Applications (15 tools)
    // =========================================================================
    this.tool(
      'list_applications',
      'List all applications (returns summary: uuid, name, status, fqdn, git_repository). Use get_application for full details.',
      {
        page: z.number().optional().describe('Page number for pagination'),
        per_page: z.number().optional().describe('Items per page (default: all)'),
      },
      async ({ page, per_page }) =>
        wrapHandler(() => this.client.listApplications({ page, per_page, summary: true })),
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
        is_http_basic_auth_enabled: z
          .boolean()
          .optional()
          .describe('Enable HTTP basic authentication'),
        http_basic_auth_username: z.string().optional().describe('HTTP basic auth username'),
        http_basic_auth_password: z.string().optional().describe('HTTP basic auth password'),
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
      'List application environment variables (returns summary: uuid, key, value, is_build_time)',
      { uuid: z.string().describe('Application UUID') },
      async ({ uuid }) =>
        wrapHandler(() => this.client.listApplicationEnvVars(uuid, { summary: true })),
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
    // Databases (6 tools)
    // =========================================================================
    this.tool(
      'list_databases',
      'List all databases (returns summary: uuid, name, type, status). Use get_database for full details.',
      {
        page: z.number().optional().describe('Page number for pagination'),
        per_page: z.number().optional().describe('Items per page (default: all)'),
      },
      async ({ page, per_page }) =>
        wrapHandler(() => this.client.listDatabases({ page, per_page, summary: true })),
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

    this.tool(
      'delete_database',
      'Delete a database. WARNING: This permanently deletes the database and optionally its volumes. Data cannot be recovered unless you have backups.',
      {
        uuid: z.string().describe('Database UUID'),
        delete_volumes: z.boolean().optional().describe('Delete volumes (default: false)'),
      },
      async ({ uuid, delete_volumes }) =>
        wrapHandler(() => this.client.deleteDatabase(uuid, { deleteVolumes: delete_volumes })),
    );

    // =========================================================================
    // Services (11 tools)
    // =========================================================================
    this.tool(
      'list_services',
      'List all services (returns summary: uuid, name, type, status, domains). Use get_service for full details.',
      {
        page: z.number().optional().describe('Page number for pagination'),
        per_page: z.number().optional().describe('Items per page (default: all)'),
      },
      async ({ page, per_page }) =>
        wrapHandler(() => this.client.listServices({ page, per_page, summary: true })),
    );

    this.tool(
      'get_service',
      'Get service details',
      { uuid: z.string().describe('Service UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getService(uuid)),
    );

    this.tool(
      'create_service',
      'Create a one-click service (e.g., pocketbase, mysql, redis, wordpress, etc.). Use type OR docker_compose_raw, not both.',
      {
        type: z
          .string()
          .optional()
          .describe(
            'Service type (e.g., pocketbase, mysql, redis, postgresql, mongodb, wordpress, etc.)',
          ),
        server_uuid: z.string().describe('Server UUID'),
        project_uuid: z.string().describe('Project UUID'),
        environment_name: z.string().optional().describe('Environment name (e.g., production)'),
        environment_uuid: z
          .string()
          .optional()
          .describe('Environment UUID (alternative to environment_name)'),
        name: z.string().optional().describe('Service name'),
        description: z.string().optional().describe('Service description'),
        destination_uuid: z.string().optional().describe('Destination UUID'),
        instant_deploy: z.boolean().optional().describe('Deploy immediately after creation'),
        docker_compose_raw: z
          .string()
          .optional()
          .describe(
            'Base64 encoded docker-compose YAML with SERVICE_FQDN_* env var for custom domain (alternative to type)',
          ),
      },
      async (args) => wrapHandler(() => this.client.createService(args)),
    );

    this.tool(
      'delete_service',
      'Delete a service',
      {
        uuid: z.string().describe('Service UUID'),
        delete_configurations: z
          .boolean()
          .optional()
          .describe('Delete configurations (default: true)'),
        delete_volumes: z.boolean().optional().describe('Delete volumes (default: true)'),
        docker_cleanup: z
          .boolean()
          .optional()
          .describe('Clean up Docker resources (default: true)'),
        delete_connected_networks: z
          .boolean()
          .optional()
          .describe('Delete connected networks (default: true)'),
      },
      async ({
        uuid,
        delete_configurations,
        delete_volumes,
        docker_cleanup,
        delete_connected_networks,
      }) =>
        wrapHandler(() =>
          this.client.deleteService(uuid, {
            deleteConfigurations: delete_configurations,
            deleteVolumes: delete_volumes,
            dockerCleanup: docker_cleanup,
            deleteConnectedNetworks: delete_connected_networks,
          }),
        ),
    );

    this.tool(
      'update_service',
      'Update a service (IMPORTANT: See UpdateServiceRequest type docs for Traefik basic auth requirements)',
      {
        uuid: z.string().describe('Service UUID'),
        name: z.string().optional().describe('Service name'),
        description: z.string().optional().describe('Description'),
        docker_compose_raw: z
          .string()
          .optional()
          .describe(
            'Base64 encoded docker-compose YAML. CRITICAL FOR BASIC AUTH: (1) Manually disable label escaping in Coolify UI first (no API). (2) Use $$ in htpasswd hashes even with escaping disabled (Traefik requirement). (3) Generate: htpasswd -nb user pass, then replace $ with $$.',
          ),
      },
      async ({ uuid, ...data }) => wrapHandler(() => this.client.updateService(uuid, data)),
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
    this.tool(
      'list_deployments',
      'List running deployments (returns summary: uuid, deployment_uuid, application_name, status). Use get_deployment for full details.',
      {
        page: z.number().optional().describe('Page number for pagination'),
        per_page: z.number().optional().describe('Items per page (default: all)'),
      },
      async ({ page, per_page }) =>
        wrapHandler(() => this.client.listDeployments({ page, per_page, summary: true })),
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

    this.tool(
      'cancel_deployment',
      'Cancel a running deployment',
      { uuid: z.string().describe('Deployment UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.cancelDeployment(uuid)),
    );

    // =========================================================================
    // Private Keys (5 tools)
    // =========================================================================
    this.tool(
      'list_private_keys',
      'List all private keys (SSH keys for deployments)',
      {},
      async () => wrapHandler(() => this.client.listPrivateKeys()),
    );

    this.tool(
      'get_private_key',
      'Get private key details',
      { uuid: z.string().describe('Private key UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.getPrivateKey(uuid)),
    );

    this.tool(
      'create_private_key',
      'Create a new private key for deployments',
      {
        private_key: z.string().describe('The private key content (PEM format)'),
        name: z.string().optional().describe('Name for the key'),
        description: z.string().optional().describe('Description'),
      },
      async (args) => wrapHandler(() => this.client.createPrivateKey(args)),
    );

    this.tool(
      'update_private_key',
      'Update a private key',
      {
        uuid: z.string().describe('Private key UUID'),
        name: z.string().optional().describe('Name for the key'),
        description: z.string().optional().describe('Description'),
        private_key: z.string().optional().describe('The private key content (PEM format)'),
      },
      async ({ uuid, ...data }) => wrapHandler(() => this.client.updatePrivateKey(uuid, data)),
    );

    this.tool(
      'delete_private_key',
      'Delete a private key',
      { uuid: z.string().describe('Private key UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.deletePrivateKey(uuid)),
    );

    // =========================================================================
    // Database Backups (4 tools)
    // =========================================================================
    this.tool(
      'list_database_backups',
      'List scheduled backups for a database',
      { uuid: z.string().describe('Database UUID') },
      async ({ uuid }) => wrapHandler(() => this.client.listDatabaseBackups(uuid)),
    );

    this.tool(
      'get_database_backup',
      'Get details of a scheduled backup',
      {
        database_uuid: z.string().describe('Database UUID'),
        backup_uuid: z.string().describe('Scheduled backup UUID'),
      },
      async ({ database_uuid, backup_uuid }) =>
        wrapHandler(() => this.client.getDatabaseBackup(database_uuid, backup_uuid)),
    );

    this.tool(
      'list_backup_executions',
      'List execution history for a scheduled backup',
      {
        database_uuid: z.string().describe('Database UUID'),
        backup_uuid: z.string().describe('Scheduled backup UUID'),
      },
      async ({ database_uuid, backup_uuid }) =>
        wrapHandler(() => this.client.listBackupExecutions(database_uuid, backup_uuid)),
    );

    this.tool(
      'get_backup_execution',
      'Get details of a specific backup execution',
      {
        database_uuid: z.string().describe('Database UUID'),
        backup_uuid: z.string().describe('Scheduled backup UUID'),
        execution_uuid: z.string().describe('Backup execution UUID'),
      },
      async ({ database_uuid, backup_uuid, execution_uuid }) =>
        wrapHandler(() =>
          this.client.getBackupExecution(database_uuid, backup_uuid, execution_uuid),
        ),
    );

    // =========================================================================
    // Diagnostics (3 tools) - Composite tools for debugging
    // =========================================================================
    this.tool(
      'diagnose_app',
      'Get comprehensive diagnostic info for an application. Accepts UUID, name, or domain (e.g., "stuartmason.co.uk" or "my-app"). Aggregates: status, health assessment, logs (last 50 lines), environment variables (keys only, values hidden), and recent deployments. Use this for debugging application issues.',
      { query: z.string().describe('Application UUID, name, or domain (FQDN)') },
      async ({ query }) => wrapHandler(() => this.client.diagnoseApplication(query)),
    );

    this.tool(
      'diagnose_server',
      'Get comprehensive diagnostic info for a server. Accepts UUID, name, or IP address (e.g., "coolify-apps" or "192.168.1.100"). Aggregates: server status, health assessment, running resources, configured domains, and connection validation. Use this for debugging server issues.',
      { query: z.string().describe('Server UUID, name, or IP address') },
      async ({ query }) => wrapHandler(() => this.client.diagnoseServer(query)),
    );

    this.tool(
      'find_issues',
      'Scan entire infrastructure for common issues. Finds: unreachable servers, unhealthy/stopped applications, exited databases, and stopped services. Returns a summary with issue counts and detailed list of problems.',
      {},
      async () => wrapHandler(() => this.client.findInfrastructureIssues()),
    );

    // =========================================================================
    // Batch Operations (4 tools) - Operate on multiple resources at once
    // =========================================================================
    this.tool(
      'restart_project_apps',
      'Restart all applications in a project. Returns a summary of succeeded/failed restarts with details.',
      { project_uuid: z.string().describe('Project UUID') },
      async ({ project_uuid }) => wrapHandler(() => this.client.restartProjectApps(project_uuid)),
    );

    this.tool(
      'bulk_env_update',
      'Update or create an environment variable across multiple applications (upsert behavior). Returns summary of succeeded/failed updates.',
      {
        app_uuids: z.array(z.string()).describe('Array of application UUIDs'),
        key: z.string().describe('Environment variable key'),
        value: z.string().describe('Environment variable value'),
        is_build_time: z.boolean().optional().describe('Build-time variable (default: false)'),
      },
      async ({ app_uuids, key, value, is_build_time }) =>
        wrapHandler(() => this.client.bulkEnvUpdate(app_uuids, key, value, is_build_time)),
    );

    this.tool(
      'stop_all_apps',
      'EMERGENCY: Stop ALL running applications across entire infrastructure. Only stops apps that are currently running or healthy. Use with caution!',
      {
        confirm: z.literal(true).describe('Must be true to confirm this dangerous operation'),
      },
      async ({ confirm }) => {
        if (!confirm) {
          return {
            content: [
              { type: 'text' as const, text: 'Error: Must set confirm=true to stop all apps' },
            ],
          };
        }
        return wrapHandler(() => this.client.stopAllApps());
      },
    );

    this.tool(
      'redeploy_project',
      'Redeploy all applications in a project with force rebuild. Returns summary of succeeded/failed deployments.',
      {
        project_uuid: z.string().describe('Project UUID'),
        force: z.boolean().optional().describe('Force rebuild (default: true)'),
      },
      async ({ project_uuid, force }) =>
        wrapHandler(() => this.client.redeployProjectApps(project_uuid, force ?? true)),
    );
  }

  // ===========================================================================
  // Prompt Templates - Guided Workflows
  // ===========================================================================
  private registerPrompts(): void {
    // -------------------------------------------------------------------------
    // debug-app: Comprehensive application debugging workflow
    // -------------------------------------------------------------------------
    this.prompt(
      'debug-app',
      'Debug an application - gathers status, logs, env vars, and recent deployments to diagnose issues',
      {
        query: z
          .string()
          .describe(
            'Application identifier: UUID, name, or domain (e.g., "my-app" or "example.com")',
          ),
      },
      async ({ query }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I need help debugging my Coolify application "${query}". Please:

1. First, use the diagnose_app tool with query="${query}" to get comprehensive diagnostics
2. Analyze the results and identify:
   - Current health status and any issues
   - Recent deployment failures or errors in logs
   - Missing or misconfigured environment variables
   - Any patterns suggesting the root cause
3. Provide a clear diagnosis with:
   - What's wrong (if anything)
   - Likely root cause
   - Recommended fix steps
4. If the app seems healthy, confirm this and suggest any optimizations

Start by running diagnose_app now.`,
              },
            },
          ],
        };
      },
    );

    // -------------------------------------------------------------------------
    // health-check: Full infrastructure health analysis
    // -------------------------------------------------------------------------
    this.prompt(
      'health-check',
      'Perform a comprehensive health check of your entire Coolify infrastructure',
      {},
      async () => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please perform a comprehensive health check of my Coolify infrastructure:

1. Run find_issues to scan for problems across all servers, apps, databases, and services
2. Run get_infrastructure_overview to get the full picture
3. For any issues found, provide:
   - Severity (critical/warning/info)
   - Affected resource and current status
   - Recommended remediation steps
4. Summarize the overall health:
   - Total resources and their states
   - Any immediate actions needed
   - Preventive recommendations

Start by running find_issues now.`,
              },
            },
          ],
        };
      },
    );

    // -------------------------------------------------------------------------
    // deploy-app: Step-by-step deployment wizard
    // -------------------------------------------------------------------------
    this.prompt(
      'deploy-app',
      'Step-by-step wizard to deploy a new application from a Git repository',
      {
        repo: z.string().describe('Git repository URL or org/repo format'),
        branch: z.string().optional().describe('Branch to deploy (default: main)'),
      },
      async ({ repo, branch }) => {
        const branchName = branch || 'main';
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I want to deploy a new application from ${repo} (branch: ${branchName}). Please guide me through the process:

1. First, run list_projects to show available projects
2. Ask me which project to deploy to (or help create a new one)
3. Run list_servers to show available servers
4. Ask me which server to deploy on
5. Run list_private_keys to check available deploy keys
6. Based on the repository type:
   - If GitHub and we have a GitHub App configured, use create_application_private_gh
   - Otherwise, help set up a deploy key and use create_application_private_key
7. After creation, ask about:
   - Environment variables needed
   - Domain/FQDN configuration
   - Whether to deploy immediately

Start by showing me the available projects.`,
              },
            },
          ],
        };
      },
    );

    // -------------------------------------------------------------------------
    // troubleshoot-ssl: SSL certificate diagnosis workflow
    // -------------------------------------------------------------------------
    this.prompt(
      'troubleshoot-ssl',
      'Diagnose SSL/TLS certificate issues for a domain',
      {
        domain: z.string().describe('Domain having SSL issues (e.g., "example.com")'),
      },
      async ({ domain }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I'm having SSL/TLS certificate issues with the domain "${domain}". Please help me diagnose:

1. First, use diagnose_app with query="${domain}" to find the application
2. Check the application's FQDN configuration
3. Look for common SSL issues:
   - Is the domain correctly configured in the FQDN field?
   - Are there any proxy/redirect issues in the logs?
   - Is Let's Encrypt renewal working (check for ACME errors)?
4. Check the server's domain configuration using get_server_domains
5. Provide remediation steps:
   - If domain misconfiguration: show how to fix with update_application
   - If SSL renewal issue: suggest checking DNS and Traefik config
   - If proxy issue: suggest checking Traefik labels

Start by finding the application for this domain.`,
              },
            },
          ],
        };
      },
    );

    // -------------------------------------------------------------------------
    // restart-project: Safely restart all apps in a project
    // -------------------------------------------------------------------------
    this.prompt(
      'restart-project',
      'Safely restart all applications in a project with status monitoring',
      {
        project: z.string().describe('Project UUID or name'),
      },
      async ({ project }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `I need to restart all applications in the project "${project}". Please handle this safely:

1. First, run list_projects to find the project UUID (if a name was given)
2. Run get_project to confirm the project details and list its environments
3. Run list_applications to find all apps in this project
4. Show me a summary of what will be restarted:
   - List each application with current status
   - Warn about any that are already unhealthy
5. Ask for my confirmation before proceeding
6. If confirmed, run restart_project_apps with the project UUID
7. After restart, check the results and report:
   - Which apps restarted successfully
   - Any failures and why
   - Current status of each app

Start by finding the project.`,
              },
            },
          ],
        };
      },
    );

    // -------------------------------------------------------------------------
    // env-audit: Audit environment variables across apps
    // -------------------------------------------------------------------------
    this.prompt(
      'env-audit',
      'Audit and compare environment variables across applications',
      {
        apps: z
          .string()
          .optional()
          .describe('Comma-separated app names/UUIDs to audit (optional, defaults to all)'),
        key: z.string().optional().describe('Specific env var key to check across apps'),
      },
      async ({ apps, key }) => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please audit environment variables across my applications${apps ? ` (${apps})` : ''}${key ? ` focusing on the "${key}" variable` : ''}:

1. Run list_applications to get the list of apps
2. For ${apps ? 'the specified apps' : 'each application'}, run list_application_envs
3. Analyze the environment variables:
   ${key ? `- Check if "${key}" is set consistently across all apps` : '- Identify common variables that differ between apps'}
   - Flag any sensitive-looking values that might be exposed
   - Identify missing variables that exist in some apps but not others
   - Check for any empty or placeholder values
4. Provide a summary:
   - Table showing variable presence across apps
   - Recommendations for standardization
   - Any security concerns

Start by listing the applications.`,
              },
            },
          ],
        };
      },
    );

    // -------------------------------------------------------------------------
    // backup-status: Check database backup status
    // -------------------------------------------------------------------------
    this.prompt(
      'backup-status',
      'Check backup status and history for all databases',
      {},
      async () => {
        return {
          messages: [
            {
              role: 'user',
              content: {
                type: 'text',
                text: `Please check the backup status of all my databases:

1. Run list_databases to get all databases
2. For each database, run list_database_backups to check scheduled backups
3. For databases with backups configured, run list_backup_executions to check recent history
4. Report:
   - Databases WITHOUT any backup schedules (critical!)
   - Last successful backup for each database
   - Any failed backups in the last 7 days
   - Backup frequency and retention settings
5. Provide recommendations:
   - Which databases need backup configuration
   - Any backup schedules that seem too infrequent
   - Storage concerns if backups are piling up

Start by listing all databases.`,
              },
            },
          ],
        };
      },
    );
  }
}
