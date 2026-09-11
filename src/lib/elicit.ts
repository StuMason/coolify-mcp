/**
 * Human-in-the-loop confirmation for destructive tools (#261).
 *
 * The problem this solves: `stop_all_apps` is gated on a `confirm: true`
 * parameter, and the model fills that parameter in. That is the model confirming
 * with itself before taking every application on the estate down. Elicitation
 * moves the question to the human, rendered by the client, outside the model's
 * control.
 *
 * **Strictly progressive enhancement.** Client support is uneven — Claude Code
 * and VS Code Copilot have it, Claude Desktop and claude.ai do not yet — so this
 * checks the client's advertised `elicitation` capability at runtime and, when
 * it is absent, approves and lets the existing parameter guards stand. A client
 * that cannot be asked is not a client that gets blocked.
 *
 * Failure is closed in the other direction: once a client says it supports
 * elicitation, a decline, a cancel, a timeout or a transport error all abort the
 * operation. The one case that does not abort is the blast-radius lookup
 * failing, because a summary we could not compute is a reason to ask with less
 * detail, not a reason to skip asking.
 *
 * V3 note: SDK v2 redesigns this as `inputRequired.elicit()` (#259). Everything
 * version-specific is inside `confirmDestructive`; call sites see only
 * {@link ConfirmOutcome}.
 */

import { createHash, randomBytes } from 'node:crypto';

import {
  createRequestStateCodec,
  inputRequired,
  inputResponse,
  type InputRequiredResult,
  type RequestStateCodec,
  type Server,
  type ServerContext,
} from '@modelcontextprotocol/server';

import type { AuditRefusal } from './audit.js';

/**
 * How long to wait for a human.
 *
 * The SDK's default request timeout is 60s, which is a sensible ceiling for a
 * machine answering and a bad one for a person reading "stop ALL 12
 * applications?" and deciding. Five minutes; after that the request is
 * abandoned and the operation aborts, which is the safe direction.
 *
 * This is a backstop, not the primary control — see the `signal` passed
 * alongside it, which lets the caller's own cancellation win first.
 */
export const ELICIT_TIMEOUT_MS = 300_000;

/**
 * Whether this client can be asked at all.
 *
 * **Read this before wiring up the HTTP transport (#303).** This depends on a
 * completed initialize handshake being retained for the connection. In a
 * stateless HTTP mode, where per-connection capabilities are not kept, it
 * returns `undefined`, every guard approves, and the entire confirmation layer
 * disappears with no signal that it has.
 *
 * Failing open is the right default here, on stdio, where the alternative is
 * blocking Claude Desktop users out of tools that work today. It is very
 * probably the wrong default for a remote server reachable over the network,
 * which is the transport where the parameter-based guards stop being credible
 * at all — the reason #303 lists elicitation as a prerequisite. Decide that
 * deliberately there rather than inheriting this choice by accident.
 *
 * `COOLIFY_MCP_ELICITATION=off` is an escape hatch, not a feature. Once a
 * client advertises the capability every rejection from `elicitInput` aborts,
 * including `-32601 Method not found` — so a client that advertises
 * `elicitation` without implementing the handler, or a proxy that drops the
 * request, makes every guarded tool permanently unusable with no way out but
 * downgrading the package. The resulting error ("could not confirm with the
 * user") does not point at the client, which makes it hard to diagnose from the
 * outside. Rare, but unrecoverable, and the fallback is the same shape as the
 * one capability-less clients already get. The default is unchanged: absent the
 * variable, an advertised capability is trusted and the guards fail closed.
 */
export function supportsElicitation(server: Server): boolean {
  if (process.env.COOLIFY_MCP_ELICITATION === 'off') return false;
  return Boolean(server.getClientCapabilities()?.elicitation);
}

export type ConfirmOutcome =
  | { approved: true }
  /**
   * `message` is user-facing text explaining why nothing ran. `reason` is the
   * same fact as a category, carried structurally rather than left for the
   * caller to recover by matching on the prose.
   *
   * The prose and the category used to be one field, and the audit layer
   * recovered the category with `message.includes(...)`. That silently
   * classified every timeout, cancellation and protocol refusal as a human
   * decline (#408) — a wrong answer to the one question the audit log exists
   * to answer. The branch that knows why already knows; it says so here.
   */
  | { approved: false; reason: AuditRefusal; message: string };

