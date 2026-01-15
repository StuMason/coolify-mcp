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

    it('should include validation errors in error message', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse(
          {
            message: 'Validation failed.',
            errors: {
              name: ['The name field is required.'],
              email: ['The email must be valid.', 'The email is already taken.'],
            },
          },
          false,
          422,
        ),
      );

      await expect(client.listServers()).rejects.toThrow(
        'Validation failed. - name: The name field is required.; email: The email must be valid., The email is already taken.',
      );
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

      const result = await client.deleteProjectEnvironment('project-uuid', 'env-uuid');

      expect(result).toEqual({ message: 'Deleted' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/projects/project-uuid/environments/env-uuid',
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

    /**
     * Issue #76 - Client Layer Behavior Test
     *
     * This test documents that the client passes through whatever data it receives.
     * The client itself is NOT buggy - it correctly sends all fields to the API.
     *
     * The FIX for #76 is in mcp-server.ts which now strips 'action' before
     * calling client methods. This test ensures the client behavior remains
     * predictable (pass-through) so the MCP server layer must handle filtering.
     */
    it('client passes through action field when included in create data (documents #76 fix location)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'new-app-uuid' }));

      // This simulates what mcp-server.ts does: passing full args with action
      const argsFromMcpTool = {
        action: 'create_public', // This should NOT be sent to the API
        project_uuid: 'proj-uuid',
        server_uuid: 'server-uuid',
        git_repository: 'https://github.com/user/repo',
        git_branch: 'main',
        build_pack: 'nixpacks',
        ports_exposes: '3000',
      };

      await client.createApplicationPublic(argsFromMcpTool as any);

      // This assertion proves the bug: 'action' IS included in the request body
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/public',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('"action":"create_public"'),
        }),
      );
    });

    it('should update an application', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockApplication, name: 'updated-app' }));

      const result = await client.updateApplication('app-uuid', { name: 'updated-app' });

      expect(result.name).toBe('updated-app');
    });

    it('should update an application and verify request body', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockApplication, name: 'updated-app' }));

      await client.updateApplication('app-uuid', { name: 'updated-app', description: 'new desc' });

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid',
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ name: 'updated-app', description: 'new desc' }),
        }),
      );
    });

    /**
     * Issue #76 - Client Layer Behavior Test
     *
     * This test documents that the client passes through whatever data it receives.
     * The client itself is NOT buggy - it correctly sends all fields to the API.
     *
     * The FIX for #76 is in mcp-server.ts which now strips 'action' before
     * calling client methods. This test ensures the client behavior remains
     * predictable (pass-through) so the MCP server layer must handle filtering.
     */
    it('client passes through action field when included in update data (documents #76 fix location)', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ ...mockApplication, name: 'updated-app' }));

      // This simulates what mcp-server.ts does: passing the full args object including 'action'
      const argsFromMcpTool = {
        action: 'update', // This should NOT be sent to the API
        uuid: 'app-uuid', // This is extracted separately
        name: 'updated-app',
        description: 'new desc',
      };

      // The client passes whatever it receives to the API
      await client.updateApplication('app-uuid', argsFromMcpTool as any);

      // This assertion proves the bug: 'action' IS included in the request body
      // The Coolify API will reject this with "action: This field is not allowed"
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/applications/app-uuid',
        expect.objectContaining({
          method: 'PATCH',
          body: expect.stringContaining('"action":"update"'),
        }),
      );
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

    it('should list application env vars with summary', async () => {
      const fullEnvVar = {
        id: 1,
        uuid: 'env-var-uuid',
        key: 'API_KEY',
        value: 'secret123',
        is_build_time: false,
        is_literal: true,
        is_multiline: false,
        is_preview: false,
        is_shared: false,
        is_shown_once: false,
        application_id: 1,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };
      mockFetch.mockResolvedValueOnce(mockResponse([fullEnvVar]));

      const result = await client.listApplicationEnvVars('app-uuid', { summary: true });

      // Summary should only include uuid, key, value, is_build_time
      expect(result).toEqual([
        {
          uuid: 'env-var-uuid',
          key: 'API_KEY',
          value: 'secret123',
          is_build_time: false,
        },
      ]);
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

    it('should get a database backup', async () => {
      const mockBackup = { uuid: 'backup-uuid', enabled: true, frequency: '0 0 * * *' };
      mockFetch.mockResolvedValueOnce(mockResponse(mockBackup));

      const result = await client.getDatabaseBackup('db-uuid', 'backup-uuid');

      expect(result).toEqual(mockBackup);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid',
        expect.any(Object),
      );
    });

    it('should create a database backup', async () => {
      const mockBackup = { uuid: 'backup-uuid', frequency: '0 0 * * *', enabled: true };
      mockFetch.mockResolvedValueOnce(mockResponse(mockBackup));

      const result = await client.createDatabaseBackup('db-uuid', {
        frequency: '0 0 * * *',
        enabled: true,
        save_s3: true,
        s3_storage_uuid: 'storage-uuid',
        database_backup_retention_days_locally: 7,
        database_backup_retention_days_s3: 7,
      });

      expect(result).toEqual(mockBackup);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should update a database backup', async () => {
      const mockData = { message: 'Backup updated' };
      mockFetch.mockResolvedValueOnce(mockResponse(mockData));

      const result = await client.updateDatabaseBackup('db-uuid', 'backup-uuid', {
        enabled: false,
        frequency: '0 2 * * *',
      });

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid',
        expect.objectContaining({ method: 'PATCH' }),
      );
    });

    it('should delete a database backup', async () => {
      const mockData = { message: 'Backup deleted' };
      mockFetch.mockResolvedValueOnce(mockResponse(mockData));

      const result = await client.deleteDatabaseBackup('db-uuid', 'backup-uuid');

      expect(result).toEqual(mockData);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid',
        expect.objectContaining({ method: 'DELETE' }),
      );
    });

    it('should list backup executions', async () => {
      const mockExecutions = [{ uuid: 'exec-uuid', status: 'success' }];
      mockFetch.mockResolvedValueOnce(mockResponse(mockExecutions));

      const result = await client.listBackupExecutions('db-uuid', 'backup-uuid');

      expect(result).toEqual(mockExecutions);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid/executions',
        expect.any(Object),
      );
    });

    it('should get a backup execution', async () => {
      const mockExecution = { uuid: 'exec-uuid', status: 'success', size: 1024 };
      mockFetch.mockResolvedValueOnce(mockResponse(mockExecution));

      const result = await client.getBackupExecution('db-uuid', 'backup-uuid', 'exec-uuid');

      expect(result).toEqual(mockExecution);
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid/executions/exec-uuid',
        expect.any(Object),
      );
    });

    it('should create a PostgreSQL database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'pg-uuid' }));

      const result = await client.createPostgresql({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
        environment_name: 'production',
        postgres_user: 'myuser',
        postgres_db: 'mydb',
      });

      expect(result).toEqual({ uuid: 'pg-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/postgresql',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create a MySQL database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'mysql-uuid' }));

      const result = await client.createMysql({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
        mysql_user: 'myuser',
        mysql_database: 'mydb',
      });

      expect(result).toEqual({ uuid: 'mysql-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/mysql',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create a MariaDB database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'mariadb-uuid' }));

      const result = await client.createMariadb({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
      });

      expect(result).toEqual({ uuid: 'mariadb-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/mariadb',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create a MongoDB database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'mongo-uuid' }));

      const result = await client.createMongodb({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
        mongo_initdb_root_username: 'admin',
      });

      expect(result).toEqual({ uuid: 'mongo-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/mongodb',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create a Redis database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'redis-uuid' }));

      const result = await client.createRedis({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
        redis_password: 'secret',
      });

      expect(result).toEqual({ uuid: 'redis-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/redis',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create a KeyDB database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'keydb-uuid' }));

      const result = await client.createKeydb({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
      });

      expect(result).toEqual({ uuid: 'keydb-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/keydb',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create a ClickHouse database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'clickhouse-uuid' }));

      const result = await client.createClickhouse({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
        clickhouse_admin_user: 'admin',
      });

      expect(result).toEqual({ uuid: 'clickhouse-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/clickhouse',
        expect.objectContaining({ method: 'POST' }),
      );
    });

    it('should create a Dragonfly database', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ uuid: 'dragonfly-uuid' }));

      const result = await client.createDragonfly({
        server_uuid: 'server-uuid',
        project_uuid: 'project-uuid',
        dragonfly_password: 'secret',
      });

      expect(result).toEqual({ uuid: 'dragonfly-uuid' });
      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/dragonfly',
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

  // ===========================================================================
  // Database Backup Tests
  // ===========================================================================
  describe('Database Backups', () => {
    const mockBackups = [
      {
        id: 1,
        uuid: 'backup-uuid-1',
        database_id: 1,
        database_type: 'postgresql',
        database_uuid: 'db-uuid',
        enabled: true,
        frequency: '0 0 * * *',
        save_s3: false,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    ];

    const mockExecutions = [
      {
        id: 1,
        uuid: 'exec-uuid-1',
        scheduled_database_backup_id: 1,
        status: 'success',
        message: 'Backup completed',
        size: 1024,
        filename: 'backup-20240101.sql',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      },
    ];

    it('should list database backups', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockBackups));

      const result = await client.listDatabaseBackups('db-uuid');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups',
        expect.any(Object),
      );
      expect(result).toEqual(mockBackups);
    });

    it('should get a specific database backup', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockBackups[0]));

      const result = await client.getDatabaseBackup('db-uuid', 'backup-uuid-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid-1',
        expect.any(Object),
      );
      expect(result).toEqual(mockBackups[0]);
    });

    it('should list backup executions', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockExecutions));

      const result = await client.listBackupExecutions('db-uuid', 'backup-uuid-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid-1/executions',
        expect.any(Object),
      );
      expect(result).toEqual(mockExecutions);
    });

    it('should get a specific backup execution', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse(mockExecutions[0]));

      const result = await client.getBackupExecution('db-uuid', 'backup-uuid-1', 'exec-uuid-1');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/databases/db-uuid/backups/backup-uuid-1/executions/exec-uuid-1',
        expect.any(Object),
      );
      expect(result).toEqual(mockExecutions[0]);
    });
  });

  // ===========================================================================
  // Deployment Control Tests
  // ===========================================================================
  describe('Deployment Control', () => {
    it('should cancel a deployment', async () => {
      mockFetch.mockResolvedValueOnce(mockResponse({ message: 'Deployment cancelled' }));

      const result = await client.cancelDeployment('deploy-uuid');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:3000/api/v1/deployments/deploy-uuid/cancel',
        expect.objectContaining({ method: 'POST' }),
      );
      expect(result).toEqual({ message: 'Deployment cancelled' });
    });
  });

  // ===========================================================================
  // Smart Lookup Tests
  // ===========================================================================
  describe('Smart Lookup', () => {
    describe('resolveApplicationUuid', () => {
      const mockApps = [
        {
          id: 1,
          uuid: 'app-uuid-1',
          name: 'tidylinker',
          status: 'running',
          fqdn: 'https://tidylinker.com',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'app-uuid-2',
          name: 'my-api',
          status: 'running',
          fqdn: 'https://api.example.com',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      it('should return UUID directly if it looks like a UUID', async () => {
        // UUIDs are alphanumeric, 20+ chars - no API call should be made
        const result = await client.resolveApplicationUuid('xs0sgs4gog044s4k4c88kgsc');
        expect(result).toBe('xs0sgs4gog044s4k4c88kgsc');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should find application by name', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockApps));

        const result = await client.resolveApplicationUuid('tidylinker');

        expect(result).toBe('app-uuid-1');
      });

      it('should find application by partial name (case-insensitive)', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockApps));

        const result = await client.resolveApplicationUuid('TidyLink');

        expect(result).toBe('app-uuid-1');
      });

      it('should find application by domain', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockApps));

        const result = await client.resolveApplicationUuid('tidylinker.com');

        expect(result).toBe('app-uuid-1');
      });

      it('should find application by partial domain', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockApps));

        const result = await client.resolveApplicationUuid('api.example.com');

        expect(result).toBe('app-uuid-2');
      });

      it('should throw error if no application found', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockApps));

        await expect(client.resolveApplicationUuid('nonexistent')).rejects.toThrow(
          'No application found matching "nonexistent"',
        );
      });

      it('should throw error if multiple applications match', async () => {
        const multiMatchApps = [
          { ...mockApps[0], name: 'test-app-1' },
          { ...mockApps[1], name: 'test-app-2' },
        ];
        mockFetch.mockResolvedValueOnce(mockResponse(multiMatchApps));

        await expect(client.resolveApplicationUuid('test-app')).rejects.toThrow(
          'Multiple applications match',
        );
      });
    });

    describe('resolveServerUuid', () => {
      const mockServers = [
        {
          id: 1,
          uuid: 'server-uuid-1',
          name: 'coolify-apps',
          ip: '192.168.1.100',
          user: 'root',
          port: 22,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'server-uuid-2',
          name: 'production-db',
          ip: '10.0.0.50',
          user: 'root',
          port: 22,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      it('should return UUID directly if it looks like a UUID', async () => {
        const result = await client.resolveServerUuid('ggkk8w4c08gw48oowsg4g0oc');
        expect(result).toBe('ggkk8w4c08gw48oowsg4g0oc');
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should find server by name', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

        const result = await client.resolveServerUuid('coolify-apps');

        expect(result).toBe('server-uuid-1');
      });

      it('should find server by partial name (case-insensitive)', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

        const result = await client.resolveServerUuid('Coolify');

        expect(result).toBe('server-uuid-1');
      });

      it('should find server by IP address', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

        const result = await client.resolveServerUuid('192.168.1.100');

        expect(result).toBe('server-uuid-1');
      });

      it('should find server by partial IP', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

        const result = await client.resolveServerUuid('10.0.0');

        expect(result).toBe('server-uuid-2');
      });

      it('should throw error if no server found', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockServers));

        await expect(client.resolveServerUuid('nonexistent')).rejects.toThrow(
          'No server found matching "nonexistent"',
        );
      });

      it('should throw error if multiple servers match', async () => {
        const multiMatchServers = [
          { ...mockServers[0], name: 'prod-server-1' },
          { ...mockServers[1], name: 'prod-server-2' },
        ];
        mockFetch.mockResolvedValueOnce(mockResponse(multiMatchServers));

        await expect(client.resolveServerUuid('prod-server')).rejects.toThrow(
          'Multiple servers match',
        );
      });
    });
  });

  // ===========================================================================
  // Diagnostic Methods Tests
  // ===========================================================================
  describe('Diagnostic Methods', () => {
    describe('diagnoseApplication', () => {
      // Use UUID-like format that matches the isLikelyUuid check
      const testAppUuid = 'app0uuid0test0001234567';
      const mockApp = {
        id: 1,
        uuid: testAppUuid,
        name: 'test-app',
        status: 'running:healthy',
        fqdn: 'https://test.com',
        git_repository: 'org/repo',
        git_branch: 'main',
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      const mockLogs = 'Log line 1\nLog line 2\nLog line 3';

      const mockEnvVars = [
        {
          id: 1,
          uuid: 'env-1',
          key: 'DATABASE_URL',
          value: 'postgres://...',
          is_build_time: false,
        },
        { id: 2, uuid: 'env-2', key: 'NODE_ENV', value: 'production', is_build_time: true },
      ];

      const mockDeployments = [
        {
          id: 1,
          uuid: 'deploy-1',
          deployment_uuid: 'deploy-1',
          status: 'finished',
          force_rebuild: false,
          is_webhook: false,
          is_api: false,
          restart_only: false,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'deploy-2',
          deployment_uuid: 'deploy-2',
          status: 'finished',
          force_rebuild: false,
          is_webhook: false,
          is_api: false,
          restart_only: false,
          created_at: '2024-01-02',
          updated_at: '2024-01-02',
        },
      ];

      it('should aggregate all application data successfully', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApp))
          .mockResolvedValueOnce(mockResponse(mockLogs))
          .mockResolvedValueOnce(mockResponse(mockEnvVars))
          .mockResolvedValueOnce(mockResponse(mockDeployments));

        const result = await client.diagnoseApplication(testAppUuid);

        expect(result.application).toEqual({
          uuid: testAppUuid,
          name: 'test-app',
          status: 'running:healthy',
          fqdn: 'https://test.com',
          git_repository: 'org/repo',
          git_branch: 'main',
        });
        expect(result.health.status).toBe('healthy');
        expect(result.logs).toBe(mockLogs);
        expect(result.environment_variables.count).toBe(2);
        expect(result.environment_variables.variables).toEqual([
          { key: 'DATABASE_URL', is_build_time: false },
          { key: 'NODE_ENV', is_build_time: true },
        ]);
        expect(result.recent_deployments).toHaveLength(2);
        expect(result.errors).toBeUndefined();
      });

      it('should detect unhealthy application status', async () => {
        const unhealthyApp = { ...mockApp, status: 'exited:unhealthy' };
        mockFetch
          .mockResolvedValueOnce(mockResponse(unhealthyApp))
          .mockResolvedValueOnce(mockResponse(mockLogs))
          .mockResolvedValueOnce(mockResponse(mockEnvVars))
          .mockResolvedValueOnce(mockResponse([]));

        const result = await client.diagnoseApplication(testAppUuid);

        expect(result.health.status).toBe('unhealthy');
        expect(result.health.issues).toContain('Status: exited:unhealthy');
      });

      it('should detect failed deployments as issues', async () => {
        const failedDeployments = [
          { ...mockDeployments[0], status: 'failed' },
          { ...mockDeployments[1], status: 'failed' },
        ];
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApp))
          .mockResolvedValueOnce(mockResponse(mockLogs))
          .mockResolvedValueOnce(mockResponse(mockEnvVars))
          .mockResolvedValueOnce(mockResponse(failedDeployments));

        const result = await client.diagnoseApplication(testAppUuid);

        expect(result.health.issues).toContain('2 failed deployment(s) in last 5');
      });

      it('should handle partial failures gracefully', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApp))
          .mockRejectedValueOnce(new Error('Logs unavailable'))
          .mockResolvedValueOnce(mockResponse(mockEnvVars))
          .mockResolvedValueOnce(mockResponse(mockDeployments));

        const result = await client.diagnoseApplication(testAppUuid);

        expect(result.application).not.toBeNull();
        expect(result.logs).toBeNull();
        expect(result.errors).toContain('logs: Logs unavailable');
      });

      it('should handle complete failure gracefully', async () => {
        mockFetch
          .mockRejectedValueOnce(new Error('App not found'))
          .mockRejectedValueOnce(new Error('Logs unavailable'))
          .mockRejectedValueOnce(new Error('Env vars unavailable'))
          .mockRejectedValueOnce(new Error('Deployments unavailable'));

        const result = await client.diagnoseApplication(testAppUuid);

        expect(result.application).toBeNull();
        expect(result.logs).toBeNull();
        expect(result.health.status).toBe('unknown');
        expect(result.errors).toHaveLength(4);
      });

      it('should find application by name and diagnose it', async () => {
        const mockApps = [{ ...mockApp, uuid: 'found-uuid', name: 'my-app' }];
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps)) // listApplications for lookup
          .mockResolvedValueOnce(mockResponse(mockApp))
          .mockResolvedValueOnce(mockResponse(mockLogs))
          .mockResolvedValueOnce(mockResponse(mockEnvVars))
          .mockResolvedValueOnce(mockResponse(mockDeployments));

        const result = await client.diagnoseApplication('my-app');

        expect(result.application).not.toBeNull();
        // First call should be to list apps for lookup
        expect(mockFetch).toHaveBeenNthCalledWith(
          1,
          'http://localhost:3000/api/v1/applications',
          expect.any(Object),
        );
      });

      it('should find application by domain and diagnose it', async () => {
        const mockApps = [{ ...mockApp, uuid: 'found-uuid', fqdn: 'https://tidylinker.com' }];
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps)) // listApplications for lookup
          .mockResolvedValueOnce(mockResponse(mockApp))
          .mockResolvedValueOnce(mockResponse(mockLogs))
          .mockResolvedValueOnce(mockResponse(mockEnvVars))
          .mockResolvedValueOnce(mockResponse(mockDeployments));

        const result = await client.diagnoseApplication('tidylinker.com');

        expect(result.application).not.toBeNull();
      });

      it('should return error in result when application not found by name', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse([])); // Empty app list

        const result = await client.diagnoseApplication('nonexistent-app');

        expect(result.application).toBeNull();
        expect(result.errors).toContain('No application found matching "nonexistent-app"');
      });
    });

    describe('diagnoseServer', () => {
      // Use UUID-like format that matches the isLikelyUuid check
      const testServerUuid = 'srv0uuid0test0001234567';
      const mockServer = {
        id: 1,
        uuid: testServerUuid,
        name: 'test-server',
        ip: '192.168.1.1',
        user: 'root',
        port: 22,
        status: 'running',
        is_reachable: true,
        is_usable: true,
        created_at: '2024-01-01',
        updated_at: '2024-01-01',
      };

      const mockResources = [
        {
          id: 1,
          uuid: 'res-1',
          name: 'app-1',
          type: 'application',
          status: 'running:healthy',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'res-2',
          name: 'db-1',
          type: 'database',
          status: 'running:healthy',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      const mockDomains = [{ ip: '192.168.1.1', domains: ['example.com', 'api.example.com'] }];

      const mockValidation = { message: 'Server is reachable and validated' };

      it('should aggregate all server data successfully', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockServer))
          .mockResolvedValueOnce(mockResponse(mockResources))
          .mockResolvedValueOnce(mockResponse(mockDomains))
          .mockResolvedValueOnce(mockResponse(mockValidation));

        const result = await client.diagnoseServer(testServerUuid);

        expect(result.server).toEqual({
          uuid: testServerUuid,
          name: 'test-server',
          ip: '192.168.1.1',
          status: 'running',
          is_reachable: true,
        });
        expect(result.health.status).toBe('healthy');
        expect(result.resources).toHaveLength(2);
        expect(result.domains).toHaveLength(1);
        expect(result.validation?.message).toBe('Server is reachable and validated');
        expect(result.errors).toBeUndefined();
      });

      it('should detect unreachable server', async () => {
        const unreachableServer = { ...mockServer, is_reachable: false };
        mockFetch
          .mockResolvedValueOnce(mockResponse(unreachableServer))
          .mockResolvedValueOnce(mockResponse(mockResources))
          .mockResolvedValueOnce(mockResponse(mockDomains))
          .mockResolvedValueOnce(mockResponse(mockValidation));

        const result = await client.diagnoseServer(testServerUuid);

        expect(result.health.status).toBe('unhealthy');
        expect(result.health.issues).toContain('Server is not reachable');
      });

      it('should detect unhealthy resources', async () => {
        const unhealthyResources = [
          { ...mockResources[0], status: 'exited:unhealthy' },
          { ...mockResources[1], status: 'running:healthy' },
        ];
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockServer))
          .mockResolvedValueOnce(mockResponse(unhealthyResources))
          .mockResolvedValueOnce(mockResponse(mockDomains))
          .mockResolvedValueOnce(mockResponse(mockValidation));

        const result = await client.diagnoseServer(testServerUuid);

        expect(result.health.issues).toContain('1 unhealthy resource(s)');
      });

      it('should handle partial failures gracefully', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockServer))
          .mockRejectedValueOnce(new Error('Resources unavailable'))
          .mockResolvedValueOnce(mockResponse(mockDomains))
          .mockResolvedValueOnce(mockResponse(mockValidation));

        const result = await client.diagnoseServer(testServerUuid);

        expect(result.server).not.toBeNull();
        expect(result.resources).toEqual([]);
        expect(result.errors).toContain('resources: Resources unavailable');
      });

      it('should find server by name and diagnose it', async () => {
        const mockServers = [{ ...mockServer, uuid: 'found-uuid', name: 'coolify-apps' }];
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockServers)) // listServers for lookup
          .mockResolvedValueOnce(mockResponse(mockServer))
          .mockResolvedValueOnce(mockResponse(mockResources))
          .mockResolvedValueOnce(mockResponse(mockDomains))
          .mockResolvedValueOnce(mockResponse(mockValidation));

        const result = await client.diagnoseServer('coolify-apps');

        expect(result.server).not.toBeNull();
        // First call should be to list servers for lookup
        expect(mockFetch).toHaveBeenNthCalledWith(
          1,
          'http://localhost:3000/api/v1/servers',
          expect.any(Object),
        );
      });

      it('should find server by IP and diagnose it', async () => {
        const mockServers = [{ ...mockServer, uuid: 'found-uuid', ip: '10.0.0.5' }];
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockServers)) // listServers for lookup
          .mockResolvedValueOnce(mockResponse(mockServer))
          .mockResolvedValueOnce(mockResponse(mockResources))
          .mockResolvedValueOnce(mockResponse(mockDomains))
          .mockResolvedValueOnce(mockResponse(mockValidation));

        const result = await client.diagnoseServer('10.0.0.5');

        expect(result.server).not.toBeNull();
      });

      it('should return error in result when server not found by name', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse([])); // Empty server list

        const result = await client.diagnoseServer('nonexistent-server');

        expect(result.server).toBeNull();
        expect(result.errors).toContain('No server found matching "nonexistent-server"');
      });
    });

    describe('findInfrastructureIssues', () => {
      const mockServers = [
        {
          id: 1,
          uuid: 'server-1',
          name: 'healthy-server',
          ip: '1.1.1.1',
          user: 'root',
          port: 22,
          is_reachable: true,
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'server-2',
          name: 'unreachable-server',
          ip: '2.2.2.2',
          user: 'root',
          port: 22,
          is_reachable: false,
          status: 'error',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      const mockApplications = [
        {
          id: 1,
          uuid: 'app-1',
          name: 'healthy-app',
          status: 'running:healthy',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'app-2',
          name: 'unhealthy-app',
          status: 'exited:unhealthy',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      const mockDatabases = [
        {
          id: 1,
          uuid: 'db-1',
          name: 'healthy-db',
          type: 'postgresql',
          status: 'running:healthy',
          is_public: false,
          image: 'postgres:16',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'db-2',
          name: 'stopped-db',
          type: 'redis',
          status: 'exited:unhealthy',
          is_public: false,
          image: 'redis:7',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      const mockServices = [
        {
          id: 1,
          uuid: 'svc-1',
          name: 'healthy-service',
          type: 'pocketbase',
          status: 'running:healthy',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'svc-2',
          name: 'exited-service',
          type: 'n8n',
          status: 'exited',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      it('should find all infrastructure issues', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockServers))
          .mockResolvedValueOnce(mockResponse(mockApplications))
          .mockResolvedValueOnce(mockResponse(mockDatabases))
          .mockResolvedValueOnce(mockResponse(mockServices));

        const result = await client.findInfrastructureIssues();

        expect(result.summary.total_issues).toBe(4);
        expect(result.summary.unreachable_servers).toBe(1);
        expect(result.summary.unhealthy_applications).toBe(1);
        expect(result.summary.unhealthy_databases).toBe(1);
        expect(result.summary.unhealthy_services).toBe(1);
        expect(result.issues).toHaveLength(4);
        expect(result.errors).toBeUndefined();
      });

      it('should return empty issues when everything is healthy', async () => {
        const healthyServers = [mockServers[0]];
        const healthyApps = [mockApplications[0]];
        const healthyDbs = [mockDatabases[0]];
        const healthySvcs = [mockServices[0]];

        mockFetch
          .mockResolvedValueOnce(mockResponse(healthyServers))
          .mockResolvedValueOnce(mockResponse(healthyApps))
          .mockResolvedValueOnce(mockResponse(healthyDbs))
          .mockResolvedValueOnce(mockResponse(healthySvcs));

        const result = await client.findInfrastructureIssues();

        expect(result.summary.total_issues).toBe(0);
        expect(result.issues).toHaveLength(0);
      });

      it('should handle partial failures and still report issues', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockServers))
          .mockRejectedValueOnce(new Error('Applications unavailable'))
          .mockResolvedValueOnce(mockResponse(mockDatabases))
          .mockResolvedValueOnce(mockResponse(mockServices));

        const result = await client.findInfrastructureIssues();

        expect(result.summary.unreachable_servers).toBe(1);
        expect(result.summary.unhealthy_databases).toBe(1);
        expect(result.summary.unhealthy_services).toBe(1);
        expect(result.summary.unhealthy_applications).toBe(0); // Failed to fetch
        expect(result.errors).toContain('applications: Applications unavailable');
      });
    });
  });

  // ===========================================================================
  // Batch Operations Tests
  // ===========================================================================
  describe('Batch Operations', () => {
    describe('restartProjectApps', () => {
      const mockApps = [
        {
          id: 1,
          uuid: 'app-1',
          name: 'app-one',
          project_uuid: 'proj-1',
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'app-2',
          name: 'app-two',
          project_uuid: 'proj-1',
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 3,
          uuid: 'app-3',
          name: 'app-three',
          project_uuid: 'proj-2', // Different project
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      it('should restart all apps in a project', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Restarted' })) // app-1
          .mockResolvedValueOnce(mockResponse({ message: 'Restarted' })); // app-2

        const result = await client.restartProjectApps('proj-1');

        expect(result.summary.total).toBe(2);
        expect(result.summary.succeeded).toBe(2);
        expect(result.summary.failed).toBe(0);
        expect(result.succeeded).toEqual([
          { uuid: 'app-1', name: 'app-one' },
          { uuid: 'app-2', name: 'app-two' },
        ]);
        expect(result.failed).toEqual([]);
      });

      it('should handle partial failures gracefully', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Restarted' }))
          .mockRejectedValueOnce(new Error('App not running'));

        const result = await client.restartProjectApps('proj-1');

        expect(result.summary.succeeded).toBe(1);
        expect(result.summary.failed).toBe(1);
        expect(result.succeeded).toHaveLength(1);
        expect(result.failed).toHaveLength(1);
        expect(result.failed[0].error).toBe('App not running');
      });

      it('should return empty result for empty project', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse([]));

        const result = await client.restartProjectApps('empty-project');

        expect(result.summary.total).toBe(0);
        expect(result.summary.succeeded).toBe(0);
        expect(result.summary.failed).toBe(0);
      });

      it('should return empty result for project with no apps', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse(mockApps));

        const result = await client.restartProjectApps('nonexistent-project');

        expect(result.summary.total).toBe(0);
      });
    });

    describe('bulkEnvUpdate', () => {
      const mockApps = [
        {
          id: 1,
          uuid: 'app-1',
          name: 'app-one',
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'app-2',
          name: 'app-two',
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 3,
          uuid: 'app-3',
          name: 'app-three',
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      it('should update env var across multiple apps', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps)) // listApplications
          .mockResolvedValueOnce(mockResponse({ message: 'Updated' })) // app-1
          .mockResolvedValueOnce(mockResponse({ message: 'Updated' })); // app-2

        const result = await client.bulkEnvUpdate(['app-1', 'app-2'], 'API_KEY', 'new-value');

        expect(result.summary.total).toBe(2);
        expect(result.summary.succeeded).toBe(2);
        expect(result.summary.failed).toBe(0);
        expect(result.succeeded).toEqual([
          { uuid: 'app-1', name: 'app-one' },
          { uuid: 'app-2', name: 'app-two' },
        ]);
      });

      it('should handle partial failures', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Updated' }))
          .mockRejectedValueOnce(new Error('App not found'));

        const result = await client.bulkEnvUpdate(['app-1', 'app-2'], 'API_KEY', 'new-value');

        expect(result.summary.succeeded).toBe(1);
        expect(result.summary.failed).toBe(1);
        expect(result.failed[0].error).toBe('App not found');
      });

      it('should handle unknown app UUIDs gracefully', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Updated' }))
          .mockRejectedValueOnce(new Error('Application not found'));

        const result = await client.bulkEnvUpdate(['app-1', 'unknown-app'], 'API_KEY', 'new-value');

        expect(result.summary.total).toBe(2);
        expect(result.summary.succeeded).toBe(1);
        expect(result.summary.failed).toBe(1);
        expect(result.succeeded[0].uuid).toBe('app-1');
        expect(result.failed[0].uuid).toBe('unknown-app');
        expect(result.failed[0].error).toBe('Application not found');
      });

      it('should return empty result for empty app UUIDs array', async () => {
        const result = await client.bulkEnvUpdate([], 'API_KEY', 'new-value');

        expect(result.summary.total).toBe(0);
        expect(result.summary.succeeded).toBe(0);
        expect(result.summary.failed).toBe(0);
        // No API calls should be made
        expect(mockFetch).not.toHaveBeenCalled();
      });

      it('should send build time flag when specified', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Updated' }));

        await client.bulkEnvUpdate(['app-1'], 'BUILD_VAR', 'value', true);

        // Verify the PATCH call was made with is_build_time
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/api/v1/applications/app-1/envs',
          expect.objectContaining({
            method: 'PATCH',
            body: JSON.stringify({ key: 'BUILD_VAR', value: 'value', is_build_time: true }),
          }),
        );
      });
    });

    describe('stopAllApps', () => {
      const mockApps = [
        {
          id: 1,
          uuid: 'app-1',
          name: 'running-app',
          status: 'running:healthy',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'app-2',
          name: 'healthy-app',
          status: 'healthy',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 3,
          uuid: 'app-3',
          name: 'stopped-app',
          status: 'exited',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      it('should stop all running apps', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Stopped' })) // app-1
          .mockResolvedValueOnce(mockResponse({ message: 'Stopped' })); // app-2

        const result = await client.stopAllApps();

        // Only 2 apps are running (app-1 and app-2), app-3 is already stopped
        expect(result.summary.total).toBe(2);
        expect(result.summary.succeeded).toBe(2);
        expect(result.summary.failed).toBe(0);
      });

      it('should handle partial failures', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Stopped' }))
          .mockRejectedValueOnce(new Error('Failed to stop'));

        const result = await client.stopAllApps();

        expect(result.summary.succeeded).toBe(1);
        expect(result.summary.failed).toBe(1);
      });

      it('should return empty result when no running apps', async () => {
        const stoppedApps = [
          { ...mockApps[2] }, // Only the stopped app
        ];
        mockFetch.mockResolvedValueOnce(mockResponse(stoppedApps));

        const result = await client.stopAllApps();

        expect(result.summary.total).toBe(0);
      });
    });

    describe('redeployProjectApps', () => {
      const mockApps = [
        {
          id: 1,
          uuid: 'app-1',
          name: 'app-one',
          project_uuid: 'proj-1',
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 2,
          uuid: 'app-2',
          name: 'app-two',
          project_uuid: 'proj-1',
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
        {
          id: 3,
          uuid: 'app-3',
          name: 'app-three',
          project_uuid: 'proj-2', // Different project
          status: 'running',
          created_at: '2024-01-01',
          updated_at: '2024-01-01',
        },
      ];

      it('should redeploy all apps in a project', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Deployed' })) // app-1
          .mockResolvedValueOnce(mockResponse({ message: 'Deployed' })); // app-2

        const result = await client.redeployProjectApps('proj-1');

        expect(result.summary.total).toBe(2);
        expect(result.summary.succeeded).toBe(2);
        expect(result.summary.failed).toBe(0);
      });

      it('should use force=true by default', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Deployed' }))
          .mockResolvedValueOnce(mockResponse({ message: 'Deployed' }));

        await client.redeployProjectApps('proj-1');

        // Verify deploy calls use force=true
        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/api/v1/deploy?tag=app-1&force=true',
          expect.any(Object),
        );
      });

      it('should support force=false', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Deployed' }))
          .mockResolvedValueOnce(mockResponse({ message: 'Deployed' }));

        await client.redeployProjectApps('proj-1', false);

        expect(mockFetch).toHaveBeenCalledWith(
          'http://localhost:3000/api/v1/deploy?tag=app-1&force=false',
          expect.any(Object),
        );
      });

      it('should handle partial failures', async () => {
        mockFetch
          .mockResolvedValueOnce(mockResponse(mockApps))
          .mockResolvedValueOnce(mockResponse({ message: 'Deployed' }))
          .mockRejectedValueOnce(new Error('Build failed'));

        const result = await client.redeployProjectApps('proj-1');

        expect(result.summary.succeeded).toBe(1);
        expect(result.summary.failed).toBe(1);
        expect(result.failed[0].error).toBe('Build failed');
      });

      it('should return empty result for empty project', async () => {
        mockFetch.mockResolvedValueOnce(mockResponse([]));

        const result = await client.redeployProjectApps('empty-project');

        expect(result.summary.total).toBe(0);
      });
    });
  });
});
