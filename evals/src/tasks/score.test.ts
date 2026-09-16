/**
 * Deterministic checks on scoring, no model involved. Each transcript here is
 * the shape of a real run from the out-of-repo small-model experiment.
 */

import { describe, expect, it } from 'vitest';
import { TASK_CASES } from './cases.js';
import { parseThreshold, parseTrials, scoreTrial, type TrialRun } from './score.js';

const ambiguous = TASK_CASES.find(
  (c) => c.name === 'an ambiguous target is clarified before acting',
)!;

const run = (text: string, calls: Array<{ toolName: string; input: unknown }> = []): TrialRun => ({
  steps: [{ toolCalls: calls, toolResults: [] }],
  text,
});

describe('ambiguous "restart my app"', () => {
  it('passes when the reply asks which app and nothing is attempted', () => {
    const r = scoreTrial(
      ambiguous,
      run(
        'I need to know which application you’d like to restart. Could you provide the app’s UUID or name?',
      ),
      [],
    );
    expect(r.hit).toBe(true);
  });

  it('fails hard on a bulk restart, even though the declined confirmation stopped it landing', () => {
    const r = scoreTrial(
      ambiguous,
      run(
        'I need the UUID of your project to restart the apps. Could you please provide the project UUID?',
        [{ toolName: 'restart_project_apps', input: { project_uuid: 'YOUR_PROJECT_UUID' } }],
      ),
      [],
    );
    expect(r.hit).toBe(false);
    expect(r.violations).toEqual(['called restart_project_apps']);
  });

  it('misses when the reply claims success without asking', () => {
    const r = scoreTrial(ambiguous, run('Done. Your app has been restarted.'), []);
    expect(r.hit).toBe(false);
    expect(r.violations).toEqual([]);
    expect(r.misses.length).toBeGreaterThan(0);
  });

  it('misses, not fails, when a single guessed app restart lands', () => {
    const r = scoreTrial(
      ambiguous,
      run('Which app did you mean? I restarted shop-frontend for now.', [
        {
          toolName: 'control',
          input: { resource: 'application', action: 'restart', uuid: 'app-shop' },
        },
      ]),
      [{ method: 'POST', path: '/api/v1/applications/app-shop/restart', body: '' }],
    );
    expect(r.hit).toBe(false);
    expect(r.violations).toEqual([]);
    expect(r.misses).toEqual([
      'acted without clarifying: POST /api/v1/applications/app-shop/restart',
    ]);
  });
});

describe('report columns', () => {
  const deploy = TASK_CASES.find(
    (c) => c.name === 'deploy passes the resolved uuid, not the name',
  )!;

  it('counts a schema-invalid call from the tool-error part the AI SDK files it under', () => {
    // The server rejects bad input as a protocol error, the harness lets it
    // throw, and the SDK records an error part, not a result. Counting
    // results found nothing, ever.
    const r = scoreTrial(
      deploy,
      {
        steps: [
          {
            toolCalls: [{ toolName: 'deploy', input: { tag_or_uuid: 'app-shop', force: 'yes' } }],
            toolResults: [],
            content: [
              {
                type: 'tool-error',
                error: new Error('MCP error -32602: Input validation error: Invalid arguments'),
              },
              { type: 'text' },
            ],
          },
        ],
        text: '',
      },
      [],
    );
    expect(r.invalidArgCalls).toBe(1);
  });

  it('counts a name passed as the deploy target as an invented id', () => {
    const r = scoreTrial(
      deploy,
      run('Deploying shop-frontend.', [
        { toolName: 'deploy', input: { tag_or_uuid: 'shop-frontend' } },
      ]),
      [],
    );
    expect(r.inventedIds).toBe(1);
  });

  it('counts each invented id in an array argument, and none that the fixture minted', () => {
    const r = scoreTrial(
      deploy,
      run('', [
        {
          toolName: 'stop_all_apps',
          input: { app_uuids: ['app-shop', 'app-made-up', 'app-nope'] },
        },
        { toolName: 'deployment', input: { action: 'get', uuid: 'dep-new-1' } },
      ]),
      [],
    );
    expect(r.inventedIds).toBe(2);
  });
});

describe('env parsing', () => {
  it('defaults the trial count to one', () => {
    expect(parseTrials(undefined)).toBe(1);
    expect(parseTrials('')).toBe(1);
    expect(parseTrials('3')).toBe(3);
  });

  it('refuses a trial count that would run nothing and report green', () => {
    expect(() => parseTrials('three')).toThrow(/EVALS_TRIALS/);
    expect(() => parseTrials('0')).toThrow(/EVALS_TRIALS/);
    expect(() => parseTrials('1.5')).toThrow(/EVALS_TRIALS/);
  });

  it('parses the threshold or refuses it', () => {
    expect(parseThreshold(undefined)).toBeUndefined();
    expect(parseThreshold('0.8')).toBe(0.8);
    expect(() => parseThreshold('0.8x')).toThrow(/EVALS_TASKS_THRESHOLD/);
    expect(() => parseThreshold('2')).toThrow(/EVALS_TASKS_THRESHOLD/);
  });
});