/**
 * Text returned to the model when the human says no.
 *
 * Deliberately not prefixed `Error:` — a decline is a decision, not a fault —
 * but explicit that nothing changed and that retrying is not the next step,
 * because a model reading a bare "cancelled" will often just try again.
 */
function abortText(reason: string): string {
  return `Aborted: ${reason}. Nothing was changed. Do not retry without new instructions from the user.`;
}

/**
 * Ask the human to approve a destructive operation.
 *
 * @param server   The low-level `Server` (i.e. `mcpServer.server`), which owns
 *                 both the client capabilities and `elicitInput`.
 * @param label    One line naming the operation, independent of any lookup.
 *                 Used when `summarize` fails, so the degraded prompt still
 *                 says what it is asking about.
 * @param summarize Produces the prompt text, or `null` when the pre-flight
 *                 found nothing to confirm. A callback rather than a string so
 *                 that call sites needing an API round trip to state their blast
 *                 radius — "how many apps am I about to stop?" — only pay for it
 *                 on clients that will actually show the question.
 * @param signal   The tool call's abort signal. See the call to `elicitInput`
 *                 for why omitting it is dangerous rather than merely untidy.
 */
export async function confirmDestructive(
  server: Server,
  label: string,
  summarize: () => string | null | Promise<string | null>,
  signal?: AbortSignal,
  options?: {
    /**
     * Fail closed when the client cannot be asked (#303). On stdio the
     * capability-less fallback approves and the parameter guards stand; on an
     * internet-facing HTTP server "the model confirms with itself" is not a
     * credible control, so HTTP mode sets this and a client without
     * elicitation is refused rather than waved through.
     */
    requireHuman?: boolean;
  },
): Promise<ConfirmOutcome> {
  if (!supportsElicitation(server)) {
    if (options?.requireHuman) {
      return {
        approved: false,
        reason: 'no_elicitation',
        message: abortText(
          `this server requires human confirmation for destructive operations, and this client does not support elicitation. ` +
            `Read-only tools work normally. For destructive operations, connect with a client that supports elicitation or use the stdio server locally`,
        ),
      };
    }
    return { approved: true };
  }

  let message: string;
  try {
    const summary = await summarize();
    // `null` means the pre-flight found nothing to do — an emergency stop on an
    // idle estate, a redeploy of an empty project. Asking a human to confirm a
    // no-op is how they learn these dialogs are noise, which is the same
    // argument behind BULK_ENV_CONFIRM_THRESHOLD.
    if (summary === null) return { approved: true };
    message = summary;
  } catch (error) {
    // The pre-flight lookup failed. Still ask — a human confirming a vaguer
    // question is a better outcome than an unconfirmed destructive call, and
    // the failure itself is worth putting in front of them.
    // `label` is why this stays a real question. Without it the degraded
    // prompt reads "Proceed with this destructive operation?" whether the
    // operation deletes one service or stops every application on the estate —
    // the weakest possible ask, fired on exactly the condition (a flaky or
    // unreachable Coolify) where a human is most likely to be clicking through
    // things quickly.
    message =
      `${label}\n\nProceed? ` +
      `(Could not load the details first: ${error instanceof Error ? error.message : String(error)})`;
  }

  let result;
  try {
    result = await server.elicitInput(
      {
        message,
        // No fields: the answer is the accept/decline action itself. This is the
        // spec's confirmation-only shape, and asking for a redundant "type YES"
        // field would only add a way for the client to fail validation.
        requestedSchema: { type: 'object', properties: {} },
      },
      // The caller's signal matters more than the timeout. The elicitation runs
      // *inside* the `tools/call` request, and the SDK's client-side default
      // request timeout is 60s — shorter than a human takes to read "stop ALL
      // 12 applications?" and decide. Without this signal, a client that gives
      // up at 60s and sends `notifications/cancelled` would leave the prompt
      // live for another four minutes, and an accept at t=90s would execute the
      // destructive operation with nobody listening — after the model had
      // already been told the call failed, and may have retried it.
      { timeout: ELICIT_TIMEOUT_MS, signal },
    );
  } catch (error) {
    // Timeout, caller cancellation, transport failure, or a client that
    // advertised the capability and then rejected the request. We asked and got
    // no yes.
    return {
      approved: false,
      // Asked, no answer obtainable. NOT a decline: nobody said no, and on the
      // 2026-07-28 revision this is the branch a legacy-shaped server takes
      // every single time, so collapsing it into `declined` would fill the log
      // with human decisions that never happened.
      reason: 'unavailable',
      message: abortText(
        `could not confirm with the user (${error instanceof Error ? error.message : String(error)})`,
      ),
    };
  }

  if (result.action === 'accept') {
    return { approved: true };
  }

  return {
    approved: false,
    reason: result.action === 'decline' ? 'declined' : 'cancelled',
    message: abortText(
      result.action === 'decline' ? 'the user declined' : 'the user cancelled the prompt',
    ),
  };
}

