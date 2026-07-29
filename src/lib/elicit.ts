/**
 * Human-in-the-loop confirmation for destructive tools (#261).
 *
 * The problem this solves: `stop_all_apps` is gated on a `confirm: z.literal(true)`
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

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';

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
 */
export function supportsElicitation(server: Server): boolean {
  return Boolean(server.getClientCapabilities()?.elicitation);
}

export type ConfirmOutcome =
  | { approved: true }
  /** `message` is user-facing text explaining why nothing ran. */
  | { approved: false; message: string };

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
): Promise<ConfirmOutcome> {
  if (!supportsElicitation(server)) {
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
 * Characters that turn a plain name into markdown. Stripped rather than
 * escaped — a mangled name is a better outcome in a security dialog than a
 * rendered one.
 *
 * Deliberately **not** `_` or parentheses, though both carry some markdown
 * meaning. `API_KEY` is the shape of almost every env var name this will ever
 * render, and turning it into `APIKEY` in the one dialog whose job is to let
 * someone recognise what they are approving is a worse failure than the thing
 * it prevents. Parentheses only matter following a `[...]`, which cannot
 * survive this filter anyway.
 *
 * What is left out is the part that can mislead about destination or
 * authority: link syntax and code spans. Residual risk is emphasis via
 * `__underscores__`, which is cosmetic.
 */
const MARKDOWN_CHARS = /[`*[\]<>]/g;

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
  const safe = names.map(sanitizeForPrompt);
  if (safe.length <= MAX_NAMED) return `${count} (${safe.join(', ')})`;
  const shown = safe.slice(0, MAX_NAMED).join(', ');
  return `${count} (${shown} and ${safe.length - MAX_NAMED} more)`;
}
