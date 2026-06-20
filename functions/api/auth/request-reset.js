import { isValidEmail, errorResponse, json } from '../../_lib/auth.js';
import { sendEmail } from '../../_lib/mailer.js';
import { getEmailSignature } from '../../_lib/settings.js';
import { passwordReset } from '../../_lib/email-templates.js';

const RESET_TTL_SECONDS = 60 * 60; // 1 hour

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  if (!isValidEmail(email)) {
    return errorResponse('Please enter a valid email address', 400, 'email');
  }

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE email = ?').bind(email).first();

  // Same response either way. This endpoint must NOT reveal if an account
  // exists for a given email. That's not optional.
  if (user) {
    const token = crypto.randomUUID();
    await env.SESSIONS.put(`reset:${token}`, user.id, { expirationTtl: RESET_TTL_SECONDS });
    const signature = await getEmailSignature(env);
    const { subject, html } = passwordReset(token, signature);
    await sendEmail(env, { to: user.email, type: 'reset', subject, bodyHtml: html, userId: user.id });
  }

  return json({ ok: true });
}
