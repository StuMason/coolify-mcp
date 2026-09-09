import { describe, expect, it } from '@jest/globals';
import { buildInstructions } from '../lib/instructions.js';
import { TESTED_RANGE } from '../lib/doctor.js';

const single = buildInstructions({ fleet: false, defaultInstance: 'default', readonly: false });
const fleet = buildInstructions({ fleet: true, defaultInstance: 'prod', readonly: false });
const readonly = buildInstructions({ fleet: false, defaultInstance: 'default', readonly: true });

describe('buildInstructions', () => {
  it('states the tested Coolify range from the same constant doctor uses', () => {
    expect(single).toContain(TESTED_RANGE.label);
  });

  it('describes the safety boundary unless the surface is read-only', () => {
    expect(single).toMatch(/ask the person in their own client/);
    expect(readonly).toMatch(/read-only mode/);
    expect(readonly).not.toMatch(/ask the person/);
  });

  it('mentions `instance` and the default only in fleet mode', () => {
    expect(fleet).toContain('`instance`');
    expect(fleet).toContain('"prod"');
    expect(single).not.toContain('`instance`');
    expect(single).not.toContain('list_instances');
  });

  it('stays inside its token budget in every mode', () => {
    // Same ~4 chars/token heuristic as the tools/list budget in evals.
    for (const text of [single, fleet, readonly]) {
      expect(text.length / 4).toBeLessThan(600);
    }
  });

  it('is orientation, not behavioural direction', () => {
    // Directory review: describe the surface, do not instruct the model.
    for (const text of [single, fleet, readonly]) {
      expect(text).not.toMatch(
        /\b(you must|you should|always (call|use)|never (call|use)|do not (call|use))\b/i,
      );
    }
  });
});
