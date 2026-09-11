/**
 * Layer 1 — tool contract snapshots ("toolsnaps", after github-mcp-server's
 * pattern of the same name).
 *
 * The tool list IS the prompt: names, descriptions and schemas are what a
 * model reads before choosing a tool. Any edit to them changes model
 * behaviour, so any edit must show up in review as a snapshot diff, not ride
 * along invisibly inside a code change.
 *
 * Deterministic — no model, no API key. Runs on every PR.
 * Regenerate intentionally with: npm run snapshots:update
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { FIXTURE_WEBHOOK_SECRET } from '../fixture/data.js';
import { createEvalContext, type EvalContext } from '../harness/mcp.js';

let ctx: EvalContext;

beforeAll(async () => {
  ctx = await createEvalContext();
});

afterAll(async () => {
  await ctx.close();
});

// Codepoint compare, NOT localeCompare: ICU collation is locale/environment
// dependent and at primary strength treats `_` as ignorable, so tool names like
// get_server / github_apps can sort differently on a contributor's machine than
// on the CI runner — a phantom `_roster.json` diff on the check that gates
// merge. This is deterministic everywhere.
const byName = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The tool-list token figure as README.md states it to the public.
 *
 * Throws rather than defaulting: if the sentence is reworded, this must fail
 * loudly and be repointed, not silently fall back to a number of its own and
 * start the drift again.
 */
function publishedTokenFigure(): number {
  const readme = readFileSync(
    fileURLToPath(new URL('../../../README.md', import.meta.url)),
    'utf8',
  );
  const match = readme.match(/tool list costs about ([\d,]+) tokens/);
  if (!match) {
    throw new Error(
      'README.md no longer states the tool list token figure in the expected form ' +
        '("the whole tool list costs about N tokens"). The budget gate derives its ' +
        'ceiling from that sentence — repoint this matcher rather than hardcoding a number.',
    );
  }
  return Number(match[1].replace(/,/g, ''));
}

/**
 * Backticked tokens in prompt text that are deliberately NOT tool names.
 *
 * The "names only real tools" check below flags every backticked token that is
 * not a registered tool, so it fails closed: a prompt naming a tool that does
 * not exist is caught by default. Prompt prose also backticks argument names,
 * and those need listing here — which is the safer direction to be wrong in,
 * because forgetting to list an argument fails loudly while forgetting to list
 * a tool used to pass silently.
 */
const NOT_A_TOOL = new Set(['lines', 'page', 'instance']);

