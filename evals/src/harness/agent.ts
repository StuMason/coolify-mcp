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
// shorter common spelling too.
process.env.GOOGLE_GENERATIVE_AI_API_KEY ??= process.env.GOOGLE_AI_API_KEY;

const PROVIDERS = [
  { prefix: 'anthropic', key: 'ANTHROPIC_API_KEY', factory: anthropic, agent: 'claude-haiku-4-5', judge: 'claude-sonnet-4-5' },
  { prefix: 'google', key: 'GOOGLE_GENERATIVE_AI_API_KEY', factory: google, agent: 'gemini-2.5-flash', judge: 'gemini-2.5-pro' },
  { prefix: 'openai', key: 'OPENAI_API_KEY', factory: openai, agent: 'gpt-5-mini', judge: 'gpt-5' },
] as const;

const available = PROVIDERS.find((p) => process.env[p.key]);

export const hasModelKey = available !== undefined;

export function resolveModel(spec: string): LanguageModel {
  const idx = spec.indexOf(':');
  if (idx === -1) throw new Error(`model spec "${spec}" must be "provider:model"`);
  const provider = PROVIDERS.find((p) => p.prefix === spec.slice(0, idx));
  if (!provider) throw new Error(`unknown provider in "${spec}" (anthropic|google|openai)`);
  return provider.factory(spec.slice(idx + 1));
}

export const EVAL_MODEL =
  process.env.EVALS_MODEL ?? (available ? `${available.prefix}:${available.agent}` : 'anthropic:claude-haiku-4-5');
export const JUDGE_MODEL =
  process.env.EVALS_JUDGE_MODEL ?? (available ? `${available.prefix}:${available.judge}` : 'anthropic:claude-sonnet-4-5');

/**
 * Pause between eval cases. Gemini's free tier allows ~10 requests/min; an
 * unpaced suite burns triple that and throttled requests come back as
 * text-only responses with no tool calls — which read exactly like selection
 * failures. Pacing is correctness here, not politeness.
 */
export const CASE_DELAY_MS = process.env.EVALS_CASE_DELAY_MS
  ? Number(process.env.EVALS_CASE_DELAY_MS)
  : available?.prefix === 'google'
    ? 7000
    : 0;

export const paceCase = (): Promise<void> => new Promise((r) => setTimeout(r, CASE_DELAY_MS));

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
        // Evals need run-to-run stability far more than creativity.
        temperature: 0,
      }),
    output: ({ result }) => result.text,
  });
}

export function makeJudgeHarness() {
  return aiSdkJudgeHarness({ model: resolveModel(JUDGE_MODEL), temperature: 0 });
}
