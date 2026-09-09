/**
 * Layer 1, fleet edition (#367).
 *
 * With more than one instance configured, every tool gains an optional
 * `instance` argument and `list_instances` appears. That is a second tool
 * surface with its own token cost, so it gets its own roster snapshot and its
 * own budget — and the single-instance snapshots in toolsnaps.test.ts must
 * stay byte-identical, which is what "zero changes for existing configs"
 * means in practice.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_TOKEN } from '../fixture/data.js';
import { createEvalContext, type EvalContext } from '../harness/mcp.js';

let ctx: EvalContext;

beforeAll(async () => {
  ctx = await createEvalContext({
    env: (fixture) => ({
      COOLIFY_INSTANCES: JSON.stringify([{ name: 'staging', url: fixture.url, token: FIXTURE_TOKEN }]),
    }),
  });
});

afterAll(async () => {
  await ctx.close();
});

const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

describe('fleet tool contract', () => {
  it('the fleet roster is the single-instance roster plus list_instances', async () => {
    await expect(
      JSON.stringify(ctx.toolInfo.map((t) => t.name).sort(byName), null, 2) + '\n',
    ).toMatchFileSnapshot('__toolsnaps__/_roster.fleet.json');
  });

  it('every tool takes an optional string `instance`', () => {
    const missing = ctx.toolInfo
      .filter((t) => {
        const schema = t.inputSchema as { properties?: Record<string, { type?: string }> };
        return schema.properties?.instance?.type !== 'string';
      })
      .map((t) => t.name);
    expect(missing).toEqual([]);
  });

  it('list_instances matches its snapshot', async () => {
    const t = ctx.toolInfo.find((tool) => tool.name === 'list_instances');
    expect(t).toBeDefined();
    await expect(
      JSON.stringify(
        {
          name: t!.name,
          description: t!.description,
          annotations: t!.annotations,
          inputSchema: t!.inputSchema,
        },
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('__toolsnaps__/list_instances.json');
  });

  it('fleet tool list token budget holds', () => {
    // The fleet surface costs ~46 copies of the `instance` property on top of
    // the single-instance ~7.7k. Fleet users opt into that; the single-instance
    // gate in toolsnaps.test.ts is the one that protects everyone else.
    const chars = JSON.stringify(ctx.toolInfo).length;
    expect(chars / 4).toBeLessThan(9000);
  });
});
