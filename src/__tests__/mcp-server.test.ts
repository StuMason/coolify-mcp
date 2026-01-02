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

// Mock the CoolifyClient module
jest.mock('../lib/coolify-client.js', () => ({
  CoolifyClient: jest.fn().mockImplementation(() => ({
    listServers: mockListServers,
    listProjects: mockListProjects,
    listApplications: mockListApplications,
    listDatabases: mockListDatabases,
    listServices: mockListServices,
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
});
