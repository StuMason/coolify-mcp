import { describe, it, expect } from '@jest/globals';
import { checkStartupConfig, cfAccessHeaders } from '../lib/startup-check.js';

// A base env that passes every check, so each test breaks exactly one thing.
const cleanEnv = (): NodeJS.ProcessEnv => ({
  COOLIFY_BASE_URL: 'https://coolify.example.com',
  COOLIFY_ACCESS_TOKEN: '7|abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
});

describe('checkStartupConfig', () => {
  it('passes a clean config with no errors or warnings', () => {
    expect(checkStartupConfig(cleanEnv())).toEqual({ errors: [], warnings: [] });
  });

  // The failure story behind the check: a macOS Keychain entry stored the
  // literal string `${COOLIFY_ACCESS_TOKEN}`, every call 401ed, and the team
  // rewrote 30 tool calls against the CLI before anyone found it.
  it('catches an unexpanded ${VAR} placeholder in the token', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '${COOLIFY_ACCESS_TOKEN}';
    const { errors } = checkStartupConfig(env);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('COOLIFY_ACCESS_TOKEN');
    expect(errors[0]).toContain('unexpanded');
  });

  it('catches unexpanded placeholders in every checked variable', () => {
    for (const name of [
      'COOLIFY_BASE_URL',
      'MCP_PUBLIC_URL',
      'CF_ACCESS_CLIENT_ID',
      'CF_ACCESS_CLIENT_SECRET',
    ]) {
      const env = cleanEnv();
      env.CF_ACCESS_CLIENT_ID = 'id.access';
      env.CF_ACCESS_CLIENT_SECRET = 'cf-sentinel-secret';
      env[name] = '${SERVICE_FQDN_COOLIFYMCP}';
      const { errors } = checkStartupConfig(env);
      expect(errors.some((e) => e.includes(name) && e.includes('unexpanded'))).toBe(true);
    }
  });

  it('catches a braceless $VAR placeholder', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '$COOLIFY_ACCESS_TOKEN';
    const { errors } = checkStartupConfig(env);
    expect(errors.some((e) => e.includes('unexpanded'))).toBe(true);
  });

  it('errors on a control character in the token (pasted newline)', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '7|sentinelsecretvalue\n';
    const { errors } = checkStartupConfig(env);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('control character');
  });

  it('warns on surrounding whitespace in the token', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = ' 7|sentinelsecretvalue ';
    const { errors, warnings } = checkStartupConfig(env);
    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('whitespace');
  });

  it('errors on an unparseable base URL', () => {
    const env = cleanEnv();
    env.COOLIFY_BASE_URL = 'not a url at all';
    const { errors } = checkStartupConfig(env);
    expect(
      errors.some((e) => e.includes('COOLIFY_BASE_URL') && e.includes('not a usable URL')),
    ).toBe(true);
  });

  it('errors on a non-http scheme', () => {
    const env = cleanEnv();
    env.COOLIFY_BASE_URL = 'ftp://coolify.example.com';
    const { errors } = checkStartupConfig(env);
    expect(errors.some((e) => e.includes('must be http or https'))).toBe(true);
  });

  it('warns when the base URL already ends in /api/v1 (the server appends it again)', () => {
    for (const suffix of ['/api/v1', '/api/v1/', '/api']) {
      const env = cleanEnv();
      env.COOLIFY_BASE_URL = `https://coolify.example.com${suffix}`;
      const { warnings } = checkStartupConfig(env);
      expect(warnings.some((w) => w.includes('/api/v1 itself'))).toBe(true);
    }
  });

  it('leaves unset and empty variables alone (the entry points own required-var errors)', () => {
    expect(checkStartupConfig({})).toEqual({ errors: [], warnings: [] });
    expect(checkStartupConfig({ COOLIFY_ACCESS_TOKEN: '' })).toEqual({ errors: [], warnings: [] });
  });

  it('errors when exactly one CF Access variable is set, naming the missing one', () => {
    const idOnly = cleanEnv();
    idOnly.CF_ACCESS_CLIENT_ID = 'id.access';
    expect(checkStartupConfig(idOnly).errors[0]).toContain('CF_ACCESS_CLIENT_SECRET is not');

    const secretOnly = cleanEnv();
    secretOnly.CF_ACCESS_CLIENT_SECRET = 'cf-sentinel-secret';
    expect(checkStartupConfig(secretOnly).errors[0]).toContain('CF_ACCESS_CLIENT_ID is not');
  });

  it('accepts the CF Access pair together, and neither', () => {
    const both = cleanEnv();
    both.CF_ACCESS_CLIENT_ID = 'id.access';
    both.CF_ACCESS_CLIENT_SECRET = 'cf-sentinel-secret';
    expect(checkStartupConfig(both).errors).toEqual([]);
    expect(checkStartupConfig(cleanEnv()).errors).toEqual([]);
  });

  // The iron rule of #368: messages name variables and shapes, never values.
  it('never echoes a value in any message, whatever is wrong with it', () => {
    const env: NodeJS.ProcessEnv = {
      COOLIFY_BASE_URL: 'https://sentinel-host.example.com/api/v1',
      COOLIFY_ACCESS_TOKEN: ' 9|sentinelsecretvalue\t',
      MCP_PUBLIC_URL: 'prefix${UNEXPANDED}suffix-sentinel',
      CF_ACCESS_CLIENT_SECRET: 'cf-sentinel-secret',
    };
    const { errors, warnings } = checkStartupConfig(env);
    const output = [...errors, ...warnings].join('\n');
    expect(errors.length + warnings.length).toBeGreaterThanOrEqual(3);
    for (const sentinel of ['sentinelsecretvalue', 'suffix-sentinel', 'cf-sentinel-secret']) {
      expect(output).not.toContain(sentinel);
    }
  });
});

describe('cfAccessHeaders', () => {
  it('returns both headers when both variables are set', () => {
    expect(
      cfAccessHeaders({ CF_ACCESS_CLIENT_ID: 'id.access', CF_ACCESS_CLIENT_SECRET: 's3cret' }),
    ).toEqual({
      'CF-Access-Client-Id': 'id.access',
      'CF-Access-Client-Secret': 's3cret',
    });
  });

  it('returns undefined when either or both are missing', () => {
    expect(cfAccessHeaders({})).toBeUndefined();
    expect(cfAccessHeaders({ CF_ACCESS_CLIENT_ID: 'id.access' })).toBeUndefined();
    expect(cfAccessHeaders({ CF_ACCESS_CLIENT_SECRET: 's3cret' })).toBeUndefined();
    expect(
      cfAccessHeaders({ CF_ACCESS_CLIENT_ID: '', CF_ACCESS_CLIENT_SECRET: 's3cret' }),
    ).toBeUndefined();
  });
});
