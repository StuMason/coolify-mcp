/**
 * The fixture must let a `deploy` with `wait: true` finish. The tool polls
 * `GET /deployments/<uuid>` for the deployment it was just given until the
 * status is terminal; a fixture that mints an id it never serves keeps that
 * poll going for the tool's full 300s, past the task-case timeout, and the
 * summary then fails on a short results table with a misleading message.
 * No model involved: this drives the real server against the fixture.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvalContext, type EvalContext } from '../harness/mcp.js';

let ctx: EvalContext;
beforeAll(async () => {
  ctx = await createEvalContext();
});
afterAll(async () => {
  await ctx.close();
});

describe('fixture deployments', () => {
  it('serves the deployment that POST /deploy mints, already finished', async () => {
    const started = Date.now();
    const out = await ctx.toolSet.deploy!.execute!(
      { tag_or_uuid: 'app-shop', wait: true, timeout_seconds: 60 },
      { toolCallId: 'deploy-wait', messages: [] },
    );
    const text = String(out);
    expect(text).toContain('dep-new-1');
    expect(text).toContain('finished');
    expect(Date.now() - started).toBeLessThan(15_000);
  });
});
