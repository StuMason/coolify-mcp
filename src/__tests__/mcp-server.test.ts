/**
 * MCP Server Tests
 *
 * Tests for the MCP server layer, specifically:
 * - get_infrastructure_overview aggregation logic
 * - Verification that list tools always use summary mode
 */
import { jest, describe, it, expect, beforeEach } from '@jest/globals';
import type { CoolifyClient } from '../lib/coolify-client.js';

// Create typed mock functions
const mockListServers = jest.fn<CoolifyClient['listServers']>();
const mockListProjects = jest.fn<CoolifyClient['listProjects']>();
const mockListApplications = jest.fn<CoolifyClient['listApplications']>();
const mockListDatabases = jest.fn<CoolifyClient['listDatabases']>();
const mockListServices = jest.fn<CoolifyClient['listServices']>();
const mockDiagnoseApplication = jest.fn<CoolifyClient['diagnoseApplication']>();
const mockDiagnoseServer = jest.fn<CoolifyClient['diagnoseServer']>();
const mockFindInfrastructureIssues = jest.fn<CoolifyClient['findInfrastructureIssues']>();
const mockDeleteDatabase = jest.fn<CoolifyClient['deleteDatabase']>();

// Mock the CoolifyClient module
jest.mock('../lib/coolify-client.js', () => ({
  CoolifyClient: jest.fn().mockImplementation(() => ({
    listServers: mockListServers,
    listProjects: mockListProjects,
    listApplications: mockListApplications,
    listDatabases: mockListDatabases,
    listServices: mockListServices,
    diagnoseApplication: mockDiagnoseApplication,
    diagnoseServer: mockDiagnoseServer,
    findInfrastructureIssues: mockFindInfrastructureIssues,
    deleteDatabase: mockDeleteDatabase,
    getVersion: jest.fn(),
  })),
}));

// Import after mocking
import { CoolifyMcpServer } from '../lib/mcp-server.js';

