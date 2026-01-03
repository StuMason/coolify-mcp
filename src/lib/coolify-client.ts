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
  BackupExecution,
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
  // Diagnostic types
  DiagnosticHealthStatus,
  ApplicationDiagnostic,
  ServerDiagnostic,
  InfrastructureIssue,
  InfrastructureIssuesReport,
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

function toProjectSummary(proj: Project): ProjectSummary {
  return {
    uuid: proj.uuid,
    name: proj.name,
    description: proj.description,
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

  async deleteProjectEnvironment(environmentUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/projects/environments/${environmentUuid}`, {
      method: 'DELETE',
    });
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

  async listApplicationEnvVars(uuid: string): Promise<EnvironmentVariable[]> {
    return this.request<EnvironmentVariable[]>(`/applications/${uuid}/envs`);
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
      const ipMatch = server.ip?.includes(query);
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
}
