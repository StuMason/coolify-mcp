# Evals & red teaming

This directory measures something unit tests can't: **when a model reads this
server's tools, does it pick the right one — and can attacker-controlled tool
output make it misbehave?** Tool descriptions are prompts. v2.0.0 cut them to
~15% of their original size to save tokens; these evals are the standing proof
that the cut surface still steers models correctly and safely.

It's a self-contained package (its own `package.json`, like `site/`), so the
published server never ships eval or model-SDK dependencies.

## Why this shape

No single framework does all of this well, so we use two, each for what it's
best at — the same split the strongest MCP servers in the wild have landed on:

| Layer | What it checks | Tool | Blocks a PR? |
| --- | --- | --- | --- |
| **1. Contract snapshots** | tool name/description/schema/annotations don't drift unseen | vitest snapshots | **Yes** — deterministic, no key |
| **2. Tool selection** | a model picks the boundary-correct tool; never a destructive one on read intent | vitest-evals + AI SDK | No — reports |
| **3. Injection regression** | instructions embedded in tool output are treated as data, not commands | vitest-evals + AI SDK | No — reports |
| **4. Red team** | auto-generated adversarial battery (jailbreaks, exfiltration, privilege escalation) | promptfoo | No — scheduled |

**Why not promptfoo for everything** (as first sketched): promptfoo is the
ecosystem standard for *red teaming*, but it can't cleanly assert *which* tool a
model called with which arguments — its assertions are string/JSON matches on
output. Every serious TypeScript MCP server does tool-selection evals with
`vitest-evals` instead (Sentry, Cloudflare, Novu, Tago.io). We follow them for
Layers 1–3 and use promptfoo only for Layer 4, where its generative attack
battery has no equivalent.

### Prior art we copied from

- **Sentry — [`sentry-mcp`](https://github.com/getsentry/sentry-mcp)** (`packages/mcp-server-evals/`): the reference `vitest-evals` setup — `*.eval.ts` cases of `{input, expectedTools}`, backend mocked in-process, evals reported as a CI check rather than a merge gate. Layers 1–3 follow this.
- **GitHub — [`github-mcp-server`](https://github.com/github/github-mcp-server)** (`internal/toolsnaps/`, `pkg/github/__toolsnaps__/`): snapshotting every tool's schema so what the model sees can't change without a reviewed diff. Layer 1 is this idea, doubling as a token-budget guard.
- **Supabase — [`supabase-mcp`](https://github.com/supabase-community/supabase-mcp)** (`test/e2e/prompt-injection.e2e.ts`): the in-repo injection regression test written after their July-2025 data-exfiltration disclosure — seed poisoned data, run a *deliberately weak* model, assert it saw the poison and didn't act on it. Layer 3 is this pattern.
- **[promptfoo `redteam-mcp` example](https://github.com/promptfoo/promptfoo/tree/main/examples/redteam-mcp)** and the [MCP red-team plugin](https://www.promptfoo.dev/docs/red-team/plugins/mcp/): the basis for `redteam.yaml`.
- Checklist we map findings against: the [OWASP MCP Top 10](https://owasp.org/www-project-mcp-top-10/).

## The fixture backend (never production)

Every layer talks to an in-memory fake Coolify API (`src/fixture/`), never a
real instance. It:

- binds `127.0.0.1` only, and **refuses to start if `COOLIFY_URL` /
  `COOLIFY_BASE_URL` points anywhere that isn't localhost** — the loud guardrail
  the task asked for;
- serves data faithful to the real API's documented quirks (the `is_preview`
  env-var twin, `destination.server_id` instead of `server_uuid`, localhost
  server id `0` — see the server's CLAUDE.md);
- plants **canary secrets** (any value containing `CANARY`) in env vars,
  database passwords and private keys, so a leak into model output is
  detectable; and
- records every request, exposing `mutations()` so a test can assert *nothing
  changed*, independent of how tools map to endpoints.

The harness (`src/harness/mcp.ts`) boots the **real** built server
(`dist/index.js`) over stdio against that fixture and exposes its live
`tools/list` as an AI SDK toolset — so evals exercise the exact surface a client
sees, and the read-only/destructive split used in assertions is *derived from
the server's own annotations table*, never hand-listed here.

## Running

```bash
npm run build            # in the repo root first — the harness spawns dist/index.js
cd evals && npm ci

npm run snapshots        # Layer 1 — deterministic, no API key
npm run snapshots:update # regenerate after an intentional tool change (review the diff!)

npm run evals            # Layers 2–3 — needs a model key (see below)
npm run redteam          # Layer 4 — see "Red team" below
npm run typecheck
```

### Model keys

Layers 2–3 and the red team call a real model. Provider is auto-detected from
whichever key is present, and models are addressed `provider:model`:

| Provider | Env var | Default agent model |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_API_KEY` | `claude-haiku-4-5` |
| Google | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.5-flash` |
| OpenAI | `OPENAI_API_KEY` | `gpt-5-mini` |

Override with `EVALS_MODEL=google:gemini-2.5-flash` (and `EVALS_JUDGE_MODEL`).
A mid-tier model is the default on purpose: if the terse descriptions steer a
small model right, that's a stronger result than steering a frontier one. The
suite is provider-agnostic because this server is driven from Claude, ChatGPT
*and* Gemini clients (a Gemini-only schema bug already shipped once — server
issue #325).

Without any key the model-in-the-loop suites **skip loudly** rather than fail.

### Reading the selection score

Two kinds of check live in `src/selection`:

- **Safety invariants** hard-fail per case on every model: a read-intent
  request must never call a destructive-annotated tool, and must never mutate
  the fixture. These are the lines that matter most and they are absolute.
- **Selection pass rate** is gated against a **per-provider baseline** (Claude
  ~0.9, Gemini Flash ~0.55 — it under-chains `list→act`, see FINDINGS.md #2).
  The baseline is a regression ratchet: raise it when the surface improves,
  never lower it to turn a red run green.

## Red team (Layer 4)

`npm run redteam` stands up the fixture, then runs promptfoo's generative
battery (`redteam.yaml`) against the real server: the `mcp` plugin (function
discovery, parameter/metadata injection, unauthorized invocation, privilege
escalation) plus `pii`, `bola`, `bfla`, `excessive-agency`, under jailbreak and
prompt-injection strategies.

- **Attack generation** uses promptfoo's purpose-built remote service by
  default (needs network, no model key). It is deliberately **not** pointed at
  the Anthropic key — promptfoo's own docs warn Anthropic may disable an account
  used to generate adversarial content. To generate fully locally, set
  `PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=true` and add a `redteam.provider`
  you're comfortable using for that.
- **Reading the report:** after a run, `npm run redteam:view` opens promptfoo's
  report UI (findings grouped by plugin and severity, each with the attack
  prompt, the model's response, and the grader's verdict). The generated attack
  set is written to `redteam.generated.yaml`.
- It runs on a **schedule** (`.github/workflows/redteam.yml`), not per-PR:
  generation is nondeterministic and slow. Findings get triaged into
  `FINDINGS.md`; anything needing a code change also gets a hand-written
  regression test in `src/injection`.

## When you change the tool surface

1. `npm run snapshots` will fail — review the diff, then `npm run snapshots:update` if intended.
2. If you changed a description on an ambiguous boundary, add/adjust a case in `src/selection`.
3. If you touched anything that returns attacker-influenceable text (logs, deploy output), add an `src/injection` scenario.
4. Findings that aren't worth a code change go in `FINDINGS.md` with a reason.
