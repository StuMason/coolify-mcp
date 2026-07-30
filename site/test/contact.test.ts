/**
 * Tests for the contact endpoint (#319).
 *
 * Everything goes through the real POST handler with synthetic `Request`s
 * rather than unit-testing the private helpers, because the property that
 * matters — attacker-controlled form fields never reaching SES headers intact —
 * is a property of the whole pipeline, and exporting the helpers to test them
 * separately would leave the wiring between them untested.
 *
 * SES is mocked at the module boundary; no test here sends email.
 *
 * The rate limiter is module-level state shared across the suite, keyed on
 * Date.now(). Fake timers advance the clock past the window in `beforeEach`,
 * so every test starts with an empty limiter and no test can trip another's
 * budget — including the GLOBAL_CEILING one, which deliberately burns sixty
 * hits. Distinct per-request IPs are kept as belt and braces.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import type { APIContext } from 'astro';

const sendMock = vi.hoisted(() => vi.fn());
const commandInputs = vi.hoisted(() => [] as Array<Record<string, unknown>>);

vi.mock('@aws-sdk/client-sesv2', () => ({
  SESv2Client: class {
    send = sendMock;
  },
  SendEmailCommand: class {
    input: Record<string, unknown>;
    constructor(input: Record<string, unknown>) {
      this.input = input;
      commandInputs.push(input);
    }
  },
}));

// The credentials guard reads process.env at request time, not module load —
// the 503 tests rely on that by deleting a var after import. These are set
// here so every other test passes the guard.
process.env.AWS_ACCESS_KEY_ID = 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

const { POST } = await import('../src/pages/api/contact');

/** Mirrors WINDOW_MS in contact.ts; the beforeEach advance must exceed it. */
const WINDOW_MS = 10 * 60 * 1000;

vi.useFakeTimers();
afterAll(() => vi.useRealTimers());

let ipCounter = 0;

interface PostOptions {
  headers?: Record<string, string>;
  /** Omit x-forwarded-for entirely — for the 'unknown' bucket tests. */
  noForwardedFor?: boolean;
}

function makeContext(request: Request): APIContext {
  // Only `request` is read by the handler. A full APIContext would drag in
  // cookies/session/locals machinery no test needs, so this narrows honestly:
  // if the handler starts reading more of the context, tests fail loudly on
  // the missing property instead of silently on a half-mocked one.
  return { request } as unknown as APIContext;
}

function post(fields: Record<string, string>, options: PostOptions = {}): Promise<Response> {
  const { headers = {}, noForwardedFor = false } = options;
  const form = new URLSearchParams(fields);
  const body = form.toString();
  const requestHeaders: Record<string, string> = {
    'content-type': 'application/x-www-form-urlencoded',
    'content-length': String(body.length),
    accept: 'application/json',
    ...headers,
  };
  // Distinct IP per request unless a test is specifically about the limiter.
  if (!noForwardedFor && !('x-forwarded-for' in requestHeaders)) {
    requestHeaders['x-forwarded-for'] = `10.0.0.${++ipCounter}`;
  }
  return Promise.resolve(
    POST(
      makeContext(
        new Request('https://coolify-mcp.stumason.dev/api/contact', {
          method: 'POST',
          headers: requestHeaders,
          body,
        }),
      ),
    ),
  );
}

const VALID = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  message: 'I would like to talk about hosting.',
};

type SesInput = {
  FromEmailAddress: string;
  Destination: { ToAddresses: string[] };
  ReplyToAddresses: string[];
  Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string } } } };
};

const lastSubject = (): string => (commandInputs.at(-1) as SesInput).Content.Simple.Subject.Data;

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({});
  commandInputs.length = 0;
  // Empty the limiter: everything recorded so far falls out of the window.
  vi.advanceTimersByTime(WINDOW_MS + 1000);
});

describe('happy path', () => {
  it('sends the enquiry and returns 200 for JSON clients', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const input = commandInputs[0] as SesInput;
    expect(input.Content.Simple.Subject.Data).toContain('Jane Doe');
    expect(input.Content.Simple.Body.Text.Data).toContain('hosting');
    expect(input.ReplyToAddresses).toEqual(['jane@example.com']);
    // From and To decide where an enquiry goes; neither may ever be wired
    // from form input.
    expect(input.FromEmailAddress).toBe('site@stumason.dev');
    expect(input.Destination.ToAddresses).toEqual(['hey@stumason.dev']);
  });

  it('redirects non-JS form submissions instead of showing them raw JSON', async () => {
    const res = await post(VALID, { headers: { accept: 'text/html' } });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?sent=1#contact');
  });

  it('accepts the multipart encoding the real browser form actually sends', async () => {
    // index.astro submits `new FormData(form)` — multipart, not urlencoded.
    // request.formData() handles both, but the shape real users send should
    // not be the one shape the suite never exercises.
    const form = new FormData();
    for (const [k, v] of Object.entries(VALID)) form.append(k, v);
    const res = await Promise.resolve(
      POST(
        makeContext(
          new Request('https://coolify-mcp.stumason.dev/api/contact', {
            method: 'POST',
            headers: { accept: 'application/json', 'x-forwarded-for': `10.1.0.${++ipCounter}` },
            body: form,
          }),
        ),
      ),
    );

    expect(res.status).toBe(200);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });
});

