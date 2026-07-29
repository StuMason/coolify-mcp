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
 */
export const ELICIT_TIMEOUT_MS = 300_000;

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
 * @param summarize Produces the prompt text. A callback rather than a string so
 *                 that call sites needing an API round trip to state their blast
 *                 radius — "how many apps am I about to stop?" — only pay for it
 *                 on clients that will actually show the question.
 */
export async function confirmDestructive(
  server: Server,
  summarize: () => string | Promise<string>,
): Promise<ConfirmOutcome> {
  if (!server.getClientCapabilities()?.elicitation) {
    return { approved: true };
  }

  let message: string;
  try {
    message = await summarize();
  } catch (error) {
    // The pre-flight lookup failed. Still ask — a human confirming a vaguer
    // question is a better outcome than an unconfirmed destructive call, and
    // the failure itself is worth putting in front of them.
    message =
      `Proceed with this destructive operation? ` +
      `(Could not load details first: ${error instanceof Error ? error.message : String(error)})`;
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
      { timeout: ELICIT_TIMEOUT_MS },
    );
  } catch (error) {
    // Timeout, transport failure, or a client that advertised the capability
    // and then rejected the request. We asked and got no yes.
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
  if (names.length <= MAX_NAMED) return `${count} (${names.join(', ')})`;
  const shown = names.slice(0, MAX_NAMED).join(', ');
  return `${count} (${shown} and ${names.length - MAX_NAMED} more)`;
}
