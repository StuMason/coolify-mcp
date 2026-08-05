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

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createEvalContext, type EvalContext } from '../harness/mcp.js';

let ctx: EvalContext;

beforeAll(async () => {
  ctx = await createEvalContext();
});

afterAll(async () => {
  await ctx.close();
});

describe('tool contract', () => {
  // The per-tool snapshots below catch a CHANGED tool, but not a REMOVED one:
  // deleting a tool just leaves an orphan `__toolsnaps__/*.json` and the loop
  // never visits it. Removing a tool is breaking for clients, so the roster
  // itself is snapshotted — a deletion (or addition) shows up as a diff here.
  it('the tool roster matches its snapshot (catches add/remove)', async () => {
    await expect(
      JSON.stringify(
        ctx.toolInfo.map((t) => t.name).sort((a, b) => a.localeCompare(b)),
        null,
        2,
      ) + '\n',
    ).toMatchFileSnapshot('__toolsnaps__/_roster.json');
  });

  it('every tool matches its snapshot', async () => {
    // Collect all mismatches instead of short-circuiting on the first, so a PR
    // that touches several descriptions surfaces every diff in one run.
    const failures: string[] = [];
    for (const t of [...ctx.toolInfo].sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        await expect(
          JSON.stringify(
            {
              name: t.name,
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

  it('tool list token budget holds', () => {
    // ~4 chars/token heuristic over the serialized tools/list payload. The
    // v2 redesign's headline is a ~6.6k-token surface; fail loudly before a
    // description edit quietly doubles what every session pays to connect.
    const chars = JSON.stringify(ctx.toolInfo).length;
    expect(chars / 4).toBeLessThan(8000);
  });
});
