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
  EnvVarSummary,
  CreateEnvVarRequest,
  UpdateEnvVarRequest,
  BulkUpdateEnvVarsRequest,
  // Database types
  Database,
  UpdateDatabaseRequest,
  CreatePostgresqlRequest,
  CreateMysqlRequest,
  CreateMariadbRequest,
  CreateMongodbRequest,
  CreateRedisRequest,
  CreateKeydbRequest,
  CreateClickhouseRequest,
  CreateDragonflyRequest,
  CreateDatabaseResponse,
  DatabaseBackup,
  BackupExecution,
  CreateDatabaseBackupRequest,
  UpdateDatabaseBackupRequest,
  // Service types
  Service,
  CreateServiceRequest,
  UpdateServiceRequest,
  ServiceCreateResponse,
  // Deployment types
  Deployment,
  DeploymentEssential,
  // Team types
  Team,
  TeamMember,
  // Private key types
  PrivateKey,
  CreatePrivateKeyRequest,
  UpdatePrivateKeyRequest,
  // GitHub App types
  GitHubApp,
  CreateGitHubAppRequest,
  UpdateGitHubAppRequest,
  GitHubAppUpdateResponse,
  // Cloud token types
  CloudToken,
  CreateCloudTokenRequest,
  UpdateCloudTokenRequest,
  CloudTokenValidation,
  // Version types
  Version,
  // Diagnostic types
  DiagnosticHealthStatus,
  ApplicationDiagnostic,
  ServerDiagnostic,
  InfrastructureIssue,
  InfrastructureIssuesReport,
  // Batch operation types
  BatchOperationResult,
} from '../types/coolify.js';

// =============================================================================
// List Options & Summary Types
// =============================================================================

export interface ListOptions {
  page?: number;
  per_page?: number;
  summary?: boolean;
}

export interface PaginatedResponse<T> {
  data: T[];
  total?: number;
  page?: number;
  per_page?: number;
}

// Summary types - reduced versions for list endpoints
export interface ServerSummary {
  uuid: string;
  name: string;
  ip: string;
  status?: string;
  is_reachable?: boolean;
}

export interface ApplicationSummary {
  uuid: string;
  name: string;
  status?: string;
  fqdn?: string;
  git_repository?: string;
  git_branch?: string;
}

export interface DatabaseSummary {
  uuid: string;
  name: string;
  type: string;
  status: string;
  is_public: boolean;
}

export interface ServiceSummary {
  uuid: string;
  name: string;
  type: string;
  status: string;
  domains?: string[];
}

export interface DeploymentSummary {
  uuid: string;
  deployment_uuid: string;
  application_name?: string;
  status: string;
  created_at: string;
}

export interface ProjectSummary {
  uuid: string;
  name: string;
  description?: string;
}

export interface GitHubAppSummary {
  id: number;
  uuid: string;
  name: string;
  organization: string | null;
  is_public: boolean;
  app_id: number | null;
}

/**
 * Remove undefined values from an object.
 * Keeps explicit false values so features like HTTP Basic Auth can be disabled.
 */
function cleanRequestData<T extends object>(data: T): Partial<T> {
  const cleaned: Partial<T> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined) {
      (cleaned as Record<string, unknown>)[key] = value;
    }
  }
  return cleaned;
}

// =============================================================================
// Summary Transformers - reduce full objects to essential fields
// =============================================================================

function toServerSummary(server: Server): ServerSummary {
  return {
    uuid: server.uuid,
    name: server.name,
    ip: server.ip,
    status: server.status,
    is_reachable: server.is_reachable,
  };
}

function toApplicationSummary(app: Application): ApplicationSummary {
  return {
    uuid: app.uuid,
    name: app.name,
    status: app.status,
    fqdn: app.fqdn,
    git_repository: app.git_repository,
    git_branch: app.git_branch,
  };
}

function toDatabaseSummary(db: Database): DatabaseSummary {
  return {
    uuid: db.uuid,
    name: db.name,
    type: db.type,
    status: db.status,
    is_public: db.is_public,
  };
}

function toServiceSummary(svc: Service): ServiceSummary {
  return {
    uuid: svc.uuid,
    name: svc.name,
    type: svc.type,
    status: svc.status,
    domains: svc.domains,
  };
}

