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
  UpdateServiceApplicationRequest,
  ServiceCreateResponse,
  // Deployment types
  Deployment,
  DeploymentEssential,
  DeployTriggerResponse,
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
  // Storage types
  StorageListResponse,
  CreateStorageRequest,
  UpdateStorageRequest,
  // Scheduled task types
  ScheduledTask,
  ScheduledTaskExecution,
  CreateScheduledTaskRequest,
  UpdateScheduledTaskRequest,
  // Hetzner types
  HetznerLocation,
  HetznerServerType,
  HetznerImage,
  HetznerSSHKey,
  CreateHetznerServerRequest,
  CreateHetznerServerResponse,
  // GitHub repository types
  GitHubRepository,
  GitHubBranch,
  // Diagnostic types
  DiagnosticHealthStatus,
  ApplicationDiagnostic,
  ServerDiagnostic,
  InfrastructureIssue,
  InfrastructureIssuesReport,
  // Batch operation types
  BatchOperationResult,
  // Resource list types
  ResourceListItem,
  ResourceListItemFull,
  ServiceSubResource,
  Tag,
  AttachTagsRequest,
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
  environment_uuid?: string;
  environment_name?: string;
  environment_id?: number;
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

/** Base64-encode a string, passing through values that are already base64. */
function toBase64(value: string): string {
  try {
    const decoded = Buffer.from(value, 'base64').toString('utf-8');
    if (Buffer.from(decoded, 'utf-8').toString('base64') === value) {
      return value; // Already valid base64
    }
  } catch {
    // Not base64, encode it
  }
  return Buffer.from(value, 'utf-8').toString('base64');
}

/**
 * Map 'fqdn' to 'domains' for Coolify API compatibility.
 * Coolify API uses 'domains' field for setting application domain, not 'fqdn'.
 * This provides backward compatibility for callers using 'fqdn'.
 */
function mapFqdnToDomains<T extends { fqdn?: string; domains?: string }>(
  data: T,
): Omit<T, 'fqdn'> & { domains?: string } {
  const { fqdn, ...rest } = data;
  // Explicit `domains` always wins. `fqdn` is only used when `domains` was
  // not provided — kept for backward compatibility because `get_application`
  // surfaces the field as `fqdn` in responses.
  if (rest.domains !== undefined) {
    return rest;
  }
  if (fqdn === undefined) {
    return rest;
  }
  return { ...rest, domains: fqdn };
}

/**
 * Error thrown for any non-2xx Coolify API response.
 *
 * Carries the HTTP status alongside the message so callers can branch on it —
 * notably the v4.2 GET-to-POST fallback, which must distinguish a 405 (method
 * rejected by the router, nothing executed) from every other failure. The
 * message is byte-identical to what a plain `Error` carried before, so this is
 * a drop-in for anything matching on `error.message`.
 */
export class CoolifyApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Parsed response body, when there was one. Lets callers tell Coolify's routing catch-all apart from a controller's own 404. */
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'CoolifyApiError';
  }
}

/**
 * Was this 404 produced by Coolify's routing catch-all rather than a controller?
 *
 * `routes/api.php` ends with `Route::any('/{any}', ...)` returning
 * `{ message: 'Not found.', docs: 'https://coolify.io/docs' }`. That `docs` key
 * is the signature — no controller 404 carries it — so it distinguishes "this
 * method/path is not routed" from "the resource does not exist", which matters
 * because only the former is safe and useful to retry with a different method.
 */
function isRoutingCatchAll(error: CoolifyApiError): boolean {
  if (error.status !== 404) return false;
  const body = error.body;
  if (typeof body !== 'object' || body === null) return false;
  // `docs` is the strongest signal, but a proxy or a future Coolify could drop
  // it. The catch-all's exact wording is a cheap second discriminator — a
  // controller says "<Resource> not found.", never a bare "Not found.".
  if ('docs' in body) return true;
  return (body as { message?: unknown }).message === 'Not found.';
}

/**
 * Normalise a log endpoint response to a plain string.
 *
 * Coolify returns `{ logs: "..." }` — confirmed against a live instance and
 * matching upstream's OpenAPI. `getApplicationLogs` previously declared
 * `Promise<string>` while handing back that object unchanged, so the type was a
 * lie and any caller doing string work on it would have failed at runtime. Its
 * unit tests mocked a bare string, which is why it went unnoticed.
 *
 * Bare strings are still accepted, since older instances have been observed
 * returning one and the cost of tolerating both is a single check.
 */
function unwrapLogs(response: unknown): string {
  if (typeof response === 'string') return response;
  if (response && typeof response === 'object' && 'logs' in response) {
    const { logs } = response as { logs: unknown };
    return typeof logs === 'string' ? logs : String(logs ?? '');
  }
  return '';
}

/**
 * Endpoints that Coolify v4.2 moved from GET to POST *and* that were GET-only
 * before it, so no single method works across both eras. Keys are stable
 * endpoint identifiers rather than request paths — see
 * {@link CoolifyClient.postWithLegacyGetFallback}. Declared as a closed set so
 * a new call site cannot silently reuse another endpoint's cache entry.
 */
const LEGACY_GET_ENDPOINTS = {
  serversValidate: 'servers.validate',
  apiEnable: 'api.enable',
  apiDisable: 'api.disable',
} as const;

type LegacyGetEndpointKey = (typeof LEGACY_GET_ENDPOINTS)[keyof typeof LEGACY_GET_ENDPOINTS];

/**
 * Map a failed response's status/path to an actionable hint for known Coolify quirks.
 * Coolify sometimes returns bodyless errors (e.g. bare `HTTP 500: Internal Server Error`)
 * that leave the caller guessing at the cause — this appends a short, testable hint for
 * the cases we've hit in practice. Returns undefined when no known case matches.
 */
