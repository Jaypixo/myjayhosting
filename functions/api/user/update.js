import { hashPassword, isValidEmail, json, errorResponse } from '../../_lib/auth.js';

export async function onRequestPatch(context) {
  const { request, env, data } = context;
  const user = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const updates = [];
  const values = [];

  if (typeof body.bio === 'string') {
    updates.push('bio = ?');
    values.push(body.bio.slice(0, 1000));
  }

  if (typeof body.siteTitle === 'string') {
    updates.push('site_title = ?');
    values.push(body.siteTitle.slice(0, 200));
  }

  if (typeof body.email === 'string' && body.email.trim()) {
    const email = body.email.trim().toLowerCase();
    if (!isValidEmail(email)) {
      return errorResponse('Please enter a valid email address', 400, 'email');
    }
    if (email !== user.email) {
      const existing = await env.DB.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
      if (existing) {
        return errorResponse('An account with that email already exists', 409, 'email');
      }
    }
    updates.push('email = ?');
    values.push(email);
  }

  if (typeof body.password === 'string' && body.password) {
    if (body.password.length < 8) {
      return errorResponse('Password must be at least 8 characters', 400, 'password');
    }
    updates.push('password_hash = ?');
    values.push(await hashPassword(body.password));
  }

  if (updates.length === 0) {
    return errorResponse('No valid fields to update', 400);
  }

  values.push(user.id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return json({ ok: true });
}
