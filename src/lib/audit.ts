/**
 * Structured audit logging for tool calls (#370).
 *
 * Coolify's own MCP audit-logs every call and every denial. We logged one line
 * per *request* in HTTP mode and nothing at all over stdio, which answers "what
 * was asked" but not "what happened" — and "what did the agent actually do, and
 * when" is the first question a security review asks about an agent with
 * production credentials.
 *
 * ## What is in a line, and what is deliberately not
 *
 * Tool name, action, the resource uuids, the outcome, how long it took, and in
 * HTTP mode the OAuth client id. **Never arguments, never responses.** That is
 * not a style preference: `env_vars` create carries secret values in its
 * arguments, and responses carry everything the central sanitizer exists to
 * mask. An audit log that quietly became a second copy of the secrets would be
 * a worse leak than the one it was written to prevent, because nobody reads it
 * expecting secrets.
 *
 * Values are therefore never read out of arguments generically. `pickUuids`
 * works from a closed allowlist of identifier-shaped keys and validates the
 * shape of what it finds, so a new tool argument called `password` cannot end
 * up in a log line by being added upstream of this file. A future argument
 * genuinely worth auditing has to be added to the allowlist on purpose.
 *
 * ## Known limit
 *
 * A call whose arguments fail the tool's own schema is rejected by the SDK
 * before any code here runs, so it produces no line. There is no public seam to
 * audit from earlier than the tool callback without reaching into SDK
 * internals. The gap is narrow — nothing executed and no credential was used —
 * but it is real, and `audit.test.ts` pins it so that it fails, visibly, if the
 * SDK ever grows the hook that would close it.
 *
 * ## Defaults
 *
 * On in HTTP mode, off over stdio. A local single-user pipe writing a line to
 * stderr for every call is noise for most people, while a multi-client
 * internet-facing server is exactly where the record matters. Either default is
 * overridden by `COOLIFY_MCP_AUDIT=on|off`.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

/** What happened. `refused` is a decision, `error` is a fault — see {@link AuditRefusal}. */
export type AuditOutcome = 'ok' | 'error' | 'refused';

/**
 * Why a call was refused, as a category rather than prose.
 *
 * Categories, not messages: a reviewer counting "how often does this server
 * refuse because nobody could be asked" needs to group these, and free text
 * does not group.
 */
export type AuditRefusal =
  /** A human saw the confirmation and actively said no. */
  | 'declined'
  /** A human dismissed the confirmation without answering it. */
  | 'cancelled'
  /** HTTP mode, client cannot elicit at all, so the guard failed closed. */
  | 'no_elicitation'
  /**
   * The client was asked and no answer could be obtained: a timeout, a
   * cancelled call, a transport failure, or a client that advertised the
   * capability and then refused the request.
   *
   * Distinct from `declined` on purpose. Someone reading this log to answer
   * "did a human approve this?" gets the wrong answer if a failed ask is
   * recorded as a refusal by a person who was never asked (#408).
   */
  | 'unavailable'
  /** The estate changed between the confirmation and the answer (#341). */
  | 'stale_confirmation'
  /** Arguments did not satisfy the handler (missing uuid, unknown instance). */
  | 'validation';

export interface AuditEntry {
  audit: 'tools/call';
  at: string;
  tool: string;
  /** The `action` discriminator, when the tool has one. */
  action?: string;
  /** Resource identifiers from a closed allowlist. Never other argument values. */
  uuids?: string[];
  /** Fleet mode: which instance the call was routed to. */
  instance?: string;
  outcome: AuditOutcome;
  reason?: AuditRefusal;
  duration_ms: number;
  /** HTTP mode only: the OAuth client that made the call. */
  client_id?: string;
}

/**
 * Argument keys whose values may be logged. Closed on purpose — see the note
 * at the top of the file about why this is an allowlist and not a denylist.
 */
const UUID_KEYS = [
  'uuid',
  'app_uuid',
  'storage_uuid',
  'task_uuid',
  'backup_uuid',
  'execution_uuid',
  'deployment_uuid',
  'environment_uuid',
  'project_uuid',
  'server_uuid',
  'destination_uuid',
  'private_key_uuid',
  'github_app_uuid',
  's3_storage_uuid',
] as const;

