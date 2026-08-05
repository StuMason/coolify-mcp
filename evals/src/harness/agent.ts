/**
 * The system under test for model-in-the-loop evals: a plain AI SDK agent
 * loop over the MCP server's real toolset.
 *
 * The system prompt is intentionally generic — the point of tool-selection
 * evals is that the tool names/descriptions alone steer the model, so the
 * prompt must not smuggle in routing hints ("use diagnose_app for outages")
 * that a real client would not have.
 *
 * Provider-agnostic on purpose: the server is consumed from Claude, ChatGPT
 * and Gemini clients alike (a Gemini-specific schema bug already shipped
 * once — #325), so evals must be runnable against any of them. Models are
 * addressed as "provider:model", e.g. EVALS_MODEL=google:gemini-2.5-flash.
 * The default picks a deliberately mid-tier model from the first provider
 * with a key: if the token-optimized descriptions steer a small model
 * correctly, that is a stronger claim than steering a frontier one.
 */

import { anthropic } from '@ai-sdk/anthropic';
import { google } from '@ai-sdk/google';
import { openai } from '@ai-sdk/openai';
import { generateText, stepCountIs, type LanguageModel, type ToolSet } from 'ai';
import { aiSdkHarness, aiSdkJudgeHarness } from '@vitest-evals/harness-ai-sdk';
import type { EvalContext } from './mcp.js';

// The AI SDK's Google provider reads GOOGLE_GENERATIVE_AI_API_KEY; accept the
// shorter common spelling too. NOT `??=`: assigning `process.env.X` coerces to
// a string, so `X ??= undefined` leaves the literal "undefined" (truthy) when
// neither var is set — which would make provider detection think a key exists
// and stop the suite skipping loudly. Only copy when there is something to copy.
if (process.env.GOOGLE_AI_API_KEY && !process.env.GOOGLE_GENERATIVE_AI_API_KEY) {
  process.env.GOOGLE_GENERATIVE_AI_API_KEY = process.env.GOOGLE_AI_API_KEY;
}

const PROVIDERS = [
  {
    prefix: 'anthropic',
    key: 'ANTHROPIC_API_KEY',
    factory: anthropic,
    agent: 'claude-haiku-4-5',
    judge: 'claude-sonnet-4-5',
  },
  {
    prefix: 'google',
    key: 'GOOGLE_GENERATIVE_AI_API_KEY',
    factory: google,
    agent: 'gemini-2.5-flash',
    judge: 'gemini-2.5-pro',
  },
  { prefix: 'openai', key: 'OPENAI_API_KEY', factory: openai, agent: 'gpt-5-mini', judge: 'gpt-5' },
] as const;

const providerOf = (spec: string): (typeof PROVIDERS)[number] | undefined =>
  PROVIDERS.find((p) => p.prefix === spec.slice(0, spec.indexOf(':')));

// First provider with a key — used ONLY to pick the DEFAULT model when
// EVALS_MODEL is unset.
const available = PROVIDERS.find((p) => process.env[p.key]);

export function resolveModel(spec: string): LanguageModel {
  if (!spec.includes(':')) throw new Error(`model spec "${spec}" must be "provider:model"`);
  const provider = providerOf(spec);
  if (!provider) throw new Error(`unknown provider in "${spec}" (anthropic|google|openai)`);
  return provider.factory(spec.slice(spec.indexOf(':') + 1));
}

export const EVAL_MODEL =
  process.env.EVALS_MODEL ??
  (available ? `${available.prefix}:${available.agent}` : 'anthropic:claude-haiku-4-5');
export const JUDGE_MODEL =
  process.env.EVALS_JUDGE_MODEL ??
  (available ? `${available.prefix}:${available.judge}` : 'anthropic:claude-sonnet-4-5');

// The provider actually SELECTED (via EVALS_MODEL or the default above), not
// merely the first one with a key. hasModelKey and pacing must key off this —
// otherwise `EVALS_MODEL=google:…` with an ANTHROPIC key in the env would run
// (or throttle) against the wrong provider's assumptions.
const selected = providerOf(EVAL_MODEL);

export const hasModelKey = Boolean(selected && process.env[selected.key]);

/**
 * Pause between eval cases. Gemini's free tier allows ~10 requests/min; an
 * unpaced suite burns triple that and throttled requests come back as
 * text-only responses with no tool calls — which read exactly like selection
 * failures. Pacing is correctness here, not politeness.
 */
export const CASE_DELAY_MS = process.env.EVALS_CASE_DELAY_MS
  ? Number(process.env.EVALS_CASE_DELAY_MS)
  : selected?.prefix === 'google'
    ? 7000
    : 0;

export const paceCase = (): Promise<void> => new Promise((r) => setTimeout(r, CASE_DELAY_MS));

/**
 * `temperature` was a nice-to-have for run-to-run stability, but some models
 * now hard-reject a non-default value: the Claude 5 family (opus-5, sonnet-5,
 * fable-5, haiku-5) deprecated the parameter, and OpenAI's GPT-5 reasoning
 * models (gpt-5, gpt-5-mini, …) only accept the default. So it's opt-in per
 * model — passed for models that still take it, omitted (→ field dropped) for
 * those that don't. Matches on the bare model id, so `provider:model` specs
 * work either way.
 */
export function temperatureFor(model: string): number | undefined {
  const id = model.includes(':') ? model.slice(model.indexOf(':') + 1) : model;
  if (/(opus|sonnet|fable|haiku)-5\b/.test(id)) return undefined;
  if (/^(?:o\d|gpt-5)/.test(id)) return undefined;
  return 0;
}

export const SYSTEM_PROMPT = [
  'You are an infrastructure assistant managing a Coolify estate through the provided tools.',
  'Answer using tools rather than guessing. If a request is ambiguous, ask for clarification',
  'instead of acting. Never take a destructive action the user did not clearly request.',
].join(' ');

export function makeAgentHarness(
  ctx: EvalContext,
  { model = EVAL_MODEL, system = SYSTEM_PROMPT, maxSteps = 8 } = {},
) {
  return aiSdkHarness({
    tools: ctx.toolSet,
    run: ({ input, runtime }) =>
      generateText({
        model: resolveModel(model),
        system,
        prompt: String(input),
        tools: runtime.tools as ToolSet,
        stopWhen: stepCountIs(maxSteps),
        // Nice-to-have for stability; omitted for models that reject it.
        temperature: temperatureFor(model),
      }),
    output: ({ result }) => result.text,
  });
}

export function makeJudgeHarness() {
  return aiSdkJudgeHarness({
    model: resolveModel(JUDGE_MODEL),
    temperature: temperatureFor(JUDGE_MODEL),
  });
}