describe('header injection', () => {
  // The defence this suite exists for: `name`, `company` and `email` flow into
  // the SES Subject and Reply-To. A CRLF that survives into either is a header
  // injection into outbound email from the site's own verified identity.
  it('strips CRLF from the name before it reaches the SES subject', async () => {
    await post({ ...VALID, name: 'Jane\r\nBcc: everyone@example.com' });

    expect(lastSubject()).not.toMatch(/[\r\n]/);
    expect(lastSubject()).toContain('Jane Bcc: everyone@example.com');
  });

  it('strips CRLF from the company before it reaches the SES subject', async () => {
    // The second attacker-controlled field landing in the subject, via the
    // `(company)` suffix.
    await post({ ...VALID, company: 'Acme\r\nBcc: everyone@example.com' });

    expect(lastSubject()).not.toMatch(/[\r\n]/);
    expect(lastSubject()).toContain('(Acme Bcc: everyone@example.com)');
  });

  it('rejects an email whose CRLF-stripped form is no longer an address', async () => {
    // `clean` flattens the CRLF to a space, and the space then fails EMAIL_RE
    // — so an injection attempt via the reply-to address is rejected outright
    // rather than half-cleaned and sent.
    const res = await post({ ...VALID, email: 'jane@example.com\r\nBcc: x@y.z' });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('clamps the name at exactly its limit', async () => {
    await post({ ...VALID, name: 'a'.repeat(500) });

    // MAX.name is 120. Pinned exactly, so this fails if the limit moves —
    // a `lessThan` here would keep passing while the clamp quietly widened.
    expect(lastSubject()).toBe(`coolify-mcp enquiry — ${'a'.repeat(120)}`);
  });
});

describe('validation', () => {
  it('rejects a missing message', async () => {
    const res = await post({ name: 'Jane', email: 'jane@example.com', message: '' });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it.each(['not-an-email', 'a@b', 'a b@c.com', '@example.com'])(
    'rejects the malformed address %s',
    async (email) => {
      const res = await post({ ...VALID, email });

      expect(res.status).toBe(400);
      expect(sendMock).not.toHaveBeenCalled();
    },
  );

  it('rejects a body whose declared size could not be a real enquiry', async () => {
    const res = await post(VALID, { headers: { 'content-length': String(1024 * 1024) } });

    expect(res.status).toBe(413);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('answers an unreadable body with 400, not a crash', async () => {
    const res = await Promise.resolve(
      POST(
        makeContext(
          new Request('https://coolify-mcp.stumason.dev/api/contact', {
            method: 'POST',
            headers: {
              // Declares multipart but carries no boundary, so formData()
              // rejects.
              'content-type': 'multipart/form-data',
              accept: 'application/json',
              'x-forwarded-for': `10.2.0.${++ipCounter}`,
            },
            body: 'not a form',
          }),
        ),
      ),
    );

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('honeypot', () => {
  it('discards the submission but tells the bot it succeeded', async () => {
    const res = await post({ ...VALID, website: 'https://spam.example' });

    // 200, not an error: a bot that believes it succeeded does not retry.
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendMock).not.toHaveBeenCalled();
  });
});

describe('origin checking', () => {
  it('rejects a cross-origin submission', async () => {
    const res = await post(VALID, { headers: { origin: 'https://evil.example' } });

    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('accepts a same-origin submission', async () => {
    const res = await post(VALID, {
      headers: { origin: 'https://coolify-mcp.stumason.dev', host: 'coolify-mcp.stumason.dev' },
    });

    expect(res.status).toBe(200);
  });

  it('prefers x-forwarded-host behind the proxy', async () => {
    // Behind Traefik, `host` is the internal container address; the browser's
    // origin matches the forwarded host, not it.
    const res = await post(VALID, {
      headers: {
        origin: 'https://coolify-mcp.stumason.dev',
        host: 'internal:4321',
        'x-forwarded-host': 'coolify-mcp.stumason.dev',
      },
    });

    expect(res.status).toBe(200);
  });

  it('accepts a missing origin, because plain form posts do not always send one', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
  });

  it('rejects a garbage origin header rather than throwing on it', async () => {
    const res = await post(VALID, { headers: { origin: 'not a url' } });

    expect(res.status).toBe(403);
  });
});

describe('rate limiting', () => {
  // These tests document how the limiter buckets requests, NOT a security
  // guarantee. The key is the first hop of x-forwarded-for — client-supplied
  // text unless the edge proxy replaces it. That is safe only because
  // Cloudflare/Traefik sit in front and rewrite XFF; deployed anywhere that
  // trusts inbound XFF, the per-IP limit is bypassable by lying, and only
  // GLOBAL_CEILING stands.
  it('limits a single IP to three sends per window', async () => {
    const ip = { headers: { 'x-forwarded-for': '203.0.113.7' } };

    for (let i = 0; i < 3; i++) {
      expect((await post(VALID, ip)).status).toBe(200);
    }
    const fourth = await post(VALID, ip);

    expect(fourth.status).toBe(429);
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it('lets the same IP through again once the window has passed', async () => {
    const ip = { headers: { 'x-forwarded-for': '203.0.113.8' } };
    for (let i = 0; i < 3; i++) expect((await post(VALID, ip)).status).toBe(200);
    expect((await post(VALID, ip)).status).toBe(429);

    vi.advanceTimersByTime(WINDOW_MS + 1000);

    // Window expiry is also what keeps the hits map from growing without
    // bound — the eviction branch only runs when old entries age out.
    expect((await post(VALID, ip)).status).toBe(200);
  });

  it('takes the first hop of a multi-hop x-forwarded-for', async () => {
    const chain = { headers: { 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 172.16.0.1' } };

    for (let i = 0; i < 3; i++) {
      expect((await post(VALID, chain)).status).toBe(200);
    }
    // Same client IP first in the chain, different intermediaries — still the
    // same bucket, so still limited.
    const fourth = await post(VALID, {
      headers: { 'x-forwarded-for': '203.0.113.9, 10.9.9.9' },
    });

    expect(fourth.status).toBe(429);
  });

  it('falls back to x-real-ip when x-forwarded-for is absent', async () => {
    const realIp = { headers: { 'x-real-ip': '198.51.100.4' }, noForwardedFor: true };

    for (let i = 0; i < 3; i++) expect((await post(VALID, realIp)).status).toBe(200);

    expect((await post(VALID, realIp)).status).toBe(429);
  });

  it('collapses everyone into one bucket when no client IP header survives', async () => {
    // The failure mode most likely to actually happen: the app deployed
    // somewhere that strips or never sets XFF/x-real-ip. Every visitor then
    // shares the 'unknown' bucket and the whole site gets three enquiries per
    // window — a self-inflicted outage this test at least makes visible.
    const anon = { noForwardedFor: true };

    for (let i = 0; i < 3; i++) expect((await post(VALID, anon)).status).toBe(200);

    expect((await post(VALID, anon)).status).toBe(429);
  });

  it('stops everything at the global ceiling regardless of IP spread', async () => {
    // Sixty sends from sixty different IPs — the backstop when per-IP
    // bucketing has been defeated (e.g. spoofed XFF), and the branch the
    // per-IP tests can never reach.
    for (let i = 0; i < 60; i++) {
      const res = await post(VALID, { headers: { 'x-forwarded-for': `192.0.2.${i}` } });
      expect(res.status).toBe(200);
    }
    const overCeiling = await post(VALID, {
      headers: { 'x-forwarded-for': '198.51.100.99' },
    });

    expect(overCeiling.status).toBe(429);
  });
});

describe('failure honesty', () => {
  it('returns 502 with an alternative route when SES fails', async () => {
    sendMock.mockRejectedValueOnce(new Error('ses down'));

    const res = await post(VALID);

    expect(res.status).toBe(502);
    const body = (await res.json()) as { error: string };
    // The user must leave knowing their message did NOT arrive and how to
    // reach a human anyway — a contact form that silently drops enquiries is
    // the failure the endpoint's own comments call out.
    expect(body.error).toContain('did not send');
    expect(body.error).toContain('hey@stumason.dev');
  });

  it.each(['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY'])(
    'returns 503 rather than pretending to send when %s is absent',
    async (name) => {
      const value = process.env[name];
      delete process.env[name];
      try {
        const res = await post(VALID);

        expect(res.status).toBe(503);
        expect(sendMock).not.toHaveBeenCalled();
      } finally {
        process.env[name] = value;
      }
    },
  );
});