function toDeploymentSummary(dep: Deployment): DeploymentSummary {
  return {
    uuid: dep.uuid,
    deployment_uuid: dep.deployment_uuid,
    application_name: dep.application_name,
    status: dep.status,
    created_at: dep.created_at,
  };
}

function toDeploymentEssential(dep: Deployment): DeploymentEssential {
  return {
    uuid: dep.uuid,
    deployment_uuid: dep.deployment_uuid,
    application_uuid: dep.application_uuid,
    application_name: dep.application_name,
    server_name: dep.server_name,
    status: dep.status,
    commit: dep.commit,
    force_rebuild: dep.force_rebuild,
    is_webhook: dep.is_webhook,
    is_api: dep.is_api,
    created_at: dep.created_at,
    updated_at: dep.updated_at,
    logs_truncated: !!dep.logs,
    logs_info: dep.logs
      ? `Logs available (${dep.logs.length} chars). Use lines param to retrieve.`
      : undefined,
  };
}

function toProjectSummary(proj: Project): ProjectSummary {
  return {
    uuid: proj.uuid,
    name: proj.name,
    description: proj.description,
  };
}

function toGitHubAppSummary(app: GitHubApp): GitHubAppSummary {
  return {
    id: app.id,
    uuid: app.uuid,
    name: app.name,
    organization: app.organization,
    is_public: app.is_public,
    app_id: app.app_id,
  };
}

