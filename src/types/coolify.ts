/**
 * Coolify MCP Server Type Definitions
 * Complete type definitions for the Coolify API v1
 */

// =============================================================================
// Configuration
// =============================================================================

export interface CoolifyConfig {
  baseUrl: string;
  accessToken: string;
}

// =============================================================================
// Common Types
// =============================================================================

export interface ErrorResponse {
  error?: string;
  message: string;
  status?: number;
}

export interface DeleteOptions {
  deleteConfigurations?: boolean;
  deleteVolumes?: boolean;
  dockerCleanup?: boolean;
  deleteConnectedNetworks?: boolean;
}

export interface MessageResponse {
  message: string;
}

export interface UuidResponse {
  uuid: string;
}

// =============================================================================
// Server Types
// =============================================================================

export interface Server {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  ip: string;
  user: string;
  port: number;
  status?: 'running' | 'stopped' | 'error' | 'unknown';
  is_reachable?: boolean;
  is_usable?: boolean;
  is_swarm_manager?: boolean;
  is_swarm_worker?: boolean;
  is_build_server?: boolean;
  validation_logs?: string;
  log_drain_notification_sent?: boolean;
  high_disk_usage_notification_sent?: boolean;
  unreachable_notification_sent?: boolean;
  unreachable_count?: number;
  proxy_type?: 'traefik' | 'caddy' | 'none';
  proxy_status?: string;
  settings?: ServerSettings;
  team_id?: number;
  created_at: string;
  updated_at: string;
}

export interface ServerSettings {
  id: number;
  server_id: number;
  concurrent_builds: number;
  dynamic_timeout: number;
  force_disabled: boolean;
  force_docker_cleanup: boolean;
  docker_cleanup_frequency: string;
  docker_cleanup_threshold: number;
  is_cloudflare_tunnel: boolean;
  is_jump_server: boolean;
  is_logdrain_axiom_enabled: boolean;
  is_logdrain_highlight_enabled: boolean;
  is_logdrain_custom_enabled: boolean;
  is_logdrain_newrelic_enabled: boolean;
  is_metrics_enabled: boolean;
  is_reachable: boolean;
  is_sentinel_enabled: boolean;
  is_swarm_manager: boolean;
  is_swarm_worker: boolean;
  is_usable: boolean;
  wildcard_domain?: string;
  created_at: string;
  updated_at: string;
}

export interface ServerResource {
  id: number;
  uuid: string;
  name: string;
  type: 'application' | 'database' | 'service';
  status: string;
  created_at: string;
  updated_at: string;
}

export interface ServerDomain {
  ip: string;
  domains: string[];
}

export interface ServerValidation {
  message: string;
  validation_logs?: string;
}

export interface CreateServerRequest {
  name: string;
  description?: string;
  ip: string;
  port?: number;
  user?: string;
  private_key_uuid: string;
  is_build_server?: boolean;
  instant_validate?: boolean;
}

export interface UpdateServerRequest {
  name?: string;
  description?: string;
  ip?: string;
  port?: number;
  user?: string;
  private_key_uuid?: string;
  is_build_server?: boolean;
}

// =============================================================================
// Project Types
// =============================================================================

export interface Project {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  team_id?: number;
  environments?: Environment[];
  created_at?: string;
  updated_at?: string;
}

export interface CreateProjectRequest {
  name: string;
  description?: string;
}

export interface UpdateProjectRequest {
  name?: string;
  description?: string;
}

// =============================================================================
// Environment Types
// =============================================================================

