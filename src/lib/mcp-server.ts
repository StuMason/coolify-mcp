/**
 * Coolify MCP Server
 * Consolidated tools for efficient token usage
 */

import { createRequire } from 'module';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { Transport } from '@modelcontextprotocol/sdk/shared/transport.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import type { ToolCallback } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ZodRawShapeCompat } from '@modelcontextprotocol/sdk/server/zod-compat.js';
import { z } from 'zod';
import {
  CoolifyClient,
  isRunningStatus,
  type ServerSummary,
  type ProjectSummary,
  type ApplicationSummary,
  type DatabaseSummary,
  type ServiceSummary,
  type GitHubAppSummary,
} from './coolify-client.js';
import type {
  Application,
  CoolifyConfig,
  GitHubApp,
  BuildPack,
  ResponseAction,
  ResponsePagination,
  ScheduledTaskExecution,
  Deployment,
  DeploymentEssential,
  DeployTriggerResponse,
} from '../types/coolify.js';
import { DocsSearchEngine } from './docs-search.js';
import { confirmDestructive, describeBlastRadius, sanitizeForPrompt } from './elicit.js';

const _require = createRequire(import.meta.url);
export const VERSION: string = _require('../../package.json').version;

/** Wrap handler with error handling */
function wrap<T>(
  fn: () => Promise<T>,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return fn()
    .then((result) => ({
      content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
    }))
    .catch((error) => ({
      content: [
        {
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    }));
}

const TRUNCATION_PREFIX = '...[truncated]...\n';

/**
 * Apps a single `bulk_env_update` may touch before it needs a human (#261).
 *
 * Prompting on every bulk update would be prompt fatigue with extra steps, and
 * a prompt people have learned to dismiss protects nothing. Three is the
 * boundary named in the issue: enough for the ordinary "same key on the api,
 * the worker and the scheduler" edit to stay frictionless.
 */
const BULK_ENV_CONFIRM_THRESHOLD = 3;

/**
 * Confirmation text for deleting an application, database or service (#261).
 *
 * The volume sentence is the reason this function exists. `delete_volumes` is
 * documented `default: true` on all three DELETE endpoints (see
 * `docs/coolify-openapi.yaml`), so **omitting the flag destroys the data** —
 * the opposite of what "optional boolean, left unset" reads like at a call
 * site. Only an explicit `false` is treated as "volumes kept", which is both
 * what the spec says and the safe way to be wrong if the spec is lying again.
 */
function deleteResourcePrompt(
  kind: 'application' | 'database' | 'service',
  name: string,
  uuid: string,
  deleteVolumes: boolean | undefined,
): string {
  const volumes =
    deleteVolumes === false
      ? 'Persistent volumes are kept.'
      : `Persistent volumes will be DESTROYED and their data is not recoverable${
          deleteVolumes === undefined
            ? ' (delete_volumes was not set, and it defaults to true)'
            : ''
        }.`;
  return `Delete ${kind} "${sanitizeForPrompt(name)}" (${uuid})?\n\n${volumes} This cannot be undone.`;
}

interface LogEntry {
  output?: string;
  timestamp?: string;
  type?: string;
  hidden?: boolean;
  command?: string | null;
}

export interface TruncatedLogsResult {
  logs: string;
  total: number;
  showing_start: number;
  showing_end: number;
}

/**
 * Truncate logs by entry count with pagination support.
 * Handles both JSON array format (Coolify deployment logs) and plain text.
 * Page 1 = most recent entries, page 2 = next older batch, etc.
 * Exported for testing.
 */
export function truncateLogs(
  logs: string,
  lineLimit: number = 200,
  charLimit: number = 50000,
  page: number = 1,
): TruncatedLogsResult {
  // Try parsing as JSON array (Coolify deployment log format)
  let lines: string[];
  let total: number;
  try {
    const entries: LogEntry[] = JSON.parse(logs);
    if (Array.isArray(entries)) {
      const visible = entries.filter((e) => !e.hidden);
      total = visible.length;
      const end = total - (page - 1) * lineLimit;
      const start = Math.max(0, end - lineLimit);
      const slice = visible.slice(start, end);
      lines = slice.map((e) => `[${e.timestamp ?? ''}] ${e.output ?? ''}`);
    } else {
      const allLines = logs.split('\n');
      total = allLines.length;
      const end = total - (page - 1) * lineLimit;
      const start = Math.max(0, end - lineLimit);
      lines = allLines.slice(start, end);
    }
  } catch {
    // Plain text logs — split by newlines
    const allLines = logs.split('\n');
    total = allLines.length;
    const end = total - (page - 1) * lineLimit;
    const start = Math.max(0, end - lineLimit);
    lines = allLines.slice(start, end);
  }

  const end = total - (page - 1) * lineLimit;
  const start = Math.max(0, end - lineLimit);
  let result = lines.join('\n');

  // Safety net: limit by characters
  if (result.length > charLimit) {
    const prefixLen = TRUNCATION_PREFIX.length;
    result = TRUNCATION_PREFIX + result.slice(-(charLimit - prefixLen));
  }

  return {
    logs: result,
    total,
    showing_start: start + 1,
    showing_end: Math.min(end, total),
  };
}

// =============================================================================
// Action Generators for HATEOAS-style responses
// =============================================================================

/** Generate contextual actions for an application based on its status */
export function getApplicationActions(uuid: string, status?: string): ResponseAction[] {
  const actions: ResponseAction[] = [
    { tool: 'logs', args: { resource: 'application', uuid }, hint: 'View logs' },
  ];
  const s = (status || '').toLowerCase();
  if (s.includes('running')) {
    actions.push({
      tool: 'control',
      args: { resource: 'application', action: 'restart', uuid },
      hint: 'Restart',
    });
    actions.push({
      tool: 'control',
      args: { resource: 'application', action: 'stop', uuid },
      hint: 'Stop',
    });
  } else {
    actions.push({
      tool: 'control',
      args: { resource: 'application', action: 'start', uuid },
      hint: 'Start',
    });
  }
  return actions;
}

/** Generate contextual actions for a deployment */
export function getDeploymentActions(
  uuid: string,
  status: string,
  appUuid?: string,
): ResponseAction[] {
  const actions: ResponseAction[] = [];
  if (status === 'in_progress' || status === 'queued') {
    actions.push({ tool: 'deployment', args: { action: 'cancel', uuid }, hint: 'Cancel' });
  }
  if (appUuid) {
    actions.push({ tool: 'get_application', args: { uuid: appUuid }, hint: 'View app' });
    actions.push({
      tool: 'logs',
      args: { resource: 'application', uuid: appUuid },
      hint: 'App logs',
    });
  }
  return actions;
}

/** Generate pagination info for list endpoints */
export function getPagination(
  tool: string,
  page?: number,
  perPage?: number,
  count?: number,
): ResponsePagination | undefined {
  const p = page ?? 1;
  const pp = perPage ?? 50;
  if (!count || count < pp) {
    return p > 1 ? { prev: { tool, args: { page: p - 1, per_page: pp } } } : undefined;
  }
  return {
    ...(p > 1 && { prev: { tool, args: { page: p - 1, per_page: pp } } }),
    next: { tool, args: { page: p + 1, per_page: pp } },
  };
}

/** Wrap handler with error handling and HATEOAS actions */
function wrapWithActions<T>(
  fn: () => Promise<T>,
  getActions?: (result: T) => ResponseAction[],
  getPaginationFn?: (result: T) => ResponsePagination | undefined,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  return fn()
    .then((result) => {
      const actions = getActions?.(result) ?? [];
      const pagination = getPaginationFn?.(result);
      const response: Record<string, unknown> = { data: result };
      if (actions.length > 0) response._actions = actions;
      if (pagination) response._pagination = pagination;
      return { content: [{ type: 'text' as const, text: JSON.stringify(response, null, 2) }] };
    })
    .catch((error) => ({
      content: [
        {
          type: 'text' as const,
          text: `Error: ${error instanceof Error ? error.message : String(error)}`,
        },
      ],
    }));
}

// =============================================================================
// Deploy wait/poll helpers (#238)
// =============================================================================

/** Deployment statuses that end a run — polling stops once one of these is hit. */
const TERMINAL_DEPLOYMENT_STATUSES: ReadonlySet<string> = new Set([
  'finished',
  'failed',
  'cancelled',
]);

const DEFAULT_DEPLOY_TIMEOUT_SECONDS = 300;
const DEPLOY_POLL_INTERVAL_MS = 5000;

function isTerminalDeploymentStatus(status: string): boolean {
  return TERMINAL_DEPLOYMENT_STATUSES.has(status);
}

/** Isolated so tests can drive polling with jest fake timers instead of real waits. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function durationSeconds(createdAt?: string, updatedAt?: string): number | undefined {
  if (!createdAt || !updatedAt) return undefined;
  const start = Date.parse(createdAt);
  const end = Date.parse(updatedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return undefined;
  return Math.max(0, Math.round((end - start) / 1000));
}

/**
 * Small, safe projection returned by `deploy` when `wait: true`.
 * Built from essential fields + a bounded log tail only — never the raw
 * upstream deployment object, which can carry server/application secrets
 * (see #232).
 */
interface DeployWaitResult {
  status: string;
  deployment_uuid: string;
  application_uuid?: string;
  commit?: string;
  created_at?: string;
  updated_at?: string;
  duration_seconds?: number;
  timed_out?: boolean;
  logs_tail?: string;
  logs_meta?: { total_entries: number; showing: string };
  next_action?: string;
  additional_deployment_uuids?: string[];
}

/**
 * Tool annotations, spec-stable since 2025-03-26 and honoured by SDK 1.x
 * `registerTool`. They ride the existing `tools/list` response but are NOT
 * free: ~415 tokens as emitted here, and ~751 with the spec defaults spelled
 * out. Measured, not assumed — see the byte-budget test in mcp-server.test.ts
 * before re-adding any default hint.
 *
 * Kept as one table rather than scattered across every call site so the safety
 * classification of the whole surface can be audited in one place — which is
 * the point of it. Tests assert this map and the registered tools stay 1:1.
 *
 * Semantics (per spec):
 * - `readOnlyHint` — the tool does not modify its environment at all.
 * - `destructiveHint` — may perform destructive updates, as opposed to purely
 *   additive ones. Only meaningful when `readOnlyHint` is false.
 * - `idempotentHint` — repeated calls with the same arguments have no
 *   additional effect. Only meaningful when `readOnlyHint` is false.
 * - `openWorldHint` — interacts with an external entity (here, the Coolify API).
 *
 * Consolidated tools take worst-case values: any tool with a `delete` action is
 * destructive even though most of its actions are not.
 *
 * That worst-casing has a real cost worth naming: `env_vars` list, `deployment`
 * get/list_for_app and `system` health/list_resources are pure reads sitting
 * under destructive tools, so they lose parallel dispatch and gain confirmation
 * prompts. Inherent to consolidation, and not worth splitting tools over — but
 * it matters for the V3 read-only mode (#303), because filtering on this map
 * would drop those read actions too, which is not what someone asking for
 * read-only access expects. Gate that on action, not just on the tool.
 */
// Only non-default hints are emitted. Per spec the defaults are
// readOnlyHint=false, destructiveHint=true, idempotentHint=false and
// openWorldHint=true, so spelling those out costs tokens on every tools/list
// and tells a compliant client nothing it did not already assume.
// `destructiveHint: true` is the deliberate exception: it is the default, but
// it is also the safety signal, and stating it explicitly is worth the bytes.
// Frozen because twenty tools share the DESTRUCTIVE reference and registerTool
// stores it on the registered tool — one stray mutation would silently
// reclassify all of them.
const READ_ONLY = Object.freeze({ readOnlyHint: true }) satisfies ToolAnnotations;
const DESTRUCTIVE = Object.freeze({ destructiveHint: true }) satisfies ToolAnnotations;

export const TOOL_ANNOTATIONS = {
  // --- Read-only -----------------------------------------------------------
  get_version: READ_ONLY,
  // Local constant, no API call — the one tool that touches nothing external.
  get_mcp_version: { readOnlyHint: true, openWorldHint: false },
  get_infrastructure_overview: READ_ONLY,
  list_servers: READ_ONLY,
  list_applications: READ_ONLY,
  list_databases: READ_ONLY,
  list_services: READ_ONLY,
  list_deployments: READ_ONLY,
  get_server: READ_ONLY,
  get_application: READ_ONLY,
  get_database: READ_ONLY,
  get_service: READ_ONLY,
  server_resources: READ_ONLY,
  server_domains: READ_ONLY,
  diagnose_app: READ_ONLY,
  diagnose_server: READ_ONLY,
  find_issues: READ_ONLY,
  search_docs: READ_ONLY,
  application_logs: READ_ONLY,
  logs: READ_ONLY,
  teams: READ_ONLY,

  // --- Destructive: every one of these has a delete, stop, or replace ------
  application: DESTRUCTIVE,
  database: DESTRUCTIVE,
  service: DESTRUCTIVE,
  projects: DESTRUCTIVE,
  environments: DESTRUCTIVE,
  env_vars: DESTRUCTIVE,
  private_keys: DESTRUCTIVE,
  github_apps: DESTRUCTIVE,
  cloud_tokens: DESTRUCTIVE,
  storages: DESTRUCTIVE,
  // `detach` removes a tag from a resource.
  tags: DESTRUCTIVE,
  scheduled_tasks: DESTRUCTIVE,
  database_backups: DESTRUCTIVE,
  // stop/restart take a running resource down.
  control: DESTRUCTIVE,
  // A deploy replaces the running containers, so it is a destructive update
  // rather than an additive one.
  deploy: DESTRUCTIVE,
  // `cancel` kills an in-flight deployment.
  deployment: DESTRUCTIVE,
  stop_all_apps: DESTRUCTIVE,
  bulk_env_update: DESTRUCTIVE,
  redeploy_project: DESTRUCTIVE,
  restart_project_apps: DESTRUCTIVE,
  // `disable_api` cuts off API access entirely.
  system: DESTRUCTIVE,

  // --- Writes that are neither read-only nor destructive -------------------
  // Provisions servers and spends real money, but every action is additive:
  // it creates, it never replaces or removes.
  hetzner: { destructiveHint: false },
  // Re-running a validation converges on the same state.
  validate_server: { destructiveHint: false, idempotentHint: true },
} satisfies Record<string, ToolAnnotations>;

/**
 * Every tool name known to the annotations table. `defineTool` takes this
 * rather than `string`, so registering a tool that has no annotations is a
 * compile error instead of a runtime throw. The throw stays as a backstop for
 * anything reaching the method dynamically.
 */
export type ToolName = keyof typeof TOOL_ANNOTATIONS;

export class CoolifyMcpServer extends McpServer {
  private readonly client: CoolifyClient;
  private readonly docsSearch: DocsSearchEngine = new DocsSearchEngine();

  /**
   * Register a tool, attaching its annotations from {@link TOOL_ANNOTATIONS}.
   *
   * Wraps SDK `registerTool` (the legacy `tool()` overloads are deprecated) so
   * annotations cannot be forgotten at a call site. `name` is typed to the
   * table's own keys, so a tool with no annotations fails `tsc` rather than
   * throwing when someone runs the server; the runtime throw remains as a
   * backstop for dynamic callers.
   */
  private defineTool<Args extends ZodRawShapeCompat>(
    name: ToolName,
    description: string,
    inputSchema: Args,
    cb: ToolCallback<Args>,
  ): void {
    const annotations = TOOL_ANNOTATIONS[name];
    if (!annotations) {
      throw new Error(
        `Tool "${name}" has no entry in TOOL_ANNOTATIONS. Add one — clients use these hints to decide whether a call needs confirmation.`,
      );
    }
    this.registerTool(name, { description, inputSchema, annotations }, cb);
  }

  /**
   * Run `operation`, but ask the human first (#261).
   *
   * On clients that support elicitation this renders `summarize()` as a
   * confirmation prompt and aborts unless it is accepted; on clients that do
   * not, it is a straight pass-through to {@link wrap} and the tool behaves
   * exactly as it did before. See `elicit.ts` for why that asymmetry is the
   * right default.
   *
   * `summarize` is lazy so that call sites which need an API round trip to
   * count their blast radius do not make it on clients that will never show
   * the question, and may return `null` to mean "nothing to confirm" — an
   * emergency stop on an idle estate should not raise a dialog.
   *
   * `signal` is the tool call's own abort signal and must be threaded through:
   * without it, a client that times the `tools/call` out at 60s leaves the
   * prompt live, and a later accept executes the operation with nobody
   * listening.
   */
  private async guardDestructive<T>(
    signal: AbortSignal | undefined,
    summarize: () => string | null | Promise<string | null>,
    operation: () => Promise<T>,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const outcome = await confirmDestructive(this.server, summarize, signal);
    if (!outcome.approved) {
      return { content: [{ type: 'text' as const, text: outcome.message }] };
    }
    return wrap(operation);
  }

  constructor(config: CoolifyConfig) {
    super({ name: 'coolify', version: VERSION });
    this.client = new CoolifyClient(config);
    this.registerTools();
  }

  async connect(transport: Transport): Promise<void> {
    await super.connect(transport);
  }

  /**
   * Poll a single deployment until it reaches a terminal status or the
   * timeout elapses. Uses `getDeployment`'s no-logs projection
   * (`DeploymentEssential`) while polling, and only fetches logs (once,
   * truncated) if the deployment failed.
   */
  private async pollDeployment(uuid: string, timeoutSeconds: number): Promise<DeployWaitResult> {
    const deadline = Date.now() + timeoutSeconds * 1000;
    let current = (await this.client.getDeployment(uuid)) as DeploymentEssential;

    while (!isTerminalDeploymentStatus(current.status) && Date.now() < deadline) {
      await sleep(DEPLOY_POLL_INTERVAL_MS);
      current = (await this.client.getDeployment(uuid)) as DeploymentEssential;
    }

    if (!isTerminalDeploymentStatus(current.status)) {
      return {
        status: current.status,
        deployment_uuid: uuid,
        application_uuid: current.application_uuid,
        timed_out: true,
        next_action: `Still "${current.status}" after ${timeoutSeconds}s — poll \`deployment\` (action: "get", uuid: "${uuid}") to keep watching.`,
      };
    }

    if (current.status === 'failed') {
      const withLogs = (await this.client.getDeployment(uuid, {
        includeLogs: true,
      })) as Deployment;
      const tail = withLogs.logs ? truncateLogs(withLogs.logs, 30, 10_000) : undefined;
      return {
        status: current.status,
        deployment_uuid: uuid,
        application_uuid: current.application_uuid,
        commit: current.commit,
        created_at: current.created_at,
        updated_at: current.updated_at,
        duration_seconds: durationSeconds(current.created_at, current.updated_at),
        logs_tail: tail?.logs,
        logs_meta: tail
          ? {
              total_entries: tail.total,
              showing: `${tail.showing_start}-${tail.showing_end} of ${tail.total}`,
            }
          : undefined,
        next_action: `Deployment failed. See logs_tail above, or \`deployment\` (action: "get", uuid: "${uuid}", lines: N) for more.`,
      };
    }

    return {
      status: current.status,
      deployment_uuid: uuid,
      application_uuid: current.application_uuid,
      commit: current.commit,
      created_at: current.created_at,
      updated_at: current.updated_at,
      duration_seconds: durationSeconds(current.created_at, current.updated_at),
    };
  }

  /**
   * Trigger a deploy and wait for it to finish. A tag can resolve to
   * multiple applications, so `deployByTagOrUuid` may return several
   * `deployment_uuid`s — only the first is polled; any others are
   * surfaced under `additional_deployment_uuids` for the caller to check
   * separately via `deployment get`.
   */
  private async triggerAndWaitForDeploy(
    tagOrUuid: string,
    force: boolean | undefined,
    timeoutSeconds: number,
  ): Promise<DeployWaitResult | DeployTriggerResponse> {
    const triggered = await this.client.deployByTagOrUuid(tagOrUuid, force);
    const [first, ...rest] = triggered.deployments ?? [];

    if (!first?.deployment_uuid) {
      // Nothing to poll against — hand back the trigger response as-is.
      return triggered;
    }

    const result = await this.pollDeployment(first.deployment_uuid, timeoutSeconds);
    const additional = rest.map((d) => d.deployment_uuid).filter((u): u is string => !!u);
    if (additional.length > 0) {
      result.additional_deployment_uuids = additional;
    }
    return result;
  }

  private registerTools(): void {
    // =========================================================================
    // Meta (2 tools)
    // =========================================================================
    this.defineTool('get_version', 'Coolify API version', {}, async () =>
      wrap(() => this.client.getVersion()),
    );

    this.defineTool('get_mcp_version', 'MCP server version', {}, async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({ version: VERSION, name: '@masonator/coolify-mcp' }),
        },
      ],
    }));

    // =========================================================================
    // Infrastructure Overview (1 tool)
    // =========================================================================
    this.defineTool(
      'get_infrastructure_overview',
      'Overview of all resources with counts',
      {},
      async () =>
        wrap(async () => {
          const results = await Promise.allSettled([
            this.client.listServers({ summary: true }),
            this.client.listProjects({ summary: true }),
            this.client.listApplications({ summary: true }),
            this.client.listDatabases({ summary: true }),
            this.client.listServices({ summary: true }),
          ]);
          const extract = <T>(r: PromiseSettledResult<T>): T | [] =>
            r.status === 'fulfilled' ? r.value : [];
          const [servers, projects, applications, databases, services] = [
            extract(results[0]) as ServerSummary[],
            extract(results[1]) as ProjectSummary[],
            extract(results[2]) as ApplicationSummary[],
            extract(results[3]) as DatabaseSummary[],
            extract(results[4]) as ServiceSummary[],
          ];
          const errors = results
            .map((r, i) =>
              r.status === 'rejected'
                ? `${['servers', 'projects', 'applications', 'databases', 'services'][i]}: ${r.reason}`
                : null,
            )
            .filter(Boolean);
          return {
            summary: {
              servers: servers.length,
              projects: projects.length,
              applications: applications.length,
              databases: databases.length,
              services: services.length,
            },
            servers,
            projects,
            applications,
            databases,
            services,
            ...(errors.length > 0 && { errors }),
          };
        }),
    );

    // =========================================================================
    // Diagnostics (3 tools)
    // =========================================================================
    this.defineTool(
      'diagnose_app',
      'App diagnostics by UUID/name/domain',
      { query: z.string() },
      async ({ query }) => wrap(() => this.client.diagnoseApplication(query)),
    );

    this.defineTool(
      'diagnose_server',
      'Server diagnostics by UUID/name/IP',
      { query: z.string() },
      async ({ query }) => wrap(() => this.client.diagnoseServer(query)),
    );

    this.defineTool('find_issues', 'Scan infrastructure for problems', {}, async () =>
      wrap(() => this.client.findInfrastructureIssues()),
    );

    // =========================================================================
    // Servers (5 tools)
    // =========================================================================
    this.defineTool(
      'list_servers',
      'List servers (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listServers({ page, per_page, summary: true })),
    );

    this.defineTool('get_server', 'Server details', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getServer(uuid)),
    );

    this.defineTool(
      'server_resources',
      'Resources on server',
      { uuid: z.string() },
      async ({ uuid }) => wrap(() => this.client.getServerResources(uuid)),
    );

    this.defineTool('server_domains', 'Domains on server', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getServerDomains(uuid)),
    );

    this.defineTool(
      'validate_server',
      'Validate server connection',
      { uuid: z.string() },
      async ({ uuid }) => wrap(() => this.client.validateServer(uuid)),
    );

    // =========================================================================
    // Projects (1 tool - consolidated CRUD)
    // =========================================================================
    this.defineTool(
      'projects',
      'Manage projects: list/get/create/update/delete',
      {
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        uuid: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        page: z.number().optional(),
        per_page: z.number().optional(),
      },
      async ({ action, uuid, name, description, page, per_page }, extra) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listProjects({ page, per_page, summary: true }));
          case 'get':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.getProject(uuid));
          case 'create':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            return wrap(() => this.client.createProject({ name, description }));
          case 'update':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.updateProject(uuid, { name, description }));
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return this.guardDestructive(
              extra.signal,
              async () => {
                const project = await this.client.getProject(uuid);
                return `Delete project "${sanitizeForPrompt(project.name || uuid)}" (${uuid})? This cannot be undone.`;
              },
              () => this.client.deleteProject(uuid),
            );
        }
      },
    );

    // =========================================================================
    // Environments (1 tool - consolidated CRUD)
    // =========================================================================
    this.defineTool(
      'environments',
      'Manage environments: list/get/create/delete (get includes dragonfly/keydb/clickhouse DBs missing from API)',
      {
        action: z.enum(['list', 'get', 'create', 'delete']),
        project_uuid: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ action, project_uuid, name, description }, extra) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listProjectEnvironments(project_uuid));
          case 'get':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            // Use enhanced method that includes missing DB types (#88)
            return wrap(() => this.client.getProjectEnvironmentWithDatabases(project_uuid, name));
          case 'create':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            return wrap(() =>
              this.client.createProjectEnvironment(project_uuid, { name, description }),
            );
          case 'delete':
            if (!name)
              return { content: [{ type: 'text' as const, text: 'Error: name required' }] };
            return this.guardDestructive(
              extra.signal,
              () =>
                `Delete environment "${sanitizeForPrompt(name)}" from project ${project_uuid}? This cannot be undone.`,
              () => this.client.deleteProjectEnvironment(project_uuid, name),
            );
        }
      },
    );

    // =========================================================================
    // Applications (4 tools)
    // =========================================================================
    this.defineTool(
      'list_applications',
      'List apps (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrapWithActions(
          () => this.client.listApplications({ page, per_page, summary: true }),
          undefined,
          (result) =>
            getPagination('list_applications', page, per_page, (result as unknown[]).length),
        ),
    );

    this.defineTool('get_application', 'App details', { uuid: z.string() }, async ({ uuid }) =>
      wrapWithActions(
        () => this.client.getApplication(uuid),
        (app) => getApplicationActions(app.uuid, app.status),
      ),
    );

    this.defineTool(
      'application',
      'Manage app: create/update/delete/delete_preview',
      {
        action: z.enum([
          'create_public',
          'create_github',
          'create_key',
          'create_dockerimage',
          'create_dockerfile',
          'update',
          'delete',
          'delete_preview',
        ]),
        uuid: z.string().optional(),
        // Create fields
        project_uuid: z.string().optional(),
        server_uuid: z.string().optional(),
        github_app_uuid: z.string().optional(),
        private_key_uuid: z.string().optional(),
        destination_uuid: z.string().optional(),
        git_repository: z.string().optional(),
        git_branch: z.string().optional(),
        environment_name: z.string().optional(),
        environment_uuid: z.string().optional(),
        build_pack: z.string().optional(),
        ports_exposes: z.string().optional(),
        // Docker image fields
        docker_registry_image_name: z.string().optional(),
        docker_registry_image_tag: z.string().optional(),
        // Dockerfile fields (create_dockerfile)
        dockerfile: z.string().optional(),
        // Update fields
        name: z.string().optional(),
        description: z.string().optional(),
        fqdn: z.string().optional(),
        domains: z.string().optional(),
        custom_docker_run_options: z.string().optional(),
        custom_labels: z.string().optional(),
        custom_network_aliases: z
          .string()
          .optional()
          .describe(
            'Comma-separated DNS aliases for app-to-app traffic (update only). App containers have no stable uuid hostname — only databases do.',
          ),
        instant_deploy: z.boolean().optional(),
        // Health check fields
        health_check_enabled: z.boolean().optional(),
        health_check_path: z.string().optional(),
        health_check_port: z.number().optional(),
        health_check_host: z.string().optional(),
        health_check_method: z.string().optional(),
        health_check_return_code: z.number().optional(),
        health_check_scheme: z.string().optional(),
        health_check_response_text: z.string().optional(),
        health_check_interval: z.number().optional(),
        health_check_timeout: z.number().optional(),
        health_check_retries: z.number().optional(),
        health_check_start_period: z.number().optional(),
        // Build configuration fields (accepted on create_public/github/key + update;
        // create_dockerimage ignores these — pre-built image, no build step)
        base_directory: z.string().optional(),
        publish_directory: z.string().optional(),
        install_command: z.string().optional(),
        build_command: z.string().optional(),
        start_command: z.string().optional(),
        dockerfile_location: z.string().optional(),
        watch_paths: z.string().optional(),
        // Update-only: Coolify strips dockerfile_target_build on every create endpoint
        // (controller $allowedFields line 1014) but accepts on PATCH (line 2497).
        dockerfile_target_build: z.string().optional(),
        // Delete fields
        delete_volumes: z.boolean().optional(),
        // Preview fields
        pull_request_id: z.number().optional(),
      },
      async (args, extra) => {
        const { action, uuid, delete_volumes } = args;
        switch (action) {
          case 'create_public':
            if (
              !args.project_uuid ||
              !args.server_uuid ||
              !args.git_repository ||
              !args.git_branch ||
              !args.build_pack ||
              !args.ports_exposes
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: project_uuid, server_uuid, git_repository, git_branch, build_pack, ports_exposes required',
                  },
                ],
              };
            }
            return wrap(() =>
              this.client.createApplicationPublic({
                project_uuid: args.project_uuid!,
                server_uuid: args.server_uuid!,
                destination_uuid: args.destination_uuid,
                git_repository: args.git_repository!,
                git_branch: args.git_branch!,
                build_pack: args.build_pack! as BuildPack,
                ports_exposes: args.ports_exposes!,
                environment_name: args.environment_name,
                environment_uuid: args.environment_uuid,
                name: args.name,
                description: args.description,
                fqdn: args.fqdn,
                domains: args.domains,
                base_directory: args.base_directory,
                publish_directory: args.publish_directory,
                install_command: args.install_command,
                build_command: args.build_command,
                start_command: args.start_command,
                dockerfile_location: args.dockerfile_location,
                watch_paths: args.watch_paths,
                health_check_enabled: args.health_check_enabled,
                health_check_path: args.health_check_path,
                health_check_port: args.health_check_port,
                health_check_host: args.health_check_host,
                health_check_method: args.health_check_method,
                health_check_return_code: args.health_check_return_code,
                health_check_scheme: args.health_check_scheme,
                health_check_response_text: args.health_check_response_text,
                health_check_interval: args.health_check_interval,
                health_check_timeout: args.health_check_timeout,
                health_check_retries: args.health_check_retries,
                health_check_start_period: args.health_check_start_period,
                custom_docker_run_options: args.custom_docker_run_options,
                custom_labels: args.custom_labels,
                instant_deploy: args.instant_deploy,
              }),
            );
          case 'create_github':
            if (
              !args.project_uuid ||
              !args.server_uuid ||
              !args.github_app_uuid ||
              !args.git_repository ||
              !args.git_branch
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: project_uuid, server_uuid, github_app_uuid, git_repository, git_branch required',
                  },
                ],
              };
            }
            return wrap(() =>
              this.client.createApplicationPrivateGH({
                project_uuid: args.project_uuid!,
                server_uuid: args.server_uuid!,
                github_app_uuid: args.github_app_uuid!,
                destination_uuid: args.destination_uuid,
                git_repository: args.git_repository!,
                git_branch: args.git_branch!,
                build_pack: args.build_pack as BuildPack | undefined,
                ports_exposes: args.ports_exposes,
                environment_name: args.environment_name,
                environment_uuid: args.environment_uuid,
                name: args.name,
                description: args.description,
                fqdn: args.fqdn,
                domains: args.domains,
                base_directory: args.base_directory,
                publish_directory: args.publish_directory,
                install_command: args.install_command,
                build_command: args.build_command,
                start_command: args.start_command,
                dockerfile_location: args.dockerfile_location,
                watch_paths: args.watch_paths,
                health_check_enabled: args.health_check_enabled,
                health_check_path: args.health_check_path,
                health_check_port: args.health_check_port,
                health_check_host: args.health_check_host,
                health_check_method: args.health_check_method,
                health_check_return_code: args.health_check_return_code,
                health_check_scheme: args.health_check_scheme,
                health_check_response_text: args.health_check_response_text,
                health_check_interval: args.health_check_interval,
                health_check_timeout: args.health_check_timeout,
                health_check_retries: args.health_check_retries,
                health_check_start_period: args.health_check_start_period,
                custom_docker_run_options: args.custom_docker_run_options,
                custom_labels: args.custom_labels,
                instant_deploy: args.instant_deploy,
              }),
            );
          case 'create_key':
            if (
              !args.project_uuid ||
              !args.server_uuid ||
              !args.private_key_uuid ||
              !args.git_repository ||
              !args.git_branch
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: project_uuid, server_uuid, private_key_uuid, git_repository, git_branch required',
                  },
                ],
              };
            }
            return wrap(() =>
              this.client.createApplicationPrivateKey({
                project_uuid: args.project_uuid!,
                server_uuid: args.server_uuid!,
                private_key_uuid: args.private_key_uuid!,
                destination_uuid: args.destination_uuid,
                git_repository: args.git_repository!,
                git_branch: args.git_branch!,
                build_pack: args.build_pack as BuildPack | undefined,
                ports_exposes: args.ports_exposes,
                environment_name: args.environment_name,
                environment_uuid: args.environment_uuid,
                name: args.name,
                description: args.description,
                fqdn: args.fqdn,
                domains: args.domains,
                base_directory: args.base_directory,
                publish_directory: args.publish_directory,
                install_command: args.install_command,
                build_command: args.build_command,
                start_command: args.start_command,
                dockerfile_location: args.dockerfile_location,
                watch_paths: args.watch_paths,
                health_check_enabled: args.health_check_enabled,
                health_check_path: args.health_check_path,
                health_check_port: args.health_check_port,
                health_check_host: args.health_check_host,
                health_check_method: args.health_check_method,
                health_check_return_code: args.health_check_return_code,
                health_check_scheme: args.health_check_scheme,
                health_check_response_text: args.health_check_response_text,
                health_check_interval: args.health_check_interval,
                health_check_timeout: args.health_check_timeout,
                health_check_retries: args.health_check_retries,
                health_check_start_period: args.health_check_start_period,
                custom_docker_run_options: args.custom_docker_run_options,
                custom_labels: args.custom_labels,
                instant_deploy: args.instant_deploy,
              }),
            );
          case 'create_dockerimage':
            if (
              !args.project_uuid ||
              !args.server_uuid ||
              !args.docker_registry_image_name ||
              !args.ports_exposes
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: project_uuid, server_uuid, docker_registry_image_name, ports_exposes required',
                  },
                ],
              };
            }
            return wrap(() =>
              this.client.createApplicationDockerImage({
                project_uuid: args.project_uuid!,
                server_uuid: args.server_uuid!,
                destination_uuid: args.destination_uuid,
                docker_registry_image_name: args.docker_registry_image_name!,
                ports_exposes: args.ports_exposes!,
                docker_registry_image_tag: args.docker_registry_image_tag,
                environment_name: args.environment_name,
                environment_uuid: args.environment_uuid,
                name: args.name,
                description: args.description,
                fqdn: args.fqdn,
                domains: args.domains,
                // Build-config fields (base_directory, install_command, etc.)
                // are intentionally NOT forwarded: /applications/dockerimage is
                // for pre-built registry images and has no build step.
                health_check_enabled: args.health_check_enabled,
                health_check_path: args.health_check_path,
                health_check_port: args.health_check_port,
                health_check_host: args.health_check_host,
                health_check_method: args.health_check_method,
                health_check_return_code: args.health_check_return_code,
                health_check_scheme: args.health_check_scheme,
                health_check_response_text: args.health_check_response_text,
                health_check_interval: args.health_check_interval,
                health_check_timeout: args.health_check_timeout,
                health_check_retries: args.health_check_retries,
                health_check_start_period: args.health_check_start_period,
                custom_docker_run_options: args.custom_docker_run_options,
                custom_labels: args.custom_labels,
                instant_deploy: args.instant_deploy,
              }),
            );
          case 'create_dockerfile':
            if (!args.project_uuid || !args.server_uuid || !args.dockerfile) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: project_uuid, server_uuid, dockerfile required',
                  },
                ],
              };
            }
            return wrap(() =>
              this.client.createApplicationDockerfile({
                project_uuid: args.project_uuid!,
                server_uuid: args.server_uuid!,
                destination_uuid: args.destination_uuid,
                dockerfile: args.dockerfile!,
                dockerfile_location: args.dockerfile_location,
                ports_exposes: args.ports_exposes,
                base_directory: args.base_directory,
                environment_name: args.environment_name,
                environment_uuid: args.environment_uuid,
                name: args.name,
                description: args.description,
                fqdn: args.fqdn,
                domains: args.domains,
                custom_docker_run_options: args.custom_docker_run_options,
                custom_labels: args.custom_labels,
                instant_deploy: args.instant_deploy,
              }),
            );
          case 'update': {
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { action: _, uuid: __, delete_volumes: ___, ...updateData } = args;
            return wrap(() => this.client.updateApplication(uuid, updateData));
          }
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return this.guardDestructive(
              extra.signal,
              async () => {
                const app = await this.client.getApplication(uuid);
                return deleteResourcePrompt('application', app.name || uuid, uuid, delete_volumes);
              },
              () => this.client.deleteApplication(uuid, { deleteVolumes: delete_volumes }),
            );
          case 'delete_preview':
            if (!uuid || !args.pull_request_id)
              return {
                content: [{ type: 'text' as const, text: 'Error: uuid, pull_request_id required' }],
              };
            return wrap(() => this.client.deleteApplicationPreview(uuid, args.pull_request_id!));
        }
      },
    );

    this.defineTool(
      'logs',
      "Get container logs for an application, database, or service. A service is a multi-container stack, so resource='service' requires `container` — the sub-service name, which you can list with the `service` tool's `list_containers` action. Use `lines` to bound the output and `show_timestamps` when you need to correlate events across resources (not supported on service containers).",
      {
        resource: z.enum(['application', 'database', 'service']),
        uuid: z.string(),
        container: z
          .string()
          .optional()
          .describe(
            "Sub-service name, required when resource='service'. Get valid names from `service` action=list_containers.",
          ),
        lines: z.number().optional().describe('Number of log lines to return (default 100)'),
        show_timestamps: z
          .boolean()
          .optional()
          .describe('Prefix each line with its timestamp. Not supported for service containers.'),
      },
      async ({ resource, uuid, container, lines, show_timestamps }) => {
        if (resource === 'service') {
          if (!container) {
            return {
              content: [
                {
                  type: 'text' as const,
                  text: "Error: container required when resource='service' — a service runs several containers, so 'the service logs' is ambiguous. List valid names with the `service` tool, action=list_containers.",
                },
              ],
            };
          }
          return wrap(() => this.client.getServiceLogs(uuid, container, lines, show_timestamps));
        }
        if (resource === 'database') {
          return wrap(() => this.client.getDatabaseLogs(uuid, lines, show_timestamps));
        }
        return wrap(() => this.client.getApplicationLogs(uuid, lines, show_timestamps));
      },
    );

    this.defineTool(
      'application_logs',
      'Get app logs. Superseded by `logs` (resource=application), which also covers databases and services — prefer that. Kept for compatibility and scheduled for removal in v3.',
      { uuid: z.string(), lines: z.number().optional() },
      async ({ uuid, lines }) => wrap(() => this.client.getApplicationLogs(uuid, lines)),
    );

    // =========================================================================
    // Databases (3 tools)
    // =========================================================================
    this.defineTool(
      'list_databases',
      'List databases (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listDatabases({ page, per_page, summary: true })),
    );

    this.defineTool('get_database', 'Database details', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getDatabase(uuid)),
    );

    this.defineTool(
      'database',
      'Manage database: create/delete',
      {
        action: z.enum(['create', 'delete']),
        type: z
          .enum([
            'postgresql',
            'mysql',
            'mariadb',
            'mongodb',
            'redis',
            'keydb',
            'clickhouse',
            'dragonfly',
          ])
          .optional(),
        uuid: z.string().optional(),
        server_uuid: z.string().optional(),
        project_uuid: z.string().optional(),
        environment_name: z.string().optional(),
        destination_uuid: z
          .string()
          .optional()
          .describe('Destination UUID. Required if server has multiple destinations.'),
        name: z.string().optional(),
        description: z.string().optional(),
        image: z.string().optional(),
        is_public: z.boolean().optional(),
        public_port: z.number().optional(),
        instant_deploy: z.boolean().optional(),
        delete_volumes: z.boolean().optional(),
        // DB-specific optional fields
        postgres_user: z.string().optional(),
        postgres_password: z.string().optional(),
        postgres_db: z.string().optional(),
        mysql_root_password: z.string().optional(),
        mysql_user: z.string().optional(),
        mysql_password: z.string().optional(),
        mysql_database: z.string().optional(),
        mariadb_root_password: z.string().optional(),
        mariadb_user: z.string().optional(),
        mariadb_password: z.string().optional(),
        mariadb_database: z.string().optional(),
        mongo_initdb_root_username: z.string().optional(),
        mongo_initdb_root_password: z.string().optional(),
        mongo_initdb_database: z.string().optional(),
        redis_password: z.string().optional(),
        keydb_password: z.string().optional(),
        clickhouse_admin_user: z.string().optional(),
        clickhouse_admin_password: z.string().optional(),
        dragonfly_password: z.string().optional(),
      },
      async (args, extra) => {
        const { action, type, uuid, delete_volumes, ...dbData } = args;
        if (action === 'delete') {
          if (!uuid) return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
          return this.guardDestructive(
            extra.signal,
            async () => {
              const db = await this.client.getDatabase(uuid);
              return deleteResourcePrompt('database', db.name || uuid, uuid, delete_volumes);
            },
            () => this.client.deleteDatabase(uuid, { deleteVolumes: delete_volumes }),
          );
        }
        // create
        if (!type || !args.server_uuid || !args.project_uuid) {
          return {
            content: [
              { type: 'text' as const, text: 'Error: type, server_uuid, project_uuid required' },
            ],
          };
        }
        const dbMethods: Record<string, (data: any) => Promise<any>> = {
          postgresql: (d) => this.client.createPostgresql(d),
          mysql: (d) => this.client.createMysql(d),
          mariadb: (d) => this.client.createMariadb(d),
          mongodb: (d) => this.client.createMongodb(d),
          redis: (d) => this.client.createRedis(d),
          keydb: (d) => this.client.createKeydb(d),
          clickhouse: (d) => this.client.createClickhouse(d),
          dragonfly: (d) => this.client.createDragonfly(d),
        };
        return wrap(() => dbMethods[type](dbData));
      },
    );

    // =========================================================================
    // Services (3 tools)
    // =========================================================================
    this.defineTool(
      'list_services',
      'List services (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrap(() => this.client.listServices({ page, per_page, summary: true })),
    );

    this.defineTool('get_service', 'Service details', { uuid: z.string() }, async ({ uuid }) =>
      wrap(() => this.client.getService(uuid)),
    );

    this.defineTool(
      'service',
      'Manage service: create/update/delete/list_containers. A service is a multi-container stack; `list_containers` returns the applications and databases inside it, whose names are what the `logs` tool needs as `container`.',
      {
        action: z.enum(['create', 'update', 'delete', 'list_containers']),
        uuid: z.string().optional(),
        type: z.string().optional(),
        server_uuid: z.string().optional(),
        project_uuid: z.string().optional(),
        environment_name: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        instant_deploy: z.boolean().optional(),
        docker_compose_raw: z
          .string()
          .optional()
          .describe('Raw docker-compose YAML for custom services (auto base64-encoded)'),
        delete_volumes: z.boolean().optional(),
      },
      async (args, extra) => {
        const { action, uuid, delete_volumes } = args;
        switch (action) {
          case 'list_containers': {
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(async () => {
              const [applications, databases] = await Promise.all([
                this.client.listServiceApplications(uuid),
                this.client.listServiceDatabases(uuid),
              ]);
              return { applications, databases };
            });
          }
          case 'create':
            if (!args.server_uuid || !args.project_uuid) {
              return {
                content: [
                  { type: 'text' as const, text: 'Error: server_uuid, project_uuid required' },
                ],
              };
            }
            return wrap(() =>
              this.client.createService({
                project_uuid: args.project_uuid!,
                server_uuid: args.server_uuid!,
                type: args.type,
                name: args.name,
                description: args.description,
                environment_name: args.environment_name,
                instant_deploy: args.instant_deploy,
                docker_compose_raw: args.docker_compose_raw,
              }),
            );
          case 'update': {
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const { action: _, uuid: __, delete_volumes: ___, ...updateData } = args;
            return wrap(() => this.client.updateService(uuid, updateData));
          }
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return this.guardDestructive(
              extra.signal,
              async () => {
                const svc = await this.client.getService(uuid);
                return deleteResourcePrompt('service', svc.name || uuid, uuid, delete_volumes);
              },
              () => this.client.deleteService(uuid, { deleteVolumes: delete_volumes }),
            );
        }
      },
    );

    // =========================================================================
    // Resource Control (1 tool - start/stop/restart for all types)
    // =========================================================================
    this.defineTool(
      'control',
      'Start/stop/restart app, database, or service',
      {
        resource: z.enum(['application', 'database', 'service']),
        action: z.enum(['start', 'stop', 'restart']),
        uuid: z.string(),
        pull_latest: z
          .boolean()
          .optional()
          .describe('Pull latest images before restarting (services only)'),
      },
      async ({ resource, action, uuid, pull_latest }) => {
        const methods: Record<string, Record<string, (u: string) => Promise<unknown>>> = {
          application: {
            start: (u) => this.client.startApplication(u),
            stop: (u) => this.client.stopApplication(u),
            restart: (u) => this.client.restartApplication(u),
          },
          database: {
            start: (u) => this.client.startDatabase(u),
            stop: (u) => this.client.stopDatabase(u),
            restart: (u) => this.client.restartDatabase(u),
          },
          service: {
            start: (u) => this.client.startService(u),
            stop: (u) => this.client.stopService(u),
            restart: (u) => this.client.restartService(u, pull_latest),
          },
        };

        // Generate contextual actions based on resource type and action taken
        const getControlActions = (): ResponseAction[] => {
          const actions: ResponseAction[] = [];
          if (resource === 'application') {
            actions.push({
              tool: 'logs',
              args: { resource: 'application', uuid },
              hint: 'View logs',
            });
            actions.push({ tool: 'get_application', args: { uuid }, hint: 'Check status' });
            if (action === 'start' || action === 'restart') {
              actions.push({
                tool: 'control',
                args: { resource: 'application', action: 'stop', uuid },
                hint: 'Stop',
              });
            } else {
              actions.push({
                tool: 'control',
                args: { resource: 'application', action: 'start', uuid },
                hint: 'Start',
              });
            }
          } else if (resource === 'database') {
            actions.push({ tool: 'get_database', args: { uuid }, hint: 'Check status' });
          } else if (resource === 'service') {
            actions.push({ tool: 'get_service', args: { uuid }, hint: 'Check status' });
          }
          return actions;
        };

        return wrapWithActions(() => methods[resource][action](uuid), getControlActions);
      },
    );

    // =========================================================================
    // Environment Variables (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'env_vars',
      "Manage env vars for app, service, or database. Values are masked by default (returned as '***') to avoid leaking secrets to MCP clients; pass reveal=true on the list action when the caller explicitly needs the plaintext (e.g. 'what is FOO set to?'). On list, pass key to return only that variable — always combine reveal with key so only the requested value (not every secret on the resource) is exposed. Set is_buildtime=false (and/or is_runtime=true) for runtime-only vars to avoid Dockerfile ARG issues with multiline values like PEM keys. Preview vs production: is_preview marks a variable as applying to preview (pull-request) deployments rather than production. These are SEPARATE scopes — the same key can legitimately exist in both with different values, and that is normal configuration, not a mistake to reconcile. Check is_preview on each entry before concluding a variable is set wrong, and pass is_preview on create/update to target the preview scope (omit it to target production).",
      {
        resource: z.enum(['application', 'service', 'database']),
        action: z.enum(['list', 'create', 'update', 'delete', 'bulk_update']),
        uuid: z.string(),
        key: z.string().optional(),
        value: z.string().optional(),
        env_uuid: z.string().optional(),
        is_buildtime: z.boolean().optional(),
        is_runtime: z.boolean().optional(),
        is_preview: z.boolean().optional(),
        reveal: z.boolean().optional(),
        data: z
          .array(
            z.object({
              key: z.string(),
              value: z.string(),
              is_preview: z.boolean().optional(),
              is_buildtime: z.boolean().optional(),
              is_runtime: z.boolean().optional(),
              is_literal: z.boolean().optional(),
              is_multiline: z.boolean().optional(),
              is_shown_once: z.boolean().optional(),
            }),
          )
          .optional(),
      },
      async ({
        resource,
        action,
        uuid,
        key,
        value,
        env_uuid,
        is_buildtime,
        is_runtime,
        is_preview,
        reveal,
        data,
      }) => {
        // On `list`, an optional `key` narrows the response to that single
        // variable. This matters most with reveal=true: without it, asking
        // for one value dumps every secret on the resource to the MCP client.
        const filterByKey = <T extends { key: string }>(vars: T[]): T[] =>
          key ? vars.filter((v) => v.key === key) : vars;

        if (resource === 'application') {
          switch (action) {
            case 'list':
              return wrap(async () =>
                filterByKey(
                  await this.client.listApplicationEnvVars(uuid, { summary: true, reveal }),
                ),
              );
            case 'create':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() =>
                this.client.createApplicationEnvVar(uuid, {
                  key,
                  value,
                  is_buildtime,
                  is_runtime,
                  is_preview,
                }),
              );
            case 'update':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() =>
                this.client.updateApplicationEnvVar(uuid, {
                  key,
                  value,
                  is_buildtime,
                  is_runtime,
                  is_preview,
                }),
              );
            case 'delete':
              if (!env_uuid)
                return { content: [{ type: 'text' as const, text: 'Error: env_uuid required' }] };
              return wrap(() => this.client.deleteApplicationEnvVar(uuid, env_uuid));
            case 'bulk_update':
              if (!data)
                return { content: [{ type: 'text' as const, text: 'Error: data array required' }] };
              return wrap(() => this.client.bulkUpdateApplicationEnvVars(uuid, { data }));
          }
        } else if (resource === 'service') {
          switch (action) {
            case 'list':
              return wrap(async () =>
                filterByKey(await this.client.listServiceEnvVars(uuid, { reveal })),
              );
            case 'create':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() =>
                this.client.createServiceEnvVar(uuid, {
                  key,
                  value,
                  is_buildtime,
                  is_runtime,
                  is_preview,
                }),
              );
            case 'update':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() =>
                this.client.updateServiceEnvVar(uuid, {
                  key,
                  value,
                  is_buildtime,
                  is_runtime,
                  is_preview,
                }),
              );
            case 'delete':
              if (!env_uuid)
                return { content: [{ type: 'text' as const, text: 'Error: env_uuid required' }] };
              return wrap(() => this.client.deleteServiceEnvVar(uuid, env_uuid));
            case 'bulk_update':
              if (!data)
                return { content: [{ type: 'text' as const, text: 'Error: data array required' }] };
              return wrap(() => this.client.bulkUpdateServiceEnvVars(uuid, { data }));
          }
        } else {
          switch (action) {
            case 'list':
              return wrap(async () =>
                filterByKey(await this.client.listDatabaseEnvVars(uuid, { reveal })),
              );
            case 'create':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() =>
                this.client.createDatabaseEnvVar(uuid, {
                  key,
                  value,
                  is_buildtime,
                  is_runtime,
                  is_preview,
                }),
              );
            case 'update':
              if (!key || !value)
                return { content: [{ type: 'text' as const, text: 'Error: key, value required' }] };
              return wrap(() =>
                this.client.updateDatabaseEnvVar(uuid, {
                  key,
                  value,
                  is_buildtime,
                  is_runtime,
                  is_preview,
                }),
              );
            case 'delete':
              if (!env_uuid)
                return { content: [{ type: 'text' as const, text: 'Error: env_uuid required' }] };
              return wrap(() => this.client.deleteDatabaseEnvVar(uuid, env_uuid));
            case 'bulk_update':
              if (!data)
                return { content: [{ type: 'text' as const, text: 'Error: data array required' }] };
              return wrap(() => this.client.bulkUpdateDatabaseEnvVars(uuid, { data }));
          }
        }
      },
    );

    // =========================================================================
    // Deployments (3 tools)
    // =========================================================================
    this.defineTool(
      'list_deployments',
      'List deployments (summary)',
      { page: z.number().optional(), per_page: z.number().optional() },
      async ({ page, per_page }) =>
        wrapWithActions(
          () => this.client.listDeployments({ page, per_page, summary: true }),
          undefined,
          (result) =>
            getPagination('list_deployments', page, per_page, (result as unknown[]).length),
        ),
    );

    this.defineTool(
      'deploy',
      'Deploy by tag/UUID',
      {
        tag_or_uuid: z.string(),
        force: z.boolean().optional(),
        wait: z
          .boolean()
          .optional()
          .describe(
            'Wait for the deployment to reach a terminal status (finished/failed/cancelled) instead of returning immediately, polling every ~5s. If tag_or_uuid matches multiple applications (a tag can trigger several deployments), only the first is watched — the rest are returned under additional_deployment_uuids for you to check separately via `deployment get`. On failure the response includes a bounded log tail. Default false (fire-and-forget, unchanged response).',
          ),
        timeout_seconds: z
          .number()
          .optional()
          .describe(
            'Max seconds to poll when wait is true before giving up and returning the current status plus a next-action hint (default 300). Ignored when wait is false.',
          ),
      },
      async ({ tag_or_uuid, force, wait, timeout_seconds }) => {
        if (!wait) {
          return wrapWithActions(
            () => this.client.deployByTagOrUuid(tag_or_uuid, force),
            () => [{ tool: 'list_deployments', args: {}, hint: 'Check deployment status' }],
          );
        }
        return wrapWithActions(
          () =>
            this.triggerAndWaitForDeploy(
              tag_or_uuid,
              force,
              timeout_seconds ?? DEFAULT_DEPLOY_TIMEOUT_SECONDS,
            ),
          (result) =>
            'deployment_uuid' in result
              ? getDeploymentActions(result.deployment_uuid, result.status, result.application_uuid)
              : [],
        );
      },
    );

    this.defineTool(
      'deployment',
      'Manage deployment: get/cancel/list_for_app. Logs excluded by default on all actions — for get use `lines` (paginated tail), for list_for_app use `include_logs: true` to include raw build-log blobs.',
      {
        action: z.enum(['get', 'cancel', 'list_for_app']),
        uuid: z.string(),
        lines: z.number().optional(), // Include logs truncated to last N entries (omit for no logs)
        page: z.number().optional(), // Log page (1=most recent, 2=older, etc.)
        max_chars: z.number().optional(), // Limit log output to last N chars (default: 50000)
        include_logs: z.boolean().optional(), // list_for_app only: include raw build logs (default false; upstream returns ~30KB per deployment)
      },
      async ({ action, uuid, lines, page, max_chars, include_logs }) => {
        switch (action) {
          case 'get':
            // If lines param specified, include logs and truncate
            if (lines !== undefined) {
              const p = page ?? 1;
              const ll = lines;
              return wrapWithActions(
                async () => {
                  const deployment = await this.client.getDeployment(uuid, {
                    includeLogs: true,
                  });
                  if (deployment.logs) {
                    const result = truncateLogs(deployment.logs, ll, max_chars ?? 50000, p);
                    deployment.logs = result.logs;
                    return {
                      ...deployment,
                      logs_meta: {
                        total_entries: result.total,
                        showing: `${result.showing_start}-${result.showing_end} of ${result.total}`,
                      },
                    };
                  }
                  return { ...deployment, logs_meta: undefined };
                },
                (dep) => getDeploymentActions(dep.uuid, dep.status, dep.application_uuid),
                (dep) => {
                  const total = dep.logs_meta?.total_entries ?? 0;
                  const hasOlder = p * ll < total;
                  const pagination: ResponsePagination = {};
                  if (hasOlder)
                    pagination.next = {
                      tool: 'deployment',
                      args: { action: 'get', uuid, lines: ll, page: p + 1 },
                    };
                  if (p > 1)
                    pagination.prev = {
                      tool: 'deployment',
                      args: { action: 'get', uuid, lines: ll, page: p - 1 },
                    };
                  return Object.keys(pagination).length > 0 ? pagination : undefined;
                },
              );
            }
            // Otherwise return essential info without logs
            return wrapWithActions(
              () => this.client.getDeployment(uuid),
              (dep) => getDeploymentActions(dep.uuid, dep.status, dep.application_uuid),
            );
          case 'cancel':
            return wrap(() => this.client.cancelDeployment(uuid));
          case 'list_for_app':
            return wrap(() =>
              this.client.listApplicationDeployments(uuid, { includeLogs: include_logs }),
            );
        }
      },
    );

    // =========================================================================
    // Private Keys (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'private_keys',
      'Manage SSH keys: list/get/create/update/delete',
      {
        action: z.enum(['list', 'get', 'create', 'update', 'delete']),
        uuid: z.string().optional(),
        name: z.string().optional(),
        description: z.string().optional(),
        private_key: z.string().optional(),
      },
      async ({ action, uuid, name, description, private_key }) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listPrivateKeys());
          case 'get':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.getPrivateKey(uuid));
          case 'create':
            if (!private_key)
              return { content: [{ type: 'text' as const, text: 'Error: private_key required' }] };
            return wrap(() =>
              this.client.createPrivateKey({
                private_key,
                name: name || 'unnamed-key',
                description,
              }),
            );
          case 'update':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() =>
              this.client.updatePrivateKey(uuid, { name, description, private_key }),
            );
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.deletePrivateKey(uuid));
        }
      },
    );

    // =========================================================================
    // GitHub Apps (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'github_apps',
      'Manage GitHub Apps: list/get/create/update/delete/list_repos/list_branches',
      {
        action: z.enum([
          'list',
          'get',
          'create',
          'update',
          'delete',
          'list_repos',
          'list_branches',
        ]),
        // GitHub apps use integer id, not uuid
        id: z.number().optional(),
        // Repo/branch browsing
        owner: z.string().optional(),
        repo: z.string().optional(),
        // Create/Update fields
        name: z.string().optional(),
        organization: z.string().optional(),
        api_url: z.string().optional(),
        html_url: z.string().optional(),
        custom_user: z.string().optional(),
        custom_port: z.number().optional(),
        app_id: z.number().optional(),
        installation_id: z.number().optional(),
        client_id: z.string().optional(),
        client_secret: z.string().optional(),
        webhook_secret: z.string().optional(),
        private_key_uuid: z.string().optional(),
        is_system_wide: z.boolean().optional(),
      },
      async (args) => {
        const { action, id, ...apiData } = args;
        switch (action) {
          case 'list':
            return wrap(async () => {
              const apps = (await this.client.listGitHubApps({
                summary: true,
              })) as GitHubAppSummary[];
              return apps;
            });
          case 'get':
            if (!id) return { content: [{ type: 'text' as const, text: 'Error: id required' }] };
            return wrap(async () => {
              const apps = (await this.client.listGitHubApps()) as GitHubApp[];
              const app = apps.find((a) => a.id === id);
              if (!app) throw new Error(`GitHub App with id ${id} not found`);
              return app;
            });
          case 'create':
            if (
              !apiData.name ||
              !apiData.api_url ||
              !apiData.html_url ||
              !apiData.app_id ||
              !apiData.installation_id ||
              !apiData.client_id ||
              !apiData.client_secret ||
              !apiData.private_key_uuid
            ) {
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: name, api_url, html_url, app_id, installation_id, client_id, client_secret, private_key_uuid required',
                  },
                ],
              };
            }
            return wrap(() =>
              this.client.createGitHubApp({
                name: apiData.name!,
                api_url: apiData.api_url!,
                html_url: apiData.html_url!,
                app_id: apiData.app_id!,
                installation_id: apiData.installation_id!,
                client_id: apiData.client_id!,
                client_secret: apiData.client_secret!,
                private_key_uuid: apiData.private_key_uuid!,
                organization: apiData.organization,
                custom_user: apiData.custom_user,
                custom_port: apiData.custom_port,
                webhook_secret: apiData.webhook_secret,
                is_system_wide: apiData.is_system_wide,
              }),
            );
          case 'update':
            if (!id) return { content: [{ type: 'text' as const, text: 'Error: id required' }] };
            return wrap(() => this.client.updateGitHubApp(id, apiData));
          case 'delete':
            if (!id) return { content: [{ type: 'text' as const, text: 'Error: id required' }] };
            return wrap(() => this.client.deleteGitHubApp(id));
          case 'list_repos':
            if (!id) return { content: [{ type: 'text' as const, text: 'Error: id required' }] };
            return wrap(() => this.client.listGitHubAppRepositories(id));
          case 'list_branches':
            if (!id || !args.owner || !args.repo)
              return {
                content: [{ type: 'text' as const, text: 'Error: id, owner, repo required' }],
              };
            return wrap(() => this.client.listGitHubAppBranches(id, args.owner!, args.repo!));
        }
      },
    );

    // =========================================================================
    // Database Backups (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'database_backups',
      'Manage backups: list_schedules/get_schedule/list_executions/get_execution/create/update/delete/delete_execution',
      {
        action: z.enum([
          'list_schedules',
          'get_schedule',
          'list_executions',
          'get_execution',
          'create',
          'update',
          'delete',
          'delete_execution',
        ]),
        database_uuid: z.string(),
        backup_uuid: z.string().optional(),
        execution_uuid: z.string().optional(),
        // Backup configuration parameters
        frequency: z.string().optional(),
        enabled: z.boolean().optional(),
        save_s3: z.boolean().optional(),
        s3_storage_uuid: z.string().optional(),
        databases_to_backup: z.string().optional(),
        dump_all: z.boolean().optional(),
        database_backup_retention_days_locally: z.number().optional(),
        database_backup_retention_days_s3: z.number().optional(),
        database_backup_retention_amount_locally: z.number().optional(),
        database_backup_retention_amount_s3: z.number().optional(),
      },
      async (args) => {
        const { action, database_uuid, backup_uuid, execution_uuid, ...backupData } = args;
        switch (action) {
          case 'list_schedules':
            return wrap(() => this.client.listDatabaseBackups(database_uuid));
          case 'get_schedule':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() => this.client.getDatabaseBackup(database_uuid, backup_uuid));
          case 'list_executions':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() => this.client.listBackupExecutions(database_uuid, backup_uuid));
          case 'get_execution':
            if (!backup_uuid || !execution_uuid)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: backup_uuid, execution_uuid required' },
                ],
              };
            return wrap(() =>
              this.client.getBackupExecution(database_uuid, backup_uuid, execution_uuid),
            );
          case 'create':
            if (!args.frequency)
              return { content: [{ type: 'text' as const, text: 'Error: frequency required' }] };
            return wrap(() =>
              this.client.createDatabaseBackup(database_uuid, {
                ...backupData,
                frequency: args.frequency!,
              }),
            );
          case 'update':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() =>
              this.client.updateDatabaseBackup(database_uuid, backup_uuid, backupData),
            );
          case 'delete':
            if (!backup_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: backup_uuid required' }] };
            return wrap(() => this.client.deleteDatabaseBackup(database_uuid, backup_uuid));
          case 'delete_execution':
            if (!backup_uuid || !execution_uuid)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: backup_uuid, execution_uuid required' },
                ],
              };
            return wrap(() =>
              this.client.deleteBackupExecution(database_uuid, backup_uuid, execution_uuid),
            );
        }
      },
    );

    // =========================================================================
    // Teams (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'teams',
      'Manage teams: list/get/get_members/get_current/get_current_members',
      {
        action: z.enum(['list', 'get', 'get_members', 'get_current', 'get_current_members']),
        id: z.number().optional(),
      },
      async ({ action, id }) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listTeams());
          case 'get':
            if (!id) return { content: [{ type: 'text' as const, text: 'Error: id required' }] };
            return wrap(() => this.client.getTeam(id));
          case 'get_members':
            if (!id) return { content: [{ type: 'text' as const, text: 'Error: id required' }] };
            return wrap(() => this.client.getTeamMembers(id));
          case 'get_current':
            return wrap(() => this.client.getCurrentTeam());
          case 'get_current_members':
            return wrap(() => this.client.getCurrentTeamMembers());
        }
      },
    );

    // =========================================================================
    // Cloud Tokens (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'cloud_tokens',
      'Manage cloud provider tokens (Hetzner/DigitalOcean): list/get/create/update/delete/validate',
      {
        action: z.enum(['list', 'get', 'create', 'update', 'delete', 'validate']),
        uuid: z.string().optional(),
        provider: z.enum(['hetzner', 'digitalocean']).optional(),
        token: z.string().optional(),
        name: z.string().optional(),
      },
      async ({ action, uuid, provider, token, name }) => {
        switch (action) {
          case 'list':
            return wrap(() => this.client.listCloudTokens());
          case 'get':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.getCloudToken(uuid));
          case 'create':
            if (!provider || !token || !name)
              return {
                content: [{ type: 'text' as const, text: 'Error: provider, token, name required' }],
              };
            return wrap(() => this.client.createCloudToken({ provider, token, name }));
          case 'update':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.updateCloudToken(uuid, { name }));
          case 'delete':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.deleteCloudToken(uuid));
          case 'validate':
            if (!uuid)
              return { content: [{ type: 'text' as const, text: 'Error: uuid required' }] };
            return wrap(() => this.client.validateCloudToken(uuid));
        }
      },
    );

    // =========================================================================
    // Storages (1 tool - consolidated for app/db/service)
    // =========================================================================
    this.defineTool(
      'storages',
      'Manage persistent/file storages for app, database, or service: list/create/update/delete',
      {
        resource: z.enum(['application', 'database', 'service']),
        action: z.enum(['list', 'create', 'update', 'delete']),
        uuid: z.string(),
        storage_uuid: z.string().optional(),
        type: z.enum(['persistent', 'file']).optional(),
        mount_path: z.string().optional(),
        name: z.string().optional(),
        host_path: z.string().optional(),
        content: z.string().optional(),
        is_directory: z.boolean().optional(),
        fs_path: z.string().optional(),
        is_preview_suffix_enabled: z.boolean().optional(),
      },
      async (args) => {
        const { resource, action, uuid, storage_uuid } = args;
        if (action === 'create' && (!args.type || !args.mount_path))
          return { content: [{ type: 'text' as const, text: 'Error: type, mount_path required' }] };
        if (action === 'update' && (!args.type || !storage_uuid))
          return {
            content: [{ type: 'text' as const, text: 'Error: type, storage_uuid required' }],
          };
        if (action === 'delete' && !storage_uuid)
          return { content: [{ type: 'text' as const, text: 'Error: storage_uuid required' }] };
        const methods: Record<string, Record<string, () => Promise<unknown>>> = {
          application: {
            list: () => this.client.listApplicationStorages(uuid),
            create: () =>
              this.client.createApplicationStorage(uuid, {
                type: args.type!,
                mount_path: args.mount_path!,
                name: args.name,
                host_path: args.host_path,
                content: args.content,
                is_directory: args.is_directory,
                fs_path: args.fs_path,
                is_preview_suffix_enabled: args.is_preview_suffix_enabled,
              }),
            update: () =>
              this.client.updateApplicationStorage(uuid, {
                uuid: storage_uuid!,
                type: args.type!,
                mount_path: args.mount_path,
                name: args.name,
                host_path: args.host_path,
                content: args.content,
                is_directory: args.is_directory,
                is_preview_suffix_enabled: args.is_preview_suffix_enabled,
              }),
            delete: () => this.client.deleteApplicationStorage(uuid, storage_uuid!),
          },
          database: {
            list: () => this.client.listDatabaseStorages(uuid),
            create: () =>
              this.client.createDatabaseStorage(uuid, {
                type: args.type!,
                mount_path: args.mount_path!,
                name: args.name,
                host_path: args.host_path,
                content: args.content,
                is_directory: args.is_directory,
                fs_path: args.fs_path,
                is_preview_suffix_enabled: args.is_preview_suffix_enabled,
              }),
            update: () =>
              this.client.updateDatabaseStorage(uuid, {
                uuid: storage_uuid!,
                type: args.type!,
                mount_path: args.mount_path,
                name: args.name,
                host_path: args.host_path,
                content: args.content,
                is_directory: args.is_directory,
                is_preview_suffix_enabled: args.is_preview_suffix_enabled,
              }),
            delete: () => this.client.deleteDatabaseStorage(uuid, storage_uuid!),
          },
          service: {
            list: () => this.client.listServiceStorages(uuid),
            create: () =>
              this.client.createServiceStorage(uuid, {
                type: args.type!,
                mount_path: args.mount_path!,
                name: args.name,
                host_path: args.host_path,
                content: args.content,
                is_directory: args.is_directory,
                fs_path: args.fs_path,
                is_preview_suffix_enabled: args.is_preview_suffix_enabled,
              }),
            update: () =>
              this.client.updateServiceStorage(uuid, {
                uuid: storage_uuid!,
                type: args.type!,
                mount_path: args.mount_path,
                name: args.name,
                host_path: args.host_path,
                content: args.content,
                is_directory: args.is_directory,
                is_preview_suffix_enabled: args.is_preview_suffix_enabled,
              }),
            delete: () => this.client.deleteServiceStorage(uuid, storage_uuid!),
          },
        };
        return wrap(() => methods[resource][action]());
      },
    );

    // =========================================================================
    // Scheduled Tasks (1 tool - consolidated for app/service)
    // =========================================================================
    this.defineTool(
      'scheduled_tasks',
      'Manage scheduled tasks for app or service: list/create/update/delete/list_executions/run_once. ' +
        "list_executions: the command's stdout comes back in the execution's message field. " +
        'run_once: composite that creates a throwaway "* * * * *" task, polls list_executions every ~5s ' +
        'for the first terminal execution (or until wait_seconds elapses, default 90), deletes the task, ' +
        'and returns status+message. WARNING: the underlying cron may fire more than once before cleanup ' +
        'completes — make the command idempotent (e.g. `where not exists`) or tolerate re-execution. ' +
        'Coolify stores `command` in a varchar(255) column and rejects longer commands with a bodyless ' +
        'HTTP 500 — keep commands to 255 chars or fewer (#234).',
      {
        resource: z.enum(['application', 'service']),
        action: z.enum(['list', 'create', 'update', 'delete', 'list_executions', 'run_once']),
        uuid: z.string(),
        task_uuid: z.string().optional(),
        name: z.string().optional(),
        command: z
          .string()
          .max(
            255,
            'Coolify rejects scheduled-task commands longer than 255 chars — split the command or bake a script into the container image',
          )
          .optional(),
        frequency: z.string().optional(),
        container: z.string().optional(),
        timeout: z.number().optional(),
        enabled: z.boolean().optional(),
        wait_seconds: z
          .number()
          .optional()
          .describe('run_once only: poll budget in seconds before giving up (default 90)'),
      },
      async (args) => {
        const { resource, action, uuid, task_uuid } = args;
        const isApp = resource === 'application';
        switch (action) {
          case 'list':
            return wrap(() =>
              isApp
                ? this.client.listApplicationScheduledTasks(uuid)
                : this.client.listServiceScheduledTasks(uuid),
            );
          case 'create':
            if (!args.name || !args.command || !args.frequency)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: name, command, frequency required' },
                ],
              };
            return wrap(() => {
              const data = {
                name: args.name!,
                command: args.command!,
                frequency: args.frequency!,
                container: args.container,
                timeout: args.timeout,
                enabled: args.enabled,
              };
              return isApp
                ? this.client.createApplicationScheduledTask(uuid, data)
                : this.client.createServiceScheduledTask(uuid, data);
            });
          case 'update':
            if (!task_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: task_uuid required' }] };
            return wrap(() => {
              const data = {
                name: args.name,
                command: args.command,
                frequency: args.frequency,
                container: args.container,
                timeout: args.timeout,
                enabled: args.enabled,
              };
              return isApp
                ? this.client.updateApplicationScheduledTask(uuid, task_uuid, data)
                : this.client.updateServiceScheduledTask(uuid, task_uuid, data);
            });
          case 'delete':
            if (!task_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: task_uuid required' }] };
            return wrap(() =>
              isApp
                ? this.client.deleteApplicationScheduledTask(uuid, task_uuid)
                : this.client.deleteServiceScheduledTask(uuid, task_uuid),
            );
          case 'list_executions':
            if (!task_uuid)
              return { content: [{ type: 'text' as const, text: 'Error: task_uuid required' }] };
            return wrap(() =>
              isApp
                ? this.client.listApplicationScheduledTaskExecutions(uuid, task_uuid)
                : this.client.listServiceScheduledTaskExecutions(uuid, task_uuid),
            );
          case 'run_once':
            if (!args.command || !args.container)
              return {
                content: [{ type: 'text' as const, text: 'Error: command, container required' }],
              };
            return this.runOnceScheduledTask(
              resource,
              uuid,
              args.command,
              args.container,
              args.timeout,
              args.wait_seconds,
            );
        }
      },
    );

    // =========================================================================
    // Hetzner Cloud (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'hetzner',
      'Hetzner cloud: list_locations/list_server_types/list_images/list_ssh_keys/create_server',
      {
        action: z.enum([
          'list_locations',
          'list_server_types',
          'list_images',
          'list_ssh_keys',
          'create_server',
        ]),
        cloud_provider_token_uuid: z.string().optional(),
        location: z.string().optional(),
        server_type: z.string().optional(),
        image: z.number().optional(),
        name: z.string().optional(),
        private_key_uuid: z.string().optional(),
        enable_ipv4: z.boolean().optional(),
        enable_ipv6: z.boolean().optional(),
        hetzner_ssh_key_ids: z.array(z.number()).optional(),
        cloud_init_script: z.string().optional(),
        instant_validate: z.boolean().optional(),
      },
      async (args) => {
        const { action, cloud_provider_token_uuid: tokenUuid } = args;
        switch (action) {
          case 'list_locations':
            if (!tokenUuid)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: cloud_provider_token_uuid required' },
                ],
              };
            return wrap(() => this.client.listHetznerLocations(tokenUuid));
          case 'list_server_types':
            if (!tokenUuid)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: cloud_provider_token_uuid required' },
                ],
              };
            return wrap(() => this.client.listHetznerServerTypes(tokenUuid));
          case 'list_images':
            if (!tokenUuid)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: cloud_provider_token_uuid required' },
                ],
              };
            return wrap(() => this.client.listHetznerImages(tokenUuid));
          case 'list_ssh_keys':
            if (!tokenUuid)
              return {
                content: [
                  { type: 'text' as const, text: 'Error: cloud_provider_token_uuid required' },
                ],
              };
            return wrap(() => this.client.listHetznerSSHKeys(tokenUuid));
          case 'create_server':
            if (!args.location || !args.server_type || !args.image || !args.private_key_uuid)
              return {
                content: [
                  {
                    type: 'text' as const,
                    text: 'Error: location, server_type, image, private_key_uuid required',
                  },
                ],
              };
            return wrap(() =>
              this.client.createHetznerServer({
                cloud_provider_token_uuid: tokenUuid,
                location: args.location!,
                server_type: args.server_type!,
                image: args.image!,
                name: args.name,
                private_key_uuid: args.private_key_uuid!,
                enable_ipv4: args.enable_ipv4,
                enable_ipv6: args.enable_ipv6,
                hetzner_ssh_key_ids: args.hetzner_ssh_key_ids,
                cloud_init_script: args.cloud_init_script,
                instant_validate: args.instant_validate,
              }),
            );
        }
      },
    );

    // =========================================================================
    // System (1 tool - health/list_resources/api_control consolidated)
    // =========================================================================
    this.defineTool(
      'system',
      'System operations: health/list_resources/enable_api/disable_api. `list_resources` defaults to an essential projection (uuid/name/type/status) to keep token budgets sane on instances with many resources; pass `include_full: true` for the raw Coolify payload. When `include_full: true`, credentials are masked unless `reveal: true` is also set (matches the `env_vars` `reveal` ergonomics): webhook HMAC secrets, basic-auth password, database passwords, internal/external_db_url connection strings, compose bodies, custom_labels, and nested env-var values.',
      {
        action: z.enum(['health', 'list_resources', 'enable_api', 'disable_api']),
        include_full: z.boolean().optional(),
        reveal: z.boolean().optional(),
      },
      async ({ action, include_full, reveal }, extra) => {
        switch (action) {
          case 'health':
            return wrap(() => this.client.getHealth());
          case 'list_resources':
            return wrap(() => this.client.listResources({ include_full, reveal }));
          case 'enable_api':
            return wrap(() => this.client.enableApi());
          case 'disable_api':
            // The most self-locking operation in the server: it turns off the
            // API that every other tool depends on, including the one that
            // turns it back on. Recovery is a trip to the Coolify UI, so this
            // is precisely a decision a human should be making.
            return this.guardDestructive(
              extra.signal,
              () =>
                `Disable the Coolify API?\n\n` +
                `Every tool in this MCP server stops working immediately, including ` +
                `\`enable_api\`. Re-enabling it means logging into the Coolify UI by hand.`,
              () => this.client.disableApi(),
            );
        }
      },
    );

    // =========================================================================
    // Tags (1 tool - consolidated)
    // =========================================================================
    this.defineTool(
      'tags',
      "Manage tags on applications, databases and services. Tags group resources across projects, and `deploy` accepts a tag name — so tag several resources, then deploy them together with one `deploy` call. action=list with no resource/uuid returns every tag on the CURRENT TEAM (tokens are team-scoped, so a tag on another team will not appear); with resource+uuid it returns that resource's tags. attach is ADDITIVE — it adds the named tags and leaves existing ones in place, creating any that do not exist yet — and returns the resource's full tag set afterwards. detach unlinks one tag, and Coolify deletes the tag itself once no resources carry it, so misspelled names do not accumulate. Requires Coolify v4.2+.",
      {
        action: z.enum(['list', 'attach', 'detach']),
        resource: z.enum(['application', 'database', 'service']).optional(),
        uuid: z
          .string()
          .optional()
          .describe('Resource uuid. Omit with action=list to list every tag on the instance.'),
        tag_names: z
          .array(z.string().min(2))
          .optional()
          .describe('Tag names to attach (each min 2 characters). Required for attach.'),
        tag_uuid: z
          .string()
          .optional()
          .describe('Tag uuid to detach. Get it from action=list on the resource.'),
      },
      async ({ action, resource, uuid, tag_names, tag_uuid }) => {
        const err = (text: string) => ({
          content: [{ type: 'text' as const, text: `Error: ${text}` }],
        });

        if (action === 'list' && !resource && !uuid) {
          return wrap(() => this.client.listTags());
        }
        if (!resource || !uuid) {
          return err(
            "resource and uuid are required, except for action=list with neither (which lists the current team's tags)",
          );
        }

        switch (action) {
          case 'list':
            return wrap(() =>
              resource === 'application'
                ? this.client.listApplicationTags(uuid)
                : resource === 'database'
                  ? this.client.listDatabaseTags(uuid)
                  : this.client.listServiceTags(uuid),
            );
          case 'attach': {
            if (!tag_names?.length) return err('tag_names required for attach');
            const data = { tag_names };
            return wrap(() =>
              resource === 'application'
                ? this.client.attachApplicationTags(uuid, data)
                : resource === 'database'
                  ? this.client.attachDatabaseTags(uuid, data)
                  : this.client.attachServiceTags(uuid, data),
            );
          }
          case 'detach':
            if (!tag_uuid) return err('tag_uuid required for detach');
            return wrap(() =>
              resource === 'application'
                ? this.client.detachApplicationTag(uuid, tag_uuid)
                : resource === 'database'
                  ? this.client.detachDatabaseTag(uuid, tag_uuid)
                  : this.client.detachServiceTag(uuid, tag_uuid),
            );
        }
      },
    );

    // =========================================================================
    // Documentation Search (1 tool)
    // =========================================================================
    this.defineTool(
      'search_docs',
      'Search Coolify documentation for how-to guides, configuration, troubleshooting',
      {
        query: z.string().describe('Search query'),
        limit: z.number().optional().describe('Max results (default 5)'),
      },
      async ({ query, limit }) =>
        wrap(async () => {
          const results = await this.docsSearch.search(query, limit ?? 5);
          if (results.length === 0) {
            return { results: [], hint: 'No matches. Try broader or different keywords.' };
          }
          return { results };
        }),
    );

    // =========================================================================
    // Batch Operations (4 tools)
    // =========================================================================
    this.defineTool(
      'restart_project_apps',
      'Restart all apps in project',
      { project_uuid: z.string() },
      async ({ project_uuid }, extra) => {
        let approved: Application[] | undefined;
        return this.guardDestructive(
          extra.signal,
          async () => {
            approved = await this.client.applicationsInProject(project_uuid);
            if (approved.length === 0) return null;
            return (
              `Restart ${describeBlastRadius(
                'application',
                approved.map((app) => app.name || app.uuid),
              )} in this project?\n\n` +
              `Each one drops its connections briefly while the container comes back.`
            );
          },
          () => this.client.restartProjectApps(project_uuid, approved),
        );
      },
    );

    this.defineTool(
      'bulk_env_update',
      'Update env var across multiple apps',
      {
        app_uuids: z.array(z.string()),
        key: z.string(),
        value: z.string(),
        is_buildtime: z.boolean().optional(),
        is_runtime: z.boolean().optional(),
      },
      async ({ app_uuids, key, value, is_buildtime, is_runtime }, extra) => {
        // Under the threshold this is an ordinary edit and prompting for it
        // would only train people to click through prompts. Over it, one call
        // rewrites the same key across the estate.
        if (app_uuids.length <= BULK_ENV_CONFIRM_THRESHOLD) {
          return wrap(() =>
            this.client.bulkEnvUpdate(app_uuids, key, value, is_buildtime, is_runtime),
          );
        }
        return this.guardDestructive(
          extra.signal,
          // No pre-flight needed: the caller already told us the blast radius.
          () =>
            `Set env var "${sanitizeForPrompt(key)}" on ${app_uuids.length} applications?\n\n` +
            `Existing values for "${sanitizeForPrompt(key)}" on those applications will be overwritten.`,
          () => this.client.bulkEnvUpdate(app_uuids, key, value, is_buildtime, is_runtime),
        );
      },
    );

    this.defineTool(
      'stop_all_apps',
      'EMERGENCY: Stop all running apps',
      { confirm: z.literal(true) },
      async ({ confirm }, extra) => {
        if (!confirm)
          return { content: [{ type: 'text' as const, text: 'Error: confirm=true required' }] };
        // `confirm` above is filled in by the model, which is why #261 exists.
        // On an elicitation-capable client the real gate is below, in front of
        // a human, and it names what is about to go down.
        //
        // `approved` is shared by both callbacks on purpose: the operation must
        // act on the exact set the human was shown, not on a freshly listed
        // one. An app that starts between the prompt and the accept never
        // appeared in the dialog, so the answer does not cover it. It stays
        // undefined when no prompt was shown, and `stopAllApps` resolves the
        // set itself.
        let approved: Application[] | undefined;
        return this.guardDestructive(
          extra.signal,
          async () => {
            const apps = (await this.client.listApplications()) as Application[];
            const running = apps.filter((app) => isRunningStatus(app.status));
            approved = running;
            if (running.length === 0) return null;
            // `destination.server_id`, not `server_uuid`: the list endpoint
            // does not populate the flat field, so keying off it made this
            // clause dead code that never once fired. Caught by running it
            // against a real instance, not by reading the type.
            // Not `.filter(Boolean)`: Coolify's built-in localhost server has
            // `server_id: 0`, which is falsy, so a truthiness filter drops the
            // single most common server on any estate and undercounts. Verified
            // live — every app on the test instance reports server_id 0.
            const servers = new Set(
              running
                .map((app) => app.destination?.server_id ?? app.server_uuid)
                .filter((id) => id !== undefined && id !== null),
            );
            const across = servers.size > 1 ? ` across ${servers.size} servers` : '';
            return (
              `EMERGENCY STOP: take down ${describeBlastRadius(
                'running application',
                running.map((app) => app.name || app.uuid),
              )}${across}?\n\n` +
              `Every one stays down until it is started again. This is estate-wide, not scoped to a project.`
            );
          },
          () => this.client.stopAllApps(approved),
        );
      },
    );

    this.defineTool(
      'redeploy_project',
      'Redeploy all apps in project',
      { project_uuid: z.string(), force: z.boolean().optional() },
      async ({ project_uuid, force }, extra) => {
        let approved: Application[] | undefined;
        return this.guardDestructive(
          extra.signal,
          async () => {
            approved = await this.client.applicationsInProject(project_uuid);
            if (approved.length === 0) return null;
            return (
              `Redeploy ${describeBlastRadius(
                'application',
                approved.map((app) => app.name || app.uuid),
              )} in this project?\n\n` +
              `Each one's running containers are replaced, so expect downtime per app while it rebuilds.`
            );
          },
          () => this.client.redeployProjectApps(project_uuid, force ?? true, approved),
        );
      },
    );
  }

  /**
   * Injectable delay for the run_once poll loop. A real setTimeout in production;
   * tests replace it with `jest.spyOn(server, 'sleep').mockResolvedValue(undefined)`
   * so polling logic runs without waiting on the wall clock.
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Composite one-off command execution (#233 / #208): there is no upstream
   * "run now" endpoint for scheduled tasks, so this creates a throwaway
   * `* * * * *` task, polls list_executions until the first execution reaches a
   * terminal status (or the poll budget runs out), and returns its status+message.
   *
   * The task is deleted in a finally-equivalent (try/finally-style) block so cleanup
   * always runs — on success, on timeout, and on a polling error. If cleanup itself
   * fails, the returned message says so loudly with the task UUID so a human can
   * remove it manually (it would otherwise keep firing every minute).
   */
  private async runOnceScheduledTask(
    resource: 'application' | 'service',
    uuid: string,
    command: string,
    container: string,
    timeout: number | undefined,
    waitSeconds: number | undefined,
  ): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
    const isApp = resource === 'application';
    const pollIntervalMs = 5000;
    const budgetSeconds = waitSeconds ?? 90;
    const maxAttempts = Math.max(1, Math.ceil((budgetSeconds * 1000) / pollIntervalMs));
    const name = `oneoff-${Math.random().toString(36).slice(2, 10)}`;

    let taskUuid: string;
    try {
      const task = isApp
        ? await this.client.createApplicationScheduledTask(uuid, {
            name,
            command,
            frequency: '* * * * *',
            container,
            timeout,
            enabled: true,
          })
        : await this.client.createServiceScheduledTask(uuid, {
            name,
            command,
            frequency: '* * * * *',
            container,
            timeout,
            enabled: true,
          });
      taskUuid = task.uuid;
    } catch (error) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error creating one-off task: ${error instanceof Error ? error.message : String(error)}`,
          },
        ],
      };
    }

    let execution: ScheduledTaskExecution | undefined;
    let pollErrorMessage: string | undefined;

    try {
      for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const executions = isApp
          ? await this.client.listApplicationScheduledTaskExecutions(uuid, taskUuid)
          : await this.client.listServiceScheduledTaskExecutions(uuid, taskUuid);
        const first = executions[0];
        if (first && first.status !== 'running') {
          execution = first;
          break;
        }
        if (attempt < maxAttempts - 1) await this.sleep(pollIntervalMs);
      }
    } catch (error) {
      pollErrorMessage = error instanceof Error ? error.message : String(error);
    }

    // Cleanup always runs, regardless of how the poll loop above ended.
    let deleteErrorMessage: string | undefined;
    try {
      if (isApp) {
        await this.client.deleteApplicationScheduledTask(uuid, taskUuid);
      } else {
        await this.client.deleteServiceScheduledTask(uuid, taskUuid);
      }
    } catch (error) {
      deleteErrorMessage = error instanceof Error ? error.message : String(error);
    }

    const cleanupNote = deleteErrorMessage
      ? `WARNING: failed to delete one-off task ${taskUuid} — it will keep firing every minute ` +
        `until it is removed manually. Delete error: ${deleteErrorMessage}`
      : `One-off task ${taskUuid} deleted.`;

    if (pollErrorMessage) {
      return {
        content: [
          {
            type: 'text' as const,
            text: `Error polling one-off task ${taskUuid} executions: ${pollErrorMessage}. ${cleanupNote}`,
          },
        ],
      };
    }

    if (!execution) {
      return {
        content: [
          {
            type: 'text' as const,
            text:
              `Timed out after ${budgetSeconds}s waiting for one-off task ${taskUuid} to produce ` +
              `an execution. ${cleanupNote}`,
          },
        ],
      };
    }

    return {
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify(
            {
              status: execution.status,
              message: execution.message,
              task_uuid: taskUuid,
              cleanup: cleanupNote,
            },
            null,
            2,
          ),
        },
      ],
    };
  }
}
