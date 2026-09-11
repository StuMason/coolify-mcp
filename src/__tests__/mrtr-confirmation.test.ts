/**
 * Confirmation by multi round-trip, protocol revision 2026-07-28 (#341).
 *
 * On this revision a server may not push `elicitation/create` mid-call. It
 * answers `tools/call` with an `input_required` result instead; the client
 * fulfils the embedded request and RETRIES the original call, so the handler
 * runs a second time and has to recognise which half it is in.
 *
 * Driven directly rather than through a transport on purpose. Only HTTP mode
 * serves this era — stdio connects through the 2025 handshake and stays there
 * for the life of the connection — so a transport-level test would need the
 * whole OAuth-authenticated HTTP app to exercise four lines of branching.
 * `src/__tests__/http-interop.test.ts` covers the wiring end to end; this
 * covers the decisions.
 */

import { describe, it, expect, jest } from '@jest/globals';
import type { ServerContext } from '@modelcontextprotocol/server';
import { confirmDestructiveModern, summaryDigest } from '../lib/elicit.js';

/** A sealed state that verifies, standing in for the SDK codec. */
const SEALED = 'sealed-state';

function ctxFor(options: {
  inputResponses?: Record<string, unknown>;
  requestState?: { digest: string };
}): ServerContext {
  return {
    mcpReq: {
      method: 'tools/call',
      // Presence of the envelope is how a handler knows it is on this era.
      envelope: {},
      inputResponses: options.inputResponses,
      requestState: () => options.requestState,
    },
  } as unknown as ServerContext;
}

const mint = jest.fn(async (payload: { digest: string }) => `${SEALED}:${payload.digest}`);

describe('confirmDestructiveModern: round one', () => {
  it('asks, and seals a digest of exactly what it showed', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({}),
      'Stop everything',
      () => 'stop 12 running applications?',
      mint as never,
    );

    expect(result.status).toBe('ask');
    if (result.status !== 'ask') throw new Error('unreachable');
    expect(result.result.inputRequests?.confirm).toBeDefined();
    // The digest must be of the summary the human sees, not of the label or
    // the arguments: the summary is the promise being made to them.
    expect(result.result.requestState).toBe(
      `${SEALED}:${summaryDigest('stop 12 running applications?')}`,
    );
  });

  it('does not ask when the pre-flight found nothing to do', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({}),
      'Stop everything',
      () => null,
      mint as never,
    );

    // Asking a human to confirm a no-op is how they learn the dialog is noise.
    expect(result.status).toBe('nothing-to-do');
  });

  it('requests a schema with no fields, so the answer cannot be forged upstream', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({}),
      'Stop everything',
      () => 'stop 12 running applications?',
      mint as never,
    );

    if (result.status !== 'ask') throw new Error('unreachable');
    const request = result.result.inputRequests?.confirm as {
      params: { requestedSchema: { properties: Record<string, unknown> } };
    };
    // A `confirm: true` property would be a value something upstream could
    // supply on the retry. The answer has to be the client's accept action, or
    // the confirmation is theatre — the evals already record a model issuing a
    // real restart 5 runs out of 5 while explicitly told not to.
    expect(request.params.requestedSchema.properties).toEqual({});
  });
});

describe('confirmDestructiveModern: round two', () => {
  const summary = 'stop 12 running applications?';
  const sealed = { digest: summaryDigest(summary) };

  it('approves when the human accepted and nothing moved', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'accept' } }, requestState: sealed }),
      'Stop everything',
      () => summary,
      mint as never,
    );

    expect(result.status).toBe('approved');
  });

  it('records a decline as a decline', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'decline' } }, requestState: sealed }),
      'Stop everything',
      () => summary,
      mint as never,
    );

    expect(result).toMatchObject({ status: 'refused', reason: 'declined' });
  });

  it('records a cancel as a cancel, not a decline', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'cancel' } }, requestState: sealed }),
      'Stop everything',
      () => summary,
      mint as never,
    );

    // Dismissing a dialog is not the same act as answering no, and #408 is
    // the whole argument for keeping those apart in the audit log.
    expect(result).toMatchObject({ status: 'refused', reason: 'cancelled' });
  });

  it('refuses when the blast radius grew between the question and the answer', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'accept' } }, requestState: sealed }),
      'Stop everything',
      () => 'stop 14 running applications?',
      mint as never,
    );

    // The approval described 12. Applying it to 14 is exactly the thing the
    // confirmation existed to prevent, and the handler re-runs `summarize()`
    // on re-entry, so this race is real rather than theoretical.
    expect(result).toMatchObject({ status: 'refused', reason: 'stale_confirmation' });
  });

  it('refuses an accept that arrives with no sealed state at all', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'accept' } } }),
      'Stop everything',
      () => summary,
      mint as never,
    );

    // Fail closed: an accept nobody can tie to a question this server asked is
    // not an approval.
    expect(result).toMatchObject({ status: 'refused', reason: 'stale_confirmation' });
  });

  it('refuses a response that is not an elicitation answer', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { roots: [] } }, requestState: sealed }),
      'Stop everything',
      () => summary,
      mint as never,
    );

    expect(result).toMatchObject({ status: 'refused', reason: 'unavailable' });
  });

  it('treats a no-op on re-entry as nothing to do rather than a stale approval', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'accept' } }, requestState: sealed }),
      'Stop everything',
      () => null,
      mint as never,
    );

    // The estate went idle while the human was reading. Running the no-op is
    // honest; refusing it as "stale" would be a confusing lie.
    expect(result.status).toBe('nothing-to-do');
  });
});

describe('confirmDestructiveModern: when the pre-flight lookup fails', () => {
  const boom = (): never => {
    throw new Error('Coolify unreachable');
  };

  it('still asks, with a degraded prompt that names the failure', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({}),
      'Stop everything',
      boom,
      mint as never,
    );

    // A human confirming a vaguer question beats an unconfirmed destructive
    // call, and a flaky Coolify is precisely when someone is clicking fast.
    expect(result.status).toBe('ask');
    if (result.status !== 'ask') throw new Error('unreachable');
    const request = result.result.inputRequests?.confirm as { params: { message: string } };
    expect(request.params.message).toContain('Stop everything');
    expect(request.params.message).toContain('Coolify unreachable');
  });

  it('accepts on the retry even though the lookup failed twice', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({
        inputResponses: { confirm: { action: 'accept' } },
        requestState: { digest: 'degraded' },
      }),
      'Stop everything',
      boom,
      mint as never,
    );

    // Digesting the error text would make "Coolify is still down" look like a
    // changed blast radius and refuse an approval the human already gave. The
    // sentinel keeps the degraded case answerable, exactly as the 2025 path is.
    expect(result.status).toBe('approved');
  });

  it('refuses a degraded approval once the estate is readable again', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({
        inputResponses: { confirm: { action: 'accept' } },
        requestState: { digest: 'degraded' },
      }),
      'Stop everything',
      () => 'stop 12 running applications?',
      mint as never,
    );

    // The human said yes to "I could not check". Now it can be checked, and
    // the answer is 12 applications they were never shown.
    expect(result).toMatchObject({ status: 'refused', reason: 'stale_confirmation' });
  });
});
