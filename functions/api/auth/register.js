import {
  hashPassword,
  createSession,
  sessionCookie,
  isValidUsername,
  isValidEmail,
  isRootAdmin,
  json,
  errorResponse,
} from '../../_lib/auth.js';
import { getSettings, getEmailSignature } from '../../_lib/settings.js';
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

  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  // admin email always gets through even if registration is closed, otherwise
  // a "close registration" click could permanently lock me out of my own site
  const isAdminSignup = isRootAdmin(env, email);
  if (!isAdminSignup) {
    const settings = await getSettings(env);
    if (!settings.registrationEnabled) {
      return errorResponse('Registration is currently closed', 403);
    }
  }

  if (!isValidUsername(username)) {
    return errorResponse('Username must be 3-32 characters, lowercase letters, numbers, and hyphens only', 400, 'username');
  }
  if (!isValidEmail(email)) {
    return errorResponse('Please enter a valid email address', 400, 'email');
  }
  if (password.length < 8) {
    return errorResponse('Password must be at least 8 characters', 400, 'password');
  }

  const existingUsername = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existingUsername) {
    return errorResponse('That username is already taken', 409, 'username');
  }

  const existingEmail = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existingEmail) {
    return errorResponse('An account with that email already exists', 409, 'email');
  }

  const userId = crypto.randomUUID();
  const siteId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const role = isAdminSignup ? 'admin' : 'user';
  // The bootstrap admin signup can't depend on the mailer working, so it's
  // exempt from email verification, same reasoning as the registration-closed
  // bypass above: this account has to work on the very first try.
  const emailVerified = isAdminSignup ? 1 : 0;

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, email, username, password_hash, role, banned, email_verified, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)'
    ).bind(userId, email, username, passwordHash, role, emailVerified, now),
    env.DB.prepare(
      'INSERT INTO sites (id, user_id, username, published, updated_at, view_count, storage_bytes) VALUES (?, ?, ?, 0, ?, 0, 0)'
    ).bind(siteId, userId, username, now),
  ]);

  if (isAdminSignup) {
    const token = await createSession(env, userId);
    return json(
      { userId, username, verified: true },
      { status: 201, headers: { 'Set-Cookie': sessionCookie(token) } }
    );
  }

  const verifyToken = crypto.randomUUID();
  await env.SESSIONS.put(`verify:${verifyToken}`, userId, { expirationTtl: VERIFY_TTL_SECONDS });

  const signature = await getEmailSignature(env);
  const { subject, html } = verifyEmail(verifyToken, signature);
  await sendEmail(env, { to: email, type: 'verify', subject, bodyHtml: html, userId });

  // No session cookie here on purpose, login is blocked until the address
  // is verified, see functions/api/auth/login.js.
  return json({ userId, username, verified: false }, { status: 201 });
}