export function errorHint(status: number, path: string): string | undefined {
  if (status === 500 && /\/scheduled-tasks(\/|$)/.test(path)) {
    return 'Known cause: Coolify stores scheduled-task `command` in a varchar(255) column and rejects longer commands with a bodyless 500 — check the command length (limit 255 chars).';
  }
  if (status === 405) {
    return 'Coolify v4.2 moved state-changing endpoints from GET to POST; older versions accept GET only. This client retries automatically, so a 405 reaching you means both methods were rejected — check the endpoint path against your Coolify version.';
  }
  if (status === 401 || status === 403) {
    return 'Check that COOLIFY_ACCESS_TOKEN is valid and has the required scopes for this operation. On Coolify v4.2+, tokens belonging to a Member-role user are read-only and cannot deploy, start, stop, or modify resources.';
  }
  if (status === 404 && /\/services\/[\w-]+\/applications/.test(path)) {
    return 'Sub-application management (update_application) requires Coolify v4.2+. Check version with `get_version`. Upgrade: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | bash -s 4.2.0`';
  }
  if (status === 404 && /\/tags(\/|$)/.test(path)) {
    // Both causes look identical from the status, so name both rather than
    // pointing confidently at the wrong one.
    return 'Tag endpoints require Coolify v4.2+ (coollabsio/coolify#9275) — check with get_version. If your instance is already v4.2+, the uuid may belong to a different resource type than this route.';
  }
  if (status === 404 && /\/[\w-]{8,}(\/|$)/.test(path)) {
    return 'The uuid may belong to a different resource type than requested (e.g. an application uuid used on a service/database route).';
  }
  return undefined;
}

/**
 * Whether an application's status string counts as "up", for the purposes of
 * deciding what `stopAllApps` targets.
 *
 * Coolify reports composite statuses like `running:healthy` and
 * `exited:unhealthy`, hence substring tests rather than equality.
 *
 * Exported because `stopAllApps` uses it to decide what to stop and the #261
 * elicitation prompt uses it to tell the human what is about to be stopped. Two
 * copies of this predicate would eventually disagree, and the failure mode of
 * that is a confirmation dialog understating its own blast radius.
 *
 * **Fixed here, because extraction changed what the bug costs.** `'unhealthy'`
 * contains `'healthy'`, so the original `includes('healthy')` classified
 * `exited:unhealthy` as running. Inside `stopAllApps` that cost only a no-op
 * stop against an already-stopped app, which nobody ever saw. Shared with the
 * #261 confirmation prompt it does something worse: it names already-dead
 * applications in a dialog whose entire job is to be accurate, and someone
 * scanning that list for the one application that should not be in it is handed
 * noise. A prompt that pads its own blast radius trains people to stop reading
 * it.
 *
 * `running:unhealthy` still counts, via the `running` branch — an application
 * that is up but failing health checks is still something an emergency stop
 * should take down.
 */
export function isRunningStatus(status?: string): boolean {
  const value = status || '';
  return value.includes('running') || (value.includes('healthy') && !value.includes('unhealthy'));
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
  // API returns database_type not type, and environment_id not environment_uuid
  const raw = db as unknown as Record<string, unknown>;
  return {
    uuid: db.uuid,
    name: db.name,
    type: db.type || (raw.database_type as string),
    status: db.status,
    is_public: db.is_public,
    environment_uuid: db.environment_uuid,
    environment_name: db.environment_name,
    environment_id: raw.environment_id as number | undefined,
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
    logs_available: !!dep.logs,
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
    is_buildtime: envVar.is_buildtime,
    is_runtime: envVar.is_runtime,
    is_preview: envVar.is_preview,
  };
}

/**
 * Sentinel string used to replace plaintext env var values when masking.
 * Exported via behaviour, not as a public API — clients should treat any
 * non-real string as "value not returned".
 */
const MASKED_VALUE = '***';

/**
 * Mask the `value` and `real_value` fields on a full {@link EnvironmentVariable}.
 * All other metadata (uuid, key, flags, timestamps, ids) is preserved verbatim.
 *
 * Applied at the API boundary so callers cannot accidentally leak secrets to
 * an LLM client by forgetting to strip values downstream. Pair with the
 * `reveal: true` opt-in on list methods when the caller genuinely needs the
 * plaintext (e.g. "what is FOO set to right now?").
 */
function maskEnvVar(envVar: EnvironmentVariable): EnvironmentVariable {
  const masked: EnvironmentVariable = {
    ...envVar,
    value: MASKED_VALUE,
  };
  if (envVar.real_value !== undefined) {
    masked.real_value = MASKED_VALUE;
  }
  return masked;
}

/**
 * Mask the `value` field on an {@link EnvVarSummary}. Metadata is preserved.
 */
function maskEnvVarSummary(envVar: EnvVarSummary): EnvVarSummary {
  return {
    ...envVar,
    value: MASKED_VALUE,
  };
}

/**
 * Project a full Coolify resource row down to {@link ResourceListItem} — the
 * four fields callers actually need for enumeration (uuid, name, type, status).
 * Drops the ~90 extra fields Coolify returns by default to keep MCP token
 * budgets sane.
 */
function toResourceListItemEssential(item: ResourceListItemFull): ResourceListItem {
  const essential: ResourceListItem = {
    uuid: item.uuid,
    name: item.name,
    type: item.type,
  };
  if (typeof item.status === 'string') {
    essential.status = item.status;
  }
  return essential;
}

/**
 * Per-resource sensitive fields returned by Coolify's `/api/v1/resources`
 * endpoint that are masked by default in {@link CoolifyClient.listResources}
 * when `include_full: true` is passed. Mirrors the v2.9.0 env-var masking
 * posture: the underlying API exposes these via the same access token, but
 * the MCP layer narrows the trust boundary so an LLM client that was granted
 * "list resources" doesn't silently exfiltrate webhook HMAC secrets or
 * basic-auth credentials.
 *
 * The `manual_webhook_secret_*` fields are HMAC signing keys for inbound
 * deploy webhooks — anyone with one can forge deploys for that repo
 * independently of the Coolify API token. `http_basic_auth_password` is the
 * password gating front-of-app access.
 *
 * The database and compose entries come from a source audit of Coolify
 * v4.1.2 (#209): no Standalone* model defines `$hidden`, and Laravel
 * serializes `encrypted` casts as decrypted plaintext, so every database row
 * on `/resources` carries its password in the clear. `internal_db_url` /
 * `external_db_url` are appended accessors that embed the password in a
 * connection URL on all eight database types — including Redis, whose
 * password surfaces ONLY through those URLs (the column was moved to env
 * vars). Compose bodies are masked because Coolify resolves
 * `SERVICE_PASSWORD_*` placeholders into `docker_compose`, and
 * `custom_labels` because Traefik basic-auth labels carry htpasswd hashes.
 */
