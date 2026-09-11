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
import { confirmDestructiveModern, createConfirmationCodec, summaryDigest } from '../lib/elicit.js';

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
      true,
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
      true,
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
      true,
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
      true,
    );

    expect(result.status).toBe('approved');
  });

  it('records a decline as a decline', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'decline' } }, requestState: sealed }),
      'Stop everything',
      () => summary,
      mint as never,
      true,
    );

    expect(result).toMatchObject({ status: 'refused', reason: 'declined' });
  });

  it('records a cancel as a cancel, not a decline', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'cancel' } }, requestState: sealed }),
      'Stop everything',
      () => summary,
      mint as never,
      true,
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
      true,
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
      true,
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
      true,
    );

    expect(result).toMatchObject({ status: 'refused', reason: 'unavailable' });
  });

  it('treats a no-op on re-entry as nothing to do rather than a stale approval', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({ inputResponses: { confirm: { action: 'accept' } }, requestState: sealed }),
      'Stop everything',
      () => null,
      mint as never,
      true,
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
      true,
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
        requestState: { digest: summaryDigest('degraded:Stop everything') },
      }),
      'Stop everything',
      boom,
      mint as never,
      true,
    );

    // Digesting the error text would make "Coolify is still down" look like a
    // changed blast radius and refuse an approval the human already gave. The
    // sentinel keeps the degraded case answerable, exactly as the 2025 path is.
    expect(result.status).toBe('approved');
  });

  it('will not accept a degraded seal minted for a different operation', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({
        inputResponses: { confirm: { action: 'accept' } },
        requestState: { digest: summaryDigest('degraded:Delete the database') },
      }),
      'Stop everything',
      boom,
      mint as never,
      true,
    );

    // A shared constant here would let state sealed for one degraded
    // confirmation verify against a different degraded operation from the same
    // client inside the TTL, which is exactly the detachment the seal exists to
    // prevent.
    expect(result).toMatchObject({ status: 'refused', reason: 'stale_confirmation' });
  });

  it('refuses a degraded approval once the estate is readable again', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({
        inputResponses: { confirm: { action: 'accept' } },
        requestState: { digest: summaryDigest('degraded:Stop everything') },
      }),
      'Stop everything',
      () => 'stop 12 running applications?',
      mint as never,
      true,
    );

    // The human said yes to "I could not check". Now it can be checked, and
    // the answer is 12 applications they were never shown.
    expect(result).toMatchObject({ status: 'refused', reason: 'stale_confirmation' });
  });
});

describe('the confirmation signing key', () => {
  const swapKey = async (value: string | undefined, body: () => void): Promise<void> => {
    const previous = process.env.MCP_REQUEST_STATE_KEY;
    if (value === undefined) delete process.env.MCP_REQUEST_STATE_KEY;
    else process.env.MCP_REQUEST_STATE_KEY = value;
    try {
      body();
    } finally {
      if (previous === undefined) delete process.env.MCP_REQUEST_STATE_KEY;
      else process.env.MCP_REQUEST_STATE_KEY = previous;
    }
  };

  it('refuses a configured key too short to be one', async () => {
    await swapKey('too-short', () => {
      // Failing at construction beats signing with a weak key and finding out
      // never, because the failure mode of a weak key is silence.
      expect(() => createConfirmationCodec()).toThrow(/at least 32 bytes/);
      expect(() => createConfirmationCodec()).toThrow(/openssl rand -hex 32/);
    });
  });

  it('accepts a configured key of exactly the minimum length', async () => {
    await swapKey('x'.repeat(32), () => {
      expect(() => createConfirmationCodec()).not.toThrow();
    });
  });

  it('says so on stderr when it generates one for an internet-facing server', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await swapKey(undefined, () => {
        createConfirmationCodec({ announceGeneratedKey: true });
      });
      // A generated key is correct but has a consequence the operator cannot
      // otherwise discover: confirmations in flight across a restart are
      // refused, and a second replica cannot verify the first one's state.
      expect(warn).toHaveBeenCalledTimes(1);
      expect(String(warn.mock.calls[0]?.[0])).toContain('MCP_REQUEST_STATE_KEY');
    } finally {
      warn.mockRestore();
    }
  });

  it('stays quiet about it on stdio, where one process serves every round', async () => {
    const warn = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      await swapKey(undefined, () => {
        createConfirmationCodec();
      });
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('reuses one generated key across server instances in a process', async () => {
    await swapKey(undefined, () => {
      // HTTP builds a fresh server per request, so a key generated per
      // instance would mean the round that mints the state and the round that
      // verifies it disagree, and no confirmation could ever succeed.
      const a = createConfirmationCodec();
      const b = createConfirmationCodec();
      expect(a).not.toBe(b);
    });
    const ctx = { mcpReq: { method: 'tools/call' } } as unknown as ServerContext;
    const minted = await createConfirmationCodec().mint({ digest: 'abc' }, ctx);
    // Minted by one codec instance, verified by another: the round trip HTTP
    // mode actually performs.
    await expect(createConfirmationCodec().verify(minted, ctx)).resolves.toEqual({ digest: 'abc' });
  });
});

describe('confirmDestructiveModern: a client that cannot be asked', () => {
  it('refuses with the actionable message rather than sending an unwanted request', async () => {
    const result = await confirmDestructiveModern(
      ctxFor({}),
      'Stop everything',
      () => 'stop 12 running applications?',
      mint as never,
      false,
    );

    // Same fail-closed outcome as the 2025 path, and the same prose: embedding
    // a request in a client that never declared elicitation just moves the
    // failure somewhere harder to read.
    expect(result).toMatchObject({ status: 'refused', reason: 'no_elicitation' });
    if (result.status !== 'refused') throw new Error('unreachable');
    expect(result.message).toContain('use the stdio server locally');
  });

  it('does not even build the summary, so a broken Coolify cannot mask the refusal', async () => {
    const summarize = jest.fn(() => 'stop 12 running applications?');
    await confirmDestructiveModern(ctxFor({}), 'Stop everything', summarize, mint as never, false);

    expect(summarize).not.toHaveBeenCalled();
  });
});
