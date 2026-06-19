import { isValidEmail, errorResponse, json } from '../../_lib/auth.js';
import { sendEmail } from '../../_lib/mailer.js';
import { verifyEmail } from '../../_lib/email-templates.js';

const VERIFY_TTL_SECONDS = 60 * 60 * 24; // 24 hours

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

  const user = await env.DB.prepare('SELECT id, email, email_verified FROM users WHERE email = ?')
    .bind(email)
    .first();

  // Always return the same response whether or not the account exists, or
  // is already verified, same reasoning as password reset: don't let this
  // endpoint be used to probe which emails have accounts.
  if (user && !user.email_verified) {
    const token = crypto.randomUUID();
    await env.SESSIONS.put(`verify:${token}`, user.id, { expirationTtl: VERIFY_TTL_SECONDS });
    const { subject, html } = verifyEmail(token);
    await sendEmail(env, { to: user.email, type: 'verify', subject, bodyHtml: html, userId: user.id });
  }

  return json({ ok: true });
}
