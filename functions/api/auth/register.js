import {
  hashPassword,
  createSession,
  sessionCookie,
  isValidUsername,
  isValidEmail,
  json,
  errorResponse,
} from '../../_lib/auth.js';
import { getSettings } from '../../_lib/settings.js';

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

  const isAdminSignup = env.ADMIN_EMAIL && email === String(env.ADMIN_EMAIL).toLowerCase();
  if (!isAdminSignup) {
    const settings = await getSettings(env);
    if (!settings.registrationEnabled) {
      return errorResponse('Registration is currently closed', 403);
    }
  }

  if (!isValidUsername(username)) {
    return errorResponse('Username must be 3-32 characters, lowercase letters, numbers, and hyphens only', 400);
  }
  if (!isValidEmail(email)) {
    return errorResponse('Please enter a valid email address', 400);
  }
  if (password.length < 8) {
    return errorResponse('Password must be at least 8 characters', 400);
  }

  const existingUsername = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();
  if (existingUsername) {
    return errorResponse('That username is already taken', 409);
  }

  const existingEmail = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existingEmail) {
    return errorResponse('An account with that email already exists', 409);
  }

  const userId = crypto.randomUUID();
  const siteId = crypto.randomUUID();
  const now = new Date().toISOString();
  const passwordHash = await hashPassword(password);
  const role = env.ADMIN_EMAIL && email === String(env.ADMIN_EMAIL).toLowerCase() ? 'admin' : 'user';

  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO users (id, email, username, password_hash, role, banned, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    ).bind(userId, email, username, passwordHash, role, now),
    env.DB.prepare(
      'INSERT INTO sites (id, user_id, username, published, updated_at, view_count, storage_bytes) VALUES (?, ?, ?, 0, ?, 0, 0)'
    ).bind(siteId, userId, username, now),
  ]);

  const token = await createSession(env, userId);

  return json({ userId, username }, { status: 201, headers: { 'Set-Cookie': sessionCookie(token) } });
}
