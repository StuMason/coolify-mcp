/**
 * MCP Server Tests v2.0.0
 *
 * Tests for the consolidated MCP tool layer.
 * CoolifyClient methods are fully tested in coolify-client.test.ts (174 tests).
 * These tests verify MCP server instantiation and structure.
 */
import { createRequire } from 'module';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  CoolifyMcpServer,
  VERSION,
  truncateLogs,
  getApplicationActions,
  getDeploymentActions,
  getPagination,
} from '../lib/mcp-server.js';

describe('CoolifyMcpServer v2', () => {
  let server: CoolifyMcpServer;

  beforeEach(() => {
    server = new CoolifyMcpServer({
      baseUrl: 'http://localhost:3000',
      accessToken: 'test-token',
    });
  });

  describe('constructor', () => {
    it('should create server instance', () => {
      expect(server).toBeInstanceOf(CoolifyMcpServer);
    });

    it('should be an MCP server with connect method', () => {
      expect(typeof server.connect).toBe('function');
    });

    it('should report version matching package.json', () => {
      const _require = createRequire(import.meta.url);
      const { version } = _require('../../package.json');
      expect(VERSION).toBe(version);
    });
  });

  describe('client', () => {
    it('should have client instance', () => {
      const client = server['client'];
      expect(client).toBeDefined();
    });

    it('should have all required client methods', () => {
      const client = server['client'];

      // Core methods
      expect(typeof client.getVersion).toBe('function');

      // Server operations
      expect(typeof client.listServers).toBe('function');
      expect(typeof client.getServer).toBe('function');
      expect(typeof client.getServerResources).toBe('function');
      expect(typeof client.getServerDomains).toBe('function');
      expect(typeof client.validateServer).toBe('function');

      // Project operations
      expect(typeof client.listProjects).toBe('function');
      expect(typeof client.getProject).toBe('function');
      expect(typeof client.createProject).toBe('function');
      expect(typeof client.updateProject).toBe('function');
      expect(typeof client.deleteProject).toBe('function');

      // Environment operations
      expect(typeof client.listProjectEnvironments).toBe('function');
      expect(typeof client.getProjectEnvironment).toBe('function');
      expect(typeof client.getProjectEnvironmentWithDatabases).toBe('function');
      expect(typeof client.createProjectEnvironment).toBe('function');
      expect(typeof client.deleteProjectEnvironment).toBe('function');

      // Application operations
      expect(typeof client.listApplications).toBe('function');
      expect(typeof client.getApplication).toBe('function');
      expect(typeof client.createApplicationPublic).toBe('function');
      expect(typeof client.createApplicationPrivateGH).toBe('function');
      expect(typeof client.createApplicationPrivateKey).toBe('function');
      expect(typeof client.createApplicationDockerImage).toBe('function');
      expect(typeof client.updateApplication).toBe('function');
      expect(typeof client.deleteApplication).toBe('function');
      expect(typeof client.getApplicationLogs).toBe('function');

      // Control operations
      expect(typeof client.startApplication).toBe('function');
      expect(typeof client.stopApplication).toBe('function');
      expect(typeof client.restartApplication).toBe('function');
      expect(typeof client.startDatabase).toBe('function');
      expect(typeof client.stopDatabase).toBe('function');
      expect(typeof client.restartDatabase).toBe('function');
      expect(typeof client.startService).toBe('function');
      expect(typeof client.stopService).toBe('function');
      expect(typeof client.restartService).toBe('function');

      // Database operations
      expect(typeof client.listDatabases).toBe('function');
      expect(typeof client.getDatabase).toBe('function');
      expect(typeof client.deleteDatabase).toBe('function');
      expect(typeof client.createPostgresql).toBe('function');
      expect(typeof client.createMysql).toBe('function');
      expect(typeof client.createMariadb).toBe('function');
      expect(typeof client.createMongodb).toBe('function');
      expect(typeof client.createRedis).toBe('function');
      expect(typeof client.createKeydb).toBe('function');
      expect(typeof client.createClickhouse).toBe('function');
      expect(typeof client.createDragonfly).toBe('function');

      // Service operations
      expect(typeof client.listServices).toBe('function');
      expect(typeof client.getService).toBe('function');
      expect(typeof client.createService).toBe('function');
      expect(typeof client.updateService).toBe('function');
      expect(typeof client.deleteService).toBe('function');

      // Environment variable operations
      expect(typeof client.listApplicationEnvVars).toBe('function');
      expect(typeof client.createApplicationEnvVar).toBe('function');
      expect(typeof client.updateApplicationEnvVar).toBe('function');
      expect(typeof client.deleteApplicationEnvVar).toBe('function');
      expect(typeof client.listServiceEnvVars).toBe('function');
      expect(typeof client.createServiceEnvVar).toBe('function');
      expect(typeof client.deleteServiceEnvVar).toBe('function');

      // Deployment operations
      expect(typeof client.listDeployments).toBe('function');
      expect(typeof client.getDeployment).toBe('function');
      expect(typeof client.deployByTagOrUuid).toBe('function');
      expect(typeof client.listApplicationDeployments).toBe('function');
      expect(typeof client.cancelDeployment).toBe('function');

      // Private key operations
      expect(typeof client.listPrivateKeys).toBe('function');
      expect(typeof client.getPrivateKey).toBe('function');
      expect(typeof client.createPrivateKey).toBe('function');
      expect(typeof client.updatePrivateKey).toBe('function');
      expect(typeof client.deletePrivateKey).toBe('function');

      // GitHub App operations
      expect(typeof client.listGitHubApps).toBe('function');
      expect(typeof client.createGitHubApp).toBe('function');
      expect(typeof client.updateGitHubApp).toBe('function');
      expect(typeof client.deleteGitHubApp).toBe('function');

      // Backup operations
      expect(typeof client.listDatabaseBackups).toBe('function');
      expect(typeof client.getDatabaseBackup).toBe('function');
      expect(typeof client.createDatabaseBackup).toBe('function');
      expect(typeof client.updateDatabaseBackup).toBe('function');
      expect(typeof client.deleteDatabaseBackup).toBe('function');
      expect(typeof client.listBackupExecutions).toBe('function');
      expect(typeof client.getBackupExecution).toBe('function');

      // Diagnostic operations
      expect(typeof client.diagnoseApplication).toBe('function');
      expect(typeof client.diagnoseServer).toBe('function');
      expect(typeof client.findInfrastructureIssues).toBe('function');

      // Batch operations
      expect(typeof client.restartProjectApps).toBe('function');
      expect(typeof client.bulkEnvUpdate).toBe('function');
      expect(typeof client.stopAllApps).toBe('function');
      expect(typeof client.redeployProjectApps).toBe('function');

      // Team operations
      expect(typeof client.listTeams).toBe('function');
      expect(typeof client.getTeam).toBe('function');
      expect(typeof client.getTeamMembers).toBe('function');
      expect(typeof client.getCurrentTeam).toBe('function');
      expect(typeof client.getCurrentTeamMembers).toBe('function');

      // Cloud token operations
      expect(typeof client.listCloudTokens).toBe('function');
      expect(typeof client.getCloudToken).toBe('function');
      expect(typeof client.createCloudToken).toBe('function');
      expect(typeof client.updateCloudToken).toBe('function');
      expect(typeof client.deleteCloudToken).toBe('function');
      expect(typeof client.validateCloudToken).toBe('function');

      // Application storage operations
      expect(typeof client.listApplicationStorages).toBe('function');
      expect(typeof client.createApplicationStorage).toBe('function');
      expect(typeof client.updateApplicationStorage).toBe('function');
      expect(typeof client.deleteApplicationStorage).toBe('function');

      // Application scheduled task operations
      expect(typeof client.listApplicationScheduledTasks).toBe('function');
      expect(typeof client.createApplicationScheduledTask).toBe('function');
      expect(typeof client.updateApplicationScheduledTask).toBe('function');
      expect(typeof client.deleteApplicationScheduledTask).toBe('function');
      expect(typeof client.listApplicationScheduledTaskExecutions).toBe('function');

      // Application preview operations
      expect(typeof client.deleteApplicationPreview).toBe('function');

      // Database environment variable operations
      expect(typeof client.listDatabaseEnvVars).toBe('function');
      expect(typeof client.createDatabaseEnvVar).toBe('function');
      expect(typeof client.updateDatabaseEnvVar).toBe('function');
      expect(typeof client.bulkUpdateDatabaseEnvVars).toBe('function');
      expect(typeof client.deleteDatabaseEnvVar).toBe('function');

      // Database storage operations
      expect(typeof client.listDatabaseStorages).toBe('function');
      expect(typeof client.createDatabaseStorage).toBe('function');
      expect(typeof client.updateDatabaseStorage).toBe('function');
      expect(typeof client.deleteDatabaseStorage).toBe('function');

      // Delete backup execution
      expect(typeof client.deleteBackupExecution).toBe('function');

      // Service env var bulk operations
      expect(typeof client.bulkUpdateServiceEnvVars).toBe('function');

      // Service storage operations
      expect(typeof client.listServiceStorages).toBe('function');
      expect(typeof client.createServiceStorage).toBe('function');
      expect(typeof client.updateServiceStorage).toBe('function');
      expect(typeof client.deleteServiceStorage).toBe('function');

      // Service scheduled task operations
      expect(typeof client.listServiceScheduledTasks).toBe('function');
      expect(typeof client.createServiceScheduledTask).toBe('function');
      expect(typeof client.updateServiceScheduledTask).toBe('function');
      expect(typeof client.deleteServiceScheduledTask).toBe('function');
      expect(typeof client.listServiceScheduledTaskExecutions).toBe('function');

      // Hetzner cloud operations
      expect(typeof client.listHetznerLocations).toBe('function');
      expect(typeof client.listHetznerServerTypes).toBe('function');
      expect(typeof client.listHetznerImages).toBe('function');
      expect(typeof client.listHetznerSSHKeys).toBe('function');
      expect(typeof client.createHetznerServer).toBe('function');

      // GitHub App repository operations
      expect(typeof client.listGitHubAppRepositories).toBe('function');
      expect(typeof client.listGitHubAppBranches).toBe('function');

      // Resources operations
      expect(typeof client.listResources).toBe('function');

      // Health operations
      expect(typeof client.getHealth).toBe('function');

      // API enable/disable operations
      expect(typeof client.enableApi).toBe('function');
      expect(typeof client.disableApi).toBe('function');

      // Version caching
      expect(typeof client.getCachedVersion).toBe('function');
    });
  });

  describe('server configuration', () => {
    it('should store baseUrl and accessToken in client', () => {
      const client = server['client'];
      // CoolifyClient stores base URL without /api/v1 suffix
      expect(client['baseUrl']).toBe('http://localhost:3000');
      expect(client['accessToken']).toBe('test-token');
    });
  });

  describe('env_vars tool handler', () => {
    // Reach the SDK-registered handler so the is_buildtime / is_runtime
    // passthrough lines are actually executed (not just type-checked).
    const callEnvVars = async (
      srv: CoolifyMcpServer,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      const tool = (
        srv as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }
          >;
        }
      )._registeredTools['env_vars'];
      return tool.handler(args, {});
    };

    it('forwards is_buildtime/is_runtime to createApplicationEnvVar', async () => {
      const spy = jest
        .spyOn(server['client'], 'createApplicationEnvVar')
        .mockResolvedValue({ uuid: 'env-1' });

      await callEnvVars(server, {
        resource: 'application',
        action: 'create',
        uuid: 'app-uuid',
        key: 'PEM_KEY',
        value: '-----BEGIN-----',
        is_buildtime: false,
        is_runtime: true,
      });

      expect(spy).toHaveBeenCalledWith('app-uuid', {
        key: 'PEM_KEY',
        value: '-----BEGIN-----',
        is_buildtime: false,
        is_runtime: true,
      });
    });

    it('forwards is_buildtime/is_runtime to updateApplicationEnvVar', async () => {
      const spy = jest
        .spyOn(server['client'], 'updateApplicationEnvVar')
        .mockResolvedValue({ message: 'Updated' });

      await callEnvVars(server, {
        resource: 'application',
        action: 'update',
        uuid: 'app-uuid',
        key: 'NODE_ENV',
        value: 'production',
        is_buildtime: false,
        is_runtime: true,
      });

      expect(spy).toHaveBeenCalledWith('app-uuid', {
        key: 'NODE_ENV',
        value: 'production',
        is_buildtime: false,
        is_runtime: true,
      });
    });

    it('forwards is_buildtime/is_runtime to createServiceEnvVar', async () => {
      const spy = jest
        .spyOn(server['client'], 'createServiceEnvVar')
        .mockResolvedValue({ uuid: 'env-1' });

      await callEnvVars(server, {
        resource: 'service',
        action: 'create',
        uuid: 'svc-uuid',
        key: 'API_KEY',
        value: 'secret',
        is_buildtime: true,
        is_runtime: undefined,
      });

      expect(spy).toHaveBeenCalledWith('svc-uuid', {
        key: 'API_KEY',
        value: 'secret',
        is_buildtime: true,
        is_runtime: undefined,
      });
    });

    it('returns key/value error when create is missing required fields', async () => {
      const result = (await callEnvVars(server, {
        resource: 'application',
        action: 'create',
        uuid: 'app-uuid',
      })) as { content: Array<{ text: string }> };
      expect(result.content[0].text).toContain('key, value required');
    });

    it('returns key/value error when service create is missing required fields', async () => {
      const result = (await callEnvVars(server, {
        resource: 'service',
        action: 'create',
        uuid: 'svc-uuid',
      })) as { content: Array<{ text: string }> };
      expect(result.content[0].text).toContain('key, value required');
    });
  });

  describe('system tool handler', () => {
    const callSystem = async (
      srv: CoolifyMcpServer,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      const tool = (
        srv as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }
          >;
        }
      )._registeredTools['system'];
      return tool.handler(args, {});
    };

    it('forwards include_full and reveal to listResources', async () => {
      const spy = jest.spyOn(server['client'], 'listResources').mockResolvedValue([]);
      await callSystem(server, { action: 'list_resources', include_full: true, reveal: true });
      expect(spy).toHaveBeenCalledWith({ include_full: true, reveal: true });
    });

    it('calls listResources with undefined flags when neither is passed', async () => {
      const spy = jest.spyOn(server['client'], 'listResources').mockResolvedValue([]);
      await callSystem(server, { action: 'list_resources' });
      expect(spy).toHaveBeenCalledWith({ include_full: undefined, reveal: undefined });
    });
  });

  describe('bulk_env_update tool handler', () => {
    it('forwards is_buildtime/is_runtime to bulkEnvUpdate', async () => {
      const spy = jest.spyOn(server['client'], 'bulkEnvUpdate').mockResolvedValue({
        summary: { total: 2, succeeded: 2, failed: 0 },
        succeeded: [],
        failed: [],
      });

      const tool = (
        server as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }
          >;
        }
      )._registeredTools['bulk_env_update'];
      await tool.handler(
        {
          app_uuids: ['app-1', 'app-2'],
          key: 'PEM_KEY',
          value: 'multiline',
          is_buildtime: false,
          is_runtime: true,
        },
        {},
      );

      expect(spy).toHaveBeenCalledWith(['app-1', 'app-2'], 'PEM_KEY', 'multiline', false, true);
    });
  });

  describe('application tool handler', () => {
    // Regression for #178 — verify the application tool's create_* hand-picks
    // forward build-config and health_check_* fields to the client. Previously
    // these fields were accepted by zod but silently dropped by the hand-pick.

    const callApplication = async (
      srv: CoolifyMcpServer,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      const tool = (
        srv as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }
          >;
        }
      )._registeredTools['application'];
      return tool.handler(args, {});
    };

    const baseCreatePublic = {
      action: 'create_public' as const,
      project_uuid: 'proj-uuid',
      server_uuid: 'server-uuid',
      git_repository: 'https://github.com/org/monorepo',
      git_branch: 'main',
      build_pack: 'dockerfile',
      ports_exposes: '3000',
    };

    it('forwards build-config and health_check fields in create_public', async () => {
      const spy = jest
        .spyOn(server['client'], 'createApplicationPublic')
        .mockResolvedValue({ uuid: 'app-1' });

      await callApplication(server, {
        ...baseCreatePublic,
        base_directory: '/apps/api',
        publish_directory: '/dist',
        install_command: 'pnpm install',
        build_command: 'pnpm build',
        start_command: 'node dist/main.js',
        dockerfile_location: '/apps/api/Dockerfile',
        watch_paths: 'apps/api/**',
        health_check_enabled: true,
        health_check_path: '/health',
        health_check_port: 3000,
        health_check_start_period: 60,
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          base_directory: '/apps/api',
          publish_directory: '/dist',
          install_command: 'pnpm install',
          build_command: 'pnpm build',
          start_command: 'node dist/main.js',
          dockerfile_location: '/apps/api/Dockerfile',
          watch_paths: 'apps/api/**',
          health_check_enabled: true,
          health_check_path: '/health',
          health_check_port: 3000,
          health_check_start_period: 60,
        }),
      );
    });

    it('forwards build-config and health_check fields in create_github', async () => {
      const spy = jest
        .spyOn(server['client'], 'createApplicationPrivateGH')
        .mockResolvedValue({ uuid: 'app-2' });

      await callApplication(server, {
        action: 'create_github',
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        github_app_uuid: 'gh-app-uuid',
        git_repository: 'org/monorepo',
        git_branch: 'main',
        base_directory: '/apps/api',
        dockerfile_location: '/apps/api/Dockerfile',
        watch_paths: 'apps/api/**',
        health_check_enabled: true,
        health_check_path: '/health',
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          base_directory: '/apps/api',
          dockerfile_location: '/apps/api/Dockerfile',
          watch_paths: 'apps/api/**',
          health_check_enabled: true,
          health_check_path: '/health',
        }),
      );
    });

    it('forwards build-config and health_check fields in create_key', async () => {
      const spy = jest
        .spyOn(server['client'], 'createApplicationPrivateKey')
        .mockResolvedValue({ uuid: 'app-3' });

      await callApplication(server, {
        action: 'create_key',
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        private_key_uuid: 'key-uuid',
        git_repository: 'git@github.com:org/monorepo.git',
        git_branch: 'main',
        base_directory: '/apps/api',
        publish_directory: '/dist',
        install_command: 'pnpm install',
        build_command: 'pnpm build',
        start_command: 'node dist/main.js',
        dockerfile_location: '/apps/api/Dockerfile',
        watch_paths: 'apps/api/**',
        health_check_enabled: true,
        health_check_path: '/health',
        health_check_port: 3000,
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          base_directory: '/apps/api',
          publish_directory: '/dist',
          install_command: 'pnpm install',
          build_command: 'pnpm build',
          start_command: 'node dist/main.js',
          dockerfile_location: '/apps/api/Dockerfile',
          watch_paths: 'apps/api/**',
          health_check_enabled: true,
          health_check_path: '/health',
          health_check_port: 3000,
        }),
      );
    });

    it('forwards health_check fields in create_dockerimage (build-config intentionally dropped)', async () => {
      const spy = jest
        .spyOn(server['client'], 'createApplicationDockerImage')
        .mockResolvedValue({ uuid: 'app-4' });

      // Caller passes both healthcheck AND build-config. Coolify's /applications/dockerimage
      // endpoint doesn't accept build-config (pre-built image), so handler must drop those.
      await callApplication(server, {
        action: 'create_dockerimage',
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        docker_registry_image_name: 'traefik/whoami',
        ports_exposes: '80',
        // Should be forwarded:
        health_check_enabled: true,
        health_check_path: '/health',
        health_check_port: 80,
        // Should NOT be forwarded (build-config not applicable to prebuilt image):
        base_directory: '/should-be-dropped',
        install_command: 'should-be-dropped',
        dockerfile_location: '/should-be-dropped',
      });

      const forwarded = spy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
      expect(forwarded).toEqual(
        expect.objectContaining({
          health_check_enabled: true,
          health_check_path: '/health',
          health_check_port: 80,
        }),
      );
      expect(forwarded).not.toHaveProperty('base_directory');
      expect(forwarded).not.toHaveProperty('install_command');
      expect(forwarded).not.toHaveProperty('dockerfile_location');
    });

    it('forwards dockerfile_target_build through update (PATCH-only)', async () => {
      const spy = jest.spyOn(server['client'], 'updateApplication').mockResolvedValue({} as never);

      await callApplication(server, {
        action: 'update',
        uuid: 'app-uuid',
        dockerfile_location: '/apps/api/Dockerfile',
        dockerfile_target_build: 'production',
        base_directory: '/apps/api',
      });

      expect(spy).toHaveBeenCalledWith(
        'app-uuid',
        expect.objectContaining({
          dockerfile_location: '/apps/api/Dockerfile',
          dockerfile_target_build: 'production',
          base_directory: '/apps/api',
        }),
      );
      // Confirm the update spread strips routing fields.
      const updateData = spy.mock.calls[0]?.[1] as unknown as Record<string, unknown>;
      expect(updateData).not.toHaveProperty('action');
      expect(updateData).not.toHaveProperty('uuid');
    });
  });

  describe('database tool handler', () => {
    // Regression for #217 — the database tool's create action didn't expose
    // destination_uuid, so Coolify rejected creates on servers with more than
    // one destination ("Server has multiple destinations. Please provide a
    // destination_uuid.").

    const callDatabase = async (
      srv: CoolifyMcpServer,
      args: Record<string, unknown>,
    ): Promise<unknown> => {
      const tool = (
        srv as unknown as {
          _registeredTools: Record<
            string,
            { handler: (args: Record<string, unknown>, extra: unknown) => Promise<unknown> }
          >;
        }
      )._registeredTools['database'];
      return tool.handler(args, {});
    };

    it('forwards destination_uuid to createPostgresql when provided', async () => {
      const spy = jest
        .spyOn(server['client'], 'createPostgresql')
        .mockResolvedValue({ uuid: 'db-1' });

      await callDatabase(server, {
        action: 'create',
        type: 'postgresql',
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        destination_uuid: 'dest-uuid',
      });

      expect(spy).toHaveBeenCalledWith(
        expect.objectContaining({
          destination_uuid: 'dest-uuid',
        }),
      );
    });

    it('omits destination_uuid from createPostgresql when not provided', async () => {
      const spy = jest
        .spyOn(server['client'], 'createPostgresql')
        .mockResolvedValue({ uuid: 'db-2' });

      await callDatabase(server, {
        action: 'create',
        type: 'postgresql',
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
      });

      const forwarded = spy.mock.calls[0]?.[0] as unknown as Record<string, unknown>;
      expect(forwarded.destination_uuid).toBeUndefined();
    });
  });
});

