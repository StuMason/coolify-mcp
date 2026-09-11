import { describe, it, expect } from '@jest/globals';
import { checkStartupConfig, cfAccessHeaders, mergeCfAccessHeaders } from '../lib/startup-check.js';

// A base env that passes every check, so each test breaks exactly one thing.
const cleanEnv = (): NodeJS.ProcessEnv => ({
  COOLIFY_BASE_URL: 'https://coolify.example.com',
  COOLIFY_ACCESS_TOKEN: '7|abcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdef',
});

describe('checkStartupConfig', () => {
  it('passes a clean config with no errors or warnings', () => {
    expect(checkStartupConfig(cleanEnv(), 'http')).toEqual({ errors: [], warnings: [] });
  });

  // The failure story behind the check: a macOS Keychain entry stored the
  // literal string `${COOLIFY_ACCESS_TOKEN}`, every call 401ed, and the team
  // rewrote 30 tool calls against the CLI before anyone found it.
  it('catches an unexpanded ${VAR} placeholder in the token', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '${COOLIFY_ACCESS_TOKEN}';
    const { errors } = checkStartupConfig(env, 'http');
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
      const { errors } = checkStartupConfig(env, 'http');
      expect(errors.some((e) => e.includes(name) && e.includes('unexpanded'))).toBe(true);
    }
  });

  it('ignores MCP_PUBLIC_URL on stdio, where it is never read', () => {
    // A shared .env between a stdio config and an HTTP deployment must not
    // stop a stdio server that would run fine.
    const env = cleanEnv();
    env.MCP_PUBLIC_URL = '${SERVICE_FQDN_COOLIFYMCP}';
    expect(checkStartupConfig(env, 'stdio')).toEqual({ errors: [], warnings: [] });
    expect(checkStartupConfig(env, 'http').errors).toHaveLength(1);
  });

  it('catches a braceless $VAR placeholder', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '$COOLIFY_ACCESS_TOKEN';
    const { errors } = checkStartupConfig(env, 'http');
    expect(errors.some((e) => e.includes('unexpanded'))).toBe(true);
  });

  // Fetch's header normalization strips *outer* whitespace of the composed
  // `Bearer <token>` value, so a trailing newline (an --env-file or mounted
  // k8s secret preserves one) actually works — flagging it would refuse
  // startup for a config that is fine today.
  it('says nothing about trailing whitespace in the token (normalized away, works)', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '7|sentinelsecretvalue\n';
    expect(checkStartupConfig(env, 'http')).toEqual({ errors: [], warnings: [] });
    env.COOLIFY_ACCESS_TOKEN = '7|sentinelsecretvalue ';
    expect(checkStartupConfig(env, 'http')).toEqual({ errors: [], warnings: [] });
  });

  it('errors on leading whitespace in the token (survives as part of the credential)', () => {
    for (const value of [' 7|sentinelsecretvalue', '\t7|sentinelsecretvalue']) {
      const env = cleanEnv();
      env.COOLIFY_ACCESS_TOKEN = value;
      const { errors } = checkStartupConfig(env, 'http');
      expect(errors).toHaveLength(1);
      expect(errors[0]).toContain('leading whitespace');
    }
  });

  it('errors on an interior line break in the token (fetch refuses to send it)', () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '7|sentinel\nsecretvalue';
    const { errors } = checkStartupConfig(env, 'http');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('line break');
  });

  it('errors on an interior line break in a CF Access value', () => {
    const env = cleanEnv();
    env.CF_ACCESS_CLIENT_ID = 'id.access';
    env.CF_ACCESS_CLIENT_SECRET = 'cf-sent\ninel-secret';
    const { errors } = checkStartupConfig(env, 'http');
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('CF_ACCESS_CLIENT_SECRET');
    expect(errors[0]).toContain('line break');
  });

  it('errors on an unparseable base URL', () => {
    const env = cleanEnv();
    env.COOLIFY_BASE_URL = 'not a url at all';
    const { errors } = checkStartupConfig(env, 'http');
    expect(
      errors.some((e) => e.includes('COOLIFY_BASE_URL') && e.includes('not a usable URL')),
    ).toBe(true);
  });

  it('errors on a non-http scheme', () => {
    const env = cleanEnv();
    env.COOLIFY_BASE_URL = 'ftp://coolify.example.com';
    const { errors } = checkStartupConfig(env, 'http');
    expect(errors.some((e) => e.includes('must be http or https'))).toBe(true);
  });

  it('errors when the base URL ends in /api/v1 (guaranteed 404 on every call)', () => {
    for (const suffix of ['/api/v1', '/api/v1/']) {
      const env = cleanEnv();
      env.COOLIFY_BASE_URL = `https://coolify.example.com${suffix}`;
      const { errors } = checkStartupConfig(env, 'http');
      expect(errors.some((e) => e.includes('/api/v1 itself'))).toBe(true);
    }
  });

  it('warns when the base URL ends in /api (could be a deliberate proxy prefix)', () => {
    const env = cleanEnv();
    env.COOLIFY_BASE_URL = 'https://coolify.example.com/api';
    const { errors, warnings } = checkStartupConfig(env, 'http');
    expect(errors).toEqual([]);
    expect(warnings.some((w) => w.includes('/api/v1 itself'))).toBe(true);
  });

  it('leaves unset and empty variables alone (the entry points own required-var errors)', () => {
    expect(checkStartupConfig({}, 'http')).toEqual({ errors: [], warnings: [] });
    expect(checkStartupConfig({ COOLIFY_ACCESS_TOKEN: '' }, 'http')).toEqual({
      errors: [],
      warnings: [],
    });
  });

  it('errors when exactly one CF Access variable is set, naming the missing one', () => {
    const idOnly = cleanEnv();
    idOnly.CF_ACCESS_CLIENT_ID = 'id.access';
    expect(checkStartupConfig(idOnly, 'http').errors[0]).toContain(
      'CF_ACCESS_CLIENT_SECRET is not',
    );

    const secretOnly = cleanEnv();
    secretOnly.CF_ACCESS_CLIENT_SECRET = 'cf-sentinel-secret';
    expect(checkStartupConfig(secretOnly, 'http').errors[0]).toContain(
      'CF_ACCESS_CLIENT_ID is not',
    );
  });

  it('accepts the CF Access pair together, and neither', () => {
    const both = cleanEnv();
    both.CF_ACCESS_CLIENT_ID = 'id.access';
    both.CF_ACCESS_CLIENT_SECRET = 'cf-sentinel-secret';
    expect(checkStartupConfig(both, 'http').errors).toEqual([]);
    expect(checkStartupConfig(cleanEnv(), 'http').errors).toEqual([]);
  });

  // The iron rule of #368: messages name variables and shapes, never values.
  it('never echoes a value in any message, whatever is wrong with it', () => {
    const env: NodeJS.ProcessEnv = {
      COOLIFY_BASE_URL: 'https://sentinel-host.example.com/api/v1',
      COOLIFY_ACCESS_TOKEN: ' 9|sentinelsecretvalue\t',
      MCP_PUBLIC_URL: 'prefix${UNEXPANDED}suffix-sentinel',
      CF_ACCESS_CLIENT_SECRET: 'cf-sentinel-secret',
    };
    const { errors, warnings } = checkStartupConfig(env, 'http');
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

describe('mergeCfAccessHeaders', () => {
  const cfEnv: NodeJS.ProcessEnv = {
    CF_ACCESS_CLIENT_ID: 'env-id',
    CF_ACCESS_CLIENT_SECRET: 'env-secret',
  };

  it('combines env CF headers with CLI headers', () => {
    expect(mergeCfAccessHeaders(cfEnv, { 'X-Custom': 'v' })).toEqual({
      'CF-Access-Client-Id': 'env-id',
      'CF-Access-Client-Secret': 'env-secret',
      'X-Custom': 'v',
    });
  });

  it('lets a --header flag override a CF header case-insensitively (no comma-joined duplicates)', () => {
    const merged = mergeCfAccessHeaders(cfEnv, { 'cf-access-client-id': 'cli-id' });
    expect(merged['cf-access-client-id']).toBe('cli-id');
    // The env-derived spelling must be gone entirely — two spellings of the
    // same header would be sent comma-joined and rejected by Access.
    expect(merged['CF-Access-Client-Id']).toBeUndefined();
    expect(merged['CF-Access-Client-Secret']).toBe('env-secret');
  });

  it('is just the CLI headers when no CF pair is configured', () => {
    expect(mergeCfAccessHeaders({}, { 'X-Custom': 'v' })).toEqual({ 'X-Custom': 'v' });
  });
});

describe('checkStartupConfig: the confirmation signing key (#341)', () => {
  it('rejects a key too short to sign with', () => {
    const env = cleanEnv();
    env.MCP_REQUEST_STATE_KEY = 'nowhere near long enough';
    const { errors } = checkStartupConfig(env, 'http');
    // The codec throws on this, but it is built per request in HTTP mode — so
    // without a boot-time check the operator meets it as a confirmation that
    // mysteriously fails, once per attempt, forever.
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain('MCP_REQUEST_STATE_KEY');
    expect(errors[0]).toContain('openssl rand -hex 32');
  });

  it('accepts a key of exactly the minimum length', () => {
    const env = cleanEnv();
    env.MCP_REQUEST_STATE_KEY = 'x'.repeat(32);
    expect(checkStartupConfig(env, 'http').errors).toEqual([]);
  });

  it('says nothing when it is unset, because generating one is supported', () => {
    expect(checkStartupConfig(cleanEnv(), 'http').errors).toEqual([]);
  });

  it('reports the placeholder rather than the length when the value is unexpanded', () => {
    const env = cleanEnv();
    env.MCP_REQUEST_STATE_KEY = '${MCP_REQUEST_STATE_KEY}';
    const { errors } = checkStartupConfig(env, 'http');
    // Both checks would fire on this string. Only the one naming the actual
    // cause is useful, so the length check stands aside for it.
    expect(errors).toHaveLength(1);
    expect(errors[0]).not.toContain('32 bytes');
  });
});
