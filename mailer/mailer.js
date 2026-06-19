// myjay-mailer: the only thing in this whole platform that talks to Resend.
// Every other piece (Pages Functions, the router) calls this Worker over a
// service binding, never the Resend API directly. That keeps the API key in
// exactly one place and gives every send a single, consistent log/suppression
// check, regardless of which part of the app triggered it.
//
// Deploy: wrangler deploy mailer/mailer.js --name myjay-mailer --config mailer/wrangler.toml
// Bindings required: DB (D1, same database as the rest of the platform)
// Secret required: RESEND_API_KEY

// Sends that must always go out regardless of the recipient's notification
// preferences. Everything else is gated by notification_prefs.
const TRANSACTIONAL_TYPES = new Set(['verify', 'reset', 'security_alert']);

const VALID_TYPES = new Set([
  'verify', 'reset', 'security_alert',
  'admin_message', 'broadcast', 'blog_notification',
]);

const FROM_ADDRESS = 'MyJay.net <noreply@myjay.net>';

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

async function isSuppressed(env, email) {
  const row = await env.DB.prepare('SELECT email FROM bounce_suppression WHERE email = ?')
    .bind(email.toLowerCase())
    .first();
  return Boolean(row);
}

async function isUnsubscribed(env, userId, type) {
  if (!userId) return false;
  const row = await env.DB.prepare(
    'SELECT unsubscribed FROM notification_prefs WHERE user_id = ? AND type = ?'
  )
    .bind(userId, type)
    .first();
  return Boolean(row && row.unsubscribed);
}

async function logSend(env, { id, recipient, type, subject, bodyHtml, status, resendId, userId }) {
  await env.DB.prepare(
    `INSERT INTO email_log (id, recipient, type, subject, body_html, status, opened, bounced, resend_id, user_id, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?)`
  )
    .bind(id, recipient, type, subject, bodyHtml || null, status, resendId || null, userId || null, new Date().toISOString())
    .run();
}

async function sendViaResend(env, { to, subject, bodyHtml }) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM_ADDRESS,
      to: [to],
      subject,
      html: bodyHtml,
    }),
  });

  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, resendId: body.id || null, error: res.ok ? null : (body.message || `Resend returned ${res.status}`) };
}

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return jsonResponse({ error: 'Invalid JSON body' }, 400);
    }

    const to = String(body.to || '').trim().toLowerCase();
    const type = String(body.type || '');
    const subject = String(body.subject || '');
    const bodyHtml = String(body.bodyHtml || '');
    const userId = body.userId || null;

    if (!to || !to.includes('@')) {
      return jsonResponse({ error: 'A valid "to" address is required' }, 400);
    }
    if (!VALID_TYPES.has(type)) {
      return jsonResponse({ error: `"type" must be one of: ${[...VALID_TYPES].join(', ')}` }, 400);
    }
    if (!subject || !bodyHtml) {
      return jsonResponse({ error: '"subject" and "bodyHtml" are required' }, 400);
    }

    const logId = crypto.randomUUID();
    const transactional = TRANSACTIONAL_TYPES.has(type);

    // Hard-bounced addresses are skipped outright, transactional or not,
    // there's no inbox on the other end to deliver to.
    if (await isSuppressed(env, to)) {
      await logSend(env, { id: logId, recipient: to, type, subject, bodyHtml, status: 'failed', userId });
      return jsonResponse({ ok: false, skipped: 'suppressed', logId });
    }

    // Non-transactional sends respect the recipient's notification_prefs.
    // Transactional sends (verify, reset, security alerts) always go out,
    // an account holder can't opt out of knowing their password changed.
    if (!transactional && (await isUnsubscribed(env, userId, type))) {
      await logSend(env, { id: logId, recipient: to, type, subject, bodyHtml, status: 'failed', userId });
      return jsonResponse({ ok: false, skipped: 'unsubscribed', logId });
    }

    const result = await sendViaResend(env, { to, subject, bodyHtml });

    await logSend(env, {
      id: logId,
      recipient: to,
      type,
      subject,
      bodyHtml,
      status: result.ok ? 'sent' : 'failed',
      resendId: result.resendId,
      userId,
    });

    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error, logId }, 502);
    }

    return jsonResponse({ ok: true, resendId: result.resendId, logId });
  },
};
