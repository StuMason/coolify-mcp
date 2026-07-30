import type { APIRoute } from 'astro';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

export const prerender = false;

/**
 * Contact form → SES.
 *
 * Env (set these in Coolify on the docs app):
 *   AWS_REGION             e.g. eu-west-2
 *   AWS_ACCESS_KEY_ID
 *   AWS_SECRET_ACCESS_KEY
 *   CONTACT_TO             defaults to hey@stumason.dev
 *   CONTACT_FROM           must be an SES-verified identity on the domain
 */
const TO = process.env.CONTACT_TO || 'hey@stumason.dev';
const FROM = process.env.CONTACT_FROM || 'site@stumason.dev';
const REGION = process.env.AWS_REGION || 'eu-west-2';

const MAX = { name: 120, email: 200, company: 160, message: 5000 } as const;

/**
 * For header-bound fields (name, email, company → SES Subject / Reply-To):
 * reject anything that could inject headers, and clamp length.
 */
function clean(value: FormDataEntryValue | null, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, limit);
}

/**
 * For the message body: newlines are content there, not an injection vector —
 * the body is not a header, and flattening it delivers every multi-paragraph
 * enquiry as one long line. Only \r goes (normalising CRLF to LF), plus the
 * same clamp.
 */
function cleanBody(value: FormDataEntryValue | null, limit: number): string {
  if (typeof value !== 'string') return '';
  return value.replace(/\r/g, '').trim().slice(0, limit);
}

const EMAIL_RE = /^[^@\s]+@[^@\s.]+\.[^@\s]+$/;

const json = (body: unknown, status: number): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * Same-origin check, done here rather than by Astro's `security.checkOrigin`.
 *
 * That built-in rejected genuine same-origin browser submissions with a 403 —
 * reproduced with a real browser fetch, and again with the configured `site`
 * pointed at the dev host so origin, host and site all agreed. A contact form
 * that 403s every real enquiry is worse than no contact form, so the check is
 * explicit and testable here instead.
 *
 * A missing Origin is allowed: `<form method=post>` without JS does not always
 * send one, and the worst a forged submission achieves is an email to the site
 * owner. Rate limiting, not origin checking, is the control that matters here —
 * see `rateLimited` below.
 *
 * Compared against the request's own Host rather than a hardcoded list. A
 * literal list of hostnames is the exact class of hand-maintained fact this
 * project keeps getting bitten by — a Coolify-generated FQDN, a `www.`, or a
 * port change would 403 every enquiry, which is the bug being fixed.
 */
function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  // Behind Traefik the forwarded host is the one the browser actually used.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!host) return false;
  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

/**
 * In-process sliding window, because this endpoint sends email to a real
 * inbox on an unauthenticated POST.
 *
 * Without it, a loop of `curl -X POST .../api/contact` is one SES message per
 * request: the inbox, the SES bill, and — the one that actually hurts — the
 * sending domain's reputation, since SES suspends identities on complaint and
 * bounce rates. The honeypot only catches bots that fill every field, and a
 * script does not need a browser.
 *
 * Single instance, so a Map is enough; if this ever runs more than one replica
 * the limit becomes per-replica and needs moving to shared state.
 */
const WINDOW_MS = 10 * 60 * 1000;
const PER_IP = 3;
const GLOBAL_CEILING = 60;
const hits = new Map<string, number[]>();

function rateLimited(request: Request): boolean {
  const ip =
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    request.headers.get('x-real-ip') ||
    'unknown';
  const now = Date.now();
  const cutoff = now - WINDOW_MS;

  let total = 0;
  for (const [key, times] of hits) {
    const recent = times.filter((t) => t > cutoff);
    if (recent.length === 0) hits.delete(key);
    else {
      hits.set(key, recent);
      total += recent.length;
    }
  }
  if (total >= GLOBAL_CEILING) return true;

  const mine = hits.get(ip) ?? [];
  if (mine.length >= PER_IP) return true;
  mine.push(now);
  hits.set(ip, mine);
  return false;
}

/** Reject an oversized body before `formData()` buffers all of it into memory. */
const MAX_BODY_BYTES = 64 * 1024;

export const POST: APIRoute = async ({ request }) => {
  if (!originAllowed(request)) {
    return json({ error: 'That request did not come from this site.' }, 403);
  }

  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > MAX_BODY_BYTES) {
    return json({ error: 'That message is too long. Send a shorter one.' }, 413);
  }

  if (rateLimited(request)) {
    return json(
      { error: 'That is a few too many in a short spell. Email hey@stumason.dev instead.' },
      429,
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'That form could not be read. Try again.' }, 400);
  }

  // Honeypot: a real person never sees this field, so anything in it is a bot.
  // Answer 200 so the bot believes it succeeded and does not retry.
  //
  // Logged, because browser autofill does sometimes populate a field named
  // `website` regardless of autocomplete="off". When that happens a real
  // enquiry is discarded while the sender is told it sent — the precise
  // failure this endpoint exists to avoid — and the log line is the only way
  // anyone would ever find out.
  if (clean(form.get('website'), 100)) {
    console.warn('[contact] honeypot triggered — discarded, and this may be a false positive', {
      from: clean(form.get('email'), MAX.email),
    });
    return json({ ok: true }, 200);
  }

  const name = clean(form.get('name'), MAX.name);
  const email = clean(form.get('email'), MAX.email);
  const company = clean(form.get('company'), MAX.company);
  const message = cleanBody(form.get('message'), MAX.message);

  if (!name || !email || !message) {
    return json({ error: 'Name, email and a message are all needed.' }, 400);
  }
  if (!EMAIL_RE.test(email)) {
    return json({ error: 'That email address does not look right.' }, 400);
  }

  // Fail loudly at the point of use rather than sending into a void. A contact
  // form that silently drops enquiries is worse than one that is visibly down.
  if (!process.env.AWS_ACCESS_KEY_ID || !process.env.AWS_SECRET_ACCESS_KEY) {
    console.error('[contact] SES credentials are not configured — enquiry NOT delivered', {
      from: email,
    });
    return json(
      { error: 'The form is not wired up right now. Email hey@stumason.dev and it reaches me.' },
      503,
    );
  }

  const body = [
    `Name:    ${name}`,
    `Email:   ${email}`,
    company ? `Company: ${company}` : null,
    '',
    message,
    '',
    '— sent from coolify-mcp.stumason.dev',
  ]
    .filter((l) => l !== null)
    .join('\n');

  try {
    const ses = new SESv2Client({ region: REGION });
    await ses.send(
      new SendEmailCommand({
        FromEmailAddress: FROM,
        Destination: { ToAddresses: [TO] },
        ReplyToAddresses: [email],
        Content: {
          Simple: {
            Subject: { Data: `coolify-mcp enquiry — ${name}${company ? ` (${company})` : ''}` },
            Body: { Text: { Data: body } },
          },
        },
      }),
    );
  } catch (error) {
    // Log the whole thing server-side; the enquiry is otherwise lost.
    console.error('[contact] SES send failed', error, { from: email, name, company });
    return json(
      { error: 'That did not send. Email hey@stumason.dev and it will reach me directly.' },
      502,
    );
  }

  // Non-JS submissions land here, so give them a real page rather than raw JSON.
  if (!request.headers.get('accept')?.includes('application/json')) {
    return new Response(null, { status: 303, headers: { Location: '/?sent=1#contact' } });
  }
  return json({ ok: true }, 200);
};