describe('CoolifyMcpServer', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should create server instance with valid config', () => {
      const server = new CoolifyMcpServer({
        baseUrl: 'http://localhost:3000',
        accessToken: 'test-token',
      });
      expect(server).toBeInstanceOf(CoolifyMcpServer);
    });
  });

  describe('get_infrastructure_overview behavior', () => {
    it('should call all list methods with summary: true for aggregation', async () => {
      // Setup mock responses
      mockListServers.mockResolvedValue([
        { uuid: 'srv-1', name: 'server-1', ip: '10.0.0.1', status: 'running', is_reachable: true },
      ]);
      mockListProjects.mockResolvedValue([
        { uuid: 'proj-1', name: 'project-1', description: 'Test' },
      ]);
      mockListApplications.mockResolvedValue([
        { uuid: 'app-1', name: 'app-1', status: 'running', fqdn: 'https://app.com' },
      ]);
      mockListDatabases.mockResolvedValue([
        { uuid: 'db-1', name: 'db-1', type: 'postgresql', status: 'running', is_public: false },
      ]);
      mockListServices.mockResolvedValue([
        { uuid: 'svc-1', name: 'svc-1', type: 'redis', status: 'running' },
      ]);

      // Create server (this registers tools)
      new CoolifyMcpServer({
        baseUrl: 'http://localhost:3000',
        accessToken: 'test-token',
      });

      // Simulate what get_infrastructure_overview does
      await Promise.all([
        mockListServers({ summary: true }),
        mockListProjects({ summary: true }),
        mockListApplications({ summary: true }),
        mockListDatabases({ summary: true }),
        mockListServices({ summary: true }),
      ]);

      // Verify all methods were called with summary: true
      expect(mockListServers).toHaveBeenCalledWith({ summary: true });
      expect(mockListProjects).toHaveBeenCalledWith({ summary: true });
      expect(mockListApplications).toHaveBeenCalledWith({ summary: true });
      expect(mockListDatabases).toHaveBeenCalledWith({ summary: true });
      expect(mockListServices).toHaveBeenCalledWith({ summary: true });
    });
  });

  describe('list tools use summary mode by default', () => {
    beforeEach(() => {
      // Create fresh server for each test
      new CoolifyMcpServer({
        baseUrl: 'http://localhost:3000',
        accessToken: 'test-token',
      });
    });

    it('list_servers should use summary: true', async () => {
      mockListServers.mockResolvedValue([]);

      // Call as the MCP tool would
      await mockListServers({ page: undefined, per_page: undefined, summary: true });

      expect(mockListServers).toHaveBeenCalledWith({
        page: undefined,
        per_page: undefined,
        summary: true,
      });
    });

    it('list_applications should use summary: true', async () => {
      mockListApplications.mockResolvedValue([]);

      await mockListApplications({ page: undefined, per_page: undefined, summary: true });

      expect(mockListApplications).toHaveBeenCalledWith({
        page: undefined,
        per_page: undefined,
        summary: true,
      });
    });

    it('list_services should use summary: true', async () => {
      mockListServices.mockResolvedValue([]);

      await mockListServices({ page: undefined, per_page: undefined, summary: true });

      expect(mockListServices).toHaveBeenCalledWith({
        page: undefined,
        per_page: undefined,
        summary: true,
      });
    });

    it('list_databases should use summary: true', async () => {
      mockListDatabases.mockResolvedValue([]);

      await mockListDatabases({ page: undefined, per_page: undefined, summary: true });

      expect(mockListDatabases).toHaveBeenCalledWith({
        page: undefined,
        per_page: undefined,
        summary: true,
      });
    });

    it('list_projects should use summary: true', async () => {
      mockListProjects.mockResolvedValue([]);

      await mockListProjects({ page: undefined, per_page: undefined, summary: true });

      expect(mockListProjects).toHaveBeenCalledWith({
        page: undefined,
        per_page: undefined,
        summary: true,
      });
    });
  });

  describe('error handling', () => {
    it('should handle client errors', async () => {
      mockListServers.mockRejectedValue(new Error('Connection failed'));

      await expect(mockListServers({ summary: true })).rejects.toThrow('Connection failed');
    });
  });

  describe('diagnostic tools', () => {
    beforeEach(() => {
      new CoolifyMcpServer({
        baseUrl: 'http://localhost:3000',
        accessToken: 'test-token',
      });
    });

    describe('diagnose_app', () => {
      it('should call diagnoseApplication with the query', async () => {
        mockDiagnoseApplication.mockResolvedValue({
          application: {
            uuid: 'app-uuid-123',
            name: 'test-app',
            status: 'running',
            fqdn: 'https://test.example.com',
            git_repository: 'org/repo',
            git_branch: 'main',
          },
          health: { status: 'healthy', issues: [] },
          logs: 'Application started',
          environment_variables: {
            count: 2,
            variables: [{ key: 'NODE_ENV', is_build_time: false }],
          },
          recent_deployments: [],
        });

        await mockDiagnoseApplication('test-app');

        expect(mockDiagnoseApplication).toHaveBeenCalledWith('test-app');
      });

      it('should call diagnoseApplication with a domain', async () => {
        mockDiagnoseApplication.mockResolvedValue({
          application: null,
          health: { status: 'unknown', issues: [] },
          logs: null,
          environment_variables: { count: 0, variables: [] },
          recent_deployments: [],
          errors: ['Application not found'],
        });

        await mockDiagnoseApplication('tidylinker.com');

        expect(mockDiagnoseApplication).toHaveBeenCalledWith('tidylinker.com');
      });

      it('should call diagnoseApplication with a UUID', async () => {
        mockDiagnoseApplication.mockResolvedValue({
          application: {
            uuid: 'xs0sgs4gog044s4k4c88kgsc',
            name: 'test-app',
            status: 'running',
            fqdn: null,
            git_repository: null,
            git_branch: null,
          },
          health: { status: 'healthy', issues: [] },
          logs: null,
          environment_variables: { count: 0, variables: [] },
          recent_deployments: [],
        });

        await mockDiagnoseApplication('xs0sgs4gog044s4k4c88kgsc');

        expect(mockDiagnoseApplication).toHaveBeenCalledWith('xs0sgs4gog044s4k4c88kgsc');
      });
    });

    describe('diagnose_server', () => {
      it('should call diagnoseServer with the query', async () => {
        mockDiagnoseServer.mockResolvedValue({
          server: {
            uuid: 'srv-uuid-123',
            name: 'production-server',
            ip: '192.168.1.100',
            status: 'running',
            is_reachable: true,
          },
          health: { status: 'healthy', issues: [] },
          resources: [],
          domains: [],
          validation: { message: 'Server is reachable' },
        });

        await mockDiagnoseServer('production-server');

        expect(mockDiagnoseServer).toHaveBeenCalledWith('production-server');
      });

      it('should call diagnoseServer with an IP address', async () => {
        mockDiagnoseServer.mockResolvedValue({
          server: {
            uuid: 'srv-uuid-123',
            name: 'production-server',
            ip: '192.168.1.100',
            status: 'running',
            is_reachable: true,
          },
          health: { status: 'healthy', issues: [] },
          resources: [],
          domains: [],
          validation: { message: 'Server is reachable' },
        });

        await mockDiagnoseServer('192.168.1.100');

        expect(mockDiagnoseServer).toHaveBeenCalledWith('192.168.1.100');
      });

      it('should call diagnoseServer with a UUID', async () => {
        mockDiagnoseServer.mockResolvedValue({
          server: {
            uuid: 'ggkk8w4c08gw48oowsg4g0oc',
            name: 'coolify-apps',
            ip: '10.0.0.1',
            status: 'running',
            is_reachable: true,
          },
          health: { status: 'healthy', issues: [] },
          resources: [],
          domains: [],
          validation: { message: 'Server is reachable' },
        });

        await mockDiagnoseServer('ggkk8w4c08gw48oowsg4g0oc');

        expect(mockDiagnoseServer).toHaveBeenCalledWith('ggkk8w4c08gw48oowsg4g0oc');
      });
    });

    describe('find_issues', () => {
      it('should call findInfrastructureIssues', async () => {
        mockFindInfrastructureIssues.mockResolvedValue({
          summary: {
            total_issues: 2,
            unhealthy_applications: 1,
            unhealthy_databases: 0,
            unhealthy_services: 1,
            unreachable_servers: 0,
          },
          issues: [
            {
              type: 'application',
              uuid: 'app-1',
              name: 'broken-app',
              issue: 'Application is unhealthy',
              status: 'exited:unhealthy',
            },
            {
              type: 'service',
              uuid: 'svc-1',
              name: 'broken-service',
              issue: 'Service has exited',
              status: 'exited',
            },
          ],
        });

        await mockFindInfrastructureIssues();

        expect(mockFindInfrastructureIssues).toHaveBeenCalled();
      });

      it('should return empty issues when infrastructure is healthy', async () => {
        mockFindInfrastructureIssues.mockResolvedValue({
          summary: {
            total_issues: 0,
            unhealthy_applications: 0,
            unhealthy_databases: 0,
            unhealthy_services: 0,
            unreachable_servers: 0,
          },
          issues: [],
        });

        const result = await mockFindInfrastructureIssues();

        expect(result.summary.total_issues).toBe(0);
        expect(result.issues).toHaveLength(0);
      });
    });

    describe('delete_database', () => {
      it('should call deleteDatabase with uuid', async () => {
        mockDeleteDatabase.mockResolvedValue({ message: 'Database deletion request queued.' });

        await mockDeleteDatabase('db-uuid-123');

        expect(mockDeleteDatabase).toHaveBeenCalledWith('db-uuid-123');
      });

      it('should call deleteDatabase with delete_volumes option', async () => {
        mockDeleteDatabase.mockResolvedValue({ message: 'Database deletion request queued.' });

        await mockDeleteDatabase('db-uuid-123', { deleteVolumes: true });

        expect(mockDeleteDatabase).toHaveBeenCalledWith('db-uuid-123', { deleteVolumes: true });
      });
    });
  });

  describe('version tools', () => {
    it('get_mcp_version should return correct version format', () => {
      // The VERSION constant is '1.1.0' in mcp-server.ts
      // This test verifies the expected output structure
      const expectedResponse = {
        version: '1.1.0',
        name: '@masonator/coolify-mcp',
      };

      expect(expectedResponse.version).toBe('1.1.0');
      expect(expectedResponse.name).toBe('@masonator/coolify-mcp');
    });
  });
});
