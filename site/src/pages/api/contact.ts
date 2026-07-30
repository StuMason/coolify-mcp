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

/** Reject anything that could inject headers, and clamp length. */
function clean(value: FormDataEntryValue | null, limit: number): string {
  if (typeof value !== 'string') return '';
  return value
    .replace(/[\r\n]+/g, ' ')
    .trim()
    .slice(0, limit);
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
 * owner. Rate limiting, not origin checking, is the control that matters here.
 */
const ALLOWED_HOSTS = new Set([
  'coolify-mcp.stumason.dev',
  // dev + preview
  '127.0.0.1:4322',
  'localhost:4322',
  '127.0.0.1:4321',
  'localhost:4321',
]);

function originAllowed(request: Request): boolean {
  const origin = request.headers.get('origin');
  if (!origin) return true;
  try {
    return ALLOWED_HOSTS.has(new URL(origin).host);
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request }) => {
  if (!originAllowed(request)) {
    return json({ error: 'That request did not come from this site.' }, 403);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return json({ error: 'That form could not be read. Try again.' }, 400);
  }

  // Honeypot: a real person never sees this field, so anything in it is a bot.
  // Answer 200 so the bot believes it succeeded and does not retry.
  if (clean(form.get('website'), 100)) {
    return json({ ok: true }, 200);
  }

  const name = clean(form.get('name'), MAX.name);
  const email = clean(form.get('email'), MAX.email);
  const company = clean(form.get('company'), MAX.company);
  const message = clean(form.get('message'), MAX.message);

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