/** Cap on how many resource names a blast-radius summary spells out. */
const MAX_NAMED = 8;

/** Cap on a single interpolated name, so one long name cannot bury the question. */
const MAX_NAME_LENGTH = 64;

/**
 * Characters that turn a plain name into markdown, **or that the prompt
 * templates themselves use as delimiters**. Stripped rather than escaped — a
 * mangled name is a better outcome in a security dialog than a rendered one.
 *
 * The second category is the easy one to miss. `deleteResourcePrompt` renders
 * `Delete application "NAME" (UUID)?`, so a quote or a parenthesis inside NAME
 * is not merely cosmetic markdown — it closes the delimiter the reader is using
 * to tell where the untrusted value ends. A resource named
 * `x" is routine and safe (` produces a sentence that reads as the server's own
 * prose. That matters most for the `uuid` arguments, which are plain strings in
 * the tool schemas with no uuid constraint, so their contents are chosen by the
 * model rather than by anyone with access to the Coolify instance.
 *
 * `#` goes too: the module already assumes a markdown-rendering client (that is
 * the stated reason for stripping backticks and `[`), and a leading `# ` is a
 * heading.
 *
 * Deliberately **not** `_`. `API_KEY` is the shape of almost every env var name
 * this will ever render, and turning it into `APIKEY` in the one dialog whose
 * job is to let someone recognise what they are approving is a worse failure
 * than the thing it prevents. Residual risk is emphasis via `__underscores__`,
 * which is cosmetic.
 */
