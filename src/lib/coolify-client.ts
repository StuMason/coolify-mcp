/**
 * Coolify API Client
 * Complete HTTP client for the Coolify API v1
 */

import type {
  CoolifyConfig,
  ErrorResponse,
  DeleteOptions,
  MessageResponse,
  UuidResponse,
  // Server types
  Server,
  ServerResource,
  ServerDomain,
  ServerValidation,
  CreateServerRequest,
  UpdateServerRequest,
  // Project types
  Project,
  CreateProjectRequest,
  UpdateProjectRequest,
  // Environment types
  Environment,
  CreateEnvironmentRequest,
  // Application types
  Application,
  CreateApplicationPublicRequest,
  CreateApplicationPrivateGHRequest,
  CreateApplicationPrivateKeyRequest,
  CreateApplicationDockerfileRequest,
  CreateApplicationDockerImageRequest,
  CreateApplicationDockerComposeRequest,
  UpdateApplicationRequest,
  ApplicationActionResponse,
  // Environment variable types
  EnvironmentVariable,
  CreateEnvVarRequest,
  UpdateEnvVarRequest,
  BulkUpdateEnvVarsRequest,
  // Database types
  Database,
  UpdateDatabaseRequest,
  DatabaseBackup,
  CreateDatabaseBackupRequest,
  // Service types
  Service,
  CreateServiceRequest,
  UpdateServiceRequest,
  ServiceCreateResponse,
  // Deployment types
  Deployment,
  // Team types
  Team,
  TeamMember,
  // Private key types
  PrivateKey,
  CreatePrivateKeyRequest,
  UpdatePrivateKeyRequest,
  // Cloud token types
  CloudToken,
  CreateCloudTokenRequest,
  UpdateCloudTokenRequest,
  CloudTokenValidation,
  // Version types
  Version,
} from '../types/coolify.js';

/**
 * HTTP client for the Coolify API
 */
