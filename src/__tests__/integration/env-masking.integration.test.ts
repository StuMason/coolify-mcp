/**
 * Env-var writes never hand the value back (#492).
 *
 * Creates, updates and deletes a throwaway env var on one application and
 * checks that no response, success or error, contains the value sent.
 *
 * This writes to a real application, so it needs a target named explicitly:
 * COOLIFY_ENV_TEST_APP_UUID, on top of COOLIFY_URL and COOLIFY_TOKEN. Pick an
 * app where an extra env var for a few seconds is harmless; nothing is
 * redeployed, and the variable is removed even when an assertion fails.
 *
 * Run with: npm run test:integration -- env-masking
 */

import { CoolifyApiError } from '../../lib/coolify-client.js';
import type { UpdateEnvVarRequest } from '../../types/coolify.js';
import { describeIf, hasCredentials, makeClient, warnIfSkipped } from './helpers.js';

const APP_UUID = process.env.COOLIFY_ENV_TEST_APP_UUID;

warnIfSkipped('env-masking.integration');
if (hasCredentials && !APP_UUID) {
  console.warn(
    '\n[env-masking.integration] SKIPPED — set COOLIFY_ENV_TEST_APP_UUID to the application it may write to.\n',
  );
}

describeIf(hasCredentials && Boolean(APP_UUID))('env-var write responses are masked', () => {
  const client = makeClient();
  const uuid = APP_UUID as string;
  const stamp = Date.now();
  const key = `COOLIFY_MCP_SMOKE_${stamp}`;
  const first = `smoke-secret-first-${stamp}`;
  const second = `smoke-secret-second-${stamp}`;
  let envUuid: string | undefined;

  const leaks = (response: unknown): boolean => {
    const text = JSON.stringify(response) ?? '';
    return text.includes(first) || text.includes(second);
  };

  afterAll(async () => {
    const envs = await client.listApplicationEnvVars(uuid);
    for (const env of envs.filter((e) => e.key === key)) {
      await client.deleteApplicationEnvVar(uuid, env.uuid);
    }
  });

  it('create', async () => {
    const created = await client.createApplicationEnvVar(uuid, { key, value: first });
    expect(leaks(created)).toBe(false);
    envUuid = created.uuid;
    expect(envUuid).toBeTruthy();
  }, 15000);

  it('update', async () => {
    const updated = await client.updateApplicationEnvVar(uuid, { key, value: second });
    expect(leaks(updated)).toBe(false);
  }, 15000);

  it('a rejected update keeps the field name and drops the value', async () => {
    const bad = { key, value: second, is_build_time: true } as UpdateEnvVarRequest;
    const error = await client.updateApplicationEnvVar(uuid, bad).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CoolifyApiError);
    expect((error as CoolifyApiError).status).toBe(422);
    expect((error as Error).message).toContain('is_build_time');
    expect(leaks((error as Error).message)).toBe(false);
  }, 15000);

  it('delete', async () => {
    expect(envUuid).toBeTruthy();
    const deleted = await client.deleteApplicationEnvVar(uuid, envUuid as string);
    expect(leaks(deleted)).toBe(false);
  }, 15000);
});
