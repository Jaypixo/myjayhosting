// POST /api/webhooks/resend. Resend delivers webhooks signed the same way
// Svix signs all of its webhooks: a base64 HMAC-SHA256 over
// "{svix-id}.{svix-timestamp}.{raw body}", keyed by a per-endpoint signing
// secret you get from the Resend dashboard when you create the webhook
// (looks like "whsec_..."). That secret is RESEND_WEBHOOK_SECRET, separate
// from RESEND_API_KEY, and is set on the Pages project, not the mailer.
import { errorResponse, json } from '../../_lib/auth.js';

function base64ToBytes(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
}

function bytesToBase64(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)));
}

async function verifySignature(env, request, rawBody) {
  const secret = env.RESEND_WEBHOOK_SECRET;
  if (!secret) return false; // refuse to trust anything if it isn't configured

  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');
  if (!svixId || !svixTimestamp || !svixSignature) return false;

  const secretBytes = base64ToBytes(secret.startsWith('whsec_') ? secret.slice(6) : secret);
  const key = await crypto.subtle.importKey('raw', secretBytes, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const signedContent = `${svixId}.${svixTimestamp}.${rawBody}`;
  const sigBytes = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedContent));
  const expected = bytesToBase64(sigBytes);

  // The header can carry several "v1,<base64>" values space-separated
  // (e.g. during secret rotation), any match is good enough.
  return svixSignature
    .split(' ')
    .map((part) => part.split(',')[1])
    .some((sig) => sig === expected);
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const rawBody = await request.text();

  if (!(await verifySignature(env, request, rawBody))) {
    return errorResponse('Invalid signature', 401);
  }

  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const type = event.type;
  const resendId = event.data?.email_id;
  if (!resendId) {
    // Nothing to correlate this to, acknowledge and move on rather than error.
    return json({ ok: true });
  }

  if (type === 'email.delivered') {
    await env.DB.prepare('UPDATE email_log SET status = ? WHERE resend_id = ?').bind('delivered', resendId).run();
  } else if (type === 'email.opened') {
    await env.DB.prepare('UPDATE email_log SET opened = 1 WHERE resend_id = ?').bind(resendId).run();
  } else if (type === 'email.bounced') {
    const log = await env.DB.prepare('SELECT recipient FROM email_log WHERE resend_id = ?').bind(resendId).first();
    await env.DB.prepare('UPDATE email_log SET status = ?, bounced = 1 WHERE resend_id = ?').bind('bounced', resendId).run();

    if (log) {
      const bounceType = event.data?.bounce?.type || 'unknown';
      await env.DB.prepare(
        `INSERT INTO bounce_suppression (email, reason, created_at) VALUES (?, ?, ?)
         ON CONFLICT(email) DO NOTHING`
      )
        .bind(log.recipient.toLowerCase(), bounceType, new Date().toISOString())
        .run();
    }
  }

  return json({ ok: true });
}
