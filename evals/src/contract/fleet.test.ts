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
      COOLIFY_INSTANCES: JSON.stringify([
        { name: 'staging', url: fixture.url, token: FIXTURE_TOKEN },
      ]),
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

  it('every instance-scoped tool takes an optional string `instance`', () => {
    // list_instances is about the fleet, not an instance of it — no argument.
    const missing = ctx.toolInfo
      .filter((t) => t.name !== 'list_instances')
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

  it('the fleet instructions match their snapshot (#339)', async () => {
    expect(ctx.instructions).toContain('`instance`');
    await expect(ctx.instructions + '\n').toMatchFileSnapshot(
      '__toolsnaps__/_instructions.fleet.txt',
    );
  });

  it('fleet tool list token budget holds', () => {
    // The fleet surface costs ~46 copies of the `instance` property on top of
    // the single-instance ~7.7k. Fleet users opt into that; the single-instance
    // gate in toolsnaps.test.ts is the one that protects everyone else.
    const chars = JSON.stringify(ctx.toolInfo).length;
    expect(chars / 4).toBeLessThan(9000);
  });
});

describe('fleet prompt and resource contract (#371)', () => {
  it('the fleet prompt list matches its snapshot', async () => {
    await expect(
      JSON.stringify(
        [...ctx.promptInfo].sort((a, b) => byName(a.name, b.name)),
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('__toolsnaps__/_prompts.fleet.json');
  });

  it('every prompt takes an optional `instance`, exactly as the tools do', () => {
    const missing = ctx.promptInfo
      .filter((p) => !(p.arguments ?? []).some((arg) => arg.name === 'instance'))
      .map((p) => p.name);
    expect(missing).toEqual([]);
    // Optional, never required: an omitted instance means the default here as
    // it does everywhere else, so a fleet does not make the common case worse.
    const required = ctx.promptInfo
      .filter((p) => (p.arguments ?? []).some((a) => a.name === 'instance' && a.required === true))
      .map((p) => p.name);
    expect(required).toEqual([]);
  });

  it('a prompt written for one instance names that instance in its text', async () => {
    const { messages } = await ctx.client.getPrompt({
      name: 'estate_health',
      arguments: { instance: 'staging' },
    });
    const text = messages.map((m) => (m.content.type === 'text' ? m.content.text : '')).join('\n');
    // Not decoration: a prompt makes no API call, so writing the instance into
    // the tool calls it asks for is the ONLY thing that routes the work the
    // model then does to the instance the human picked.
    expect(text).toContain('instance: "staging"');
    // And it says which instance it did not cover, so "estate" is not silently
    // read as "the whole fleet".
    expect(text).toContain('"default"');
  });

  it('an unknown instance fails the prompt loudly rather than answering for the default', async () => {
    await expect(
      ctx.client.getPrompt({ name: 'estate_health', arguments: { instance: 'stagng' } }),
    ).rejects.toThrow(/Unknown instance/);
  });

  it('the fleet resource list matches its snapshot', async () => {
    await expect(
      JSON.stringify(
        {
          resources: [...ctx.resourceInfo].sort((a, b) => byName(a.uri, b.uri)),
          templates: [...ctx.resourceTemplateInfo].sort((a, b) =>
            byName(a.uriTemplate, b.uriTemplate),
          ),
        },
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('__toolsnaps__/_resources.fleet.json');
  });

  it('every resource URI names its instance', () => {
    // The failure this prevents: reading prod's overview while believing it is
    // staging's. With more than one instance configured there is no unscoped
    // URI to get that wrong with.
    const uris = [
      ...ctx.resourceInfo.map((r) => r.uri),
      ...ctx.resourceTemplateInfo.map((r) => r.uriTemplate),
    ];
    expect(uris).not.toHaveLength(0);
    const unscoped = uris.filter((uri) => /^coolify:\/\/(overview|application)/.test(uri));
    expect(unscoped).toEqual([]);
  });

  it('reading an instance-scoped resource returns that instance', async () => {
    const read = await ctx.client.readResource({ uri: 'coolify://staging/overview' });
    const parsed = JSON.parse((read.contents[0] as { text: string }).text) as {
      summary: Record<string, number>;
    };
    expect(parsed.summary.applications).toBeGreaterThan(0);
  });

  it('an application URI reads the instance it names', async () => {
    // The one resource path where a routing mistake serves production's
    // configuration under a staging URI. Both instances point at the same
    // fixture here, so the assertion is that the scoped URI resolves and
    // returns that application rather than erroring or returning a list.
    const read = await ctx.client.readResource({
      uri: 'coolify://staging/application/app-api',
    });
    const parsed = JSON.parse((read.contents[0] as { text: string }).text) as { uuid?: string };
    expect(parsed.uuid).toBe('app-api');
  });

  it('an application URI with no uuid is an error, not the whole application list', async () => {
    // `GET /applications/` is Laravel's index route, so an empty uuid would
    // return every application under a URI claiming exactly one.
    await expect(
      ctx.client.readResource({ uri: 'coolify://staging/application/' }),
    ).rejects.toThrow();
  });

  it('an unknown instance in a URI is an error, not the default instance', async () => {
    await expect(ctx.client.readResource({ uri: 'coolify://stagng/overview' })).rejects.toThrow(
      /Unknown instance/,
    );
  });
});
