/**
 * Launcher for the promptfoo red-team battery (Layer 4).
 *
 * promptfoo spawns dist/index.js itself (see redteam.yaml). This wrapper's job
 * is to stand up the fixture Coolify backend FIRST and export
 * COOLIFY_BASE_URL / COOLIFY_ACCESS_TOKEN into the environment promptfoo
 * inherits, so the spawned MCP server talks to the fixture and never to a real
 * instance. The env guard in fixture/server.ts is the backstop; this is the
 * mechanism.
 *
 * Usage:
 *   npm run redteam            # generate + run, write report JSON
 *   npm run redteam -- --view  # open the last report in the browser
 *
 * Generation and grading call a model. promptfoo defaults its attack generator
 * to a remote service unless PROMPTFOO_DISABLE_REDTEAM_REMOTE_GENERATION=1;
 * the grader uses OPENAI_API_KEY (override via redteam.yaml `provider`).
 */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { FIXTURE_TOKEN } from './src/fixture/data.js';
import { startFixture } from './src/fixture/server.js';

const here = fileURLToPath(new URL('.', import.meta.url));

/** Run promptfoo, resolving its exit code. An 'error' handler is essential: a
 *  spawn failure (npx missing, ENOENT) otherwise never settles and the run
 *  hangs to the workflow timeout instead of erroring. */
function runPromptfoo(args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve) => {
    const child = spawn('npx', ['promptfoo', ...args], { cwd: here, stdio: 'inherit', env });
    child.on('exit', (c) => resolve(c ?? 1));
    child.on('error', (err) => {
      console.error('[redteam] failed to spawn promptfoo:', err);
      resolve(1);
    });
  });
}

async function main(): Promise<void> {
  const passthrough = process.argv.slice(2);

  // `--view` only opens the last report — no target is spawned, so no fixture.
  if (passthrough.includes('--view')) {
    process.exit(await runPromptfoo(['redteam', 'report'], process.env));
  }

  const fixture = await startFixture();
  console.error(`[redteam] fixture Coolify backend on ${fixture.url}`);
  const env = {
    ...process.env,
    COOLIFY_BASE_URL: fixture.url,
    COOLIFY_ACCESS_TOKEN: FIXTURE_TOKEN,
  };

  let code: number;
  try {
    // `redteam run` generates attacks (into redteam.generated.yaml) then evals
    // them; `--output` here is the *generated tests* file, not the results.
    code = await runPromptfoo(
      [
        'redteam',
        'run',
        '--config',
        'redteam.yaml',
        '--output',
        'redteam.generated.yaml',
        ...passthrough,
      ],
      env,
    );

    // Export the graded RESULTS so the scheduled job uploads something a human
    // can triage — `redteam run` otherwise leaves results only in promptfoo's
    // local store and exits 0 whether or not probes failed. Best-effort.
    // NOTE: not exercised in this sandbox (needs network for generation) —
    // verify against the first live scheduled run.
    if (code === 0) {
      await runPromptfoo(['export', 'eval', 'latest', '--output', 'redteam-results.json'], env);
    }
  } finally {
    // Close the fixture BEFORE exiting — process.exit would skip this.
    await fixture.close();
  }
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
