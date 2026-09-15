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
]);

export const ID_ARGS = [
  'uuid',
  'project_uuid',
  'app_uuid',
  'server_uuid',
  'environment_uuid',
  'env_uuid',
];

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
  }>;
  text: string;
}

const sameValue = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export function scoreTrial(c: TaskCase, run: TrialRun, recorded: RecordedRequest[]): TrialResult {
  const calls = run.steps.flatMap((s) => s.toolCalls);
  const outputs = run.steps.flatMap((s) => s.toolResults).map((r) => String(r.output));
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

  for (const re of c.answer ?? []) {
    if (!re.test(run.text)) misses.push(`answer does not match ${re}`);
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
    return (
      n +
      ID_ARGS.filter((k) => typeof args[k] === 'string' && !KNOWN_IDS.has(args[k] as string)).length
    );
  }, 0);

  return {
    hit: misses.length === 0 && violations.length === 0,
    violations,
    misses,
    calls: calls.length,
    invalidArgCalls: outputs.filter((o) => o.includes('Input validation error')).length,
    inventedIds,
    steps: run.steps.length,
    called: calls.map((call) => `${call.toolName}(${JSON.stringify(call.input)})`),
    text: run.text.slice(0, 300),
  };
}
