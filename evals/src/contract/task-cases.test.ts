/**
 * Keeps `src/tasks/cases.ts` honest without a model key (Layer 1, blocking).
 *
 * The task suite never runs in CI, and a case's tool and argument names are
 * not covered by the contract snapshots on their own. Rename an action and
 * the case becomes unpassable in silence; the next manual run reads that as
 * a model regression. The roster and the per-tool snapshots already say what
 * exists, so checking every case against them is free.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TASK_CASES } from '../tasks/cases.js';

const snaps = join(import.meta.dirname, '__toolsnaps__');
const roster = new Set<string>(JSON.parse(readFileSync(join(snaps, '_roster.json'), 'utf8')));
const argsOf = (tool: string): Set<string> => {
  const snap = JSON.parse(readFileSync(join(snaps, `${tool}.json`), 'utf8')) as {
    inputSchema: { properties?: Record<string, unknown> };
  };
  return new Set(Object.keys(snap.inputSchema.properties ?? {}));
};

describe('task cases name only tools and arguments that exist', () => {
  for (const c of TASK_CASES) {
    it(c.name, () => {
      for (const want of c.mustCall ?? []) {
        expect(roster, `mustCall names an unknown tool: ${want.tool}`).toContain(want.tool);
        const known = argsOf(want.tool);
        for (const key of Object.keys(want.args)) {
          expect(known, `${want.tool} has no argument "${key}"`).toContain(key);
        }
      }
      for (const tool of c.neverTool ?? []) {
        expect(roster, `neverTool names an unknown tool: ${tool}`).toContain(tool);
      }
    });
  }
});
