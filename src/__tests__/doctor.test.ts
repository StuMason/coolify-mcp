import { jest, describe, it, expect } from '@jest/globals';
import { runDoctor, runDoctorCli, type DoctorReport } from '../lib/doctor.js';

const BASE = 'https://coolify.example.com';

const cleanEnv = (): NodeJS.ProcessEnv => ({
  COOLIFY_BASE_URL: BASE,
  COOLIFY_ACCESS_TOKEN: '7|sentinelsecretvaluesentinelsecretvaluesentinel',
});

type FetchLike = typeof fetch;

function jsonResponse(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/**
 * A healthy Coolify 4.1.2: version answers (unauth probe gets 401, auth gets
 * the version string), ability gates let us through with the pre-4.2 shapes,
 * and the routing catch-all has its `docs` key.
 */
function healthyFetch(): jest.Mock {
  return jest.fn(async (url: unknown, init?: unknown) => {
    const path = String(url).replace(`${BASE}/api/v1`, '');
    const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
    const authed = Boolean(headers?.Authorization);
    if (path === '/version') {
      return authed
        ? new Response('4.1.2', { status: 200 })
        : jsonResponse(401, { message: 'Unauthenticated.' });
    }
    if (path === '/enable' || path === '/deploy') {
      return jsonResponse(400, { message: 'Invalid uuid.' });
    }
    return jsonResponse(404, { message: 'Not found.', docs: 'https://coolify.io/docs' });
  });
}

function check(
  report: DoctorReport,
  name: string,
): { status: string; detail: string; fix?: string } {
  const found = report.instances[0].checks.find((c) => c.check === name);
  if (!found) throw new Error(`no such check: ${name}`);
  return found;
}

describe('runDoctor', () => {
  it('passes everything against a healthy instance', async () => {
    const report = await runDoctor(cleanEnv(), healthyFetch() as unknown as FetchLike);
    expect(report.ok).toBe(true);
    expect(check(report, 'config').status).toBe('pass');
    expect(check(report, 'reachability').status).toBe('pass');
    expect(check(report, 'token').status).toBe('pass');
    expect(check(report, 'version').status).toBe('pass');
    expect(check(report, 'version').detail).toContain('4.1.2');
    expect(check(report, 'abilities').status).toBe('pass');
    expect(check(report, 'abilities').detail).toContain('read, write, deploy');
    expect(check(report, 'api-shape').status).toBe('pass');
    expect(check(report, 'runtime').status).toBe('pass');
  });

  // #368 story 1: the macOS Keychain stored `${COOLIFY_ACCESS_TOKEN}` and a
  // team ripped the integration out over silent 401s.
  it('names the unexpanded-placeholder token and skips the auth probes', async () => {
    const env = cleanEnv();
    env.COOLIFY_ACCESS_TOKEN = '${COOLIFY_ACCESS_TOKEN}';
    const fetchMock = healthyFetch();
    const report = await runDoctor(env, fetchMock as unknown as FetchLike);
    expect(report.ok).toBe(false);
    expect(check(report, 'config').status).toBe('fail');
    expect(check(report, 'config').detail).toContain('unexpanded');
    expect(check(report, 'token').status).toBe('skipped');
    // No request may carry the placeholder as a credential.
    for (const call of fetchMock.mock.calls) {
      const headers = (call[1] as RequestInit | undefined)?.headers as Record<string, string>;
      expect(headers?.Authorization ?? '').not.toContain('${');
    }
  });

  // #368 story 3 (herdctl): config passed in the wrong shape = nothing set.
  it('fails config when nothing is set, and skips every probe', async () => {
    const fetchMock = jest.fn();
    const report = await runDoctor({}, fetchMock as unknown as FetchLike);
    expect(report.ok).toBe(false);
    expect(check(report, 'config').detail).toContain('COOLIFY_BASE_URL is unset');
    expect(check(report, 'config').detail).toContain('COOLIFY_ACCESS_TOKEN is unset');
    expect(check(report, 'reachability').status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  // #368 story 4 (hospital-reunioes): 401s with a syntactically fine token.
  it('reports a rejected token with a fix', async () => {
    const fetchMock = jest.fn(async (url: unknown, init?: unknown) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (headers?.Authorization) return jsonResponse(401, { message: 'Unauthenticated.' });
      return jsonResponse(401, { message: 'Unauthenticated.' });
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    expect(report.ok).toBe(false);
    expect(check(report, 'reachability').status).toBe('pass');
    expect(check(report, 'token').status).toBe('fail');
    expect(check(report, 'token').fix).toContain('fresh token');
    expect(check(report, 'abilities').status).toBe('skipped');
  });

  // The 2026-09-08 estate incident signature: 302 to the Access login page
  // on every call while the container's own health check stays green.
  it('detects Cloudflare Access interception and points at the service-token fix', async () => {
    const fetchMock = jest.fn(
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://team.cloudflareaccess.com/cdn-cgi/access/login/x' },
        }),
    );
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    expect(report.ok).toBe(false);
    const reach = check(report, 'reachability');
    expect(reach.status).toBe('fail');
    expect(reach.detail).toContain('Cloudflare Access');
    expect(reach.fix).toContain('CF_ACCESS_CLIENT_ID');
  });

  it('reports missing abilities from the upstream 403 body without failing the run', async () => {
    const fetchMock = jest.fn(async (url: unknown, init?: unknown) => {
      const path = String(url).replace(`${BASE}/api/v1`, '');
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (path === '/version') {
        return headers?.Authorization
          ? new Response('4.2.5', { status: 200 })
          : jsonResponse(401, { message: 'Unauthenticated.' });
      }
      if (path === '/deploy') {
        return jsonResponse(403, { message: 'Missing required permissions: deploy' });
      }
      if (path === '/enable') {
        return jsonResponse(405, { message: 'This endpoint has changed to a POST request.' });
      }
      return jsonResponse(404, { message: 'Not found.', docs: 'https://coolify.io/docs' });
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    expect(report.ok).toBe(true);
    const abilities = check(report, 'abilities');
    expect(abilities.status).toBe('warn');
    expect(abilities.detail).toContain('token lacks: deploy');
    expect(abilities.detail).toContain('read, write');
  });

  it('distinguishes the Member-role hard block from missing abilities', async () => {
    const fetchMock = jest.fn(async (url: unknown, init?: unknown) => {
      const path = String(url).replace(`${BASE}/api/v1`, '');
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (path === '/version') {
        return headers?.Authorization
          ? new Response('4.3.1', { status: 200 })
          : jsonResponse(401, { message: 'Unauthenticated.' });
      }
      if (path === '/enable' || path === '/deploy') {
        return jsonResponse(403, {
          message: 'This API token has permissions that exceed your current role as a team member.',
        });
      }
      return jsonResponse(404, { message: 'Not found.', docs: 'x' });
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    const abilities = check(report, 'abilities');
    expect(abilities.status).toBe('warn');
    expect(abilities.detail).toContain('team role');
  });

  it('warns when the Coolify version is outside the tested range', async () => {
    const fetchMock = healthyFetch();
    fetchMock.mockImplementation(async (url: unknown, init?: unknown) => {
      const path = String(url).replace(`${BASE}/api/v1`, '');
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (path === '/version') {
        return headers?.Authorization
          ? new Response('4.9.0', { status: 200 })
          : jsonResponse(401, { message: 'Unauthenticated.' });
      }
      if (path === '/enable' || path === '/deploy') return jsonResponse(400, { message: 'x' });
      return jsonResponse(404, { message: 'Not found.', docs: 'x' });
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    const version = check(report, 'version');
    expect(version.status).toBe('warn');
    expect(version.detail).toContain('4.9.0');
  });

  it('warns when the routing catch-all loses the shape our fallback detection reads', async () => {
    const fetchMock = healthyFetch();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: unknown, init?: unknown) => {
      if (String(url).includes('doctor-probe-')) {
        return jsonResponse(404, { error: 'not found' });
      }
      return base(url, init) as Promise<Response>;
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    expect(check(report, 'api-shape').status).toBe('warn');
  });

  it('reports an unreachable Coolify as a reachability failure, not a token one', async () => {
    const fetchMock = jest.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    expect(check(report, 'reachability').status).toBe('fail');
    expect(check(report, 'token').status).toBe('skipped');
  });

  it('treats a non-Cloudflare redirect as a warning and keeps probing', async () => {
    const fetchMock = healthyFetch();
    const base = fetchMock.getMockImplementation()!;
    let first = true;
    fetchMock.mockImplementation(async (url: unknown, init?: unknown) => {
      if (first) {
        // Only the unauthenticated reachability probe sees the redirect.
        first = false;
        return new Response(null, {
          status: 301,
          headers: { location: 'https://coolify.example.com/api/v1/version' },
        });
      }
      return base(url, init) as Promise<Response>;
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    const reach = check(report, 'reachability');
    expect(reach.status).toBe('warn');
    expect(reach.fix).toContain('final URL');
    expect(check(report, 'token').status).toBe('pass');
  });

  it('skips reachability when the base URL is set but unusable', async () => {
    const env = cleanEnv();
    env.COOLIFY_BASE_URL = 'not a url at all';
    const fetchMock = jest.fn();
    const report = await runDoctor(env, fetchMock as unknown as FetchLike);
    expect(check(report, 'config').status).toBe('fail');
    expect(check(report, 'reachability').status).toBe('skipped');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('reports a token lacking read from the version endpoint 403', async () => {
    const fetchMock = jest.fn(async (url: unknown, init?: unknown) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (headers?.Authorization) {
        return jsonResponse(403, { message: 'Missing required permissions: read' });
      }
      return jsonResponse(401, { message: 'Unauthenticated.' });
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    const token = check(report, 'token');
    expect(token.status).toBe('fail');
    expect(token.detail).toContain('lacks the "read" ability');
    expect(check(report, 'version').status).toBe('skipped');
  });

  it('reports the Member-role block from the version endpoint 403', async () => {
    const fetchMock = jest.fn(async (url: unknown, init?: unknown) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (headers?.Authorization) {
        return jsonResponse(403, {
          message: 'permissions exceed your current role as a team member',
        });
      }
      return jsonResponse(401, { message: 'Unauthenticated.' });
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    expect(check(report, 'token').detail).toContain('team role');
  });

  it('marks the token check inconclusive on an unexpected status or a thrown probe', async () => {
    const unexpected = jest.fn(async (url: unknown, init?: unknown) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (headers?.Authorization) return new Response('oops', { status: 500 });
      return jsonResponse(401, { message: 'Unauthenticated.' });
    });
    let report = await runDoctor(cleanEnv(), unexpected as unknown as FetchLike);
    expect(check(report, 'token').status).toBe('inconclusive');

    const throwing = jest.fn(async (url: unknown, init?: unknown) => {
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (headers?.Authorization) throw new TypeError('boom');
      return jsonResponse(401, { message: 'Unauthenticated.' });
    });
    report = await runDoctor(cleanEnv(), throwing as unknown as FetchLike);
    expect(check(report, 'token').status).toBe('inconclusive');
  });

  it('treats an unrecognized 403 body or a thrown ability probe as not-missing', async () => {
    const fetchMock = jest.fn(async (url: unknown, init?: unknown) => {
      const path = String(url).replace(`${BASE}/api/v1`, '');
      const headers = (init as RequestInit | undefined)?.headers as Record<string, string>;
      if (path === '/version') {
        return headers?.Authorization
          ? new Response('4.1.2', { status: 200 })
          : jsonResponse(401, { message: 'Unauthenticated.' });
      }
      if (path === '/enable') return new Response('forbidden', { status: 403 });
      if (path === '/deploy') throw new TypeError('boom');
      return jsonResponse(404, { message: 'Not found.', docs: 'x' });
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    const abilities = check(report, 'abilities');
    // Unknown is not proof of a missing ability — report only what's proven.
    expect(abilities.status).toBe('pass');
    expect(abilities.detail).toContain('read');
    expect(abilities.detail).not.toContain('write');
  });

  it('marks api-shape inconclusive when the probe itself fails', async () => {
    const fetchMock = healthyFetch();
    const base = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation(async (url: unknown, init?: unknown) => {
      if (String(url).includes('doctor-probe-')) throw new TypeError('boom');
      return base(url, init) as Promise<Response>;
    });
    const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
    expect(check(report, 'api-shape').status).toBe('inconclusive');
  });

  it('reports config warnings as a warn without blocking the probes', async () => {
    const env = cleanEnv();
    env.COOLIFY_BASE_URL = `${BASE}/api`;
    const fetchMock = jest.fn(async () => jsonResponse(401, { message: 'Unauthenticated.' }));
    const report = await runDoctor(env, fetchMock as unknown as FetchLike);
    const config = check(report, 'config');
    expect(config.status).toBe('warn');
    expect(config.detail).toContain('/api');
    expect(check(report, 'reachability').status).toBe('pass');
  });

  it('warns on a node version below the tested floor', async () => {
    const report = await runDoctor(cleanEnv(), healthyFetch() as unknown as FetchLike, 'v18.19.0');
    const runtime = check(report, 'runtime');
    expect(runtime.status).toBe('warn');
    expect(runtime.fix).toContain('Node 20+');
  });

  // The iron rule: no secret ever reaches the output, whatever went wrong.
  it('never includes the token value anywhere in the report', async () => {
    for (const fetchMock of [
      healthyFetch(),
      jest.fn(async () => jsonResponse(401, { message: 'Unauthenticated.' })),
      jest.fn(async () => {
        throw new TypeError('fetch failed');
      }),
    ]) {
      const report = await runDoctor(cleanEnv(), fetchMock as unknown as FetchLike);
      expect(JSON.stringify(report)).not.toContain('sentinelsecretvalue');
    }
  });
});

describe('runDoctorCli', () => {
  it('prints human-readable lines and exits 0 when healthy', async () => {
    const lines: string[] = [];
    const code = await runDoctorCli(
      cleanEnv(),
      false,
      healthyFetch() as unknown as FetchLike,
      (l) => lines.push(l),
    );
    expect(code).toBe(0);
    const output = lines.join('\n');
    expect(output).toContain('✓ token');
    expect(output).toContain('No failures.');
    expect(output).not.toContain('sentinelsecretvalue');
  });

  it('prints parseable JSON with --json and exits 1 on failure', async () => {
    const lines: string[] = [];
    const code = await runDoctorCli({}, true, jest.fn() as unknown as FetchLike, (l) =>
      lines.push(l),
    );
    expect(code).toBe(1);
    const parsed = JSON.parse(lines.join('\n')) as DoctorReport;
    expect(parsed.ok).toBe(false);
    expect(parsed.instances[0].checks.length).toBeGreaterThan(2);
  });
});