describe('truncateLogs', () => {
  // Plain text log tests
  it('should return logs unchanged when within limits', () => {
    const logs = 'line1\nline2\nline3';
    const result = truncateLogs(logs, 200, 50000);
    expect(result.logs).toBe(logs);
    expect(result.total).toBe(3);
  });

  it('should truncate to last N lines', () => {
    const logs = 'line1\nline2\nline3\nline4\nline5';
    const result = truncateLogs(logs, 3, 50000);
    expect(result.logs).toBe('line3\nline4\nline5');
    expect(result.total).toBe(5);
    expect(result.showing_start).toBe(3);
    expect(result.showing_end).toBe(5);
  });

  it('should truncate by character limit when lines are huge', () => {
    const hugeLine = 'x'.repeat(100);
    const logs = `${hugeLine}\n${hugeLine}\n${hugeLine}`;
    const result = truncateLogs(logs, 200, 50);
    expect(result.logs.length).toBeLessThanOrEqual(50);
    expect(result.logs.startsWith('...[truncated]...')).toBe(true);
  });

  it('should not add truncation prefix when under char limit', () => {
    const logs = 'line1\nline2\nline3';
    const result = truncateLogs(logs, 200, 50000);
    expect(result.logs.startsWith('...[truncated]...')).toBe(false);
  });

  it('should handle empty logs', () => {
    const result = truncateLogs('', 200, 50000);
    expect(result.logs).toBe('');
  });

  it('should use default limits when not specified', () => {
    const logs = 'line1\nline2';
    const result = truncateLogs(logs);
    expect(result.logs).toBe(logs);
  });

  it('should respect custom line limit', () => {
    const lines = Array.from({ length: 300 }, (_, i) => `line${i + 1}`).join('\n');
    const result = truncateLogs(lines, 50, 50000);
    const resultLines = result.logs.split('\n');
    expect(resultLines.length).toBe(50);
    expect(resultLines[0]).toBe('line251');
    expect(resultLines[49]).toBe('line300');
  });

  it('should respect custom char limit', () => {
    const logs = 'x'.repeat(1000);
    const result = truncateLogs(logs, 200, 100);
    expect(result.logs.length).toBe(100);
  });

  // Pagination tests (plain text)
  it('should paginate plain text logs (page 2 = older entries)', () => {
    const logs = Array.from({ length: 30 }, (_, i) => `line${i + 1}`).join('\n');
    const page1 = truncateLogs(logs, 10, 50000, 1);
    const page2 = truncateLogs(logs, 10, 50000, 2);
    const page3 = truncateLogs(logs, 10, 50000, 3);
    expect(page1.logs).toContain('line30');
    expect(page1.logs).toContain('line21');
    expect(page1.logs).not.toContain('line20');
    expect(page2.logs).toContain('line20');
    expect(page2.logs).toContain('line11');
    expect(page2.logs).not.toContain('line10');
    expect(page3.logs).toContain('line10');
    expect(page3.logs).toContain('line1');
    expect(page1.showing_start).toBe(21);
    expect(page1.showing_end).toBe(30);
  });

  // JSON array format tests (Coolify deployment logs)
  it('should parse JSON array logs and return last N visible entries', () => {
    const entries = [
      { output: 'Building...', timestamp: '2026-01-01T00:00:01Z', hidden: false },
      { output: 'docker pull', timestamp: '2026-01-01T00:00:02Z', hidden: true },
      { output: 'Compiling...', timestamp: '2026-01-01T00:00:03Z', hidden: false },
      { output: 'Done.', timestamp: '2026-01-01T00:00:04Z', hidden: false },
    ];
    const result = truncateLogs(JSON.stringify(entries), 2, 50000);
    expect(result.logs).toContain('Compiling...');
    expect(result.logs).toContain('Done.');
    expect(result.logs).not.toContain('Building...');
    expect(result.logs).not.toContain('docker pull');
    expect(result.total).toBe(3); // 3 visible entries
  });

  it('should filter hidden entries from JSON logs', () => {
    const entries = [
      { output: 'visible1', timestamp: '2026-01-01T00:00:01Z', hidden: false },
      { output: 'hidden1', timestamp: '2026-01-01T00:00:02Z', hidden: true },
      { output: 'hidden2', timestamp: '2026-01-01T00:00:03Z', hidden: true },
      { output: 'visible2', timestamp: '2026-01-01T00:00:04Z', hidden: false },
    ];
    const result = truncateLogs(JSON.stringify(entries), 200, 50000);
    expect(result.logs).toContain('visible1');
    expect(result.logs).toContain('visible2');
    expect(result.logs).not.toContain('hidden1');
    expect(result.logs).not.toContain('hidden2');
  });

  it('should format JSON log entries with timestamp and output', () => {
    const entries = [
      { output: 'Starting deploy', timestamp: '2026-01-01T10:00:00Z', hidden: false },
    ];
    const result = truncateLogs(JSON.stringify(entries), 200, 50000);
    expect(result.logs).toBe('[2026-01-01T10:00:00Z] Starting deploy');
  });

  it('should paginate JSON logs (page 2 = older entries)', () => {
    const entries = Array.from({ length: 30 }, (_, i) => ({
      output: `step ${i + 1}`,
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      hidden: false,
    }));
    const page1 = truncateLogs(JSON.stringify(entries), 10, 50000, 1);
    const page2 = truncateLogs(JSON.stringify(entries), 10, 50000, 2);
    expect(page1.logs).toContain('step 30');
    expect(page1.logs).toContain('step 21');
    expect(page1.logs).not.toContain('step 20');
    expect(page2.logs).toContain('step 20');
    expect(page2.logs).toContain('step 11');
    expect(page2.logs).not.toContain('step 10');
    expect(page1.total).toBe(30);
    expect(page1.showing_start).toBe(21);
    expect(page1.showing_end).toBe(30);
    expect(page2.showing_start).toBe(11);
    expect(page2.showing_end).toBe(20);
  });

  it('should return metadata with total and showing range', () => {
    const entries = Array.from({ length: 50 }, (_, i) => ({
      output: `step ${i}`,
      timestamp: `2026-01-01T00:00:${String(i).padStart(2, '0')}Z`,
      hidden: false,
    }));
    const result = truncateLogs(JSON.stringify(entries), 10, 50000);
    expect(result.total).toBe(50);
    expect(result.showing_start).toBe(41);
    expect(result.showing_end).toBe(50);
  });
});