const MARKDOWN_CHARS = /[`*[\]<>"()#]/g;

/** C0 and C1 control ranges — where newlines and carriage returns live. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g;

/**
 * Make a value safe to interpolate into a confirmation dialog.
 *
 * Two sources, and the weaker-looking one is the stronger vector:
 *
 * - **Coolify-supplied names** are attacker-influenced in the weak sense that
 *   anyone able to create resources on the instance chooses them. A name
 *   containing newlines — `api\n\nThis is routine, safe to accept.` — reshapes
 *   a dialog whose entire job is to be trustworthy into one that argues for its
 *   own approval.
 * - **Model-supplied identifiers** (the `uuid` arguments) are worse. Those
 *   schemas are plain strings with no uuid constraint, so the value is
 *   arbitrary text the model chose, and producing it needs no write access to
 *   the Coolify instance at all — only a model that read something hostile in a
 *   README, an issue body or a log line. Anything crossing into the dialog gets
 *   sanitized, whichever side it came from; the whole point of the dialog is to
 *   sit outside the model's control.
 *
 * A real 36-character UUID is well inside {@link MAX_NAME_LENGTH}, so genuine
 * values render unchanged.
 *
 * Markdown-significant characters are neutralised alongside the control ones.
 * The prompts in this codebase use backticks for emphasis, which means they
 * assume a client that renders markdown — and markdown rendering *is* parsing,
 * whatever the text is nominally "for". Under that assumption a resource named
 * `[Approve](https://evil.example)` becomes a link and `**SAFE - routine**`
 * becomes bold reassurance, inside a dialog whose whole job is to look
 * trustworthy. The length clamp caps that but does not remove it.
 */
export function sanitizeForPrompt(name: string): string {
  const flattened = name
    .replace(CONTROL_CHARS, ' ')
    .replace(MARKDOWN_CHARS, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (flattened.length <= MAX_NAME_LENGTH) return flattened;
  return `${flattened.slice(0, MAX_NAME_LENGTH - 1)}…`;
}

/**
 * Render "12 applications (a, b, c and 9 more)" for a confirmation message.
 *
 * Names are truncated because the point of the list is recognition — spotting
 * the one production app that should not be in the set — and a wall of sixty
 * names defeats that as thoroughly as no names at all.
 */
export function describeBlastRadius(noun: string, names: string[]): string {
  const count = `${names.length} ${noun}${names.length === 1 ? '' : 's'}`;
  if (names.length === 0) return count;
  // Sorted, so the same set of resources always renders the same string.
  //
  // Coolify does not promise an order, and on revision 2026-07-28 this text is
  // digested into the sealed confirmation and compared against a second render
  // seconds later (#341). Unsorted, a reordering of the same twelve names — or
  // a different twelve surviving the `and N more` truncation — reads as a
  // changed blast radius and refuses an approval the human legitimately gave,
  // with a re-run offering the same coin flip. A count change still refuses,
  // which is the check that was wanted.
  //
  // Codepoint compare, not localeCompare: collation is locale-dependent, and a
  // prompt that sorts differently on the operator's machine than on the server
  // would reintroduce exactly the instability this removes.
  const safe = [...names].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0)).map(sanitizeForPrompt);
  if (safe.length <= MAX_NAMED) return `${count} (${safe.join(', ')})`;
  const shown = safe.slice(0, MAX_NAMED).join(', ');
  return `${count} (${shown} and ${safe.length - MAX_NAMED} more)`;
}

/**
 * The confirmation key used for the embedded elicitation request, and the key
 * the retried call's `inputResponses` is read back under. One guarded
 * operation is in flight per call, so a constant is enough.
 */
export const CONFIRM_KEY = 'confirm';

/** What travels inside the sealed `requestState` across the two round trips. */
export interface ConfirmationState {
  /** Digest of the summary the human was actually shown. */
  digest: string;
}

/**
 * Outcome of the 2026-07-28 confirmation flow.
 *
 * `ask` is not a refusal and not an approval: it is the first half of a
 * two-round-trip exchange, and the caller must return `result` to the client
 * unchanged so the client can fulfil it and retry.
 */
export type ModernConfirmation =
  | { status: 'ask'; result: InputRequiredResult }
  | { status: 'approved' }
  | { status: 'nothing-to-do' }
  | { status: 'refused'; reason: AuditRefusal; message: string };

/** Stable digest of the text a human was shown, for the staleness check. */
export function summaryDigest(summary: string): string {
  return createHash('sha256').update(summary).digest('hex').slice(0, 32);
}

/**
 * The text a human is shown, plus the digest sealed alongside it.
 *
 * `summarize()` reaches a live Coolify and can fail. The 2025 path deliberately
 * asks anyway, because a human confirming a vaguer question is a better outcome
 * than an unconfirmed destructive call — and a flaky Coolify is exactly when
 * someone is most likely to be clicking through things quickly. This era has to
 * behave the same way or the two paths diverge on the case that matters most.
 *
 * A degraded prompt seals a fixed sentinel rather than a digest of the error.
 * Two failures rarely produce byte-identical messages, and digesting the error
 * text would turn "Coolify is still down on the retry" into a spurious
 * stale-confirmation refusal after the human already said yes.
 */
function degradedDigest(label: string): string {
  // Deliberately derived from `label`, not from the error text. Two failures
  // are rarely byte-identical, so digesting the message would refuse a
  // legitimate approval; a bare constant would go the other way and let state
  // sealed for a degraded `delete service X` verify against a degraded
  // `stop_all_apps` from the same client inside the TTL. `label` is a static
  // string per operation and needs no lookup, which is its whole purpose.
  return summaryDigest(`degraded:${label}`);
}

async function describe(
  label: string,
  summarize: () => string | null | Promise<string | null>,
): Promise<{ text: string; digest: string } | null> {
  try {
    const summary = await summarize();
    if (summary === null) return null;
    return { text: summary, digest: summaryDigest(summary) };
  } catch (error) {
    return {
      text:
        `${label}\n\nProceed? ` +
        `(Could not load the details first: ${error instanceof Error ? error.message : String(error)})`,
      digest: degradedDigest(label),
    };
  }
}

/**
 * Ask the human to approve a destructive operation, on protocol revision
 * 2026-07-28.
 *
 * The 2025 shape — server pushes `elicitation/create` mid-request and awaits
 * the answer — does not exist on this revision; `elicitInput` throws. Instead
 * the handler returns an `input_required` result, the **client** fulfils the
 * embedded request and retries the original call with `inputResponses`, and
 * the handler runs a second time from the top.
 *
 * Two consequences shape everything here.
 *
 * **The handler is re-entered, so it must know which half it is in.** That is
 * the `inputResponse` read at the top: absent means round one, present means
 * the human has answered.
 *
 * **`summarize()` runs again on round two.** It has to: the estate is live,
 * and the whole point of the prompt is the blast radius it quoted. So the
 * digest of what was shown is sealed into `requestState` on the way out and
 * compared on the way back. If an emergency stop said "12 applications" and
 * 14 are running by the time the human clicks yes, the approval no longer
 * describes the operation and this refuses rather than widening it silently.
 *
 * The requested schema is deliberately **empty**. The answer is the client's
 * accept/decline action, not a field: a `confirm: true` property is a value
 * something upstream could supply on the retry, and the evals already record a
 * model issuing a real restart 5 runs out of 5 while explicitly told not to.
 * The confirmation has to come from outside the model, or it is theatre.
 */
export async function confirmDestructiveModern(
  ctx: ServerContext,
  label: string,
  summarize: () => string | null | Promise<string | null>,
  mint: (payload: ConfirmationState, ctx: ServerContext) => Promise<string>,
  canAsk: boolean,
): Promise<ModernConfirmation> {
  // Asking a client that never declared elicitation produces an embedded
  // request it did not agree to receive, and whatever its SDK does with that
  // becomes somebody's debugging session. Refuse with the message that says
  // what to do instead — the same fail-closed outcome, legible.
  //
  // This is also where `COOLIFY_MCP_ELICITATION=off` is honoured, since it is
  // folded into the same capability check.
  if (!canAsk) {
    return {
      status: 'refused',
      reason: 'no_elicitation',
      message: abortText(
        `this server requires human confirmation for destructive operations, and this client does not support elicitation. ` +
          `Read-only tools work normally. For destructive operations, connect with a client that supports elicitation or use the stdio server locally`,
      ),
    };
  }

  const answer = inputResponse(ctx.mcpReq.inputResponses, CONFIRM_KEY);

  if (answer.kind === 'missing') {
    const summary = await describe(label, summarize);
    // `null` means the pre-flight found nothing to do. Same rule as the legacy
    // path: asking a human to confirm a no-op teaches them the dialog is noise.
    if (summary === null) return { status: 'nothing-to-do' };
    return {
      status: 'ask',
      result: inputRequired({
        inputRequests: {
          [CONFIRM_KEY]: inputRequired.elicit({
            message: summary.text,
            requestedSchema: { type: 'object', properties: {} },
          }),
        },
        requestState: await mint({ digest: summary.digest }, ctx),
      }),
    };
  }

  if (answer.kind !== 'elicit') {
    // A response arrived under our key that is not an elicitation answer.
    // Nobody said yes, so nothing runs.
    return {
      status: 'refused',
      reason: 'unavailable',
      message: abortText(`the confirmation came back as a ${answer.kind} response, not an answer`),
    };
  }

  if (answer.action !== 'accept') {
    return {
      status: 'refused',
      reason: answer.action === 'decline' ? 'declined' : 'cancelled',
      message: abortText(
        answer.action === 'decline' ? 'the user declined' : 'the user cancelled the prompt',
      ),
    };
  }

  const sealed = ctx.mcpReq.requestState<ConfirmationState>();
  const current = await describe(label, summarize);
  if (current === null) return { status: 'nothing-to-do' };
  if (!sealed || sealed.digest !== current.digest) {
    return {
      status: 'refused',
      reason: 'stale_confirmation',
      message: abortText(
        `what this would do changed between the confirmation and the answer, so the approval no longer describes it. ` +
          `Nothing was changed. Re-run ${JSON.stringify(label)} to see the current blast radius and confirm that`,
      ),
    };
  }

  return { status: 'approved' };
}

/**
 * How long a minted confirmation stays answerable.
 *
 * Ten minutes is the codec default and the right order of magnitude: long
 * enough that a human can read "stop ALL 12 applications?", think, and answer;
 * short enough that a dialog left open over lunch does not still authorise a
 * deletion afterwards.
 */
const CONFIRMATION_TTL_SECONDS = 600;

/**
 * The HMAC key for {@link createConfirmationCodec}.
 *
 * `requestState` is handed to the client and comes back as attacker-controlled
 * input, so it is signed. The key is read from `MCP_REQUEST_STATE_KEY` when set
 * and generated per process otherwise.
 *
 * The generated fallback is correct but has two consequences worth knowing:
 * confirmations in flight across a restart or redeploy stop verifying, and more
 * than one replica behind a load balancer cannot verify each other's state.
 * Both fail closed — the operation is refused, never wrongly approved — so this
 * is an availability trade, not a security one.
 */
/**
 * Said once per process, beside the generation it describes.
 *
 * HTTP mode builds a fresh `CoolifyMcpServer` for every request, so warning
 * from the codec factory would print this between every pair of audit lines —
 * non-JSON prose interleaved through the audit stream, on the default
 * configuration, forever.
 */
function announceGeneratedKey(): void {
  console.error(
    'coolify-mcp: MCP_REQUEST_STATE_KEY is unset, so confirmation state is signed with a key ' +
      'generated on first use. Confirmations in flight across a restart will be refused and must ' +
      'be re-confirmed. Set it to at least 32 bytes to survive restarts and to run more than ' +
      'one replica.',
  );
}

let generatedKey: Uint8Array | undefined;

function confirmationKey(announce: boolean): Uint8Array | string {
  const configured = process.env.MCP_REQUEST_STATE_KEY;
  if (configured === undefined || configured === '') {
    // Per PROCESS, not per server instance. HTTP mode builds a fresh
    // `CoolifyMcpServer` for every request, so a key generated in the
    // constructor would differ between the round that mints the state and the
    // round that verifies it, and every confirmation would fail as forged.
    // That is a real failure mode, caught by the interop test rather than by
    // reading: it fails closed, so it looks like tight security rather than a
    // bug.
    if (generatedKey === undefined) {
      generatedKey = randomBytes(32);
      if (announce) announceGeneratedKey();
    }
    return generatedKey;
  }
  if (Buffer.byteLength(configured, 'utf8') < 32) {
    throw new Error(
      'MCP_REQUEST_STATE_KEY must be at least 32 bytes. Generate one with: openssl rand -hex 32',
    );
  }
  return configured;
}

/**
 * Seals the confirmation that round-trips through the client (#341).
 *
 * Bound to the authenticated principal and the method, so state minted for one
 * caller cannot be echoed by another — the spec's user-binding requirement for
 * state that influences authorization, and this state authorises a deletion.
 * The binding value is stored as a keyed tag rather than in clear, so the
 * client never holds a readable principal identifier.
 *
 * Signed, not encrypted. The payload is a digest and an expiry, both of which a
 * client may read without harm; nothing secret goes in it.
 */
export function createConfirmationCodec(options?: {
  announceGeneratedKey?: boolean;
}): RequestStateCodec<ConfirmationState> {
  return createRequestStateCodec<ConfirmationState>({
    key: confirmationKey(options?.announceGeneratedKey === true),
    ttlSeconds: CONFIRMATION_TTL_SECONDS,
    bind: (ctx) => `${ctx.mcpReq.method} ${ctx.http?.authInfo?.clientId ?? ''}`,
  });
}
