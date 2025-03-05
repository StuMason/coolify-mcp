import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import { CoolifyClient } from './coolify-client.js';
import {
  CoolifyConfig,
  ServerInfo,
  ServerResources,
  ServerDomain,
  ValidationResponse,
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  Environment,
  Application,
  CreateApplicationRequest,
  Deployment,
  LogEntry,
} from '../types/coolify.js';
import { z } from 'zod';

export class CoolifyMcpServer {
  private server: McpServer;
  private client: CoolifyClient;

  constructor(config: CoolifyConfig) {
    this.server = new McpServer({
      name: 'coolify',
      version: '0.1.0',
    });

    this.client = new CoolifyClient(config);
    this.setupTools();
  }

  private setupTools(): void {
    this.server.tool('list_servers', 'List all Coolify servers', {}, async () => {
      try {
        const servers = await this.client.listServers();
        return {
          content: [{ type: 'text', text: JSON.stringify(servers) }],
          isError: false,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text', text: errorMessage }],
          isError: true,
        };
      }
    });

    this.server.tool(
      'get_server',
      'Get details about a specific Coolify server',
      { uuid: z.string().describe('UUID of the server to get details for') },
      async (params) => {
        try {
          const server = await this.client.getServer(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(server) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'get_server_resources',
      'Get the current resources running on a specific Coolify server',
      { uuid: z.string().describe('UUID of the server to get resources for') },
      async (params) => {
        try {
          const resources = await this.client.getServerResources(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(resources) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'get_server_domains',
      'Get the domains associated with a specific Coolify server',
      { uuid: z.string().describe('UUID of the server to get domains for') },
      async (params) => {
        try {
          const domains = await this.client.getServerDomains(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(domains) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'validate_server',
      'Validate the connection to a specific Coolify server',
      { uuid: z.string().describe('UUID of the server to validate') },
      async (params) => {
        try {
          const result = await this.client.validateServer(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool('list_projects', 'List all Coolify projects', {}, async () => {
      try {
        const projects = await this.client.listProjects();
        return {
          content: [{ type: 'text', text: JSON.stringify(projects) }],
          isError: false,
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        return {
          content: [{ type: 'text', text: errorMessage }],
          isError: true,
        };
      }
    });

    this.server.tool(
      'get_project',
      'Get details about a specific Coolify project',
      { uuid: z.string().describe('UUID of the project to get details for') },
      async (params) => {
        try {
          const project = await this.client.getProject(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(project) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'create_project',
      'Create a new Coolify project',
      {
        name: z.string().describe('Name of the project'),
        description: z.string().optional().describe('Optional description of the project'),
      },
      async (params) => {
        try {
          const result = await this.client.createProject(params);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'update_project',
      'Update an existing Coolify project',
      {
        uuid: z.string().describe('UUID of the project to update'),
        name: z.string().optional().describe('New name for the project'),
        description: z.string().optional().describe('New description for the project'),
      },
      async (params) => {
        try {
          const { uuid, ...updateData } = params;
          const result = await this.client.updateProject(uuid, updateData);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'delete_project',
      'Delete a Coolify project',
      { uuid: z.string().describe('UUID of the project to delete') },
      async (params) => {
        try {
          const result = await this.client.deleteProject(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(result) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'get_project_environment',
      'Get details about a specific environment in a project',
      {
        project_uuid: z.string().describe('UUID of the project'),
        environment_name_or_uuid: z.string().describe('Name or UUID of the environment'),
      },
      async (params) => {
        try {
          const environment = await this.client.getProjectEnvironment(
            params.project_uuid,
            params.environment_name_or_uuid,
          );
          return {
            content: [{ type: 'text', text: JSON.stringify(environment) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'list_applications',
      'List all applications or filter by environment',
      {
        environment_uuid: z
          .string()
          .optional()
          .describe('Optional UUID of the environment to filter by'),
      },
      async (params) => {
        try {
          const applications = await this.client.listApplications(params.environment_uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(applications) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'get_application',
      'Get details about a specific application',
      {
        uuid: z.string().describe('UUID of the application to get details for'),
      },
      async (params) => {
        try {
          const application = await this.client.getApplication(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(application) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'create_application',
      'Create a new application from a public repository',
      {
        project_uuid: z.string().describe('UUID of the project'),
        environment_uuid: z.string().describe('UUID of the environment'),
        git_repository: z.string().describe('URL of the git repository'),
        git_branch: z.string().describe('Branch to deploy'),
        build_pack: z
          .enum(['nixpacks', 'static', 'dockerfile', 'dockercompose'])
          .describe('Build pack to use'),
        ports_exposes: z.string().describe('Ports to expose (comma-separated)'),
        name: z.string().optional().describe('Optional name for the application'),
      },
      async (params) => {
        try {
          const application = await this.client.createApplication(params);
          return {
            content: [{ type: 'text', text: JSON.stringify(application) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'delete_application',
      'Delete an application',
      {
        uuid: z.string().describe('UUID of the application to delete'),
      },
      async (params) => {
        try {
          await this.client.deleteApplication(params.uuid);
          return {
            content: [{ type: 'text', text: 'Application deleted successfully' }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'deploy_application',
      'Trigger a deployment for an application',
      {
        uuid: z.string().describe('UUID of the application to deploy'),
      },
      async (params) => {
        try {
          const deployment = await this.client.deployApplication(params.uuid);
          return {
            content: [{ type: 'text', text: JSON.stringify(deployment) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    this.server.tool(
      'get_application_logs',
      'Get logs for an application',
      {
        uuid: z.string().describe('UUID of the application'),
        since: z.string().optional().describe('Optional timestamp to get logs since (ISO format)'),
      },
      async (params) => {
        try {
          const logs = await this.client.getApplicationLogs(params.uuid, params.since);
          return {
            content: [{ type: 'text', text: JSON.stringify(logs) }],
            isError: false,
          };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          return {
            content: [{ type: 'text', text: errorMessage }],
            isError: true,
          };
        }
      },
    );

    // End of tool definitions
  }

  async start(transport: Transport): Promise<void> {
    await this.client.validateConnection();
    await this.server.connect(transport);
  }

  async list_servers(): Promise<ServerInfo[]> {
    return this.client.listServers();
  }

  async get_server(uuid: string): Promise<ServerInfo> {
    return this.client.getServer(uuid);
  }

  async get_server_resources(uuid: string): Promise<ServerResources> {
    return this.client.getServerResources(uuid);
  }

  async get_server_domains(uuid: string): Promise<ServerDomain[]> {
    return this.client.getServerDomains(uuid);
  }

  async validate_server(uuid: string): Promise<ValidationResponse> {
    return this.client.validateServer(uuid);
  }

  async list_projects(): Promise<Project[]> {
    return this.client.listProjects();
  }

  async get_project(uuid: string): Promise<Project> {
    return this.client.getProject(uuid);
  }

  async create_project(project: CreateProjectRequest): Promise<{ uuid: string }> {
    return this.client.createProject(project);
  }

  async update_project(uuid: string, project: UpdateProjectRequest): Promise<Project> {
    return this.client.updateProject(uuid, project);
  }

  async delete_project(uuid: string): Promise<{ message: string }> {
    return this.client.deleteProject(uuid);
  }

  async get_project_environment(
    projectUuid: string,
    environmentNameOrUuid: string,
  ): Promise<Environment> {
    return this.client.getProjectEnvironment(projectUuid, environmentNameOrUuid);
  }

  async list_applications(environmentUuid?: string): Promise<Application[]> {
    return this.client.listApplications(environmentUuid);
  }

  async get_application(uuid: string): Promise<Application> {
    return this.client.getApplication(uuid);
  }

  async create_application(application: CreateApplicationRequest): Promise<{ uuid: string }> {
    return this.client.createApplication(application);
  }

  async delete_application(uuid: string): Promise<{ message: string }> {
    await this.client.deleteApplication(uuid);
    return { message: 'Application deleted successfully' };
  }

  async deploy_application(uuid: string): Promise<Deployment> {
    return this.client.deployApplication(uuid);
  }

  async get_application_logs(uuid: string, since?: string): Promise<LogEntry[]> {
    return this.client.getApplicationLogs(uuid, since);
  }
}