// =============================================================================
// Action Generators Tests
// =============================================================================

describe('getApplicationActions', () => {
  it('should return view logs action for all apps', () => {
    const actions = getApplicationActions('app-uuid', 'stopped');
    expect(actions).toContainEqual({
      tool: 'application_logs',
      args: { uuid: 'app-uuid' },
      hint: 'View logs',
    });
  });

  it('should return restart/stop actions for running apps', () => {
    const actions = getApplicationActions('app-uuid', 'running');
    expect(actions).toContainEqual({
      tool: 'control',
      args: { resource: 'application', action: 'restart', uuid: 'app-uuid' },
      hint: 'Restart',
    });
    expect(actions).toContainEqual({
      tool: 'control',
      args: { resource: 'application', action: 'stop', uuid: 'app-uuid' },
      hint: 'Stop',
    });
  });

  it('should return start action for stopped apps', () => {
    const actions = getApplicationActions('app-uuid', 'stopped');
    expect(actions).toContainEqual({
      tool: 'control',
      args: { resource: 'application', action: 'start', uuid: 'app-uuid' },
      hint: 'Start',
    });
  });

  it('should handle running:healthy status', () => {
    const actions = getApplicationActions('app-uuid', 'running:healthy');
    expect(actions.some((a) => a.hint === 'Restart')).toBe(true);
    expect(actions.some((a) => a.hint === 'Stop')).toBe(true);
  });

  it('should handle undefined status', () => {
    const actions = getApplicationActions('app-uuid', undefined);
    expect(actions).toContainEqual({
      tool: 'control',
      args: { resource: 'application', action: 'start', uuid: 'app-uuid' },
      hint: 'Start',
    });
  });
});