describe('tool contract', () => {
  // The per-tool snapshots below catch a CHANGED tool, but not a REMOVED one:
  // deleting a tool just leaves an orphan `__toolsnaps__/*.json` and the loop
  // never visits it. Removing a tool is breaking for clients, so the roster
  // itself is snapshotted — a deletion (or addition) shows up as a diff here.
  it('the tool roster matches its snapshot (catches add/remove)', async () => {
    await expect(
      JSON.stringify(ctx.toolInfo.map((t) => t.name).sort(byName), null, 2) + '\n',
    ).toMatchFileSnapshot('__toolsnaps__/_roster.json');
  });

  it('every tool matches its snapshot', async () => {
    // Collect all mismatches instead of short-circuiting on the first, so a PR
    // that touches several descriptions surfaces every diff in one run.
    const failures: string[] = [];
    for (const t of [...ctx.toolInfo].sort((a, b) => byName(a.name, b.name))) {
      try {
        await expect(
          JSON.stringify(
            {
              name: t.name,
              // Display label, not model-facing text, but it still ships on
              // every tools/list and still costs tokens — so it belongs in the
              // snapshot like everything else a client receives.
              title: t.title,
              description: t.description,
              annotations: t.annotations,
              inputSchema: t.inputSchema,
            },
            null,
            2,
          ) + '\n',
        ).toMatchFileSnapshot(`__toolsnaps__/${t.name}.json`);
      } catch (e) {
        failures.push(`${t.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    expect(failures, `tool contract drift:\n${failures.join('\n')}`).toEqual([]);
  });

  it('the safety classification is complete: every tool declares read-only or a destructive stance', () => {
    const unclassified = ctx.toolInfo
      .filter(
        (t) => t.annotations?.readOnlyHint !== true && t.annotations?.destructiveHint === undefined,
      )
      .map((t) => t.name);
    expect(unclassified).toEqual([]);
  });

  it('the server instructions match their snapshot (#339)', async () => {
    // What Claude Code reads before any tool definition. Same rule as the
    // tools: an edit must show up in review as a snapshot diff.
    expect(ctx.instructions).toBeDefined();
    await expect(ctx.instructions + '\n').toMatchFileSnapshot('__toolsnaps__/_instructions.txt');
  });

  it('instructions token budget holds', () => {
    expect((ctx.instructions ?? '').length / 4).toBeLessThan(600);
  });

  it('tool list token budget holds', () => {
    // ~4 chars/token heuristic over the serialized tools/list payload, which
    // is what every session pays on connect.
    //
    // The ceiling is DERIVED from the figure README.md publishes, rather than
    // being a second number someone has to remember to move. A hardcoded
    // ceiling is what failed before: it sat ~1,400 tokens above the published
    // figure, so the surface grew through 3.x, tripped nothing, and the docs
    // went stale unnoticed.
    //
    // Bounded on both sides on purpose. Growing past the published figure
    // fails, and so does inflating the published figure to buy headroom the
    // payload does not need — otherwise the cheap fix for a red build is to
    // edit the README, which is the drift this is here to stop.
    const published = publishedTokenFigure();
    const measured = JSON.stringify(ctx.toolInfo).length / 4;
    expect(measured).toBeLessThan(published * 1.02);
    expect(measured).toBeGreaterThan(published * 0.95);
  });
});

/**
 * Layer 1, prompts and resources (#371).
 *
 * Same argument as the tool contract: `prompts/list` and `resources/list` are
 * read by a client and, for prompts, by the human picking a slash command.
 * They are the product surface, so a change to them belongs in review as a
 * snapshot diff.
 */
describe('prompt contract', () => {
  it('the prompt list matches its snapshot', async () => {
    await expect(
      JSON.stringify(
        [...ctx.promptInfo].sort((a, b) => byName(a.name, b.name)),
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('__toolsnaps__/_prompts.json');
  });

  it('every prompt names only tools this server actually registered', async () => {
    // The whole reason `definePrompt` takes `requires` and the builders take
    // `has()`. A prompt that walks the model to a tool which is not registered
    // is worse than no prompt, and read-only mode (#303) plus consolidation
    // make "which tools exist" a per-mode fact rather than a constant.
    const registered = new Set(ctx.toolInfo.map((t) => t.name));
    const offenders: string[] = [];
    for (const prompt of ctx.promptInfo) {
      const args = Object.fromEntries(
        (prompt.arguments ?? []).map((arg) => [arg.name, `fixture-${arg.name}`]),
      );
      const { messages } = await ctx.client.getPrompt({ name: prompt.name, arguments: args });
      const text = messages
        .map((m) => (m.content.type === 'text' ? m.content.text : ''))
        .join('\n');
      // Tools are named in backticks throughout the prompt text, which is what
      // makes this checkable rather than a guess at prose. Anything backticked
      // that is neither a registered tool nor a known argument name is a
      // finding, so the check fails closed on a tool that does not exist.
      for (const [, named] of text.matchAll(/`([a-z_]+)`/g)) {
        if (!registered.has(named) && !NOT_A_TOOL.has(named)) {
          offenders.push(`${prompt.name} names \`${named}\``);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('prompt list token budget holds', () => {
    // Its own budget, deliberately separate from the tools'. Prompts are a
    // much smaller surface and should stay one.
    expect(JSON.stringify(ctx.promptInfo).length / 4).toBeLessThan(400);
  });
});

describe('resource contract', () => {
  it('the resource list matches its snapshot', async () => {
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
    ).toMatchFileSnapshot('__toolsnaps__/_resources.json');
  });

  it('no two listed resources share a display title', async () => {
    // `title` takes precedence over `name` in clients that implement it, so a
    // shared title renders an estate of applications as N identical rows —
    // which defeats the reason the listing makes API calls at all.
    const titles = ctx.resourceInfo.map((r) => r.title ?? r.name);
    expect(titles).toEqual([...new Set(titles)]);
  });

  it('reading an application resource returns exactly what get_application returns', async () => {
    // The masking eval #371 asks for. Resource reads go through CoolifyClient,
    // so the central sanitizer applies — but "so it should be fine" is not a
    // test. Byte equality with the tool is, and it holds whatever the field
    // list grows into, because both sides read the same sanitized payload.
    const uuid = 'app-api';
    const viaResource = await ctx.client.readResource({
      uri: `coolify://application/${uuid}`,
    });
    const viaTool = await ctx.client.callTool({
      name: 'get_application',
      arguments: { uuid },
    });
    const resourceText = (viaResource.contents[0] as { text: string }).text;
    const toolText = (viaTool.content as Array<{ text: string }>)[0].text;
    // The tool wraps its payload with `_actions` — next-call affordances for a
    // model mid-tool-loop. A resource is an attachment, not a turn in that
    // loop, so it carries the payload bare. The payload itself must match
    // exactly, which is the masking claim under test.
    const toolPayload = JSON.parse(toolText) as { data?: unknown };
    expect(JSON.parse(resourceText)).toEqual(toolPayload.data);
  });

  it('an application resource never carries a plaintext credential', async () => {
    // The paired positive: equality above would also pass if BOTH leaked. The
    // fixture app carries a webhook secret precisely so this can fail.
    const read = await ctx.client.readResource({ uri: 'coolify://application/app-api' });
    const text = (read.contents[0] as { text: string }).text;
    expect(text).toContain('manual_webhook_secret_github');
    expect(text).not.toContain(FIXTURE_WEBHOOK_SECRET);
    expect(JSON.parse(text).manual_webhook_secret_github).toBe('***');
  });

  it('there is no way to ask a resource for plaintext', () => {
    // A resource URI is a durable handle a client may cache, re-read or paste,
    // which is the last place to put an opt-in to secrets. `get_application`
    // has `reveal` because a caller justifies it in the moment; no URI here
    // takes one, and that asymmetry is deliberate rather than an oversight.
    const uris = [
      ...ctx.resourceInfo.map((r) => r.uri),
      ...ctx.resourceTemplateInfo.map((r) => r.uriTemplate),
    ];
    expect(uris.filter((uri) => /reveal/i.test(uri))).toEqual([]);
  });
});
