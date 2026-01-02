import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import { CoolifyClient } from '../lib/coolify-client.js';
import type { ServiceType, CreateServiceRequest } from '../types/coolify.js';

// Helper to create mock response
function mockResponse(data: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    text: async () => JSON.stringify(data),
  } as Response;
}

const mockFetch = jest.fn<typeof fetch>();

describe('CoolifyClient', () => {
  let client: CoolifyClient;

  const mockServers = [
    {
      id: 1,
      uuid: 'test-uuid',
      name: 'test-server',
      ip: '192.168.1.1',
      user: 'root',
      port: 22,
      status: 'running',
      is_reachable: true,
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    },
  ];

  const mockServerInfo = {
    id: 1,
    uuid: 'test-uuid',
    name: 'test-server',
    ip: '192.168.1.1',
    user: 'root',
    port: 22,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const mockServerResources = [
    {
      id: 1,
      uuid: 'resource-uuid',
      name: 'test-app',
      type: 'application',
      status: 'running',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    },
  ];

  const mockService = {
    id: 1,
    uuid: 'test-uuid',
    name: 'test-service',
    type: 'code-server' as ServiceType,
    status: 'running',
    domains: ['test.example.com'],
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const mockApplication = {
    id: 1,
    uuid: 'app-uuid',
    name: 'test-app',
    status: 'running',
    fqdn: 'https://app.example.com',
    git_repository: 'https://github.com/user/repo',
    git_branch: 'main',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const mockDatabase = {
    id: 1,
    uuid: 'db-uuid',
    name: 'test-db',
    type: 'postgresql',
    status: 'running',
    is_public: false,
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const mockDeployment = {
    id: 1,
    uuid: 'dep-uuid',
    deployment_uuid: 'dep-123',
    application_name: 'test-app',
    status: 'finished',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const mockProject = {
    id: 1,
    uuid: 'proj-uuid',
    name: 'test-project',
    description: 'A test project',
    created_at: '2024-01-01',
    updated_at: '2024-01-01',
  };

  const errorResponse = {
    message: 'Resource not found',
  };

  beforeEach(() => {
    mockFetch.mockClear();
    global.fetch = mockFetch;
    client = new CoolifyClient({
      baseUrl: 'http://localhost:3000',
      accessToken: 'test-api-key',
    });
  });

  describe('constructor', () => {
    it('should throw error if baseUrl is missing', () => {
      expect(() => new CoolifyClient({ baseUrl: '', accessToken: 'test' })).toThrow(
        'Coolify base URL is required',
      );
    });

    it('should throw error if accessToken is missing', () => {
      expect(() => new CoolifyClient({ baseUrl: 'http://localhost', accessToken: '' })).toThrow(
        'Coolify access token is required',
      );
    });

    it('should strip trailing slash from baseUrl', () => {
      const c = new CoolifyClient({
        baseUrl: 'http://localhost:3000/',
        accessToken: 'test',
      });
      mockFetch.mockResolvedValueOnce(mockResponse({ version: '1.0.0' }));
      c.getVersion();
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/version',
        expect.any(Object),
      );
    });
  });

  describe('listServers', () => {
    it('should return a list of servers', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

      const servers = await client.listServers();
      expect(servers).toEqual(mockServers);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers',
        expect.objectContaining({
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            Authorization: 'Bearer test-api-key',
          }),
        }),
      );
    });

    it('should handle errors', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(errorResponse, false, 404));

      await expect(client.listServers()).rejects.toThrow('Resource not found');
    });

    it('should support pagination options', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

      await client.listServers({ page: 2, per_page: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers?page=2&per_page=10',
        expect.any(Object),
      );
    });

    it('should return summary when requested', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

      const result = await client.listServers({ summary: true });

      expect(result).toEqual([
        {
          uuid: 'test-uuid',
          name: 'test-server',
          ip: '192.168.1.1',
          status: 'running',
          is_reachable: true,
        },
      ]);
    });
  });

  describe('getServer', () => {
    it('should get server info', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockServerInfo));

      const result = await client.getServer('test-uuid');

      expect(result).toEqual(mockServerInfo);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers/test-uuid',
        expect.any(Object),
      );
    });

    it('should handle errors', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(errorResponse, false, 404));

      await expect(client.getServer('test-uuid')).rejects.toThrow('Resource not found');
    });
  });

  describe('getServerResources', () => {
    it('should get server resources', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockServerResources));

      const result = await client.getServerResources('test-uuid');

      expect(result).toEqual(mockServerResources);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers/test-uuid/resources',
        expect.any(Object),
      );
    });

    it('should handle errors', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(errorResponse, false, 404));

      await expect(client.getServerResources('test-uuid')).rejects.toThrow('Resource not found');
    });
  });

  describe('listServices', () => {
    it('should list services', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockService]));

      const result = await client.listServices();

      expect(result).toEqual([mockService]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services',
        expect.any(Object),
      );
    });
  });

  describe('getService', () => {
    it('should get service info', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockService));

      const result = await client.getService('test-uuid');

      expect(result).toEqual(mockService);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid',
        expect.any(Object),
      );
    });
  });

  describe('createService', () => {
    it('should create a service', async () => {
      const responseData = {
        uuid: 'test-uuid',
        domains: ['test.com'],
      };
      mockFetch.mockResolvedValueOnce(mockResponse(responseData));

      const createData: CreateServiceRequest = {
        name: 'test-service',
        type: 'code-server',
        project_uuid: 'project-uuid',
        environment_uuid: 'env-uuid',
        server_uuid: 'server-uuid',
      };

      const result = await client.createService(createData);

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(createData),
        }),
      );
    });

    it('should create a service with docker_compose_raw instead of type', async () => {
      const responseData = {
        uuid: 'compose-uuid',
        domains: ['custom.example.com'],
      };
      mockFetch.mockResolvedValueOnce(mockResponse(responseData));

      const createData: CreateServiceRequest = {
        name: 'custom-compose-service',
        project_uuid: 'project-uuid',
        environment_uuid: 'env-uuid',
        server_uuid: 'server-uuid',
        docker_compose_raw: 'dmVyc2lvbjogIjMiCnNlcnZpY2VzOgogIGFwcDoKICAgIGltYWdlOiBuZ2lueA==',
      };

      const result = await client.createService(createData);

      expect(result).toEqual(responseData);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services',
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify(createData),
        }),
      );
    });
  });

  describe('deleteService', () => {
    it('should delete a service', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Service deleted' }));

      const result = await client.deleteService('test-uuid');

      expect(result).toEqual({ message: 'Service deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });

    it('should delete a service with options', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Service deleted' }));

      await client.deleteService('test-uuid', {
        deleteVolumes: true,
        dockerCleanup: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid?delete_volumes=true&docker_cleanup=true',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });

    it('should delete a service with all options', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Service deleted' }));

      await client.deleteService('test-uuid', {
        deleteConfigurations: true,
        deleteVolumes: true,
        dockerCleanup: true,
        deleteConnectedNetworks: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid?delete_configurations=true&delete_volumes=true&docker_cleanup=true&delete_connected_networks=true',
        expect.objectContaining({
          method: 'DELETE',
        }),
      );
    });
  });

  describe('applications', () => {
    it('should list applications', async () => {
      const mockApps = [{ id: 1, uuid: 'app-uuid', name: 'test-app' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockApps));

      const result = await client.listApplications();

      expect(result).toEqual(mockApps);
    });

    it('should start an application', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ message: 'Started', deployment_uuid: 'dep-uuid' }),
      );

      const result = await client.startApplication('app-uuid', {
        force: true,
      });

      expect(result).toEqual({
        message: 'Started',
        deployment_uuid: 'dep-uuid',
      });
    });

    it('should stop an application', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Stopped' }));

      const result = await client.stopApplication('app-uuid');

      expect(result).toEqual({ message: 'Stopped' });
    });
  });

  describe('databases', () => {
    it('should list databases', async () => {
      const mockDbs = [{ id: 1, uuid: 'db-uuid', name: 'test-db' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockDbs));

      const result = await client.listDatabases();

      expect(result).toEqual(mockDbs);
    });

    it('should start a database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Started' }));

      const result = await client.startDatabase('db-uuid');

      expect(result).toEqual({ message: 'Started' });
    });
  });

  describe('teams', () => {
    it('should list teams', async () => {
      const mockTeams = [{ id: 1, name: 'test-team', personal_team: false }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockTeams));

      const result = await client.listTeams();

      expect(result).toEqual(mockTeams);
    });

    it('should get current team', async () => {
      const mockTeam = { id: 1, name: 'my-team', personal_team: true };
      mockFetch.mockResolvedValueOnce(mockResponse(mockTeam));

      const result = await client.getCurrentTeam();

      expect(result).toEqual(mockTeam);
    });
  });

  describe('deployments', () => {
    it('should list deployments', async () => {
      const mockDeps = [
        {
          id: 1,
          uuid: 'dep-uuid',
          deployment_uuid: 'dep-123',
          status: 'finished',
        },
      ];
      mockFetch.mockResolvedValueOnce(mockResponse(mockDeps));

      const result = await client.listDeployments();

      expect(result).toEqual(mockDeps);
    });

    it('should deploy by tag', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deployed' }));

      const result = await client.deployByTagOrUuid('my-tag', true);

      expect(result).toEqual({ message: 'Deployed' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/deploy?tag=my-tag&force=true',
        expect.any(Object),
      );
    });
  });

  describe('private keys', () => {
    it('should list private keys', async () => {
      const mockKeys = [{ id: 1, uuid: 'key-uuid', name: 'my-key' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockKeys));

      const result = await client.listPrivateKeys();

      expect(result).toEqual(mockKeys);
    });

    it('should create a private key', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-key-uuid' }));

      const result = await client.createPrivateKey({
        name: 'new-key',
        private_key: 'ssh-rsa AAAA...',
      });

      expect(result).toEqual({ uuid: 'new-key-uuid' });
    });
  });

  describe('error handling', () => {
    it('should handle network errors', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(client.listServers()).rejects.toThrow('Failed to connect to Coolify server');
    });

    it('should handle empty responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 204,
        text: async () => '',
      } as Response);

      const result = await client.deleteServer('test-uuid');
      expect(result).toEqual({});
    });

    it('should handle API errors without message', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({}, false, 500));

      await expect(client.listServers()).rejects.toThrow('HTTP 500: Error');
    });
  });

  // =========================================================================
  // Server endpoints - additional coverage
  // =========================================================================
  describe('server operations', () => {
    it('should create a server', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-server-uuid' }));

      const result = await client.createServer({
        name: 'new-server',
        ip: '10.0.0.1',
        private_key_uuid: 'key-uuid',
      });

      expect(result).toEqual({ uuid: 'new-server-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers',
        expect.objectContaining({
          method: 'POST',
        }),
      );
    });

    it('should update a server', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockServerInfo, name: 'updated-server' }));

      const result = await client.updateServer('test-uuid', { name: 'updated-server' });

      expect(result.name).toBe('updated-server');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers/test-uuid',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('should get server domains', async () => {
      const mockDomains = [{ domain: 'example.com', ip: '1.2.3.4' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockDomains));

      const result = await client.getServerDomains('test-uuid');

      expect(result).toEqual(mockDomains);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers/test-uuid/domains',
        expect.any(Object),
      );
    });

    it('should validate a server', async () => {
      const mockValidation = { valid: true };
      mockFetch.mockResolvedValueOnce(mockResponse(mockValidation));

      const result = await client.validateServer('test-uuid');

      expect(result).toEqual(mockValidation);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/servers/test-uuid/validate',
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // Project endpoints
  // =========================================================================
  describe('projects', () => {
    it('should list projects', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockProject]));

      const result = await client.listProjects();

      expect(result).toEqual([mockProject]);
    });

    it('should list projects with pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockProject]));

      await client.listProjects({ page: 1, per_page: 5 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects?page=1&per_page=5',
        expect.any(Object),
      );
    });

    it('should list projects with summary', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockProject]));

      const result = await client.listProjects({ summary: true });

      expect(result).toEqual([
        {
          uuid: 'proj-uuid',
          name: 'test-project',
          description: 'A test project',
        },
      ]);
    });

    it('should get a project', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockProject));

      const result = await client.getProject('proj-uuid');

      expect(result).toEqual(mockProject);
    });

    it('should create a project', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-proj-uuid' }));

      const result = await client.createProject({ name: 'new-project' });

      expect(result).toEqual({ uuid: 'new-proj-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should update a project', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockProject, name: 'updated-project' }));

      const result = await client.updateProject('proj-uuid', { name: 'updated-project' });

      expect(result.name).toBe('updated-project');
    });

    it('should delete a project', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deleteProject('proj-uuid');

      expect(result).toEqual({ message: 'Deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects/proj-uuid',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // =========================================================================
  // Environment endpoints
  // =========================================================================
  describe('environments', () => {
    const mockEnvironment = {
      id: 1,
      uuid: 'env-uuid',
      name: 'production',
      project_uuid: 'proj-uuid',
      created_at: '2024-01-01',
      updated_at: '2024-01-01',
    };

    it('should list project environments', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockEnvironment]));

      const result = await client.listProjectEnvironments('proj-uuid');

      expect(result).toEqual([mockEnvironment]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects/proj-uuid/environments',
        expect.any(Object),
      );
    });

    it('should get a project environment', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockEnvironment));

      const result = await client.getProjectEnvironment('proj-uuid', 'production');

      expect(result).toEqual(mockEnvironment);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects/proj-uuid/production',
        expect.any(Object),
      );
    });

    it('should create a project environment', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-env-uuid' }));

      const result = await client.createProjectEnvironment('proj-uuid', { name: 'staging' });

      expect(result).toEqual({ uuid: 'new-env-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects/proj-uuid/environments',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should delete a project environment', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deleteProjectEnvironment('env-uuid');

      expect(result).toEqual({ message: 'Deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects/environments/env-uuid',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // =========================================================================
  // Application endpoints - extended coverage
  // =========================================================================
  describe('applications extended', () => {
    it('should list applications with pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockApplication]));

      await client.listApplications({ page: 1, per_page: 20 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications?page=1&per_page=20',
        expect.any(Object),
      );
    });

    it('should list applications with summary', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockApplication]));

      const result = await client.listApplications({ summary: true });

      expect(result).toEqual([
        {
          uuid: 'app-uuid',
          name: 'test-app',
          status: 'running',
          fqdn: 'https://app.example.com',
          git_repository: 'https://github.com/user/repo',
          git_branch: 'main',
        },
      ]);
    });

    it('should get an application', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockApplication));

      const result = await client.getApplication('app-uuid');

      expect(result).toEqual(mockApplication);
    });

    it('should create application from public repo', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-app-uuid' }));

      const result = await client.createApplicationPublic({
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        git_repository: 'https://github.com/user/repo',
        git_branch: 'main',
        build_pack: 'nixpacks',
        ports_exposes: '3000',
      });

      expect(result).toEqual({ uuid: 'new-app-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/public',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create application from private GH repo', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-app-uuid' }));

      const result = await client.createApplicationPrivateGH({
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        github_app_uuid: 'gh-app-uuid',
        git_repository: 'user/repo',
        git_branch: 'main',
        build_pack: 'nixpacks',
        ports_exposes: '3000',
      });

      expect(result).toEqual({ uuid: 'new-app-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/private-github-app',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create application from private key repo', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-app-uuid' }));

      const result = await client.createApplicationPrivateKey({
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        private_key_uuid: 'key-uuid',
        git_repository: 'git@github.com:user/repo.git',
        git_branch: 'main',
        build_pack: 'nixpacks',
        ports_exposes: '22',
      });

      expect(result).toEqual({ uuid: 'new-app-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/private-deploy-key',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create application from dockerfile', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-app-uuid' }));

      const result = await client.createApplicationDockerfile({
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        dockerfile: 'FROM node:18',
      });

      expect(result).toEqual({ uuid: 'new-app-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/dockerfile',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create application from docker image', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-app-uuid' }));

      const result = await client.createApplicationDockerImage({
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        docker_registry_image_name: 'nginx:latest',
        ports_exposes: '80',
      });

      expect(result).toEqual({ uuid: 'new-app-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/dockerimage',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create application from docker compose', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-app-uuid' }));

      const result = await client.createApplicationDockerCompose({
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        docker_compose_raw: 'version: "3"',
      });

      expect(result).toEqual({ uuid: 'new-app-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/dockercompose',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should update an application', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockApplication, name: 'updated-app' }));

      const result = await client.updateApplication('app-uuid', { name: 'updated-app' });

      expect(result.name).toBe('updated-app');
    });

    it('should delete an application', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deleteApplication('app-uuid');

      expect(result).toEqual({ message: 'Deleted' });
    });

    it('should delete an application with options', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      await client.deleteApplication('app-uuid', {
        deleteVolumes: true,
        dockerCleanup: true,
        deleteConfigurations: true,
        deleteConnectedNetworks: true,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid?delete_configurations=true&delete_volumes=true&docker_cleanup=true&delete_connected_networks=true',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should get application logs', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse('log line 1\nlog line 2'));

      const result = await client.getApplicationLogs('app-uuid', 50);

      expect(result).toBe('log line 1\nlog line 2');
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid/logs?lines=50',
        expect.any(Object),
      );
    });

    it('should restart an application', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Restarted' }));

      const result = await client.restartApplication('app-uuid');

      expect(result).toEqual({ message: 'Restarted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid/restart',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // =========================================================================
  // Application Environment Variables
  // =========================================================================
  describe('application environment variables', () => {
    const mockEnvVar = {
      uuid: 'env-var-uuid',
      key: 'API_KEY',
      value: 'secret123',
      is_build_time: false,
    };

    it('should list application env vars', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockEnvVar]));

      const result = await client.listApplicationEnvVars('app-uuid');

      expect(result).toEqual([mockEnvVar]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid/envs',
        expect.any(Object),
      );
    });

    it('should create application env var', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-env-uuid' }));

      const result = await client.createApplicationEnvVar('app-uuid', {
        key: 'NEW_VAR',
        value: 'new-value',
        is_build_time: true,
      });

      expect(result).toEqual({ uuid: 'new-env-uuid' });
    });

    it('should update application env var', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Updated' }));

      const result = await client.updateApplicationEnvVar('app-uuid', {
        key: 'API_KEY',
        value: 'updated-secret',
      });

      expect(result).toEqual({ message: 'Updated' });
    });

    it('should bulk update application env vars', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Updated' }));

      const result = await client.bulkUpdateApplicationEnvVars('app-uuid', {
        data: [
          { key: 'VAR1', value: 'val1' },
          { key: 'VAR2', value: 'val2' },
        ],
      });

      expect(result).toEqual({ message: 'Updated' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid/envs/bulk',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('should delete application env var', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deleteApplicationEnvVar('app-uuid', 'env-var-uuid');

      expect(result).toEqual({ message: 'Deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid/envs/env-var-uuid',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // =========================================================================
  // Database endpoints - extended coverage
  // =========================================================================
  describe('databases extended', () => {
    it('should list databases with pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockDatabase]));

      await client.listDatabases({ page: 1, per_page: 10 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases?page=1&per_page=10',
        expect.any(Object),
      );
    });

    it('should list databases with summary', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockDatabase]));

      const result = await client.listDatabases({ summary: true });

      expect(result).toEqual([
        {
          uuid: 'db-uuid',
          name: 'test-db',
          type: 'postgresql',
          status: 'running',
          is_public: false,
        },
      ]);
    });

    it('should get a database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockDatabase));

      const result = await client.getDatabase('db-uuid');

      expect(result).toEqual(mockDatabase);
    });

    it('should update a database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockDatabase, name: 'updated-db' }));

      const result = await client.updateDatabase('db-uuid', { name: 'updated-db' });

      expect(result.name).toBe('updated-db');
    });

    it('should delete a database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deleteDatabase('db-uuid');

      expect(result).toEqual({ message: 'Deleted' });
    });

    it('should delete a database with options', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      await client.deleteDatabase('db-uuid', { deleteVolumes: true, dockerCleanup: true });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid?delete_volumes=true&docker_cleanup=true',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should stop a database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Stopped' }));

      const result = await client.stopDatabase('db-uuid');

      expect(result).toEqual({ message: 'Stopped' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/stop',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should restart a database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Restarted' }));

      const result = await client.restartDatabase('db-uuid');

      expect(result).toEqual({ message: 'Restarted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/restart',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should list database backups', async () => {
      const mockBackups = [{ uuid: 'backup-uuid', status: 'completed' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockBackups));

      const result = await client.listDatabaseBackups('db-uuid');

      expect(result).toEqual(mockBackups);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups',
        expect.any(Object),
      );
    });

    it('should create a database backup', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ uuid: 'new-backup-uuid', message: 'Backup created' }),
      );

      const result = await client.createDatabaseBackup('db-uuid', {
        frequency: 'daily',
        backup_retention: 7,
      });

      expect(result).toEqual({ uuid: 'new-backup-uuid', message: 'Backup created' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // =========================================================================
  // Service endpoints - extended coverage
  // =========================================================================
  describe('services extended', () => {
    it('should list services with pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockService]));

      await client.listServices({ page: 2, per_page: 5 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services?page=2&per_page=5',
        expect.any(Object),
      );
    });

    it('should list services with summary', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockService]));

      const result = await client.listServices({ summary: true });

      expect(result).toEqual([
        {
          uuid: 'test-uuid',
          name: 'test-service',
          type: 'code-server',
          status: 'running',
          domains: ['test.example.com'],
        },
      ]);
    });

    it('should update a service', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockService, name: 'updated-service' }));

      const result = await client.updateService('test-uuid', { name: 'updated-service' });

      expect(result.name).toBe('updated-service');
    });

    it('should start a service', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Started' }));

      const result = await client.startService('test-uuid');

      expect(result).toEqual({ message: 'Started' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid/start',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should stop a service', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Stopped' }));

      const result = await client.stopService('test-uuid');

      expect(result).toEqual({ message: 'Stopped' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid/stop',
        expect.objectContaining({ method: 'GET' }),
      );
    });

    it('should restart a service', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Restarted' }));

      const result = await client.restartService('test-uuid');

      expect(result).toEqual({ message: 'Restarted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid/restart',
        expect.objectContaining({ method: 'GET' }),
      );
    });
  });

  // =========================================================================
  // Service Environment Variables
  // =========================================================================
  describe('service environment variables', () => {
    const mockEnvVar = {
      uuid: 'svc-env-uuid',
      key: 'SVC_KEY',
      value: 'svc-value',
    };

    it('should list service env vars', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockEnvVar]));

      const result = await client.listServiceEnvVars('test-uuid');

      expect(result).toEqual([mockEnvVar]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid/envs',
        expect.any(Object),
      );
    });

    it('should create service env var', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-env-uuid' }));

      const result = await client.createServiceEnvVar('test-uuid', {
        key: 'NEW_SVC_VAR',
        value: 'new-value',
      });

      expect(result).toEqual({ uuid: 'new-env-uuid' });
    });

    it('should update service env var', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Updated' }));

      const result = await client.updateServiceEnvVar('test-uuid', {
        key: 'SVC_KEY',
        value: 'updated-value',
      });

      expect(result).toEqual({ message: 'Updated' });
    });

    it('should delete service env var', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deleteServiceEnvVar('test-uuid', 'svc-env-uuid');

      expect(result).toEqual({ message: 'Deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/services/test-uuid/envs/svc-env-uuid',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // =========================================================================
  // Deployment endpoints - extended coverage
  // =========================================================================
  describe('deployments extended', () => {
    it('should list deployments with pagination', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockDeployment]));

      await client.listDeployments({ page: 1, per_page: 25 });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/deployments?page=1&per_page=25',
        expect.any(Object),
      );
    });

    it('should list deployments with summary', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockDeployment]));

      const result = await client.listDeployments({ summary: true });

      expect(result).toEqual([
        {
          uuid: 'dep-uuid',
          deployment_uuid: 'dep-123',
          application_name: 'test-app',
          status: 'finished',
          created_at: '2024-01-01',
        },
      ]);
    });

    it('should get a deployment', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockDeployment));

      const result = await client.getDeployment('dep-uuid');

      expect(result).toEqual(mockDeployment);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/deployments/dep-uuid',
        expect.any(Object),
      );
    });

    it('should list application deployments', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockDeployment]));

      const result = await client.listApplicationDeployments('app-uuid');

      expect(result).toEqual([mockDeployment]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid/deployments',
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // Team endpoints - extended coverage
  // =========================================================================
  describe('teams extended', () => {
    it('should get a team by id', async () => {
      const mockTeam = { id: 1, name: 'team-one', personal_team: false };
      mockFetch.mockResolvedValueOnce(mockResponse(mockTeam));

      const result = await client.getTeam(1);

      expect(result).toEqual(mockTeam);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/teams/1',
        expect.any(Object),
      );
    });

    it('should get team members', async () => {
      const mockMembers = [{ id: 1, name: 'User One', email: 'user@example.com' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockMembers));

      const result = await client.getTeamMembers(1);

      expect(result).toEqual(mockMembers);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/teams/1/members',
        expect.any(Object),
      );
    });

    it('should get current team members', async () => {
      const mockMembers = [{ id: 1, name: 'Current User', email: 'current@example.com' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockMembers));

      const result = await client.getCurrentTeamMembers();

      expect(result).toEqual(mockMembers);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/teams/current/members',
        expect.any(Object),
      );
    });
  });

  // =========================================================================
  // Private Key endpoints - extended coverage
  // =========================================================================
  describe('private keys extended', () => {
    const mockPrivateKey = {
      uuid: 'key-uuid',
      name: 'my-key',
      fingerprint: 'SHA256:xxx',
    };

    it('should get a private key', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockPrivateKey));

      const result = await client.getPrivateKey('key-uuid');

      expect(result).toEqual(mockPrivateKey);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/security/keys/key-uuid',
        expect.any(Object),
      );
    });

    it('should update a private key', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockPrivateKey, name: 'updated-key' }));

      const result = await client.updatePrivateKey('key-uuid', { name: 'updated-key' });

      expect(result.name).toBe('updated-key');
    });

    it('should delete a private key', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deletePrivateKey('key-uuid');

      expect(result).toEqual({ message: 'Deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/security/keys/key-uuid',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });
  });

  // =========================================================================
  // Cloud Token endpoints
  // =========================================================================
  describe('cloud tokens', () => {
    const mockCloudToken = {
      uuid: 'token-uuid',
      name: 'hetzner-token',
      provider: 'hetzner',
    };

    it('should list cloud tokens', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse([mockCloudToken]));

      const result = await client.listCloudTokens();

      expect(result).toEqual([mockCloudToken]);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/cloud-tokens',
        expect.any(Object),
      );
    });

    it('should get a cloud token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockCloudToken));

      const result = await client.getCloudToken('token-uuid');

      expect(result).toEqual(mockCloudToken);
    });

    it('should create a cloud token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-token-uuid' }));

      const result = await client.createCloudToken({
        name: 'new-token',
        provider: 'digitalocean',
        token: 'do-token-value',
      });

      expect(result).toEqual({ uuid: 'new-token-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/cloud-tokens',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should update a cloud token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockCloudToken, name: 'updated-token' }));

      const result = await client.updateCloudToken('token-uuid', { name: 'updated-token' });

      expect(result.name).toBe('updated-token');
    });

    it('should delete a cloud token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deleted' }));

      const result = await client.deleteCloudToken('token-uuid');

      expect(result).toEqual({ message: 'Deleted' });
    });

    it('should validate a cloud token', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ valid: true }));

      const result = await client.validateCloudToken('token-uuid');

      expect(result).toEqual({ valid: true });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/cloud-tokens/token-uuid/validate',
        expect.objectContaining({ method: 'POST' }),
      );
    });
  });

  // =========================================================================
  // Health & Version
  // =========================================================================
  describe('health and version', () => {
    it('should get version', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'v4.0.0-beta.123',
      } as Response);

      const result = await client.getVersion();

      expect(result).toEqual({ version: 'v4.0.0-beta.123' });
    });

    it('should handle version errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      } as Response);

      await expect(client.getVersion()).rejects.toThrow('HTTP 401: Unauthorized');
    });

    it('should validate connection successfully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        text: async () => 'v4.0.0',
      } as Response);

      await expect(client.validateConnection()).resolves.not.toThrow();
    });

    it('should throw on failed connection validation', async () => {
      mockFetch.mockRejectedValueOnce(new TypeError('fetch failed'));

      await expect(client.validateConnection()).rejects.toThrow(
        'Failed to connect to Coolify server',
      );
    });

    it('should handle non-Error exceptions in validateConnection', async () => {
      mockFetch.mockRejectedValueOnce('string error');

      await expect(client.validateConnection()).rejects.toThrow(
        'Failed to connect to Coolify server: Unknown error',
      );
    });

    it('should use default lines for getApplicationLogs', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse('log output'));

      await client.getApplicationLogs('app-uuid');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid/logs?lines=100',
        expect.any(Object),
      );
    });

    it('should use default force=false for deployByTagOrUuid', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deployed' }));

      await client.deployByTagOrUuid('my-tag');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/deploy?tag=my-tag&force=false',
        expect.any(Object),
      );
    });
  });
});