describe('getDeploymentActions', () => {
  it('should return cancel action for in_progress deployments', () => {
    const actions = getDeploymentActions('dep-uuid', 'in_progress', 'app-uuid');
    expect(actions).toContainEqual({
      tool: 'deployment',
      args: { action: 'cancel', uuid: 'dep-uuid' },
      hint: 'Cancel',
    });
  });

  it('should return cancel action for queued deployments', () => {
    const actions = getDeploymentActions('dep-uuid', 'queued', 'app-uuid');
    expect(actions).toContainEqual({
      tool: 'deployment',
      args: { action: 'cancel', uuid: 'dep-uuid' },
      hint: 'Cancel',
    });
  });

  it('should return app actions when appUuid provided', () => {
    const actions = getDeploymentActions('dep-uuid', 'finished', 'app-uuid');
    expect(actions).toContainEqual({
      tool: 'get_application',
      args: { uuid: 'app-uuid' },
      hint: 'View app',
    });
    expect(actions).toContainEqual({
      tool: 'application_logs',
      args: { uuid: 'app-uuid' },
      hint: 'App logs',
    });
  });

  it('should not return cancel for finished deployments', () => {
    const actions = getDeploymentActions('dep-uuid', 'finished', 'app-uuid');
    expect(actions.some((a) => a.hint === 'Cancel')).toBe(false);
  });

  it('should return empty actions when no appUuid and not in_progress', () => {
    const actions = getDeploymentActions('dep-uuid', 'finished', undefined);
    expect(actions).toEqual([]);
  });
});

