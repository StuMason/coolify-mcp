/**
 * Coolify MCP Server v2.1.0
 * Consolidated tools for efficient token usage
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

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

const VERSION = '2.1.0';

/** Wrap handler with error handling */
function wrap<T>(
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

export class CoolifyMcpServer extends McpServer {
  private readonly client: CoolifyClient;

  constructor(config: CoolifyConfig) {
    super({ name: 'coolify', version: VERSION });
    this.client = new CoolifyClient(config);
    this.registerTools();
  }

  async connect(transport: Transport): Promise<void> {
    await super.connect(transport);
  }

  private registerTools(): void {
    // =========================================================================
    // Meta (2 tools)
    // =========================================================================
    this.tool('get_version', 'Coolify API version', {}, async () =>
      wrap(() => this.client.getVersion()),
    );

    this.tool('get_mcp_version', 'MCP server version', {}, async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ version: VERSION, name: '@masonator/coolify-mcp' }),
        },
      ],
    }));

    // =========================================================================
    // Infrastructure Overview (1 tool)
    // =========================================================================
    this.tool(
      'get_infrastructure_overview',
      'Overview of all resources with counts',
      {},
      async () =>
        wrap(async () => {
          const results = await Promise.allSettled([
            this.client.listServers({ summary: true }),
            this.client.listProjects({ summary: true }),
            this.client.listApplications({ summary: true }),
            this.client.listDatabases({ summary: true }),
            this.client.listServices({ summary: true }),
          ]);
          const extract = <T>(r: PromiseSettledResult<T>): T | [] =>
            r.status === 'fulfilled' ? r.value : [];
          const [servers, projects, applications, databases, services] = [
            extract(results[0]) as ServerSummary[],
            extract(results[1]) as ProjectSummary[],
            extract(results[2]) as ApplicationSummary[],
            extract(results[3]) as DatabaseSummary[],
            extract(results[4]) as ServiceSummary[],
          ];
          const errors = results
            .map((r, i) =>
              r.status === 'rejected'
                ? `${['servers', 'projects', 'applications', 'databases', 'services'][i]}: ${r.reason}`
                : null,
            )
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
    // Diagnostics (3 tools)
    // =========================================================================
    this.tool(
      'diagnose_app',
      'App diagnostics by UUID/name/domain',
      { query: z.string() },
      async ({ query }) => wrap(() => this.client.diagnoseApplication(query)),
    );

    this.tool(
      'diagnose_server',
      'Server diagnostics by UUID/name/IP',
      { query: z.string() },
      async ({ query }) => wrap(() => this.client.diagnoseServer(query)),
    );

    this.tool('find_issues', 'Scan infrastructure for problems', {}, async () =>
      wrap(() => this.client.findInfrastructureIssues()),
    );

    // =========================================================================
    // Servers (5 tools)
    // =========================================================================
    this.tool(
      'list_servers',
      'List servers (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listServers({ page, per_page, summary: true })),
    );

    this.tool('get_server', 'Server details', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getServer(uuid)),
    );

    this.tool('server_resources', 'Resources on server', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getServerResources(uuid)),
    );

    this.tool('server_domains', 'Domains on server', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getServerDomains(uuid)),
    );

    this.tool(
      'validate_server',
      'Validate server connection',
      { uuid: z.string() },
      async ({ uuid }) => wrap(() => this.client.validateServer(uuid)),
    );

    // =========================================================================
    // Projects (1 tool - consolidated CRUD)
    // =========================================================================
    this.tool(
      'projects',
      'Manage projects: list/get/create/update/delete',
      {
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        uuid: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        page: z.number().optional(),
        per_page: z.number().optional(),
      },
      async ({ action, uuid, name, description, page, per_page }) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listProjects({ page, per_page, summary: true }));
          case 'get':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.getProject(uuid));
          case 'create':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            return wrap(() => this.client.createProject({ name, description }));
          case 'update':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.updateProject(uuid, { name, description }));
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.deleteProject(uuid));
        }
      },
    );

    // =========================================================================
    // Environments (1 tool - consolidated CRUD)
    // =========================================================================
    this.tool(
      'environments',
      'Manage environments: list/get/create/delete',
      {
        action: z.enum(['list', 'get', 'create', 'delete']),
        project_uuid: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ action, project_uuid, name, description }) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listProjectEnvironments(project_uuid));
          case 'get':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            return wrap(() => this.client.getProjectEnvironment(project_uuid, name));
          case 'create':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            return wrap(() =>
              this.client.createProjectEnvironment(project_uuid, { name, description }),
            );
          case 'delete':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            return wrap(() => this.client.deleteProjectEnvironment(project_uuid, name));
        }
      },
    );

    // =========================================================================
    // Applications (4 tools)
    // =========================================================================
    this.tool(
      'list_applications',
      'List apps (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listApplications({ page, per_page, summary: true })),
    );

    this.tool('get_application', 'App details', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getApplication(uuid)),
    );

    this.tool(
      'application',
      'Manage app: create/update/delete',
      {
        action: z.enum(['create_github', 'create_key', 'update', 'delete']),
        uuid: z.string().optional(),
        // Create fields
        project_uuid: z.string().optional(),
        server_uuid: z.string().optional(),
        github_app_uuid: z.string().optional(),
        private_key_uuid: z.string().optional(),
        git_repository: z.string().optional(),
        git_branch: z.string().optional(),
        environment_name: z.string().optional(),
        build_pack: z.string().optional(),
        ports_exposes: z.string().optional(),
        // Update fields
        name: z.string().optional(),
        description: z.string().optional(),
        fqdn: z.string().optional(),
        // Delete fields
        delete_volumes: z.boolean().optional(),
      },
      async (args) => {
        const { action, uuid } = args;
        switch (action) {
          case 'create_github':
            if (
              !args.project_uuid ||
              !args.server_uuid ||
              !args.github_app_uuid ||
              !args.git_repository ||
              !args.git_branch
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: project_uuid, server_uuid, github_app_uuid, git_repository, git_branch required',
                  },
                ],
              };
            }
            return wrap(() => this.client.createApplicationPrivateGH(args as any));
          case 'create_key':
            if (
              !args.project_uuid ||
              !args.server_uuid ||
              !args.private_key_uuid ||
              !args.git_repository ||
              !args.git_branch
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: project_uuid, server_uuid, private_key_uuid, git_repository, git_branch required',
                  },
                ],
              };
            }
            return wrap(() => this.client.createApplicationPrivateKey(args as any));
          case 'update':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.updateApplication(uuid, args));
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() =>
              this.client.deleteApplication(uuid, { deleteVolumes: args.delete_volumes }),
            );
        }
      },
    );

    this.tool(
      'application_logs',
      'Get app logs',
      { uuid: z.string(), lines: z.number().optional() },
      async ({ uuid, lines }) => wrap(() => this.client.getApplicationLogs(uuid, lines)),
    );

    // =========================================================================
    // Databases (3 tools)
    // =========================================================================
    this.tool(
      'list_databases',
      'List databases (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listDatabases({ page, per_page, summary: true })),
    );

    this.tool('get_database', 'Database details', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getDatabase(uuid)),
    );

    this.tool(
      'database',
      'Manage database: create/delete',
      {
        action: z.enum(['create', 'delete']),
        type: z
          .enum([
            'postgresql',
            'mysql',
            'mariadb',
            'mongodb',
            'redis',
            'keydb',
            'clickhouse',
            'dragonfly',
          ])
          .optional(),
        uuid: z.string().optional(),
        server_uuid: z.string().optional(),
        project_uuid: z.string().optional(),
        environment_name: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
        is_public: z.boolean().optional(),
        public_port: z.number().optional(),
        instant_deploy: z.boolean().optional(),
        delete_volumes: z.boolean().optional(),
        // DB-specific optional fields
        postgres_user: z.string().optional(),
        postgres_password: z.string().optional(),
        postgres_db: z.string().optional(),
        mysql_root_password: z.string().optional(),
        mysql_user: z.string().optional(),
        mysql_password: z.string().optional(),
        mysql_database: z.string().optional(),
        mariadb_root_password: z.string().optional(),
        mariadb_user: z.string().optional(),
        mariadb_password: z.string().optional(),
        mariadb_database: z.string().optional(),
        mongo_initdb_root_username: z.string().optional(),
        mongo_initdb_root_password: z.string().optional(),
        mongo_initdb_database: z.string().optional(),
        redis_password: z.string().optional(),
        keydb_password: z.string().optional(),
        clickhouse_admin_user: z.string().optional(),
        clickhouse_admin_password: z.string().optional(),
        dragonfly_password: z.string().optional(),
      },
      async (args) => {
        const { action, type, uuid, delete_volumes, ...dbData } = args;
        if (action === 'delete') {
          if (!uuid) return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
          return wrap(() => this.client.deleteDatabase(uuid, { deleteVolumes: delete_volumes }));
        }
        // create
        if (!type || !args.server_uuid || !args.project_uuid) {
          return {
            content: [
              { type: 'text' as const, text: 'Error: type, server_uuid, project_uuid required' },
            ],
          };
        }
        const dbMethods: Record<string, (data: any) => Promise<any>> = {
          postgresql: (d) => this.client.createPostgresql(d),
          mysql: (d) => this.client.createMysql(d),
          mariadb: (d) => this.client.createMariadb(d),
          mongodb: (d) => this.client.createMongodb(d),
          redis: (d) => this.client.createRedis(d),
          keydb: (d) => this.client.createKeydb(d),
          clickhouse: (d) => this.client.createClickhouse(d),
          dragonfly: (d) => this.client.createDragonfly(d),
        };
        return wrap(() => dbMethods[type](dbData));
      },
    );

    // =========================================================================
    // Services (3 tools)
    // =========================================================================
    this.tool(
      'list_services',
      'List services (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listServices({ page, per_page, summary: true })),
    );

    this.tool('get_service', 'Service details', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getService(uuid)),
    );

    this.tool(
      'service',
      'Manage service: create/update/delete',
      {
        action: z.enum(['create', 'update', 'delete']),
        uuid: z.string().optional(),
        type: z.string().optional(),
        server_uuid: z.string().optional(),
        project_uuid: z.string().optional(),
        environment_name: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        instant_deploy: z.boolean().optional(),
        docker_compose_raw: z.string().optional(),
        delete_volumes: z.boolean().optional(),
      },
      async (args) => {
        const { action, uuid } = args;
        switch (action) {
          case 'create':
            if (!args.server_uuid || !args.project_uuid) {
              return {
                content: [
                  { type: 'text' as const, text: 'Error: server_uuid, project_uuid required' },
                ],
              };
            }
            return wrap(() => this.client.createService(args as any));
          case 'update':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.updateService(uuid, args));
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() =>
              this.client.deleteService(uuid, { deleteVolumes: args.delete_volumes }),
            );
        }
      },
    );

    // =========================================================================
    // Resource Control (1 tool - start/stop/restart for all types)
    // =========================================================================
    this.tool(
      'control',
      'Start/stop/restart app, database, or service',
      {
        resource: z.enum(['application', 'database', 'service']),
        action: z.enum(['start', 'stop', 'restart']),
        uuid: z.string(),
      },
      async ({ resource, action, uuid }) => {
        const methods: Record<string, Record<string, (u: string) => Promise<any>>> = {
          application: {
            start: (u) => this.client.startApplication(u),
            stop: (u) => this.client.stopApplication(u),
            restart: (u) => this.client.restartApplication(u),
          },
          database: {
            start: (u) => this.client.startDatabase(u),
            stop: (u) => this.client.stopDatabase(u),
            restart: (u) => this.client.restartDatabase(u),
          },
          service: {
            start: (u) => this.client.startService(u),
            stop: (u) => this.client.stopService(u),
            restart: (u) => this.client.restartService(u),
          },
        };
        return wrap(() => methods[resource][action](uuid));
      },
    );

    // =========================================================================
    // Environment Variables (1 tool - consolidated)
    // =========================================================================
    this.tool(
      'env_vars',
      'Manage env vars for app or service',
      {
        resource: z.enum(['application', 'service']),
        action: z.enum(['list', 'create', 'update', 'delete']),
        uuid: z.string(),
        key: z.string().optional(),
        value: z.string().optional(),
        env_uuid: z.string().optional(),
        is_build_time: z.boolean().optional(),
      },
      async ({ resource, action, uuid, key, value, env_uuid, is_build_time }) => {
        if (resource === 'application') {
          switch (action) {
            case 'list':
              return wrap(() => this.client.listApplicationEnvVars(uuid, { summary: true }));
            case 'create':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() =>
                this.client.createApplicationEnvVar(uuid, { key, value, is_build_time }),
              );
            case 'update':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() => this.client.updateApplicationEnvVar(uuid, { key, value }));
            case 'delete':
              if (!env_uuid)
                return { content: [{ type: 'text' as const, text: 'Error: env_uuid required' }] };
              return wrap(() => this.client.deleteApplicationEnvVar(uuid, env_uuid));
          }
        } else {
          switch (action) {
            case 'list':
              return wrap(() => this.client.listServiceEnvVars(uuid));
            case 'create':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() => this.client.createServiceEnvVar(uuid, { key, value }));
            case 'update':
              return {
                content: [
                  { type: 'text' as const, text: 'Error: service env update not supported' },
                ],
              };
            case 'delete':
              if (!env_uuid)
                return { content: [{ type: 'text' as const, text: 'Error: env_uuid required' }] };
              return wrap(() => this.client.deleteServiceEnvVar(uuid, env_uuid));
          }
        }
      },
    );

    // =========================================================================
    // Deployments (3 tools)
    // =========================================================================
    this.tool(
      'list_deployments',
      'List deployments (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listDeployments({ page, per_page, summary: true })),
    );

    this.tool(
      'deploy',
      'Deploy by tag/UUID',
      { tag_or_uuid: z.string(), force: z.boolean().optional() },
      async ({ tag_or_uuid, force }) =>
        wrap(() => this.client.deployByTagOrUuid(tag_or_uuid, force)),
    );

    this.tool(
      'deployment',
      'Manage deployment: get/cancel/list_for_app',
      {
        action: z.enum(['get', 'cancel', 'list_for_app']),
        uuid: z.string(),
      },
      async ({ action, uuid }) => {
        switch (action) {
          case 'get':
            return wrap(() => this.client.getDeployment(uuid));
          case 'cancel':
            return wrap(() => this.client.cancelDeployment(uuid));
          case 'list_for_app':
            return wrap(() => this.client.listApplicationDeployments(uuid));
        }
      },
    );

    // =========================================================================
    // Private Keys (1 tool - consolidated)
    // =========================================================================
    this.tool(
      'private_keys',
      'Manage SSH keys: list/get/create/update/delete',
      {
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        uuid: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        private_key: z.string().optional(),
      },
      async ({ action, uuid, name, description, private_key }) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listPrivateKeys());
          case 'get':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.getPrivateKey(uuid));
          case 'create':
            if (!private_key)
              return { content: [{ type: 'text' as const, text: 'Error: private_key required' }] };
            return wrap(() =>
              this.client.createPrivateKey({
                private_key,
                name: name || 'unnamed-key',
                description,
              }),
            );
          case 'update':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() =>
              this.client.updatePrivateKey(uuid, { name, description, private_key }),
            );
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.deletePrivateKey(uuid));
        }
      },
    );

    // =========================================================================
    // Database Backups (1 tool - consolidated)
    // =========================================================================
    this.tool(
      'database_backups',
      'Manage backups: list_schedules/get_schedule/list_executions/get_execution/create/update/delete',
      {
        action: z.enum([
          'list_schedules',
          'get_schedule',
          'list_executions',
          'get_execution',
          'create',
          'update',
          'delete',
        ]),
        database_uuid: z.string(),
        backup_uuid: z.string().optional(),
        execution_uuid: z.string().optional(),
        // Backup configuration parameters
        frequency: z.string().optional(),
        enabled: z.boolean().optional(),
        save_s3: z.boolean().optional(),
        s3_storage_uuid: z.string().optional(),
        databases_to_backup: z.string().optional(),
        dump_all: z.boolean().optional(),
        database_backup_retention_days_locally: z.number().optional(),
        database_backup_retention_days_s3: z.number().optional(),
        database_backup_retention_amount_locally: z.number().optional(),
        database_backup_retention_amount_s3: z.number().optional(),
      },
      async (args) => {
        const { action, database_uuid, backup_uuid, execution_uuid, ...backupData } = args;
        switch (action) {
          case 'list_schedules':
            return wrap(() => this.client.listDatabaseBackups(database_uuid));
          case 'get_schedule':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() => this.client.getDatabaseBackup(database_uuid, backup_uuid));
          case 'list_executions':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() => this.client.listBackupExecutions(database_uuid, backup_uuid));
          case 'get_execution':
            if (!backup_uuid || !execution_uuid)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: backup_uuid, execution_uuid required' },
                ],
              };
            return wrap(() =>
              this.client.getBackupExecution(database_uuid, backup_uuid, execution_uuid),
            );
          case 'create':
            if (!args.frequency)
              return { content: [{ type: 'text' as const, text: 'Error: frequency required' }] };
            return wrap(() =>
              this.client.createDatabaseBackup(database_uuid, {
                ...backupData,
                frequency: args.frequency!,
              }),
            );
          case 'update':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() =>
              this.client.updateDatabaseBackup(database_uuid, backup_uuid, backupData),
            );
          case 'delete':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() => this.client.deleteDatabaseBackup(database_uuid, backup_uuid));
        }
      },
    );

    // =========================================================================
    // Batch Operations (4 tools)
    // =========================================================================
    this.tool(
      'restart_project_apps',
      'Restart all apps in project',
      { project_uuid: z.string() },
      async ({ project_uuid }) => wrap(() => this.client.restartProjectApps(project_uuid)),
    );

    this.tool(
      'bulk_env_update',
      'Update env var across multiple apps',
      {
        app_uuids: z.array(z.string()),
        key: z.string(),
        value: z.string(),
        is_build_time: z.boolean().optional(),
      },
      async ({ app_uuids, key, value, is_build_time }) =>
        wrap(() => this.client.bulkEnvUpdate(app_uuids, key, value, is_build_time)),
    );

    this.tool(
      'stop_all_apps',
      'EMERGENCY: Stop all running apps',
      { confirm: z.literal(true) },
      async ({ confirm }) => {
        if (!confirm)
          return { content: [{ type: 'text' as const, text: 'Error: confirm=true required' }] };
        return wrap(() => this.client.stopAllApps());
      },
    );

    this.tool(
      'redeploy_project',
      'Redeploy all apps in project',
      { project_uuid: z.string(), force: z.boolean().optional() },
      async ({ project_uuid, force }) =>
        wrap(() => this.client.redeployProjectApps(project_uuid, force ?? true)),
    );
  }
}
