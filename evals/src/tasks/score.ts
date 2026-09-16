/**
 * Per-trial scoring for the task suite, kept pure and exported so any runner
 * (this suite, or an out-of-repo run against another provider) scores a
 * transcript exactly the same way. It reads only what the model did and what
 * reached the fixture; it never calls a model.
 */

import {
  APP_ENVS,
  APPLICATIONS,
  DATABASES,
  DEPLOYMENTS,
  PRIVATE_KEYS,
  PROJECTS,
  SERVERS,
  SERVICES,
} from '../fixture/data.js';
import type { RecordedRequest } from '../fixture/server.js';
import { TOLERATED_MUTATION } from '../harness/scoring.js';
import type { TaskCase } from './cases.js';

/** Every id the fixture serves. An id-shaped argument outside this set was invented. */
export const KNOWN_IDS = new Set<string>([
  ...SERVERS.map((s) => s.uuid),
  ...PROJECTS.flatMap((p) => [p.uuid, ...p.environments.map((e) => e.uuid)]),
  ...APPLICATIONS.map((a) => a.uuid),
  ...DATABASES.map((d) => d.uuid),
  ...SERVICES.map((s) => s.uuid),
  ...DEPLOYMENTS.map((d) => d.deployment_uuid),
  ...Object.values(APP_ENVS).flatMap((rows) => rows.map((r) => (r as { uuid: string }).uuid)),
  ...PRIVATE_KEYS.map((k) => k.uuid),
  'dest-coolify',
  // Minted by the fixture's mutation handlers. A model that chains a deploy
  // into `deployment get` is using an id it was given, not inventing one.
  'dep-new-1',
  'fixture-created',
]);

/**
 * Arguments that carry an id. `tag_or_uuid` is here because the deploy
 * case's signature failure is a name passed where an id belongs, which is
 * the one thing this counter exists to count. Array-valued id arguments
 * (`app_uuids`) are counted per element.
 */
export const ID_ARGS = [
  'uuid',
  'project_uuid',
  'app_uuid',
  'app_uuids',
  'server_uuid',
  'environment_uuid',
  'env_uuid',
  'tag_or_uuid',
];

/** Every id-shaped value among a call's arguments, one entry per id. */
export const idValues = (args: Record<string, unknown>): string[] =>
  ID_ARGS.flatMap((k) => {
    const v = args[k];
    if (typeof v === 'string') return [v];
    if (Array.isArray(v)) return v.filter((x): x is string => typeof x === 'string');
    return [];
  });

/**
 * EVALS_TRIALS, parsed loudly. `Math.max(1, Number('three'))` is NaN, and a
 * NaN trial count runs zero trials: every per-case assertion passes on an
 * empty array and the summary reports a clean run having called no model.
 */
export function parseTrials(raw: string | undefined): number {
  if (raw === undefined || raw === '') return 1;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`EVALS_TRIALS must be a whole number of at least 1, got "${raw}"`);
  }
  return n;
}

/** EVALS_TASKS_THRESHOLD, parsed loudly for the same reason; unset means no gate. */
export function parseThreshold(raw: string | undefined): number | undefined {
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  if (Number.isNaN(n) || n < 0 || n > 1) {
    throw new Error(`EVALS_TASKS_THRESHOLD must be a number from 0 to 1, got "${raw}"`);
  }
  return n;
}

export interface TrialResult {
  hit: boolean;
  violations: string[];
  misses: string[];
  calls: number;
  invalidArgCalls: number;
  inventedIds: number;
  steps: number;
  /** Audit trail for the JSON report: what was called, and how the reply began. */
  called: string[];
  text: string;
  error?: string;
}

/** The slice of an AI SDK `generateText` result that scoring needs. */
export interface TrialRun {
  steps: Array<{
    toolCalls: Array<{ toolName: string; input: unknown }>;
    toolResults: Array<{ output: unknown }>;
    /**
     * The step's content parts. A tool whose execute() threw is a
     * `tool-error` part here and is absent from `toolResults`, which is
     * where a schema-invalid call ends up: the server rejects it as a
     * protocol error, the harness lets that throw, and the AI SDK files it
     * as an error, not a result.
     */
    content?: Array<{ type: string; error?: unknown }>;
  }>;
  text: string;
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Models write typographic punctuation: "api-gateway" with a non-breaking hyphen
 * (U+2011), "couldn't" with a curly apostrophe (U+2019). Fold those to ASCII
 * before matching, so a correct answer is never scored a miss over a glyph.
 * Surfaced by gpt-oss-20b and Granite naming the unhealthy app correctly and
 * missing.
 */
export const normaliseReply = (text: string): string =>
  text
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u00a0\u202f]/g, ' ');

export function scoreTrial(c: TaskCase, run: TrialRun, recorded: RecordedRequest[]): TrialResult {
  const calls = run.steps.flatMap((s) => s.toolCalls);
  const toolErrors = run.steps
    .flatMap((s) => s.content ?? [])
    .filter((part) => part.type === 'tool-error')
    .map((part) => {
      const error = part.error;
      return error instanceof Error ? error.message : String(error);
    });
  const mutations = recorded.filter((m) => !TOLERATED_MUTATION.test(m.path));
  const misses: string[] = [];
  const violations: string[] = [];

  const unmatched = [...mutations];
  for (const want of c.mustLand ?? []) {
    const i = unmatched.findIndex(
      (m) =>
        want.method.test(m.method) &&
        want.path.test(m.path) &&
        (want.body ?? []).every((re) => re.test(m.body)),
    );
    if (i === -1) misses.push(`no ${want.method.source} ${want.path.source} landed`);
    else unmatched.splice(i, 1);
  }

  for (const want of c.mustCall ?? []) {
    const ok = calls.some((call) => {
      const args = (call.input ?? {}) as Record<string, unknown>;
      return (
        call.toolName === want.tool &&
        Object.entries(want.args).every(([k, v]) => sameValue(args[k], v))
      );
    });
    if (!ok) misses.push(`no ${want.tool} call with ${JSON.stringify(want.args)}`);
  }

  const reply = normaliseReply(run.text);
  for (const re of c.answer ?? []) {
    if (!re.test(reply)) misses.push(`answer does not match ${re}`);
  }

  if (unmatched.length > 0) {
    const what = unmatched.map((m) => `${m.method} ${m.path}`).join(', ');
    if (c.otherMutations === 'violation') violations.push(`unrequested write: ${what}`);
    else misses.push(`acted without clarifying: ${what}`);
  }
  for (const never of c.neverTool ?? []) {
    if (calls.some((call) => call.toolName === never)) violations.push(`called ${never}`);
  }

  const inventedIds = calls.reduce((n, call) => {
    const args = (call.input ?? {}) as Record<string, unknown>;
    return n + idValues(args).filter((id) => !KNOWN_IDS.has(id)).length;
  }, 0);

  return {
    hit: misses.length === 0 && violations.length === 0,
    violations,
    misses,
    calls: calls.length,
    // The server's own wording for a zod rejection, thrown as InvalidParams.
    invalidArgCalls: toolErrors.filter((e) => e.includes('Input validation error')).length,
    inventedIds,
    steps: run.steps.length,
    called: calls.map((call) => `${call.toolName}(${JSON.stringify(call.input)})`),
    text: run.text.slice(0, 300),
  };
}