function toEnvVarSummary(envVar: EnvironmentVariable): EnvVarSummary {
  return {
    uuid: envVar.uuid,
    key: envVar.key,
    value: envVar.value,
    is_build_time: envVar.is_build_time,
  };
}

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
        // Include validation errors if present
        let errorMessage = error.message || `HTTP ${response.status}: ${response.statusText}`;
        if (error.errors && Object.keys(error.errors).length > 0) {
          const validationDetails = Object.entries(error.errors)
            .map(([field, messages]) => `${field}: ${messages.join(', ')}`)
            .join('; ');
          errorMessage = `${errorMessage} - ${validationDetails}`;
        }
        throw new Error(errorMessage);
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
    // The /version endpoint returns plain text, not JSON
    const url = `${this.baseUrl}/api/v1/version`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const version = await response.text();
    return { version: version.trim() };
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

  async listServers(options?: ListOptions): Promise<Server[] | ServerSummary[]> {
    const query = this.buildQueryString({
      page: options?.page,
      per_page: options?.per_page,
    });
    const servers = await this.request<Server[]>(`/servers${query}`);
    return options?.summary && Array.isArray(servers) ? servers.map(toServerSummary) : servers;
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

  async listProjects(options?: ListOptions): Promise<Project[] | ProjectSummary[]> {
    const query = this.buildQueryString({
      page: options?.page,
      per_page: options?.per_page,
    });
    const projects = await this.request<Project[]>(`/projects${query}`);
    return options?.summary && Array.isArray(projects) ? projects.map(toProjectSummary) : projects;
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

  async deleteProjectEnvironment(
    projectUuid: string,
    environmentNameOrUuid: string,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(
      `/projects/${projectUuid}/environments/${environmentNameOrUuid}`,
      {
        method: 'DELETE',
      },
    );
  }

  // ===========================================================================
  // Application endpoints
  // ===========================================================================

  async listApplications(options?: ListOptions): Promise<Application[] | ApplicationSummary[]> {
    const query = this.buildQueryString({
      page: options?.page,
      per_page: options?.per_page,
    });
    const apps = await this.request<Application[]>(`/applications${query}`);
    return options?.summary && Array.isArray(apps) ? apps.map(toApplicationSummary) : apps;
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

  async listApplicationEnvVars(
    uuid: string,
    options?: { summary?: boolean },
  ): Promise<EnvironmentVariable[] | EnvVarSummary[]> {
    const envVars = await this.request<EnvironmentVariable[]>(`/applications/${uuid}/envs`);
    return options?.summary ? envVars.map(toEnvVarSummary) : envVars;
  }

  async createApplicationEnvVar(uuid: string, data: CreateEnvVarRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>(`/applications/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(cleanRequestData(data)),
    });
  }

  async updateApplicationEnvVar(uuid: string, data: UpdateEnvVarRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/envs`, {
      method: 'PATCH',
      body: JSON.stringify(cleanRequestData(data)),
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

  async listDatabases(options?: ListOptions): Promise<Database[] | DatabaseSummary[]> {
    const query = this.buildQueryString({
      page: options?.page,
      per_page: options?.per_page,
    });
    const dbs = await this.request<Database[]>(`/databases${query}`);
    return options?.summary && Array.isArray(dbs) ? dbs.map(toDatabaseSummary) : dbs;
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

  // Database creation methods
  async createPostgresql(data: CreatePostgresqlRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/postgresql', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createMysql(data: CreateMysqlRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/mysql', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createMariadb(data: CreateMariadbRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/mariadb', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createMongodb(data: CreateMongodbRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/mongodb', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createRedis(data: CreateRedisRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/redis', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createKeydb(data: CreateKeydbRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/keydb', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createClickhouse(data: CreateClickhouseRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/clickhouse', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async createDragonfly(data: CreateDragonflyRequest): Promise<CreateDatabaseResponse> {
    return this.request<CreateDatabaseResponse>('/databases/dragonfly', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ===========================================================================
  // Service endpoints
  // ===========================================================================

  async listServices(options?: ListOptions): Promise<Service[] | ServiceSummary[]> {
    const query = this.buildQueryString({
      page: options?.page,
      per_page: options?.per_page,
    });
    const services = await this.request<Service[]>(`/services${query}`);
    return options?.summary && Array.isArray(services) ? services.map(toServiceSummary) : services;
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
      body: JSON.stringify(cleanRequestData(data)),
    });
  }

  async updateServiceEnvVar(uuid: string, data: UpdateEnvVarRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/envs`, {
      method: 'PATCH',
      body: JSON.stringify(cleanRequestData(data)),
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

  async listDeployments(options?: ListOptions): Promise<Deployment[] | DeploymentSummary[]> {
    const query = this.buildQueryString({
      page: options?.page,
      per_page: options?.per_page,
    });
    const deployments = await this.request<Deployment[]>(`/deployments${query}`);
    return options?.summary && Array.isArray(deployments)
      ? deployments.map(toDeploymentSummary)
      : deployments;
  }

  async getDeployment(
    uuid: string,
    options?: { includeLogs?: boolean },
  ): Promise<Deployment | DeploymentEssential> {
    const deployment = await this.request<Deployment>(`/deployments/${uuid}`);
    return options?.includeLogs ? deployment : toDeploymentEssential(deployment);
  }

  async deployByTagOrUuid(tagOrUuid: string, force: boolean = false): Promise<MessageResponse> {
    // Detect if the value looks like a UUID or a tag name
    const param = this.isLikelyUuid(tagOrUuid) ? 'uuid' : 'tag';
    return this.request<MessageResponse>(
      `/deploy?${param}=${encodeURIComponent(tagOrUuid)}&force=${force}`,
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
  // GitHub App endpoints
  // ===========================================================================

  async listGitHubApps(options?: ListOptions): Promise<GitHubApp[] | GitHubAppSummary[]> {
    const apps = await this.request<GitHubApp[]>('/github-apps');
    return options?.summary && Array.isArray(apps) ? apps.map(toGitHubAppSummary) : apps;
  }

  async createGitHubApp(data: CreateGitHubAppRequest): Promise<GitHubApp> {
    return this.request<GitHubApp>('/github-apps', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateGitHubApp(
    id: number,
    data: UpdateGitHubAppRequest,
  ): Promise<GitHubAppUpdateResponse> {
    return this.request<GitHubAppUpdateResponse>(`/github-apps/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(cleanRequestData(data)),
    });
  }

  async deleteGitHubApp(id: number): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/github-apps/${id}`, {
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

  // ===========================================================================
  // Database Backup endpoints
  // ===========================================================================

  async listDatabaseBackups(databaseUuid: string): Promise<DatabaseBackup[]> {
    return this.request<DatabaseBackup[]>(`/databases/${databaseUuid}/backups`);
  }

  async getDatabaseBackup(databaseUuid: string, backupUuid: string): Promise<DatabaseBackup> {
    return this.request<DatabaseBackup>(`/databases/${databaseUuid}/backups/${backupUuid}`);
  }

  async listBackupExecutions(databaseUuid: string, backupUuid: string): Promise<BackupExecution[]> {
    return this.request<BackupExecution[]>(
      `/databases/${databaseUuid}/backups/${backupUuid}/executions`,
    );
  }

  async getBackupExecution(
    databaseUuid: string,
    backupUuid: string,
    executionUuid: string,
  ): Promise<BackupExecution> {
    return this.request<BackupExecution>(
      `/databases/${databaseUuid}/backups/${backupUuid}/executions/${executionUuid}`,
    );
  }

  async createDatabaseBackup(
    databaseUuid: string,
    data: CreateDatabaseBackupRequest,
  ): Promise<DatabaseBackup> {
    return this.request<DatabaseBackup>(`/databases/${databaseUuid}/backups`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDatabaseBackup(
    databaseUuid: string,
    backupUuid: string,
    data: UpdateDatabaseBackupRequest,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${databaseUuid}/backups/${backupUuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteDatabaseBackup(databaseUuid: string, backupUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${databaseUuid}/backups/${backupUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Deployment Control endpoints
  // ===========================================================================

  async cancelDeployment(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/deployments/${uuid}/cancel`, {
      method: 'POST',
    });
  }

  // ===========================================================================
  // Smart Lookup Helpers
  // ===========================================================================

  /**
   * Check if a string looks like a UUID (Coolify format or standard format).
   * Coolify UUIDs are alphanumeric strings, typically 24 chars like "xs0sgs4gog044s4k4c88kgsc"
   * Also accepts standard UUID format with hyphens like "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
   */
  private isLikelyUuid(query: string): boolean {
    // Coolify UUID format: alphanumeric, 20+ chars
    if (/^[a-z0-9]{20,}$/i.test(query)) {
      return true;
    }
    // Standard UUID format with hyphens (8-4-4-4-12)
    if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(query)) {
      return true;
    }
    return false;
  }

  /**
   * Find an application by UUID, name, or domain (FQDN).
   * Returns the UUID if found, throws if not found or multiple matches.
   */
  async resolveApplicationUuid(query: string): Promise<string> {
    // If it looks like a UUID, use it directly
    if (this.isLikelyUuid(query)) {
      return query;
    }

    // Otherwise, search by name or domain
    const apps = (await this.listApplications()) as Application[];
    const queryLower = query.toLowerCase();

    const matches = apps.filter((app) => {
      const nameMatch = app.name?.toLowerCase().includes(queryLower);
      const fqdnMatch = app.fqdn?.toLowerCase().includes(queryLower);
      return nameMatch || fqdnMatch;
    });

    if (matches.length === 0) {
      throw new Error(`No application found matching "${query}"`);
    }
    if (matches.length > 1) {
      const matchList = matches.map((a) => `${a.name} (${a.fqdn || 'no domain'})`).join(', ');
      throw new Error(
        `Multiple applications match "${query}": ${matchList}. Please be more specific or use a UUID.`,
      );
    }

    return matches[0].uuid;
  }

  /**
   * Find a server by UUID, name, or IP address.
   * Returns the UUID if found, throws if not found or multiple matches.
   */
  async resolveServerUuid(query: string): Promise<string> {
    // If it looks like a UUID, use it directly
    if (this.isLikelyUuid(query)) {
      return query;
    }

    // Otherwise, search by name or IP
    const servers = (await this.listServers()) as Server[];
    const queryLower = query.toLowerCase();

    const matches = servers.filter((server) => {
      const nameMatch = server.name?.toLowerCase().includes(queryLower);
      const ipMatch = server.ip?.toLowerCase().includes(queryLower);
      return nameMatch || ipMatch;
    });

    if (matches.length === 0) {
      throw new Error(`No server found matching "${query}"`);
    }
    if (matches.length > 1) {
      const matchList = matches.map((s) => `${s.name} (${s.ip})`).join(', ');
      throw new Error(
        `Multiple servers match "${query}": ${matchList}. Please be more specific or use a UUID.`,
      );
    }

    return matches[0].uuid;
  }

  // ===========================================================================
  // Diagnostic endpoints (composite tools)
  // ===========================================================================

  /**
   * Get comprehensive diagnostic info for an application.
   * Aggregates: application details, logs, env vars, recent deployments.
   * @param query - Application UUID, name, or domain (FQDN)
   */
  async diagnoseApplication(query: string): Promise<ApplicationDiagnostic> {
    // Resolve query to UUID
    let uuid: string;
    try {
      uuid = await this.resolveApplicationUuid(query);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        application: null,
        health: { status: 'unknown', issues: [] },
        logs: null,
        environment_variables: { count: 0, variables: [] },
        recent_deployments: [],
        errors: [msg],
      };
    }

    const results = await Promise.allSettled([
      this.getApplication(uuid),
      this.getApplicationLogs(uuid, 50),
      this.listApplicationEnvVars(uuid),
      this.listApplicationDeployments(uuid),
    ]);

    const errors: string[] = [];

    const extract = <T>(result: PromiseSettledResult<T>, name: string): T | null => {
      if (result.status === 'fulfilled') return result.value;
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${name}: ${msg}`);
      return null;
    };

    const app = extract(results[0], 'application');
    const logs = extract(results[1], 'logs');
    const envVars = extract(results[2], 'environment_variables');
    const deployments = extract(results[3], 'deployments');

    // Determine health status and issues
    const issues: string[] = [];
    let healthStatus: DiagnosticHealthStatus = 'unknown';

    if (app) {
      const status = app.status || '';
      if (status.includes('running') && status.includes('healthy')) {
        healthStatus = 'healthy';
      } else if (
        status.includes('exited') ||
        status.includes('unhealthy') ||
        status.includes('error')
      ) {
        healthStatus = 'unhealthy';
        issues.push(`Status: ${status}`);
      } else if (status.includes('running')) {
        healthStatus = 'healthy';
      } else {
        issues.push(`Status: ${status}`);
      }
    }

    // Check for failed deployments
    if (deployments) {
      const recentFailed = deployments.slice(0, 5).filter((d) => d.status === 'failed');
      if (recentFailed.length > 0) {
        issues.push(`${recentFailed.length} failed deployment(s) in last 5`);
        if (healthStatus === 'healthy') healthStatus = 'unhealthy';
      }
    }

    return {
      application: app
        ? {
            uuid: app.uuid,
            name: app.name,
            status: app.status || 'unknown',
            fqdn: app.fqdn || null,
            git_repository: app.git_repository || null,
            git_branch: app.git_branch || null,
          }
        : null,
      health: {
        status: healthStatus,
        issues,
      },
      logs: typeof logs === 'string' ? logs : null,
      environment_variables: {
        count: envVars?.length || 0,
        variables: (envVars || []).map((v) => ({
          key: v.key,
          is_build_time: v.is_build_time ?? false,
        })),
      },
      recent_deployments: (deployments || []).slice(0, 5).map((d) => ({
        uuid: d.uuid,
        status: d.status,
        created_at: d.created_at,
      })),
      ...(errors.length > 0 && { errors }),
    };
  }

  /**
   * Get comprehensive diagnostic info for a server.
   * Aggregates: server details, resources, domains, validation.
   * @param query - Server UUID, name, or IP address
   */
  async diagnoseServer(query: string): Promise<ServerDiagnostic> {
    // Resolve query to UUID
    let uuid: string;
    try {
      uuid = await this.resolveServerUuid(query);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      return {
        server: null,
        health: { status: 'unknown', issues: [] },
        resources: [],
        domains: [],
        validation: null,
        errors: [msg],
      };
    }

    const results = await Promise.allSettled([
      this.getServer(uuid),
      this.getServerResources(uuid),
      this.getServerDomains(uuid),
      this.validateServer(uuid),
    ]);

    const errors: string[] = [];

    const extract = <T>(result: PromiseSettledResult<T>, name: string): T | null => {
      if (result.status === 'fulfilled') return result.value;
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${name}: ${msg}`);
      return null;
    };

    const server = extract(results[0], 'server');
    const resources = extract(results[1], 'resources');
    const domains = extract(results[2], 'domains');
    const validation = extract(results[3], 'validation');

    // Determine health status and issues
    const issues: string[] = [];
    let healthStatus: DiagnosticHealthStatus = 'unknown';

    if (server) {
      if (server.is_reachable === true) {
        healthStatus = 'healthy';
      } else if (server.is_reachable === false) {
        healthStatus = 'unhealthy';
        issues.push('Server is not reachable');
      }

      if (server.is_usable === false) {
        issues.push('Server is not usable');
        healthStatus = 'unhealthy';
      }
    }

    // Check for unhealthy resources
    if (resources) {
      const unhealthyResources = resources.filter(
        (r) =>
          r.status.includes('exited') ||
          r.status.includes('unhealthy') ||
          r.status.includes('error'),
      );
      if (unhealthyResources.length > 0) {
        issues.push(`${unhealthyResources.length} unhealthy resource(s)`);
      }
    }

    return {
      server: server
        ? {
            uuid: server.uuid,
            name: server.name,
            ip: server.ip,
            status: server.status || null,
            is_reachable: server.is_reachable ?? null,
          }
        : null,
      health: {
        status: healthStatus,
        issues,
      },
      resources: (resources || []).map((r) => ({
        uuid: r.uuid,
        name: r.name,
        type: r.type,
        status: r.status,
      })),
      domains: (domains || []).map((d) => ({
        ip: d.ip,
        domains: d.domains,
      })),
      validation: validation
        ? {
            message: validation.message,
            ...(validation.validation_logs && { validation_logs: validation.validation_logs }),
          }
        : null,
      ...(errors.length > 0 && { errors }),
    };
  }

  /**
   * Scan infrastructure for common issues.
   * Finds: unreachable servers, unhealthy apps, exited databases, stopped services.
   */
  async findInfrastructureIssues(): Promise<InfrastructureIssuesReport> {
    const results = await Promise.allSettled([
      this.listServers(),
      this.listApplications(),
      this.listDatabases(),
      this.listServices(),
    ]);

    const errors: string[] = [];
    const issues: InfrastructureIssue[] = [];

    const extract = <T>(result: PromiseSettledResult<T>, name: string): T | null => {
      if (result.status === 'fulfilled') return result.value;
      const msg = result.reason instanceof Error ? result.reason.message : String(result.reason);
      errors.push(`${name}: ${msg}`);
      return null;
    };

    const servers = extract(results[0], 'servers') as Server[] | null;
    const applications = extract(results[1], 'applications') as Application[] | null;
    const databases = extract(results[2], 'databases') as Database[] | null;
    const services = extract(results[3], 'services') as Service[] | null;

    // Check servers for unreachable
    if (servers) {
      for (const server of servers) {
        if (server.is_reachable === false) {
          issues.push({
            type: 'server',
            uuid: server.uuid,
            name: server.name,
            issue: 'Server is not reachable',
            status: server.status || 'unreachable',
          });
        }
      }
    }

    // Check applications for unhealthy status
    if (applications) {
      for (const app of applications) {
        const status = app.status || '';
        if (
          status.includes('exited') ||
          status.includes('unhealthy') ||
          status.includes('error') ||
          status === 'stopped'
        ) {
          issues.push({
            type: 'application',
            uuid: app.uuid,
            name: app.name,
            issue: `Application status: ${status}`,
            status,
          });
        }
      }
    }

    // Check databases for unhealthy status
    if (databases) {
      for (const db of databases) {
        const status = db.status || '';
        if (
          status.includes('exited') ||
          status.includes('unhealthy') ||
          status.includes('error') ||
          status === 'stopped'
        ) {
          issues.push({
            type: 'database',
            uuid: db.uuid,
            name: db.name,
            issue: `Database status: ${status}`,
            status,
          });
        }
      }
    }

    // Check services for unhealthy status
    if (services) {
      for (const svc of services) {
        const status = svc.status || '';
        if (
          status.includes('exited') ||
          status.includes('unhealthy') ||
          status.includes('error') ||
          status === 'stopped'
        ) {
          issues.push({
            type: 'service',
            uuid: svc.uuid,
            name: svc.name,
            issue: `Service status: ${status}`,
            status,
          });
        }
      }
    }

    return {
      summary: {
        total_issues: issues.length,
        unhealthy_applications: issues.filter((i) => i.type === 'application').length,
        unhealthy_databases: issues.filter((i) => i.type === 'database').length,
        unhealthy_services: issues.filter((i) => i.type === 'service').length,
        unreachable_servers: issues.filter((i) => i.type === 'server').length,
      },
      issues,
      ...(errors.length > 0 && { errors }),
    };
  }

  // ===========================================================================
  // Batch Operations
  // ===========================================================================

  /**
   * Aggregate results from Promise.allSettled into a BatchOperationResult.
   */
  private aggregateBatchResults(
    resources: Array<{ uuid: string; name?: string }>,
    results: PromiseSettledResult<unknown>[],
  ): BatchOperationResult {
    const succeeded: Array<{ uuid: string; name: string }> = [];
    const failed: Array<{ uuid: string; name: string; error: string }> = [];

    results.forEach((result, index) => {
      const resource = resources[index];
      const name = resource.name || resource.uuid;

      if (result.status === 'fulfilled') {
        succeeded.push({ uuid: resource.uuid, name });
      } else {
        const error =
          result.reason instanceof Error ? result.reason.message : String(result.reason);
        failed.push({ uuid: resource.uuid, name, error });
      }
    });

    return {
      summary: {
        total: resources.length,
        succeeded: succeeded.length,
        failed: failed.length,
      },
      succeeded,
      failed,
    };
  }

  /**
   * Restart all applications in a project.
   * @param projectUuid - Project UUID
   */
  async restartProjectApps(projectUuid: string): Promise<BatchOperationResult> {
    const allApps = (await this.listApplications()) as Application[];
    const projectApps = allApps.filter((app) => app.project_uuid === projectUuid);

    if (projectApps.length === 0) {
      return {
        summary: { total: 0, succeeded: 0, failed: 0 },
        succeeded: [],
        failed: [],
      };
    }

    const results = await Promise.allSettled(
      projectApps.map((app) => this.restartApplication(app.uuid)),
    );

    return this.aggregateBatchResults(projectApps, results);
  }

  /**
   * Update or create an environment variable across multiple applications.
   * Uses upsert behavior: creates if not exists, updates if exists.
   * @param appUuids - Array of application UUIDs
   * @param key - Environment variable key
   * @param value - Environment variable value
   * @param isBuildTime - Whether this is a build-time variable (default: false)
   */
  async bulkEnvUpdate(
    appUuids: string[],
    key: string,
    value: string,
    isBuildTime: boolean = false,
  ): Promise<BatchOperationResult> {
    // Early return for empty array - avoid unnecessary API call
    if (appUuids.length === 0) {
      return {
        summary: { total: 0, succeeded: 0, failed: 0 },
        succeeded: [],
        failed: [],
      };
    }

    // Get app names first for better response
    const allApps = (await this.listApplications()) as Application[];
    const appMap = new Map(allApps.map((a) => [a.uuid, a.name || a.uuid]));

    // Build the resource list with names
    const resources = appUuids.map((uuid) => ({
      uuid,
      name: appMap.get(uuid) || uuid,
    }));

    const results = await Promise.allSettled(
      appUuids.map((uuid) =>
        this.updateApplicationEnvVar(uuid, { key, value, is_build_time: isBuildTime }),
      ),
    );

    return this.aggregateBatchResults(resources, results);
  }

  /**
   * Emergency stop all running applications across entire infrastructure.
   */
  async stopAllApps(): Promise<BatchOperationResult> {
    const allApps = (await this.listApplications()) as Application[];

    // Only stop running apps
    const runningApps = allApps.filter((app) => {
      const status = app.status || '';
      return status.includes('running') || status.includes('healthy');
    });

    if (runningApps.length === 0) {
      return {
        summary: { total: 0, succeeded: 0, failed: 0 },
        succeeded: [],
        failed: [],
      };
    }

    const results = await Promise.allSettled(
      runningApps.map((app) => this.stopApplication(app.uuid)),
    );

    return this.aggregateBatchResults(runningApps, results);
  }

  /**
   * Redeploy all applications in a project.
   * @param projectUuid - Project UUID
   * @param force - Force rebuild (default: true)
   */
  async redeployProjectApps(
    projectUuid: string,
    force: boolean = true,
  ): Promise<BatchOperationResult> {
    const allApps = (await this.listApplications()) as Application[];
    const projectApps = allApps.filter((app) => app.project_uuid === projectUuid);

    if (projectApps.length === 0) {
      return {
        summary: { total: 0, succeeded: 0, failed: 0 },
        succeeded: [],
        failed: [],
      };
    }

    const results = await Promise.allSettled(
      projectApps.map((app) => this.deployByTagOrUuid(app.uuid, force)),
    );

    return this.aggregateBatchResults(projectApps, results);
  }
}