describe('getPagination', () => {
  it('should return undefined when count is less than perPage and page is 1', () => {
    const result = getPagination('list_apps', 1, 50, 30);
    expect(result).toBeUndefined();
  });

  it('should return next when count equals or exceeds perPage', () => {
    const result = getPagination('list_apps', 1, 50, 50);
    expect(result).toEqual({
      next: { tool: 'list_apps', args: { page: 2, per_page: 50 } },
    });
  });

  it('should return both prev and next for middle pages', () => {
    const result = getPagination('list_apps', 2, 50, 50);
    expect(result).toEqual({
      prev: { tool: 'list_apps', args: { page: 1, per_page: 50 } },
      next: { tool: 'list_apps', args: { page: 3, per_page: 50 } },
    });
  });

  it('should return prev when page > 1 and count < perPage', () => {
    const result = getPagination('list_apps', 3, 50, 20);
    expect(result).toEqual({
      prev: { tool: 'list_apps', args: { page: 2, per_page: 50 } },
    });
  });

  it('should use default page and perPage when undefined', () => {
    const result = getPagination('list_apps', undefined, undefined, 100);
    expect(result).toEqual({
      next: { tool: 'list_apps', args: { page: 2, per_page: 50 } },
    });
  });

  it('should return undefined when count is undefined', () => {
    const result = getPagination('list_apps', 1, 50, undefined);
    expect(result).toBeUndefined();
  });
});