export class CoolifyClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;

  constructor(config: CoolifyConfig) {
    if (!config.baseUrl) {
      throw new Error('Coolify base URL is required');
    }
    if (!config.accessToken) {
      throw new Error('Coolify access token is required');
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.accessToken = config.accessToken;
  }

  // ===========================================================================
  // Private HTTP methods
  // ===========================================================================

  private async request<T>(path: string, options: RequestInit = {}): Promise<T> {
    const url = `${this.baseUrl}/api/v1${path}`;

    try {
      const response = await fetch(url, {
        ...options,
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.accessToken}`,
          ...options.headers,
        },
      });

      // Handle empty responses (204 No Content, etc.)
      const text = await response.text();
      const data = text ? JSON.parse(text) : {};

      if (!response.ok) {
        const error = data as ErrorResponse;
        throw new Error(error.message || `HTTP ${response.status}: ${response.statusText}`);
      }

      return data as T;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(
          `Failed to connect to Coolify server at ${this.baseUrl}. Please check if the server is running and accessible.`,
        );
      }
      throw error;
    }
  }

  private buildQueryString(params: Record<string, unknown>): string {
    const searchParams = new URLSearchParams();
    for (const [key, value] of Object.entries(params)) {
      if (value !== undefined && value !== null) {
        searchParams.set(key, String(value));
      }
    }
    const queryString = searchParams.toString();
    return queryString ? `?${queryString}` : '';
  }

  // ===========================================================================
  // Health & Version
  // ===========================================================================

  async getVersion(): Promise<Version> {
    return this.request<Version>('/version');
  }

  async validateConnection(): Promise<void> {
    try {
      await this.getVersion();
    } catch (error) {
      throw new Error(
        `Failed to connect to Coolify server: ${error instanceof Error ? error.message : 'Unknown error'}`,
      );
    }
  }

  // ===========================================================================
  // Server endpoints
  // ===========================================================================

  async listServers(): Promise<Server[]> {
    return this.request<Server[]>('/servers');
  }

  async getServer(uuid: string): Promise<Server> {
    return this.request<Server>(`/servers/${uuid}`);
  }

  async createServer(data: CreateServerRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>('/servers', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateServer(uuid: string, data: UpdateServerRequest): Promise<Server> {
    return this.request<Server>(`/servers/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteServer(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/servers/${uuid}`, {
      method: 'DELETE',
    });
  }

  async getServerResources(uuid: string): Promise<ServerResource[]> {
    return this.request<ServerResource[]>(`/servers/${uuid}/resources`);
  }

  async getServerDomains(uuid: string): Promise<ServerDomain[]> {
    return this.request<ServerDomain[]>(`/servers/${uuid}/domains`);
  }

  async validateServer(uuid: string): Promise<ServerValidation> {
    return this.request<ServerValidation>(`/servers/${uuid}/validate`);
  }

  // ===========================================================================
  // Project endpoints
  // ===========================================================================

  async listProjects(): Promise<Project[]> {
    return this.request<Project[]>('/projects');
  }

  async getProject(uuid: string): Promise<Project> {
    return this.request<Project>(`/projects/${uuid}`);
  }

  async createProject(data: CreateProjectRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>('/projects', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateProject(uuid: string, data: UpdateProjectRequest): Promise<Project> {
    return this.request<Project>(`/projects/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteProject(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/projects/${uuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Environment endpoints
  // ===========================================================================

  async listProjectEnvironments(projectUuid: string): Promise<Environment[]> {
    return this.request<Environment[]>(`/projects/${projectUuid}/environments`);
  }

  async getProjectEnvironment(
    projectUuid: string,
    environmentNameOrUuid: string,
  ): Promise<Environment> {
    return this.request<Environment>(`/projects/${projectUuid}/${environmentNameOrUuid}`);
  }

  async createProjectEnvironment(
    projectUuid: string,
    data: CreateEnvironmentRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>(`/projects/${projectUuid}/environments`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async deleteProjectEnvironment(environmentUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/projects/environments/${environmentUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Application endpoints
  // ===========================================================================

  async listApplications(): Promise<Application[]> {
    return this.request<Application[]>('/applications');
  }

  async getApplication(uuid: string): Promise<Application> {
    return this.request<Application>(`/applications/${uuid}`);
  }

  async createApplicationPublic(data: CreateApplicationPublicRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/public', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createApplicationPrivateGH(data: CreateApplicationPrivateGHRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/private-github-app', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createApplicationPrivateKey(
    data: CreateApplicationPrivateKeyRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/private-deploy-key', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createApplicationDockerfile(
    data: CreateApplicationDockerfileRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/dockerfile', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createApplicationDockerImage(
    data: CreateApplicationDockerImageRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/dockerimage', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createApplicationDockerCompose(
    data: CreateApplicationDockerComposeRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/dockercompose', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateApplication(uuid: string, data: UpdateApplicationRequest): Promise<Application> {
    return this.request<Application>(`/applications/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteApplication(uuid: string, options?: DeleteOptions): Promise<MessageResponse> {
    const query = this.buildQueryString({
      delete_configurations: options?.deleteConfigurations,
      delete_volumes: options?.deleteVolumes,
      docker_cleanup: options?.dockerCleanup,
      delete_connected_networks: options?.deleteConnectedNetworks,
    });
    return this.request<MessageResponse>(`/applications/${uuid}${query}`, {
      method: 'DELETE',
    });
  }

  async getApplicationLogs(uuid: string, lines: number = 100): Promise<string> {
    return this.request<string>(`/applications/${uuid}/logs?lines=${lines}`);
  }

  async startApplication(
    uuid: string,
    options?: { force?: boolean; instant_deploy?: boolean },
  ): Promise<ApplicationActionResponse> {
    const query = this.buildQueryString({
      force: options?.force,
      instant_deploy: options?.instant_deploy,
    });
    return this.request<ApplicationActionResponse>(`/applications/${uuid}/start${query}`, {
      method: 'POST',
    });
  }

  async stopApplication(uuid: string): Promise<ApplicationActionResponse> {
    return this.request<ApplicationActionResponse>(`/applications/${uuid}/stop`, {
      method: 'POST',
    });
  }

  async restartApplication(uuid: string): Promise<ApplicationActionResponse> {
    return this.request<ApplicationActionResponse>(`/applications/${uuid}/restart`, {
      method: 'POST',
    });
  }

  // ===========================================================================
  // Application Environment Variables
  // ===========================================================================

  async listApplicationEnvVars(uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(`/applications/${uuid}/envs`);
  }

  async createApplicationEnvVar(uuid: string, data: CreateEnvVarRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>(`/applications/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateApplicationEnvVar(uuid: string, data: UpdateEnvVarRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/envs`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async bulkUpdateApplicationEnvVars(
    uuid: string,
    data: BulkUpdateEnvVarsRequest,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/envs/bulk`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteApplicationEnvVar(uuid: string, envUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/envs/${envUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Database endpoints
  // ===========================================================================

  async listDatabases(): Promise<Database[]> {
    return this.request<Database[]>('/databases');
  }

  async getDatabase(uuid: string): Promise<Database> {
    return this.request<Database>(`/databases/${uuid}`);
  }

  async updateDatabase(uuid: string, data: UpdateDatabaseRequest): Promise<Database> {
    return this.request<Database>(`/databases/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteDatabase(uuid: string, options?: DeleteOptions): Promise<MessageResponse> {
    const query = this.buildQueryString({
      delete_configurations: options?.deleteConfigurations,
      delete_volumes: options?.deleteVolumes,
      docker_cleanup: options?.dockerCleanup,
      delete_connected_networks: options?.deleteConnectedNetworks,
    });
    return this.request<MessageResponse>(`/databases/${uuid}${query}`, {
      method: 'DELETE',
    });
  }

  async startDatabase(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/start`, {
      method: 'POST',
    });
  }

  async stopDatabase(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/stop`, {
      method: 'POST',
    });
  }

  async restartDatabase(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/restart`, {
      method: 'POST',
    });
  }

  // ===========================================================================
  // Database Backups
  // ===========================================================================

  async listDatabaseBackups(uuid: string): Promise<DatabaseBackup[]> {
    return this.request<DatabaseBackup[]>(`/databases/${uuid}/backups`);
  }

  async createDatabaseBackup(
    uuid: string,
    data: CreateDatabaseBackupRequest,
  ): Promise<UuidResponse & MessageResponse> {
    return this.request<UuidResponse & MessageResponse>(`/databases/${uuid}/backups`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ===========================================================================
  // Service endpoints
  // ===========================================================================

  async listServices(): Promise<Service[]> {
    return this.request<Service[]>('/services');
  }

  async getService(uuid: string): Promise<Service> {
    return this.request<Service>(`/services/${uuid}`);
  }

  async createService(data: CreateServiceRequest): Promise<ServiceCreateResponse> {
    return this.request<ServiceCreateResponse>('/services', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateService(uuid: string, data: UpdateServiceRequest): Promise<Service> {
    return this.request<Service>(`/services/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteService(uuid: string, options?: DeleteOptions): Promise<MessageResponse> {
    const query = this.buildQueryString({
      delete_configurations: options?.deleteConfigurations,
      delete_volumes: options?.deleteVolumes,
      docker_cleanup: options?.dockerCleanup,
      delete_connected_networks: options?.deleteConnectedNetworks,
    });
    return this.request<MessageResponse>(`/services/${uuid}${query}`, {
      method: 'DELETE',
    });
  }

  async startService(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/start`, {
      method: 'GET',
    });
  }

  async stopService(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/stop`, {
      method: 'GET',
    });
  }

  async restartService(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/restart`, {
      method: 'GET',
    });
  }

  // ===========================================================================
  // Service Environment Variables
  // ===========================================================================

  async listServiceEnvVars(uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(`/services/${uuid}/envs`);
  }

  async createServiceEnvVar(uuid: string, data: CreateEnvVarRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>(`/services/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateServiceEnvVar(uuid: string, data: UpdateEnvVarRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/envs`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteServiceEnvVar(uuid: string, envUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/envs/${envUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Deployment endpoints
  // ===========================================================================

  async listDeployments(): Promise<Deployment[]> {
    return this.request<Deployment[]>('/deployments');
  }

  async getDeployment(uuid: string): Promise<Deployment> {
    return this.request<Deployment>(`/deployments/${uuid}`);
  }

  async deployByTagOrUuid(tagOrUuid: string, force: boolean = false): Promise<MessageResponse> {
    return this.request<MessageResponse>(
      `/deploy?tag=${encodeURIComponent(tagOrUuid)}&force=${force}`,
      { method: 'GET' },
    );
  }

  async listApplicationDeployments(appUuid: string): Promise<Deployment[]> {
    return this.request<Deployment[]>(`/applications/${appUuid}/deployments`);
  }

  // ===========================================================================
  // Team endpoints
  // ===========================================================================

  async listTeams(): Promise<Team[]> {
    return this.request<Team[]>('/teams');
  }

  async getTeam(id: number): Promise<Team> {
    return this.request<Team>(`/teams/${id}`);
  }

  async getTeamMembers(id: number): Promise<TeamMember[]> {
    return this.request<TeamMember[]>(`/teams/${id}/members`);
  }

  async getCurrentTeam(): Promise<Team> {
    return this.request<Team>('/teams/current');
  }

  async getCurrentTeamMembers(): Promise<TeamMember[]> {
    return this.request<TeamMember[]>('/teams/current/members');
  }

  // ===========================================================================
  // Private Key endpoints
  // ===========================================================================

  async listPrivateKeys(): Promise<PrivateKey[]> {
    return this.request<PrivateKey[]>('/security/keys');
  }

  async getPrivateKey(uuid: string): Promise<PrivateKey> {
    return this.request<PrivateKey>(`/security/keys/${uuid}`);
  }

  async createPrivateKey(data: CreatePrivateKeyRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>('/security/keys', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updatePrivateKey(uuid: string, data: UpdatePrivateKeyRequest): Promise<PrivateKey> {
    return this.request<PrivateKey>(`/security/keys/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deletePrivateKey(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/security/keys/${uuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Cloud Token endpoints (Hetzner, DigitalOcean)
  // ===========================================================================

  async listCloudTokens(): Promise<CloudToken[]> {
    return this.request<CloudToken[]>('/cloud-tokens');
  }

  async getCloudToken(uuid: string): Promise<CloudToken> {
    return this.request<CloudToken>(`/cloud-tokens/${uuid}`);
  }

  async createCloudToken(data: CreateCloudTokenRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>('/cloud-tokens', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateCloudToken(uuid: string, data: UpdateCloudTokenRequest): Promise<CloudToken> {
    return this.request<CloudToken>(`/cloud-tokens/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteCloudToken(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/cloud-tokens/${uuid}`, {
      method: 'DELETE',
    });
  }

  async validateCloudToken(uuid: string): Promise<CloudTokenValidation> {
    return this.request<CloudTokenValidation>(`/cloud-tokens/${uuid}/validate`, { method: 'POST' });
  }
}