/** Coolify uuids are lowercase alphanumerics; the OAuth/deployment ones add dashes. */
const UUID_SHAPE = /^[A-Za-z0-9][A-Za-z0-9-]{0,63}$/;

/** Action values come from zod enums, but the charset is pinned rather than trusted. */
const ACTION_SHAPE = /^[a-z][a-z0-9_]{0,39}$/;

export function pickAction(args: unknown): string | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const action = (args as Record<string, unknown>).action;
  return typeof action === 'string' && ACTION_SHAPE.test(action) ? action : undefined;
}

export function pickUuids(args: unknown): string[] | undefined {
  if (typeof args !== 'object' || args === null) return undefined;
  const record = args as Record<string, unknown>;
  const found: string[] = [];
  for (const key of UUID_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && UUID_SHAPE.test(value) && !found.includes(value)) {
      found.push(value);
    }
  }
  return found.length ? found : undefined;
}

/** `COOLIFY_MCP_AUDIT` wins over the transport's default in both directions. */
export function auditEnabled(defaultOn: boolean, env: NodeJS.ProcessEnv = process.env): boolean {
  const value = env.COOLIFY_MCP_AUDIT?.trim().toLowerCase();
  if (value === 'off' || value === 'false' || value === '0') return false;
  if (value === 'on' || value === 'true' || value === '1') return true;
  return defaultOn;
}

/**
 * Per-call slot a handler can mark. Only refusals are marked: an error is
 * already unambiguous from the `Error:` prefix every handler returns, and a
 * decline deliberately does not carry that prefix, so it has to say so itself.
 */
interface CallSlot {
  reason?: AuditRefusal;
}

const callContext = new AsyncLocalStorage<CallSlot>();

/** Record that this call was refused, and why. No-op outside an audited call. */
export function markRefused(reason: AuditRefusal): void {
  const slot = callContext.getStore();
  if (slot) slot.reason = reason;
}

/** Write one line. stderr, so stdout stays a clean JSON-RPC pipe over stdio. */
export function writeAudit(entry: AuditEntry): void {
  console.error(JSON.stringify(entry));
}

interface AuditedCallInput {
  tool: string;
  args: unknown;
  instance?: string;
  clientId?: string;
  now?: () => number;
  write?: (entry: AuditEntry) => void;
}

/**
 * Run a tool call and write exactly one audit line for it.
 *
 * One line per call, whatever happens, including a throw — a record with holes
 * where the failures were is worse than no record, because it reads as complete.
 */
export async function auditedCall<T>(
  input: AuditedCallInput,
  run: () => Promise<T> | T,
): Promise<T> {
  const clock = input.now ?? (() => Date.now());
  const write = input.write ?? writeAudit;
  const started = clock();
  const slot: CallSlot = {};

  const finish = (outcome: AuditOutcome, reason?: AuditRefusal): void => {
    const entry: AuditEntry = {
      audit: 'tools/call',
      at: new Date().toISOString(),
      tool: input.tool,
      outcome,
      duration_ms: Math.max(0, clock() - started),
    };
    const action = pickAction(input.args);
    if (action) entry.action = action;
    const uuids = pickUuids(input.args);
    if (uuids) entry.uuids = uuids;
    if (input.instance) entry.instance = input.instance;
    if (reason) entry.reason = reason;
    if (input.clientId) entry.client_id = input.clientId;
    write(entry);
  };

  try {
    const result = await callContext.run(slot, async () => run());
    if (slot.reason) {
      finish('refused', slot.reason);
    } else if (isErrorResult(result)) {
      finish('error');
    } else {
      finish('ok');
    }
    return result;
  } catch (error) {
    // A throw escaping a handler is the case an audit log most needs to record,
    // so the line is written before the error continues on its way.
    finish('error');
    throw error;
  }
}

/**
 * Every handler reports failure as text prefixed `Error:` rather than by
 * throwing, so that the model reads the reason instead of a transport fault.
 * A decline is deliberately NOT prefixed that way (see `abortText` in
 * elicit.ts), which is what keeps the two apart here.
 */
function isErrorResult(result: unknown): boolean {
  if (typeof result !== 'object' || result === null) return false;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return false;
  const text = (content[0] as { text?: unknown } | undefined)?.text;
  return typeof text === 'string' && text.startsWith('Error:');
}