export interface Environment {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  project_id?: number;
  project_uuid?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateEnvironmentRequest {
  name: string;
  description?: string;
}

// =============================================================================
// Application Types
// =============================================================================

export type BuildPack = 'nixpacks' | 'static' | 'dockerfile' | 'dockercompose' | 'dockerimage';

export interface Application {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  fqdn?: string;
  git_repository?: string;
  git_branch?: string;
  git_commit_sha?: string;
  build_pack?: BuildPack;
  ports_exposes?: string;
  ports_mappings?: string;
  dockerfile?: string;
  dockerfile_location?: string;
  docker_registry_image_name?: string;
  docker_registry_image_tag?: string;
  docker_compose_location?: string;
  docker_compose_raw?: string;
  docker_compose_custom_start_command?: string;
  docker_compose_custom_build_command?: string;
  base_directory?: string;
  publish_directory?: string;
  install_command?: string;
  build_command?: string;
  start_command?: string;
  health_check_enabled?: boolean;
  health_check_path?: string;
  health_check_port?: number;
  health_check_host?: string;
  health_check_method?: string;
  health_check_return_code?: number;
  health_check_scheme?: string;
  health_check_response_text?: string;
  health_check_interval?: number;
  health_check_timeout?: number;
  health_check_retries?: number;
  health_check_start_period?: number;
  limits_memory?: string;
  limits_memory_swap?: string;
  limits_memory_swappiness?: number;
  limits_memory_reservation?: string;
  limits_cpus?: string;
  limits_cpuset?: string;
  limits_cpu_shares?: number;
  status?: 'running' | 'stopped' | 'error' | 'building' | 'deploying';
  preview_url_template?: string;
  destination_type?: string;
  destination_id?: number;
  source_type?: string;
  source_id?: number;
  private_key_id?: number;
  environment_id?: number;
  project_uuid?: string;
  environment_uuid?: string;
  server_uuid?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateApplicationPublicRequest {
  project_uuid: string;
  server_uuid: string;
  environment_name?: string;
  environment_uuid?: string;
  destination_uuid?: string;
  name?: string;
  description?: string;
  fqdn?: string;
  git_repository: string;
  git_branch: string;
  git_commit_sha?: string;
  build_pack: BuildPack;
  ports_exposes: string;
  ports_mappings?: string;
  base_directory?: string;
  publish_directory?: string;
  install_command?: string;
  build_command?: string;
  start_command?: string;
  instant_deploy?: boolean;
}

export interface CreateApplicationPrivateGHRequest extends CreateApplicationPublicRequest {
  github_app_uuid: string;
}

export interface CreateApplicationPrivateKeyRequest extends CreateApplicationPublicRequest {
  private_key_uuid: string;
}

export interface CreateApplicationDockerfileRequest {
  project_uuid: string;
  server_uuid: string;
  environment_name?: string;
  environment_uuid?: string;
  destination_uuid?: string;
  name?: string;
  description?: string;
  fqdn?: string;
  dockerfile: string;
  dockerfile_location?: string;
  ports_exposes?: string;
  ports_mappings?: string;
  base_directory?: string;
  instant_deploy?: boolean;
}

export interface CreateApplicationDockerImageRequest {
  project_uuid: string;
  server_uuid: string;
  environment_name?: string;
  environment_uuid?: string;
  destination_uuid?: string;
  name?: string;
  description?: string;
  fqdn?: string;
  docker_registry_image_name: string;
  docker_registry_image_tag?: string;
  ports_exposes: string;
  ports_mappings?: string;
  instant_deploy?: boolean;
}

export interface CreateApplicationDockerComposeRequest {
  project_uuid: string;
  server_uuid: string;
  environment_name?: string;
  environment_uuid?: string;
  destination_uuid?: string;
  name?: string;
  description?: string;
  docker_compose_raw: string;
  docker_compose_location?: string;
  docker_compose_custom_start_command?: string;
  docker_compose_custom_build_command?: string;
  instant_deploy?: boolean;
}

export interface UpdateApplicationRequest {
  name?: string;
  description?: string;
  fqdn?: string;
  git_repository?: string;
  git_branch?: string;
  git_commit_sha?: string;
  ports_exposes?: string;
  ports_mappings?: string;
  dockerfile?: string;
  dockerfile_location?: string;
  docker_registry_image_name?: string;
  docker_registry_image_tag?: string;
  docker_compose_raw?: string;
  docker_compose_location?: string;
  base_directory?: string;
  publish_directory?: string;
  install_command?: string;
  build_command?: string;
  start_command?: string;
  health_check_enabled?: boolean;
  health_check_path?: string;
  health_check_port?: number;
  limits_memory?: string;
  limits_memory_swap?: string;
  limits_cpus?: string;
  is_http_basic_auth_enabled?: boolean;
  http_basic_auth_username?: string;
  http_basic_auth_password?: string;
}

export interface ApplicationActionResponse {
  message: string;
  deployment_uuid?: string;
}

// =============================================================================
// Environment Variable Types
// =============================================================================

export interface EnvironmentVariable {
  id: number;
  uuid: string;
  key: string;
  value: string;
  is_build_time: boolean;
  is_literal: boolean;
  is_multiline: boolean;
  is_preview: boolean;
  is_shared: boolean;
  is_shown_once: boolean;
  real_value?: string;
  version?: string;
  application_id?: number;
  service_id?: number;
  database_id?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateEnvVarRequest {
  key: string;
  value: string;
  is_preview?: boolean;
  is_literal?: boolean;
  is_multiline?: boolean;
  is_shown_once?: boolean;
  is_build_time?: boolean;
}

export interface UpdateEnvVarRequest {
  key: string;
  value: string;
  is_preview?: boolean;
  is_literal?: boolean;
  is_multiline?: boolean;
  is_shown_once?: boolean;
  is_build_time?: boolean;
}

export interface BulkUpdateEnvVarsRequest {
  data: CreateEnvVarRequest[];
}

// Summary type for env vars - reduces response size significantly
export interface EnvVarSummary {
  uuid: string;
  key: string;
  value: string;
  is_build_time: boolean;
}

// =============================================================================
// Database Types
// =============================================================================

export type DatabaseType =
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'mongodb'
  | 'redis'
  | 'keydb'
  | 'clickhouse'
  | 'dragonfly';

export interface DatabaseLimits {
  memory?: string;
  memory_swap?: string;
  memory_swappiness?: number;
  memory_reservation?: string;
  cpus?: string;
  cpuset?: string;
  cpu_shares?: number;
}

export interface Database {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  type: DatabaseType;
  status: 'running' | 'stopped' | 'error' | 'restarting';
  is_public: boolean;
  public_port?: number;
  image: string;
  started_at?: string;
  internal_db_url?: string;
  external_db_url?: string;
  project_uuid?: string;
  environment_uuid?: string;
  environment_name?: string;
  server_uuid?: string;
  limits?: DatabaseLimits;
  created_at: string;
  updated_at: string;
  // PostgreSQL fields
  postgres_user?: string;
  postgres_password?: string;
  postgres_db?: string;
  postgres_initdb_args?: string;
  postgres_host_auth_method?: string;
  postgres_conf?: string;
  // MySQL fields
  mysql_root_password?: string;
  mysql_user?: string;
  mysql_password?: string;
  mysql_database?: string;
  // MariaDB fields
  mariadb_root_password?: string;
  mariadb_user?: string;
  mariadb_password?: string;
  mariadb_database?: string;
  mariadb_conf?: string;
  // MongoDB fields
  mongo_initdb_root_username?: string;
  mongo_initdb_root_password?: string;
  mongo_initdb_database?: string;
  mongo_conf?: string;
  // Redis fields
  redis_password?: string;
  redis_conf?: string;
  // KeyDB fields
  keydb_password?: string;
  keydb_conf?: string;
  // Clickhouse fields
  clickhouse_admin_user?: string;
  clickhouse_admin_password?: string;
  // Dragonfly fields
  dragonfly_password?: string;
}

export interface UpdateDatabaseRequest {
  name?: string;
  description?: string;
  image?: string;
  is_public?: boolean;
  public_port?: number;
  limits_memory?: string;
  limits_memory_swap?: string;
  limits_memory_swappiness?: number;
  limits_memory_reservation?: string;
  limits_cpus?: string;
  limits_cpuset?: string;
  limits_cpu_shares?: number;
  // PostgreSQL specific
  postgres_user?: string;
  postgres_password?: string;
  postgres_db?: string;
  postgres_initdb_args?: string;
  postgres_host_auth_method?: string;
  postgres_conf?: string;
  // MySQL specific
  mysql_root_password?: string;
  mysql_user?: string;
  mysql_password?: string;
  mysql_database?: string;
  // MariaDB specific
  mariadb_root_password?: string;
  mariadb_user?: string;
  mariadb_password?: string;
  mariadb_database?: string;
  mariadb_conf?: string;
  // MongoDB specific
  mongo_initdb_root_username?: string;
  mongo_initdb_root_password?: string;
  mongo_initdb_database?: string;
  mongo_conf?: string;
  // Redis specific
  redis_password?: string;
  redis_conf?: string;
  // KeyDB specific
  keydb_password?: string;
  keydb_conf?: string;
  // Clickhouse specific
  clickhouse_admin_user?: string;
  clickhouse_admin_password?: string;
  // Dragonfly specific
  dragonfly_password?: string;
}

// =============================================================================
// Database Backup Types
// =============================================================================

export interface DatabaseBackup {
  id: number;
  uuid: string;
  database_id: number;
  database_type: DatabaseType;
  status: 'pending' | 'running' | 'success' | 'failed';
  filename?: string;
  size?: number;
  frequency: string;
  enabled: boolean;
  save_s3: boolean;
  s3_storage_id?: number;
  databases_to_backup?: string;
  dump_all: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateDatabaseBackupRequest {
  frequency: string;
  enabled?: boolean;
  save_s3?: boolean;
  s3_storage_uuid?: string;
  databases_to_backup?: string;
  dump_all?: boolean;
  backup_now?: boolean;
  backup_retention?: number;
  backup_retention_days?: number;
}

export interface BackupExecution {
  id: number;
  uuid: string;
  scheduled_database_backup_id: number;
  status: 'pending' | 'running' | 'success' | 'failed';
  message?: string;
  size?: number;
  filename?: string;
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Service Types
// =============================================================================

/**
 * Available one-click service types in Coolify.
 * This is a string type to avoid TypeScript memory issues with large const arrays.
 * Common types include: activepieces, appsmith, appwrite, authentik, ghost, gitea,
 * grafana, jellyfin, minio, n8n, nextcloud, pocketbase, supabase, uptime-kuma,
 * vaultwarden, wordpress-with-mariadb, wordpress-with-mysql, etc.
 */
export type ServiceType = string;

export interface Service {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  type: ServiceType;
  status: 'running' | 'stopped' | 'error' | 'restarting';
  project_uuid?: string;
  environment_name?: string;
  environment_uuid?: string;
  server_uuid?: string;
  destination_uuid?: string;
  domains?: string[];
  config_hash?: string;
  connect_to_docker_network?: boolean;
  created_at: string;
  updated_at: string;
}

export interface CreateServiceRequest {
  type?: ServiceType;
  name?: string;
  description?: string;
  project_uuid: string;
  environment_name?: string;
  environment_uuid?: string;
  server_uuid: string;
  destination_uuid?: string;
  instant_deploy?: boolean;
  docker_compose_raw?: string; // Base64 encoded docker-compose YAML (alternative to type)
}

/**
 * CRITICAL: When updating services with Traefik basic auth labels
 *
 * 1. MANUAL STEP REQUIRED: You MUST disable "Escape characters in labels" in Coolify UI
 *    - Navigate to: Service Settings > Advanced > Container Label Character Escaping
 *    - This setting CANNOT be changed via API
 *    - Without this, Coolify will double-escape $ signs, breaking htpasswd
 *
 * 2. Even with escaping disabled, Traefik still requires $$ in htpasswd hashes
 *    - Correct: "user:$$apr1$$hash$$here"
 *    - Wrong: "user:$apr1$hash$here"
 *    - Docker Compose processes $$ → $ for Traefik
 *
 * 3. docker_compose_raw must be base64 encoded when sent to API
 *    - Example: Buffer.from(yamlString).toString('base64')
 *
 * Summary for htpasswd with basic auth:
 *   - Generate hash: htpasswd -nb username password
 *   - Replace $ with $$ in the hash
 *   - Disable label escaping in Coolify UI (manual step!)
 *   - Base64 encode the entire docker-compose YAML
 */
export interface UpdateServiceRequest {
  name?: string;
  description?: string;
  docker_compose_raw?: string; // Base64 encoded docker-compose YAML
}

export interface ServiceCreateResponse {
  uuid: string;
  domains: string[];
}

// =============================================================================
// Deployment Types
// =============================================================================

export interface Deployment {
  id: number;
  uuid: string;
  application_id?: number;
  application_uuid?: string;
  application_name?: string;
  deployment_uuid: string;
  pull_request_id?: number;
  force_rebuild: boolean;
  commit?: string;
  status: 'queued' | 'in_progress' | 'finished' | 'failed' | 'cancelled';
  is_webhook: boolean;
  is_api: boolean;
  logs?: string;
  current_process_id?: string;
  restart_only: boolean;
  git_type?: string;
  server_id?: number;
  server_name?: string;
  created_at: string;
  updated_at: string;
}

export interface DeployByTagRequest {
  tag?: string;
  uuid?: string;
  force?: boolean;
}

// =============================================================================
// Team Types
// =============================================================================

export interface Team {
  id: number;
  uuid?: string;
  name: string;
  description?: string;
  personal_team: boolean;
  show_boarding?: boolean;
  custom_server_limit?: number;
  members?: TeamMember[];
  created_at: string;
  updated_at: string;
}

export interface TeamMember {
  id: number;
  name: string;
  email: string;
  role?: 'owner' | 'admin' | 'member' | 'readonly';
  created_at: string;
  updated_at: string;
}

// =============================================================================
// Private Key Types
// =============================================================================

export interface PrivateKey {
  id: number;
  uuid: string;
  name: string;
  description?: string;
  private_key: string;
  public_key?: string;
  fingerprint?: string;
  is_git_related: boolean;
  team_id: number;
  created_at: string;
  updated_at: string;
}

export interface CreatePrivateKeyRequest {
  name: string;
  description?: string;
  private_key: string;
}

export interface UpdatePrivateKeyRequest {
  name?: string;
  description?: string;
  private_key?: string;
}

// =============================================================================
// Cloud Token Types (Hetzner, DigitalOcean)
// =============================================================================

export type CloudProvider = 'hetzner' | 'digitalocean';

export interface CloudToken {
  id: number;
  uuid: string;
  name: string;
  provider: CloudProvider;
  team_id: number;
  servers_count?: number;
  created_at: string;
  updated_at: string;
}

export interface CreateCloudTokenRequest {
  provider: CloudProvider;
  token: string;
  name: string;
}

export interface UpdateCloudTokenRequest {
  name?: string;
}

export interface CloudTokenValidation {
  valid: boolean;
  message: string;
}

// =============================================================================
// Version/Health Types
// =============================================================================

export interface Version {
  version: string;
}

export interface HealthCheck {
  status: 'healthy' | 'unhealthy';
  version?: string;
}

// =============================================================================
// Diagnostic Types (Composite responses for debugging)
// =============================================================================

export type DiagnosticHealthStatus = 'healthy' | 'unhealthy' | 'unknown';

export interface ApplicationDiagnostic {
  application: {
    uuid: string;
    name: string;
    status: string;
    fqdn: string | null;
    git_repository: string | null;
    git_branch: string | null;
  } | null;
  health: {
    status: DiagnosticHealthStatus;
    issues: string[];
  };
  logs: string | null;
  environment_variables: {
    count: number;
    variables: Array<{ key: string; is_build_time: boolean }>;
  };
  recent_deployments: Array<{
    uuid: string;
    status: string;
    created_at: string;
  }>;
  errors?: string[];
}

export interface ServerDiagnostic {
  server: {
    uuid: string;
    name: string;
    ip: string;
    status: string | null;
    is_reachable: boolean | null;
  } | null;
  health: {
    status: DiagnosticHealthStatus;
    issues: string[];
  };
  resources: Array<{
    uuid: string;
    name: string;
    type: string;
    status: string;
  }>;
  domains: Array<{
    ip: string;
    domains: string[];
  }>;
  validation: {
    message: string;
    validation_logs?: string;
  } | null;
  errors?: string[];
}

export interface InfrastructureIssue {
  type: 'application' | 'database' | 'service' | 'server';
  uuid: string;
  name: string;
  issue: string;
  status: string;
}

export interface InfrastructureIssuesReport {
  summary: {
    total_issues: number;
    unhealthy_applications: number;
    unhealthy_databases: number;
    unhealthy_services: number;
    unreachable_servers: number;
  };
  issues: InfrastructureIssue[];
  errors?: string[];
}