const SENSITIVE_RESOURCE_FIELDS = [
  // Webhook + basic-auth (#204 / #206)
  'manual_webhook_secret_github',
  'manual_webhook_secret_gitlab',
  'manual_webhook_secret_gitea',
  'manual_webhook_secret_bitbucket',
  'http_basic_auth_password',
  // Database passwords (#209) — serialized decrypted at the API
  'postgres_password',
  'mysql_password',
  'mysql_root_password',
  'mariadb_password',
  'mariadb_root_password',
  'mongo_initdb_root_password',
  'redis_password',
  'keydb_password',
  'dragonfly_password',
  'clickhouse_admin_password',
  // Connection-URL appends (#209) — embed the password on every db type
  'internal_db_url',
  'external_db_url',
  // Compose bodies + Traefik labels (#209) — carry resolved credentials
  'docker_compose_raw',
  'docker_compose',
  'docker_compose_pr_raw',
  'docker_compose_pr',
  'custom_labels',
] as const;

/**
 * Replace each {@link SENSITIVE_RESOURCE_FIELDS} entry with `'***'` on a full
 * resource row. Null/undefined values are preserved (since `null` conveys
 * "no secret set" and matters to callers); only populated values get masked.
 *
 * Also walks a nested `environment_variables[]` collection if one is present
 * and masks `value` / `real_value` on each entry (mirroring {@link maskEnvVar}).
 * Coolify v4.1.2 never inlines env vars on `/resources` rows — the relation
 * is lazy and the controller never loads it — but other versions or forks
 * might, and the nested copy would otherwise bypass the env_vars pipeline's
 * masking entirely (#209).
 */
function maskResourceItemFull(item: ResourceListItemFull): ResourceListItemFull {
  const masked: ResourceListItemFull = { ...item };
  for (const field of SENSITIVE_RESOURCE_FIELDS) {
    if (masked[field] != null) {
      masked[field] = MASKED_VALUE;
    }
  }
  if (Array.isArray(masked.environment_variables)) {
    masked.environment_variables = masked.environment_variables.map((entry) => {
      if (entry === null || typeof entry !== 'object') return entry;
      const env = { ...(entry as Record<string, unknown>) };
      if (env.value != null) env.value = MASKED_VALUE;
      if (env.real_value != null) env.real_value = MASKED_VALUE;
      return env;
    });
  }
  return masked;
}

/**
 * HTTP client for the Coolify API
 */
export class CoolifyClient {
  private readonly baseUrl: string;
  private readonly accessToken: string;
  private readonly customHeaders: Record<string, string>;
  private cachedVersion: string | null = null;

  /**
   * Endpoints observed to reject POST with a 405, meaning this instance
   * predates the v4.2 GET-to-POST move and wants the legacy GET.
   * See {@link postWithLegacyGetFallback}.
   */
  private readonly legacyGetEndpoints = new Set<LegacyGetEndpointKey>();

