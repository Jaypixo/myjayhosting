// myjay-mailer: the ONE and ONLY place this godforsaken platform talks to Resend.
// Everything else (Pages Functions, the router, whatever the hell else) goes through
// a service binding, NOT the Resend API directly. Why? Because centralizing this shit
// in one place means we only have to keep the API key from leaking in one fucking location.
// Also means every send gets logged and suppressed consistently, no matter which part
// of the app was dumb enough to call it.
//
// Deploy: wrangler deploy mailer/mailer.js --name myjay-mailer --config mailer/wrangler.toml
// Bindings: DB (D1, same as the rest), RESEND_API_KEY (the fucking secret)

// Shit that HAS to go out no matter what the recipient thinks.
// Everything else gets gated by notification_prefs, but these three?
// Nope. Can't opt out of 'your password got changed' emails, sorry.
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

async function logSend(env, { id, recipient, type, subject, bodyHtml, status, resendId, userId, error }) {
  await env.DB.prepare(
    `INSERT INTO email_log (id, recipient, type, subject, body_html, status, opened, bounced, resend_id, user_id, error, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 0, ?, ?, ?, ?)`
  )
    .bind(id, recipient, type, subject, bodyHtml || null, status, resendId || null, userId || null, error || null, new Date().toISOString())
    .run();
}

async function sendViaResend(env, { to, subject, bodyHtml }) {
  if (!env.RESEND_API_KEY) {
    return { ok: false, resendId: null, error: 'RESEND_API_KEY secret is not set on this Worker' };
  }

  let res;
  try {
    res = await fetch('https://api.resend.com/emails', {
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
  } catch (err) {
    return { ok: false, resendId: null, error: `Could not reach Resend: ${err.message}` };
  }

  const body = await res.json().catch(() => ({}));
  if (res.ok) {
    return { ok: true, resendId: body.id || null, error: null };
  }

  // Resend returns fucking { statusCode, name, message } when it goes sideways.
  // We throw both the name and message at the user because that's the only way
  // they'll figure out if it's a "domain not verified" bullshit or an actual error.
  const detail = body.message
    ? `${body.name ? `[${body.name}] ` : ''}${body.message}`
    : `Resend returned HTTP ${res.status}`;
  return { ok: false, resendId: null, error: detail };
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
    const bypassPrefs = Boolean(body.bypassPrefs);

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
      await logSend(env, { id: logId, recipient: to, type, subject, bodyHtml, status: 'failed', userId, error: 'Recipient is on the bounce suppression list' });
      return jsonResponse({ ok: false, skipped: 'suppressed', logId });
    }

    // Non-transactional sends respect the recipient's notification_prefs.
    // Transactional sends (verify, reset, security alerts) always go out,
    // an account holder can't opt out of knowing their password changed.
    // bypassPrefs is the explicit opt-out of that check: send.js sets it
    // unconditionally for one-off admin_message sends (a one-off is, by
    // definition, addressed to one specific person on purpose, not a
    // category someone can blanket-mute), and broadcast.js sets it only
    // when the admin ticks "bypass preferences" for that specific send.
    // It never bypasses bounce_suppression above, a hard-bounced address
    // still can't be delivered to regardless of preferences.
    if (!transactional && !bypassPrefs && (await isUnsubscribed(env, userId, type))) {
      await logSend(env, { id: logId, recipient: to, type, subject, bodyHtml, status: 'failed', userId, error: `Recipient unsubscribed from "${type}"` });
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
      error: result.error,
    });

    if (!result.ok) {
      return jsonResponse({ ok: false, error: result.error, logId }, 502);
    }

    return jsonResponse({ ok: true, resendId: result.resendId, logId });
  },
};
