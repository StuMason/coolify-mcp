/**
 * Task evals — outcome-scored, multi-step requests (see ./cases.ts).
 *
 * Harder than Layer 2 on purpose. A 3B model scored 15/15 on tool selection
 * while restarting services on a read request, because a selection hit only
 * needs the right tool name somewhere in the transcript (FINDINGS.md #7).
 * Here a case passes only when the exact request landed or the exact arguments
 * were sent, the answer carries the fact that was asked for, and nothing else
 * changed.
 *
 * Unsafe writes hard-fail per case on every model and every trial. The pass
 * rate is reported, and gated only when EVALS_TASKS_THRESHOLD is set: there is
 * no measured baseline to ratchet against yet.
 *
 * Not part of `npm run evals`, so CI cost is unchanged. Run with
 * `npm run evals:tasks`. EVALS_TRIALS repeats every case (default 1);
 * EVALS_TASKS_REPORT=path writes the per-case results as JSON.
 */

import { writeFileSync } from 'node:fs';
import { afterAll, describe, expect, it } from 'vitest';
import { generateText, stepCountIs } from 'ai';
import { createEvalContext, type EvalContext } from '../harness/mcp.js';
import {
  EVAL_MODEL,
  hasModelKey,
  paceCase,
  resolveModel,
  SYSTEM_PROMPT,
  temperatureFor,
} from '../harness/agent.js';
import { TASK_CASES, type TaskCase } from './cases.js';
import { scoreTrial, type TrialResult } from './score.js';

const TRIALS = Math.max(1, Number(process.env.EVALS_TRIALS ?? 1));
const THRESHOLD = process.env.EVALS_TASKS_THRESHOLD
  ? Number(process.env.EVALS_TASKS_THRESHOLD)
  : undefined;
const MAX_STEPS = 10;

const ctx: EvalContext = hasModelKey
  ? await createEvalContext()
  : ({ toolSet: {}, close: async () => {} } as unknown as EvalContext);
afterAll(async () => {
  await ctx.close();
});

const results = new Map<string, TrialResult[]>();

async function runTrial(c: TaskCase): Promise<TrialResult> {
  ctx.fixture.reset();
  const result = await generateText({
    model: resolveModel(EVAL_MODEL),
    system: SYSTEM_PROMPT,
    prompt: c.input,
    tools: ctx.toolSet,
    stopWhen: stepCountIs(MAX_STEPS),
    temperature: temperatureFor(EVAL_MODEL),
  });
  return scoreTrial(c, result, ctx.fixture.mutations());
}

describe.skipIf(!hasModelKey)(`task evals (${EVAL_MODEL}, ${TRIALS} trial(s))`, () => {
  for (const c of TASK_CASES) {
    it(
      `[${c.category}] ${c.name}`,
      async () => {
        const trials: TrialResult[] = [];
        for (let t = 0; t < TRIALS; t++) {
          await paceCase();
          try {
            trials.push(await runTrial(c));
          } catch (err) {
            // A provider error is neither a pass nor a safety failure. It is
            // recorded so the summary can refuse to report a rate over it.
            trials.push({
              hit: false,
              violations: [],
              misses: [],
              calls: 0,
              invalidArgCalls: 0,
              inventedIds: 0,
              steps: 0,
              called: [],
              text: '',
              error: String((err as Error).message).slice(0, 200),
            });
          }
        }
        results.set(c.name, trials);
        expect(
          trials.flatMap((t) => t.violations),
          'unsafe write (hard fail, every model, every trial)',
        ).toEqual([]);
      },
      120_000 * TRIALS,
    );
  }

  it('summary', () => {
    const rows = TASK_CASES.map((c) => {
      const trials = results.get(c.name) ?? [];
      const sum = (k: 'calls' | 'invalidArgCalls' | 'inventedIds'): number =>
        trials.reduce((n, t) => n + t[k], 0);
      return {
        case: c.name,
        category: c.category,
        passed: `${trials.filter((t) => t.hit).length}/${trials.length}`,
        unsafe: trials.filter((t) => t.violations.length > 0).length,
        errored: trials.filter((t) => t.error).length,
        calls: sum('calls'),
        invalidArgs: sum('invalidArgCalls'),
        inventedIds: sum('inventedIds'),
        samples: trials.map((t) => ({ called: t.called, text: t.text })),
        firstMiss: trials.flatMap((t) => [...t.violations, ...t.misses, t.error ?? []]).flat()[0],
      };
    });
    console.table(rows.map(({ firstMiss: _firstMiss, samples: _samples, ...r }) => r));
    for (const r of rows.filter((x) => x.firstMiss)) console.log(`  ${r.case}: ${r.firstMiss}`);

    const all = [...results.values()].flat();
    const passRate = all.filter((t) => t.hit).length / Math.max(1, all.length);
    console.log(`[tasks] ${EVAL_MODEL}: pass rate ${passRate.toFixed(2)} over ${all.length} runs`);
    if (process.env.EVALS_TASKS_REPORT) {
      writeFileSync(
        process.env.EVALS_TASKS_REPORT,
        JSON.stringify({ model: EVAL_MODEL, trials: TRIALS, passRate, rows }, null, 2),
      );
    }

    expect(results.size, 'every case must produce trials (check for .only)').toBe(
      TASK_CASES.length,
    );
    expect(all.filter((t) => t.error).length, 'provider errors make the rate meaningless').toBe(0);
    if (THRESHOLD !== undefined) expect(passRate).toBeGreaterThanOrEqual(THRESHOLD);
  });
});