  constructor(config: CoolifyConfig) {
    if (!config.baseUrl) {
      throw new Error('Coolify base URL is required');
    }
    if (!config.accessToken) {
      throw new Error('Coolify access token is required');
    }
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.accessToken = config.accessToken;

    const reserved = new Set(['authorization', 'content-type']);
    const raw = config.customHeaders ?? {};
    const filtered: Record<string, string> = {};
    for (const [key, value] of Object.entries(raw)) {
      if (reserved.has(key.toLowerCase())) {
        console.warn(`Custom header "${key}" ignored: reserved by the Coolify client`);
      } else {
        filtered[key] = value;
      }
    }
    this.customHeaders = filtered;
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
          ...this.customHeaders,
          ...options.headers,
        },
      });

      // Handle empty responses (204 No Content, etc.)
      const text = await response.text();
      const contentType = response.headers?.get('Content-Type')?.toLowerCase() ?? '';
      const isJsonResponse =
        !contentType || contentType.includes('application/json') || contentType.includes('+json');
      let data: unknown = {};
      if (text) {
        if (isJsonResponse) {
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
        } else {
          data = text;
        }
      }

      if (!response.ok) {
        const error = data as ErrorResponse;
        // Include validation errors if present
        let errorMessage = error.message || `HTTP ${response.status}: ${response.statusText}`;
        if (error.errors && Object.keys(error.errors).length > 0) {
          const validationDetails = Object.entries(error.errors)
            .map(
              ([field, messages]) =>
                `${field}: ${Array.isArray(messages) ? messages.join(', ') : String(messages)}`,
            )
            .join('; ');
          errorMessage = `${errorMessage} - ${validationDetails}`;
        }
        const hint = errorHint(response.status, path);
        if (hint) {
          errorMessage = `${errorMessage} (${hint})`;
        }
        throw new CoolifyApiError(errorMessage, response.status, data);
      }

      return data as T;
    } catch (error) {
      if (error instanceof TypeError && error.message.includes('fetch')) {
        throw new Error(
          `Failed to connect to Coolify server at ${this.baseUrl}. Please check if the server is running and accessible.`,
          { cause: error },
        );
      }
      throw error;
    }
  }

  /**
   * Call an endpoint that Coolify v4.2 moved from GET to POST, working against
   * both eras without any version probing.
   *
   * Three endpoints genuinely diverge — `/enable`, `/disable` and
   * `/servers/{uuid}/validate` are registered `Route::get` only up to v4.1.2
   * and `Route::post` only from v4.2 — so neither method works everywhere and
   * a blanket switch to POST would break every pre-4.2 instance. (The other
   * endpoints in the v4.2 breaking-change list were already
   * `Route::match(['get','post'])` in v4.1 and older, so those just send POST
   * unconditionally.)
   *
   * Strategy: try POST, and on a 405 or 404 retry once with GET. The retry is safe
   * because a 405 comes from the router before the controller runs, so nothing
   * has executed and there is no risk of double-firing a state change. The same
   * holds for the catch-all 404, which is identified by its body shape rather
   * than by status alone so a controller's genuine "not found" stays out of the
   * retry path. Nothing else triggers the fallback — a 500 in particular
   * propagates untouched, since it may mean the action partially ran.
   *
   * The resolved method is cached per `key`, so the extra round trip is paid at
   * most once per endpoint rather than per call. `key` is a stable endpoint
   * identifier rather than the request path, because version compatibility is a
   * property of the instance, not of the resource — `/servers/{uuid}/validate`
   * behaves the same for every uuid, so keying on the path would re-probe for
   * every server.
   *
   * The cache self-heals in both directions: if a remembered GET later returns a
   * 405 (the instance was upgraded to v4.2 while this client was running) the
   * stale preference is dropped and POST is re-probed, rather than 405ing
   * forever until restart.
   */
  private async postWithLegacyGetFallback<T>(
    key: LegacyGetEndpointKey,
    path: string,
    options: RequestInit = {},
  ): Promise<T> {
    // A 405, or the 404 Coolify's routing catch-all returns for an unmatched
    // method. Verified against a live 4.1.2: POST on these GET-only routes comes
    // back 404, never 405, so handling only 405 meant the fallback never fired
    // and enable/disable/validate broke outright.
    //
    // Matching on the catch-all's body shape rather than on 404 alone keeps a
    // controller's genuine "resource not found" out of the retry path — that is
    // a real answer, not a routing miss, and retrying it would both waste a
    // request and discard the specific message.
    const isMethodRejected = (error: unknown): boolean =>
      error instanceof CoolifyApiError && (error.status === 405 || isRoutingCatchAll(error));

    if (this.legacyGetEndpoints.has(key)) {
      try {
        return await this.request<T>(path, { ...options, method: 'GET' });
      } catch (error) {
        if (!isMethodRejected(error)) {
          throw error;
        }
        // Upgraded to v4.2 under us — forget the stale preference and re-probe.
        this.legacyGetEndpoints.delete(key);
      }
    }

    try {
      return await this.request<T>(path, { ...options, method: 'POST' });
    } catch (error) {
      if (!isMethodRejected(error)) {
        throw error;
      }
      try {
        const result = await this.request<T>(path, { ...options, method: 'GET' });
        this.legacyGetEndpoints.add(key);
        return result;
      } catch (getError) {
        // The POST is a routing miss by construction — isMethodRejected already
        // established nothing ran — so it carries no information about the
        // request itself. If the GET reached a controller, its error is the real
        // answer ("Server not found."), and reporting the POST's bare
        // "Not found." instead would even pick up the misleading uuid hint.
        // Only when neither method routed is the POST error the one to report.
        throw isMethodRejected(getError) ? error : getError;
      }
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
    if (this.cachedVersion) {
      return { version: this.cachedVersion };
    }
    // The /version endpoint returns plain text, not JSON
    const url = `${this.baseUrl}/api/v1/version`;
    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...this.customHeaders,
      },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const version = await response.text();
    this.cachedVersion = version.trim();
    return { version: this.cachedVersion };
  }

  getCachedVersion(): string | null {
    return this.cachedVersion;
  }

  async validateConnection(): Promise<void> {
    try {
      await this.getVersion();
    } catch (error) {
      throw new Error(
        `Failed to connect to Coolify server: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error },
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
    // POST from v4.2, GET only before it. See postWithLegacyGetFallback.
    return this.postWithLegacyGetFallback<ServerValidation>(
      LEGACY_GET_ENDPOINTS.serversValidate,
      `/servers/${uuid}/validate`,
    );
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

  /**
   * Get environment with missing database types (dragonfly, keydb, clickhouse).
   * Coolify API omits these from the environment endpoint - we cross-reference
   * with listDatabases using lightweight summaries.
   * @see https://github.com/StuMason/coolify-mcp/issues/88
   */
  async getProjectEnvironmentWithDatabases(
    projectUuid: string,
    environmentNameOrUuid: string,
  ): Promise<
    Environment & {
      dragonflys?: DatabaseSummary[];
      keydbs?: DatabaseSummary[];
      clickhouses?: DatabaseSummary[];
    }
  > {
    const [environment, dbSummaries] = await Promise.all([
      this.getProjectEnvironment(projectUuid, environmentNameOrUuid),
      this.listDatabases({ summary: true }) as Promise<DatabaseSummary[]>,
    ]);

    // Filter for this environment's missing database types
    // API uses environment_id, not environment_uuid
    const envDbs = dbSummaries.filter(
      (db) =>
        db.environment_id === environment.id ||
        db.environment_uuid === environment.uuid ||
        db.environment_name === environment.name,
    );
    const dragonflys = envDbs.filter((db) => db.type?.includes('dragonfly'));
    const keydbs = envDbs.filter((db) => db.type?.includes('keydb'));
    const clickhouses = envDbs.filter((db) => db.type?.includes('clickhouse'));

    return {
      ...environment,
      ...(dragonflys.length > 0 && { dragonflys }),
      ...(keydbs.length > 0 && { keydbs }),
      ...(clickhouses.length > 0 && { clickhouses }),
    };
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
      body: JSON.stringify(mapFqdnToDomains(data)),
    });
  }

  async createApplicationPrivateGH(data: CreateApplicationPrivateGHRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/private-github-app', {
      method: 'POST',
      body: JSON.stringify(mapFqdnToDomains(data)),
    });
  }

  async createApplicationPrivateKey(
    data: CreateApplicationPrivateKeyRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/private-deploy-key', {
      method: 'POST',
      body: JSON.stringify(mapFqdnToDomains(data)),
    });
  }

  async createApplicationDockerfile(
    data: CreateApplicationDockerfileRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/dockerfile', {
      method: 'POST',
      body: JSON.stringify(mapFqdnToDomains(data)),
    });
  }

  async createApplicationDockerImage(
    data: CreateApplicationDockerImageRequest,
  ): Promise<UuidResponse> {
    return this.request<UuidResponse>('/applications/dockerimage', {
      method: 'POST',
      body: JSON.stringify(mapFqdnToDomains(data)),
    });
  }

  /**
   * @deprecated Coolify removed POST /applications/dockercompose upstream in
   * v4.1.0 (coollabsio/coolify commit 6ee75cfa) in favour of POST /services.
   * This 404s against current Coolify releases; use createService instead.
   * Not exposed via any MCP tool — see #235.
   */
  async createApplicationDockerCompose(
    data: CreateApplicationDockerComposeRequest,
  ): Promise<UuidResponse> {
    const mapped = mapFqdnToDomains(data);
    const payload = { ...mapped };
    if (payload.docker_compose_raw) {
      payload.docker_compose_raw = toBase64(payload.docker_compose_raw);
    }
    return this.request<UuidResponse>('/applications/dockercompose', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateApplication(uuid: string, data: UpdateApplicationRequest): Promise<Application> {
    const mapped = mapFqdnToDomains(data);
    const payload = { ...mapped };
    if (mapped.docker_compose_raw) {
      (payload as Record<string, unknown>).docker_compose_raw = toBase64(mapped.docker_compose_raw);
    }
    return this.request<Application>(`/applications/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
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

  async getApplicationLogs(
    uuid: string,
    lines: number = 100,
    showTimestamps?: boolean,
  ): Promise<string> {
    const query = this.buildQueryString({ lines, show_timestamps: showTimestamps });
    return unwrapLogs(await this.request<unknown>(`/applications/${uuid}/logs${query}`));
  }

  async getDatabaseLogs(
    uuid: string,
    lines: number = 100,
    showTimestamps?: boolean,
  ): Promise<string> {
    const query = this.buildQueryString({ lines, show_timestamps: showTimestamps });
    return unwrapLogs(await this.request<unknown>(`/databases/${uuid}/logs${query}`));
  }

  /**
   * Logs for one container inside a service. `subServiceName` is required by
   * Coolify — a service is a multi-container stack, so "the service logs" is
   * ambiguous without it. Discover valid names via {@link listServiceApplications}
   * and {@link listServiceDatabases}.
   */
  async getServiceLogs(
    uuid: string,
    subServiceName: string,
    lines: number = 100,
    showTimestamps?: boolean,
  ): Promise<string> {
    const query = this.buildQueryString({
      sub_service_name: subServiceName,
      lines,
      show_timestamps: showTimestamps,
    });
    return unwrapLogs(await this.request<unknown>(`/services/${uuid}/logs${query}`));
  }

  // ===========================================================================
  // Tags (v4.2)
  // ===========================================================================

  /**
   * Every tag on the **current team** — tokens are team-scoped, so this is not
   * the whole instance. Useful for discovering a name to attach or deploy by.
   */
  async listTags(): Promise<Tag[]> {
    return this.request<Tag[]>('/tags');
  }

  async listApplicationTags(uuid: string): Promise<Tag[]> {
    return this.request<Tag[]>(`/applications/${uuid}/tags`);
  }

  async listDatabaseTags(uuid: string): Promise<Tag[]> {
    return this.request<Tag[]>(`/databases/${uuid}/tags`);
  }

  async listServiceTags(uuid: string): Promise<Tag[]> {
    return this.request<Tag[]>(`/services/${uuid}/tags`);
  }

  async attachApplicationTags(uuid: string, data: AttachTagsRequest): Promise<Tag[]> {
    return this.request<Tag[]>(`/applications/${uuid}/tags`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async attachDatabaseTags(uuid: string, data: AttachTagsRequest): Promise<Tag[]> {
    return this.request<Tag[]>(`/databases/${uuid}/tags`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async attachServiceTags(uuid: string, data: AttachTagsRequest): Promise<Tag[]> {
    return this.request<Tag[]>(`/services/${uuid}/tags`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async detachApplicationTag(uuid: string, tagUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/tags/${tagUuid}`, {
      method: 'DELETE',
    });
  }

  async detachDatabaseTag(uuid: string, tagUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/tags/${tagUuid}`, {
      method: 'DELETE',
    });
  }

  async detachServiceTag(uuid: string, tagUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/tags/${tagUuid}`, {
      method: 'DELETE',
    });
  }

  async listServiceApplications(uuid: string): Promise<ServiceSubResource[]> {
    return this.request<ServiceSubResource[]>(`/services/${uuid}/applications`);
  }

  async listServiceDatabases(uuid: string): Promise<ServiceSubResource[]> {
    return this.request<ServiceSubResource[]>(`/services/${uuid}/databases`);
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

  /**
   * List env vars for an application.
   *
   * Default behaviour masks `value` (and `real_value` on the full projection)
   * with a sentinel string so secrets are not leaked to MCP clients. Pass
   * `reveal: true` when the caller explicitly needs the plaintext value.
   */
  async listApplicationEnvVars(
    uuid: string,
    options?: { summary?: boolean; reveal?: boolean },
  ): Promise<EnvironmentVariable[] | EnvVarSummary[]> {
    const envVars = await this.request<EnvironmentVariable[]>(`/applications/${uuid}/envs`);
    const reveal = options?.reveal === true;
    if (options?.summary) {
      const summaries = envVars.map(toEnvVarSummary);
      return reveal ? summaries : summaries.map(maskEnvVarSummary);
    }
    return reveal ? envVars : envVars.map(maskEnvVar);
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
    const payload = { ...data };
    if (payload.docker_compose_raw) {
      payload.docker_compose_raw = toBase64(payload.docker_compose_raw);
    }
    return this.request<ServiceCreateResponse>('/services', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  async updateService(uuid: string, data: UpdateServiceRequest): Promise<Service> {
    const payload = { ...data };
    if (payload.docker_compose_raw) {
      payload.docker_compose_raw = toBase64(payload.docker_compose_raw);
    }
    return this.request<Service>(`/services/${uuid}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  }

  async updateServiceApplication(
    serviceUuid: string,
    appUuid: string,
    data: UpdateServiceApplicationRequest,
    options?: { forceDomainOverride?: boolean },
  ): Promise<Application> {
    const query = this.buildQueryString({
      force_domain_override: options?.forceDomainOverride,
    });
    return this.request<Application>(`/services/${serviceUuid}/applications/${appUuid}${query}`, {
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

  // Service start/stop/restart require POST from Coolify v4.2 and have accepted
  // POST since well before it (`Route::match(['get','post'])` in v4.1 and older),
  // so POST is safe unconditionally — no fallback needed.
  async startService(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/start`, {
      method: 'POST',
    });
  }

  async stopService(uuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/stop`, {
      method: 'POST',
    });
  }

  async restartService(uuid: string, pullLatest = false): Promise<MessageResponse> {
    // `latest` stays a query param: upstream reads it via `$request->boolean('latest')`,
    // which draws from the unified input bag, so it works on POST unchanged.
    const qs = pullLatest ? '?latest=true' : '';
    return this.request<MessageResponse>(`/services/${uuid}/restart${qs}`, {
      method: 'POST',
    });
  }

  // ===========================================================================
  // Service Environment Variables
  // ===========================================================================

  /**
   * List env vars for a service.
   *
   * Default behaviour masks `value` (and `real_value`) with a sentinel string
   * so secrets are not leaked to MCP clients. Pass `reveal: true` when the
   * caller explicitly needs the plaintext value.
   */
  async listServiceEnvVars(
    uuid: string,
    options?: { reveal?: boolean },
  ): Promise<EnvironmentVariable[]> {
    const envVars = await this.request<EnvironmentVariable[]>(`/services/${uuid}/envs`);
    return options?.reveal === true ? envVars : envVars.map(maskEnvVar);
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
  ): Promise<DeploymentEssential> {
    const deployment = await this.request<Deployment>(`/deployments/${uuid}`);
    const essential = toDeploymentEssential(deployment);
    // Attach the raw log string (never the raw upstream object, which also embeds
    // the full application/server graph and secrets) onto the essential projection.
    if (options?.includeLogs && deployment.logs) {
      essential.logs = deployment.logs;
    }
    return essential;
  }

  async deployByTagOrUuid(
    tagOrUuid: string,
    force: boolean = false,
  ): Promise<DeployTriggerResponse> {
    // Detect if the value looks like a UUID or a tag name
    const param = this.isLikelyUuid(tagOrUuid) ? 'uuid' : 'tag';
    // POST required from v4.2 and accepted long before it (`match(['get','post'])`).
    return this.request<DeployTriggerResponse>(
      `/deploy?${param}=${encodeURIComponent(tagOrUuid)}&force=${force}`,
      { method: 'POST' },
    );
  }

  /**
   * List deployments for an application.
   *
   * Coolify returns `{ count, deployments: Deployment[] }` for this endpoint
   * (NOT a raw array — upstream @masonator type was incorrect).
   *
   * By default returns a DeploymentEssential summary (no `logs` field) because
   * each deployment's log blob can be 30–100KB, and a typical list has 20–35
   * deployments — exceeding MCP response token limits. Pass `includeLogs: true`
   * to also attach the raw log string to each essential projection (never the
   * raw upstream deployment object, which also embeds the full application/server
   * graph and secrets).
   */
  async listApplicationDeployments(
    appUuid: string,
    options?: { includeLogs?: boolean },
  ): Promise<{ count: number; deployments: DeploymentEssential[] }> {
    const envelope = await this.request<{ count: number; deployments: Deployment[] }>(
      `/deployments/applications/${appUuid}`,
    );
    const deployments = Array.isArray(envelope?.deployments) ? envelope.deployments : [];
    return {
      count: typeof envelope?.count === 'number' ? envelope.count : deployments.length,
      deployments: deployments.map((dep) => {
        const essential = toDeploymentEssential(dep);
        if (options?.includeLogs && dep.logs) {
          essential.logs = dep.logs;
        }
        return essential;
      }),
    };
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
  // Application Storage endpoints
  // ===========================================================================

  async listApplicationStorages(uuid: string): Promise<StorageListResponse> {
    return this.request<StorageListResponse>(`/applications/${uuid}/storages`);
  }

  async createApplicationStorage(
    uuid: string,
    data: CreateStorageRequest,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/storages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateApplicationStorage(
    uuid: string,
    data: UpdateStorageRequest,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/storages`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteApplicationStorage(uuid: string, storageUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/storages/${storageUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Application Scheduled Task endpoints
  // ===========================================================================

  async listApplicationScheduledTasks(uuid: string): Promise<ScheduledTask[]> {
    return this.request<ScheduledTask[]>(`/applications/${uuid}/scheduled-tasks`);
  }

  async createApplicationScheduledTask(
    uuid: string,
    data: CreateScheduledTaskRequest,
  ): Promise<ScheduledTask> {
    return this.request<ScheduledTask>(`/applications/${uuid}/scheduled-tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateApplicationScheduledTask(
    uuid: string,
    taskUuid: string,
    data: UpdateScheduledTaskRequest,
  ): Promise<ScheduledTask> {
    return this.request<ScheduledTask>(`/applications/${uuid}/scheduled-tasks/${taskUuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteApplicationScheduledTask(uuid: string, taskUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/scheduled-tasks/${taskUuid}`, {
      method: 'DELETE',
    });
  }

  async listApplicationScheduledTaskExecutions(
    uuid: string,
    taskUuid: string,
  ): Promise<ScheduledTaskExecution[]> {
    return this.request<ScheduledTaskExecution[]>(
      `/applications/${uuid}/scheduled-tasks/${taskUuid}/executions`,
    );
  }

  // ===========================================================================
  // Application Preview endpoints
  // ===========================================================================

  async deleteApplicationPreview(uuid: string, pullRequestId: number): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/applications/${uuid}/previews/${pullRequestId}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Database Environment Variable endpoints
  // ===========================================================================

  /**
   * List env vars for a database.
   *
   * Default behaviour masks `value` (and `real_value`) with a sentinel string
   * so secrets are not leaked to MCP clients. Pass `reveal: true` when the
   * caller explicitly needs the plaintext value. Database env vars are among
   * the most sensitive the server touches (credentials, connection strings),
   * so this mirrors the masking on {@link listServiceEnvVars}.
   */
  async listDatabaseEnvVars(
    uuid: string,
    options?: { reveal?: boolean },
  ): Promise<EnvironmentVariable[]> {
    const envVars = await this.request<EnvironmentVariable[]>(`/databases/${uuid}/envs`);
    return options?.reveal === true ? envVars : envVars.map(maskEnvVar);
  }

  async createDatabaseEnvVar(uuid: string, data: CreateEnvVarRequest): Promise<UuidResponse> {
    return this.request<UuidResponse>(`/databases/${uuid}/envs`, {
      method: 'POST',
      body: JSON.stringify(cleanRequestData(data)),
    });
  }

  async updateDatabaseEnvVar(uuid: string, data: UpdateEnvVarRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/envs`, {
      method: 'PATCH',
      body: JSON.stringify(cleanRequestData(data)),
    });
  }

  async bulkUpdateDatabaseEnvVars(
    uuid: string,
    data: BulkUpdateEnvVarsRequest,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/envs/bulk`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteDatabaseEnvVar(uuid: string, envUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/envs/${envUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Database Storage endpoints
  // ===========================================================================

  async listDatabaseStorages(uuid: string): Promise<StorageListResponse> {
    return this.request<StorageListResponse>(`/databases/${uuid}/storages`);
  }

  async createDatabaseStorage(uuid: string, data: CreateStorageRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/storages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateDatabaseStorage(uuid: string, data: UpdateStorageRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/storages`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteDatabaseStorage(uuid: string, storageUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/databases/${uuid}/storages/${storageUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Delete Backup Execution endpoint
  // ===========================================================================

  async deleteBackupExecution(
    databaseUuid: string,
    backupUuid: string,
    executionUuid: string,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(
      `/databases/${databaseUuid}/backups/${backupUuid}/executions/${executionUuid}`,
      { method: 'DELETE' },
    );
  }

  // ===========================================================================
  // Service Environment Variable (bulk) endpoint
  // ===========================================================================

  async bulkUpdateServiceEnvVars(
    uuid: string,
    data: BulkUpdateEnvVarsRequest,
  ): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/envs/bulk`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  // ===========================================================================
  // Service Storage endpoints
  // ===========================================================================

  async listServiceStorages(uuid: string): Promise<StorageListResponse> {
    return this.request<StorageListResponse>(`/services/${uuid}/storages`);
  }

  async createServiceStorage(uuid: string, data: CreateStorageRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/storages`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateServiceStorage(uuid: string, data: UpdateStorageRequest): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/storages`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteServiceStorage(uuid: string, storageUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/storages/${storageUuid}`, {
      method: 'DELETE',
    });
  }

  // ===========================================================================
  // Service Scheduled Task endpoints
  // ===========================================================================

  async listServiceScheduledTasks(uuid: string): Promise<ScheduledTask[]> {
    return this.request<ScheduledTask[]>(`/services/${uuid}/scheduled-tasks`);
  }

  async createServiceScheduledTask(
    uuid: string,
    data: CreateScheduledTaskRequest,
  ): Promise<ScheduledTask> {
    return this.request<ScheduledTask>(`/services/${uuid}/scheduled-tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  async updateServiceScheduledTask(
    uuid: string,
    taskUuid: string,
    data: UpdateScheduledTaskRequest,
  ): Promise<ScheduledTask> {
    return this.request<ScheduledTask>(`/services/${uuid}/scheduled-tasks/${taskUuid}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  }

  async deleteServiceScheduledTask(uuid: string, taskUuid: string): Promise<MessageResponse> {
    return this.request<MessageResponse>(`/services/${uuid}/scheduled-tasks/${taskUuid}`, {
      method: 'DELETE',
    });
  }

  async listServiceScheduledTaskExecutions(
    uuid: string,
    taskUuid: string,
  ): Promise<ScheduledTaskExecution[]> {
    return this.request<ScheduledTaskExecution[]>(
      `/services/${uuid}/scheduled-tasks/${taskUuid}/executions`,
    );
  }

  // ===========================================================================
  // Hetzner Cloud endpoints
  // ===========================================================================

  async listHetznerLocations(tokenUuid: string): Promise<HetznerLocation[]> {
    return this.request<HetznerLocation[]>(
      `/hetzner/locations?cloud_provider_token_uuid=${encodeURIComponent(tokenUuid)}`,
    );
  }

  async listHetznerServerTypes(tokenUuid: string): Promise<HetznerServerType[]> {
    return this.request<HetznerServerType[]>(
      `/hetzner/server-types?cloud_provider_token_uuid=${encodeURIComponent(tokenUuid)}`,
    );
  }

  async listHetznerImages(tokenUuid: string): Promise<HetznerImage[]> {
    return this.request<HetznerImage[]>(
      `/hetzner/images?cloud_provider_token_uuid=${encodeURIComponent(tokenUuid)}`,
    );
  }

  async listHetznerSSHKeys(tokenUuid: string): Promise<HetznerSSHKey[]> {
    return this.request<HetznerSSHKey[]>(
      `/hetzner/ssh-keys?cloud_provider_token_uuid=${encodeURIComponent(tokenUuid)}`,
    );
  }

  async createHetznerServer(
    data: CreateHetznerServerRequest,
  ): Promise<CreateHetznerServerResponse> {
    return this.request<CreateHetznerServerResponse>('/servers/hetzner', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  }

  // ===========================================================================
  // GitHub App Repository endpoints
  // ===========================================================================

  async listGitHubAppRepositories(githubAppId: number): Promise<GitHubRepository[]> {
    const response = await this.request<{ repositories: GitHubRepository[] }>(
      `/github-apps/${githubAppId}/repositories`,
    );
    return response.repositories ?? [];
  }

  async listGitHubAppBranches(
    githubAppId: number,
    owner: string,
    repo: string,
  ): Promise<GitHubBranch[]> {
    return this.request<GitHubBranch[]>(
      `/github-apps/${githubAppId}/repositories/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches`,
    );
  }

  // ===========================================================================
  // Resources endpoint
  // ===========================================================================

  /**
   * List every resource on the Coolify instance.
   *
   * Defaults to an essential projection ({@link ResourceListItem}: uuid, name,
   * type, optional status) — Coolify's `/api/v1/resources` endpoint actually
   * returns ~95 fields per row including the full build/healthcheck/limits
   * config, which on a moderate instance can exceed 500 KB on a single call
   * and blow MCP/LLM context budgets. Set `include_full: true` to opt back
   * into the raw response shape ({@link ResourceListItemFull}).
   *
   * When `include_full: true`, sensitive fields ({@link SENSITIVE_RESOURCE_FIELDS}:
   * webhook HMAC secrets + basic-auth password) are replaced with `'***'`
   * unless the caller also passes `reveal: true`. Mirrors the v2.9.0 env_vars
   * masking posture.
   */
  async listResources(options?: {
    include_full?: boolean;
    reveal?: boolean;
  }): Promise<ResourceListItem[] | ResourceListItemFull[]> {
    const full = await this.request<ResourceListItemFull[]>('/resources');
    if (options?.include_full !== true) {
      return full.map(toResourceListItemEssential);
    }
    return options.reveal === true ? full : full.map(maskResourceItemFull);
  }

  // ===========================================================================
  // Health endpoint
  // ===========================================================================

  async getHealth(): Promise<MessageResponse> {
    return this.request<MessageResponse>('/health');
  }

  // ===========================================================================
  // API Enable/Disable endpoints
  // ===========================================================================

  // POST from v4.2, GET only before it. See postWithLegacyGetFallback.
  async enableApi(): Promise<MessageResponse> {
    return this.postWithLegacyGetFallback<MessageResponse>(
      LEGACY_GET_ENDPOINTS.apiEnable,
      '/enable',
    );
  }

  async disableApi(): Promise<MessageResponse> {
    return this.postWithLegacyGetFallback<MessageResponse>(
      LEGACY_GET_ENDPOINTS.apiDisable,
      '/disable',
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
    // listApplicationDeployments now returns { count, deployments: [...] } —
    // flatten back to the array that the diagnostics consumer expects.
    const deploymentsEnvelope = extract(results[3], 'deployments');
    const deployments = deploymentsEnvelope?.deployments ?? [];

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

    // Cross-check: the container can be running:healthy while the latest
    // deployment failed/was cancelled — old code still serving, new code
    // never arrived (#239). Skip silently if we have no app or no deployments.
    if (app && deployments && deployments.length > 0) {
      const latestDeployment = deployments[0];
      const appIsRunning = (app.status || '').includes('running');
      if (
        appIsRunning &&
        (latestDeployment.status === 'failed' || latestDeployment.status === 'cancelled')
      ) {
        issues.push(
          `Running container predates the last (${latestDeployment.status}) deployment (${latestDeployment.uuid}) — the app is serving stale code. Use the deployment tool (action: get, uuid: ${latestDeployment.uuid}, lines) to see why it ${latestDeployment.status}.`,
        );
        healthStatus = 'unhealthy';
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
          is_buildtime: v.is_buildtime ?? false,
          is_runtime: v.is_runtime ?? true,
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
  /**
   * Applications belonging to a project.
   *
   * **`GET /applications` does not return `project_uuid`.** Verified live
   * against 4.1.2: none of the 26 applications on the test estate carried the
   * field, and it is absent from the response entirely. `restartProjectApps`
   * and `redeployProjectApps` both filtered on it, so both matched zero
   * applications and silently reported "0 succeeded" instead of doing anything.
   *
   * The only link an application carries is the numeric `environment_id`, and
   * `GET /projects/{uuid}` is what expands a project into its environments. So
   * the resolution is project → environment ids → applications in those
   * environments. Verified live: this maps all 26 applications to a project.
   *
   * `getProject` rather than the narrower `listProjectEnvironments`
   * (`GET /projects/{uuid}/environments`) because one call answers both halves
   * of the question — it returns the environments *and* confirms the project
   * exists — and it is verified against a live 4.1.2, which the narrower
   * endpoint is not. `environments` is optional on the `Project` type, so the
   * check below is what stops that choice degrading into a silent zero; if a
   * future instance stops expanding it, the fix is to fall back to
   * `listProjectEnvironments` here rather than to soften the check.
   *
   * Deliberately takes no pre-fetched application list. The #261 confirmation
   * path shares the set the human approved by passing it to the *operation*
   * (`restartProjectApps` / `redeployProjectApps` both accept it), not by
   * re-entering this lookup, so a pre-fetch parameter here would have no caller.
   */
  async applicationsInProject(projectUuid: string): Promise<Application[]> {
    const [project, allApps] = await Promise.all([
      this.getProject(projectUuid),
      this.listApplications() as Promise<Application[]>,
    ]);
    // Throw rather than treat a missing `environments` as an empty one. An
    // absent array means the project's environments could not be resolved —
    // older instance, partial response, insufficient permissions — and
    // defaulting it to `[]` would match zero applications and report a cheerful
    // "0 succeeded", which is precisely the silent no-op this method exists to
    // fix. An empty array is different and is left alone: that is a real answer
    // about a real project.
    //
    // It matters most on the confirmation path: an unresolvable project would
    // otherwise produce no dialog *and* no work, so the user would see neither
    // a prompt nor an error.
    if (!Array.isArray(project.environments)) {
      throw new Error(
        `Could not resolve environments for project ${projectUuid}: the API returned no environments array. ` +
          `Without it there is no way to tell which applications belong to this project.`,
      );
    }
    const environmentIds = new Set(project.environments.map((env) => env.id));
    return allApps.filter(
      (app) => app.environment_id !== undefined && environmentIds.has(app.environment_id),
    );
  }

  /**
   * Everything a project delete would take with it.
   *
   * `DELETE /projects/{uuid}` documents no "project has resources" refusal —
   * unlike the environment delete, which has an explicit 400 — so the delete is
   * assumed to cascade, and a confirmation that counts only applications
   * understates a project holding three Postgres instances and no apps. That is
   * the direction a destructive prompt must never be wrong in.
   *
   * Databases and services resolve exactly like applications: verified live
   * against 4.1.2, neither list endpoint returns `project_uuid` and both carry
   * the numeric `environment_id`.
   *
   * Returns the `project` too, so the confirmation path does not fetch it a
   * second time — the one path where an extra round trip happens with a human
   * waiting on the dialog.
   */
  async projectContents(projectUuid: string): Promise<{
    project: Project;
    applications: Application[];
    databases: Database[];
    services: Service[];
  }> {
    const [project, apps, databases, services] = await Promise.all([
      this.getProject(projectUuid),
      this.listApplications() as Promise<Application[]>,
      this.listDatabases() as Promise<Database[]>,
      this.listServices() as Promise<Service[]>,
    ]);
    // Same reasoning as `applicationsInProject`: a missing array means "could
    // not find out", and reporting that as an empty project is how a delete
    // prompt understates itself.
    if (!Array.isArray(project.environments)) {
      throw new Error(
        `Could not resolve environments for project ${projectUuid}: the API returned no environments array. ` +
          `Without it there is no way to tell what this project contains.`,
      );
    }
    const environmentIds = new Set(project.environments.map((env) => env.id));
    const inProject = <T extends { environment_id?: number }>(items: T[]): T[] =>
      items.filter(
        (item) => item.environment_id !== undefined && environmentIds.has(item.environment_id),
      );
    return {
      project,
      applications: inProject(apps),
      databases: inProject(databases),
      services: inProject(services),
    };
  }

  /**
   * @param projectApps The applications to restart. Pass the set a human already
   *   approved; omit to resolve it from the project.
   */
  async restartProjectApps(
    projectUuid: string,
    projectApps?: Application[],
  ): Promise<BatchOperationResult> {
    projectApps ??= await this.applicationsInProject(projectUuid);

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
   * @param isBuildtime - Sets the build-time flag on the variable when provided
   * @param isRuntime - Sets the runtime flag on the variable when provided
   */
  async bulkEnvUpdate(
    appUuids: string[],
    key: string,
    value: string,
    isBuildtime?: boolean,
    isRuntime?: boolean,
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
        this.updateApplicationEnvVar(uuid, {
          key,
          value,
          is_buildtime: isBuildtime,
          is_runtime: isRuntime,
        }),
      ),
    );

    return this.aggregateBatchResults(resources, results);
  }

  /**
   * Emergency stop all running applications across entire infrastructure.
   */
  /**
   * @param runningApps The applications to stop, already filtered to running.
   *   Pass the set a human approved; omit to resolve it from the estate.
   */
  async stopAllApps(runningApps?: Application[]): Promise<BatchOperationResult> {
    // Only stop running apps
    runningApps ??= ((await this.listApplications()) as Application[]).filter((app) =>
      isRunningStatus(app.status),
    );

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
    projectApps?: Application[],
  ): Promise<BatchOperationResult> {
    projectApps ??= await this.applicationsInProject(projectUuid);

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
