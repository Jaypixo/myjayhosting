import { hashPassword, errorResponse, json } from '../../_lib/auth.js';
import { sendEmail } from '../../_lib/mailer.js';
import { getEmailSignature } from '../../_lib/settings.js';
import { securityAlert } from '../../_lib/email-templates.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const token = String(body.token || '');
  const password = String(body.password || '');

  if (!token) {
    return errorResponse('Missing or invalid reset link', 400);
  }
  if (password.length < 8) {
    return errorResponse('Password must be at least 8 characters', 400, 'password');
  }

  const userId = await env.SESSIONS.get(`reset:${token}`);
  if (!userId) {
    return errorResponse('This reset link has expired or already been used', 400);
  }

  const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(userId).first();
  if (!user) {
    return errorResponse('This reset link has expired or already been used', 400);
  }

  const passwordHash = await hashPassword(password);
  await env.DB.prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, userId).run();
  await env.SESSIONS.delete(`reset:${token}`);

  // Always transactional, the account holder gets told their password
  // changed whether or not they're the one who triggered it.
  const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
  const location = [request.cf?.city, request.cf?.country].filter(Boolean).join(', ') || 'unknown';
  const signature = await getEmailSignature(env);
  const { subject, html } = securityAlert('Password changed', ip, location, signature);
  await sendEmail(env, { to: user.email, type: 'security_alert', subject, bodyHtml: html, userId: user.id });

  return json({ ok: true });
}
