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
 * The rate limiter is module-level state shared across the suite, so every
 * request carries a distinct `x-forwarded-for` unless a test is specifically
 * about the limiter. If tests start failing with 429s, that discipline slipped.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

// Credentials must exist before the module loads so the 503 guard passes by
// default; the one test about missing credentials removes them.
process.env.AWS_ACCESS_KEY_ID = 'test-key';
process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';

const { POST } = await import('../src/pages/api/contact');

let ipCounter = 0;

function post(
  fields: Record<string, string>,
  headers: Record<string, string> = {},
): Promise<Response> {
  const form = new URLSearchParams(fields);
  const body = form.toString();
  return POST({
    request: new Request('https://coolify-mcp.stumason.dev/api/contact', {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        'content-length': String(body.length),
        accept: 'application/json',
        // Distinct IP per request so the per-IP limiter never interferes with
        // unrelated tests.
        'x-forwarded-for': headers['x-forwarded-for'] ?? `10.0.0.${++ipCounter}`,
        ...headers,
      },
      body,
    }),
  } as never) as Promise<Response>;
}

const VALID = {
  name: 'Jane Doe',
  email: 'jane@example.com',
  message: 'I would like to talk about hosting.',
};

beforeEach(() => {
  sendMock.mockReset().mockResolvedValue({});
  commandInputs.length = 0;
});

describe('happy path', () => {
  it('sends the enquiry and returns 200 for JSON clients', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(sendMock).toHaveBeenCalledTimes(1);
    const input = commandInputs[0] as {
      Content: { Simple: { Subject: { Data: string }; Body: { Text: { Data: string } } } };
      ReplyToAddresses: string[];
    };
    expect(input.Content.Simple.Subject.Data).toContain('Jane Doe');
    expect(input.Content.Simple.Body.Text.Data).toContain('hosting');
    expect(input.ReplyToAddresses).toEqual(['jane@example.com']);
  });

  it('redirects non-JS form submissions instead of showing them raw JSON', async () => {
    const res = await post(VALID, { accept: 'text/html' });

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/?sent=1#contact');
  });
});

describe('header injection', () => {
  // The defence this suite exists for: `name` and `email` flow into the SES
  // Subject and Reply-To. A CRLF that survives into either is a header
  // injection into outbound email from the site's own verified identity.
  it('strips CRLF from the name before it reaches the SES subject', async () => {
    await post({ ...VALID, name: 'Jane\r\nBcc: everyone@example.com' });

    const subject = (commandInputs[0] as { Content: { Simple: { Subject: { Data: string } } } })
      .Content.Simple.Subject.Data;
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).toContain('Jane Bcc: everyone@example.com');
  });

  it('rejects an email whose CRLF-stripped form is no longer an address', async () => {
    // `clean` flattens the CRLF to a space, and the space then fails EMAIL_RE
    // — so an injection attempt via the reply-to address is rejected outright
    // rather than half-cleaned and sent.
    const res = await post({ ...VALID, email: 'jane@example.com\r\nBcc: x@y.z' });

    expect(res.status).toBe(400);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('clamps an oversized name rather than passing it through', async () => {
    await post({ ...VALID, name: 'a'.repeat(500) });

    const subject = (commandInputs[0] as { Content: { Simple: { Subject: { Data: string } } } })
      .Content.Simple.Subject.Data;
    // MAX.name is 120; the subject adds a prefix around it.
    expect(subject.length).toBeLessThan(200);
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
    const res = await post(VALID, { 'content-length': String(1024 * 1024) });

    expect(res.status).toBe(413);
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
    const res = await post(VALID, { origin: 'https://evil.example' });

    expect(res.status).toBe(403);
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('accepts a same-origin submission', async () => {
    const res = await post(VALID, {
      origin: 'https://coolify-mcp.stumason.dev',
      host: 'coolify-mcp.stumason.dev',
    });

    expect(res.status).toBe(200);
  });

  it('prefers x-forwarded-host behind the proxy', async () => {
    // Behind Traefik, `host` is the internal container address; the browser's
    // origin matches the forwarded host, not it.
    const res = await post(VALID, {
      origin: 'https://coolify-mcp.stumason.dev',
      host: 'internal:4321',
      'x-forwarded-host': 'coolify-mcp.stumason.dev',
    });

    expect(res.status).toBe(200);
  });

  it('accepts a missing origin, because plain form posts do not always send one', async () => {
    const res = await post(VALID);

    expect(res.status).toBe(200);
  });

  it('rejects a garbage origin header rather than throwing on it', async () => {
    const res = await post(VALID, { origin: 'not a url' });

    expect(res.status).toBe(403);
  });
});

describe('rate limiting', () => {
  it('limits a single IP to three sends per window', async () => {
    const ip = { 'x-forwarded-for': '203.0.113.7' };

    for (let i = 0; i < 3; i++) {
      expect((await post(VALID, ip)).status).toBe(200);
    }
    const fourth = await post(VALID, ip);

    expect(fourth.status).toBe(429);
    expect(sendMock).toHaveBeenCalledTimes(3);
  });

  it('takes the first hop of a multi-hop x-forwarded-for', async () => {
    const chain = { 'x-forwarded-for': '203.0.113.9, 10.0.0.1, 172.16.0.1' };

    for (let i = 0; i < 3; i++) await post(VALID, chain);
    // Same client IP first in the chain, different intermediaries — still the
    // same bucket, so still limited.
    const fourth = await post(VALID, {
      'x-forwarded-for': '203.0.113.9, 10.9.9.9',
    });

    expect(fourth.status).toBe(429);
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

  it('returns 503 rather than pretending to send when credentials are absent', async () => {
    const key = process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_ACCESS_KEY_ID;
    try {
      const res = await post(VALID);

      expect(res.status).toBe(503);
      expect(sendMock).not.toHaveBeenCalled();
    } finally {
      process.env.AWS_ACCESS_KEY_ID = key;
    }
  });
});
