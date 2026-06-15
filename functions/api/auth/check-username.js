import { isValidUsername, json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const username = (url.searchParams.get('u') || '').trim().toLowerCase();

  if (!isValidUsername(username)) {
    return json({ available: false });
  }

  const existing = await env.DB.prepare('SELECT id FROM users WHERE username = ?').bind(username).first();

  return json({ available: !existing });
}
