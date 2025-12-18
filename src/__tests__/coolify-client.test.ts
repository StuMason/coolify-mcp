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
      expect(
        () =>
          new CoolifyClient({ baseUrl: '', accessToken: 'test' }),
      ).toThrow('Coolify base URL is required');
    });

    it('should throw error if accessToken is missing', () => {
      expect(
        () =>
          new CoolifyClient({ baseUrl: 'http://localhost', accessToken: '' }),
      ).toThrow('Coolify access token is required');
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

      await expect(client.getServer('test-uuid')).rejects.toThrow(
        'Resource not found',
      );
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

      await expect(client.getServerResources('test-uuid')).rejects.toThrow(
        'Resource not found',
      );
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
  });

  describe('deleteService', () => {
    it('should delete a service', async () => {
      mockFetch.mockResolvedValueOnce(
        mockResponse({ message: 'Service deleted' }),
      );

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
      mockFetch.mockResolvedValueOnce(
        mockResponse({ message: 'Service deleted' }),
      );

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
      mockFetch.mockRejectedValueOnce(
        new TypeError('fetch failed'),
      );

      await expect(client.listServers()).rejects.toThrow(
        'Failed to connect to Coolify server',
      );
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
  });
});
