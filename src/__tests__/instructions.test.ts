import { describe, expect, it } from '@jest/globals';
import { buildInstructions } from '../lib/instructions.js';
import { TESTED_RANGE } from '../lib/tested-range.js';
import { TOOL_ANNOTATIONS } from '../lib/mcp-server.js';

const base = {
  fleet: false,
  defaultInstance: 'default',
  readonly: false,
  requireElicitation: false,
};
const single = buildInstructions(base);
const fleet = buildInstructions({ ...base, fleet: true, defaultInstance: 'prod' });
const readonly = buildInstructions({ ...base, readonly: true, requireElicitation: true });
const http = buildInstructions({ ...base, requireElicitation: true });
const all = { single, fleet, readonly, http };

describe('buildInstructions', () => {
  it('states the tested Coolify range from the shared constant', () => {
    expect(single).toContain(TESTED_RANGE.label);
  });

  it('describes the confirmation boundary as it actually behaves per mode', () => {
    // stdio default: elicitation is progressive enhancement, so say what
    // happens without it rather than promise a person is always asked.
    expect(single).toMatch(/in clients that support elicitation/);
    expect(single).toMatch(/run unconfirmed/);
    // HTTP: fail closed.
    expect(http).toMatch(/refused with a message/);
    expect(http).not.toMatch(/run unconfirmed/);
    // Read-only: no write boundary to describe.
    expect(readonly).toMatch(/read-only mode/);
    expect(readonly).not.toMatch(/Destructive actions/);
  });

  it('keeps the masking paragraph in every mode, read-only included', () => {
    for (const text of Object.values(all)) {
      expect(text).toMatch(/Secrets are masked/);
      expect(text).toContain('`reveal: true`');
    }
  });

  it('mentions `instance` and the default only in fleet mode', () => {
    expect(fleet).toContain('except `list_instances`');
    expect(fleet).toContain('"prod"');
    expect(single).not.toContain('`instance`');
    expect(single).not.toContain('list_instances');
  });

  it('names only tools that exist', () => {
    // A rename must not leave the text confidently citing a dead tool.
    const known = new Set(Object.keys(TOOL_ANNOTATIONS));
    const arguments_ = new Set(['action', 'instance', 'key']);
    for (const text of Object.values(all)) {
      const cited = [...text.matchAll(/`([a-z][a-z0-9_]+)`/g)].map((m) => m[1]);
      const unknown = cited.filter((n) => !known.has(n) && !arguments_.has(n));
      expect(unknown).toEqual([]);
    }
  });

  it('stays inside its token budget in every mode', () => {
    // Same ~4 chars/token heuristic as the tools/list budget in evals.
    for (const text of Object.values(all)) {
      expect(text.length / 4).toBeLessThan(600);
    }
  });

  it('is orientation, not behavioural direction', () => {
    // Directory review: describe the surface, do not instruct the model.
    for (const text of Object.values(all)) {
      expect(text).not.toMatch(
        /\b(you must|you should|always (call|use)|never (call|use)|do not (call|use))\b/i,
      );
    }
  });

  it('matches its snapshot in every mode, so an edit shows up in review', () => {
    // evals/ snapshots the single and fleet texts over the wire; the
    // read-only and HTTP variants have no harness there, so they live here.
    expect(all).toMatchSnapshot();
  });
});
