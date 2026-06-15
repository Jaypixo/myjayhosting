import { json, errorResponse } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const user = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const published = Boolean(body.published);
  const now = new Date().toISOString();

  await env.DB.prepare('UPDATE sites SET published = ?, updated_at = ? WHERE user_id = ?')
    .bind(published ? 1 : 0, now, user.id)
    .run();

  return json({ ok: true });
}
