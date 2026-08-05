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

async function main(): Promise<void> {
  const passthrough = process.argv.slice(2);
  const view = passthrough.includes('--view');

  const fixture = await startFixture();

  console.error(`[redteam] fixture Coolify backend on ${fixture.url}`);

  // `redteam run` generates attacks (into redteam.generated.yaml) then evals
  // them; results land in promptfoo's local store, read back by `report` /
  // `view`. `-o` here is the *generated tests* file, not the results file.
  const args = view
    ? ['promptfoo', 'redteam', 'report']
    : [
        'promptfoo',
        'redteam',
        'run',
        '--config',
        'redteam.yaml',
        '--output',
        'redteam.generated.yaml',
        ...passthrough.filter((a) => a !== '--view'),
      ];

  const child = spawn('npx', args, {
    cwd: here,
    stdio: 'inherit',
    env: {
      ...process.env,
      COOLIFY_BASE_URL: fixture.url,
      COOLIFY_ACCESS_TOKEN: FIXTURE_TOKEN,
    },
  });

  const code: number = await new Promise((resolve) => {
    child.on('exit', (c) => resolve(c ?? 1));
    // Without this, a spawn failure (npx missing, ENOENT) never settles the
    // promise and the run hangs to the workflow timeout instead of erroring.
    child.on('error', (err) => {
      console.error('[redteam] failed to spawn promptfoo:', err);
      resolve(1);
    });
  });

  // Export the graded RESULTS (not just the generated attacks) so the scheduled
  // job uploads something a human can triage into FINDINGS.md — `redteam run`
  // otherwise leaves results only in promptfoo's local store, and exits 0
  // whether or not probes failed. Best-effort: a failed export must not fail the
  // run. NOTE: not exercised in this sandbox (needs network for generation) —
  // verify against the first live scheduled run.
  if (!view && code === 0) {
    await new Promise<void>((resolve) => {
      const exporter = spawn(
        'npx',
        ['promptfoo', 'export', 'eval', 'latest', '--output', 'redteam-results.json'],
        { cwd: here, stdio: 'inherit' },
      );
      exporter.on('exit', () => resolve());
      exporter.on('error', (err) => {
        console.error('[redteam] results export failed (non-fatal):', err);
        resolve();
      });
    });
  }

  await fixture.close();
  process.exit(code);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
