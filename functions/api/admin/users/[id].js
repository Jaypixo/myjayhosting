import { listSiteObjects } from '../../../_lib/storage.js';
import { json, errorResponse } from '../../../_lib/auth.js';

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const { id } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const updates = [];
  const values = [];

  if (typeof body.role === 'string') {
    if (!['user', 'admin'].includes(body.role)) {
      return errorResponse('Invalid role', 400);
    }
    updates.push('role = ?');
    values.push(body.role);
  }

  if (typeof body.banned === 'boolean') {
    updates.push('banned = ?');
    values.push(body.banned ? 1 : 0);
  }

  if (updates.length === 0) {
    return errorResponse('No valid fields to update', 400);
  }

  values.push(id);
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params, data } = context;
  const { id } = params;

  if (data.user.id === id) {
    return errorResponse("You can't delete your own account", 400);
  }

  const target = await env.DB.prepare('SELECT username FROM users WHERE id = ?').bind(id).first();
  if (!target) {
    return errorResponse('User not found', 404);
  }

  const objects = await listSiteObjects(env, target.username);
  if (objects.length > 0) {
    await env.SITES.delete(objects.map((obj) => obj.key));
  }

  await env.DB.batch([
    env.DB.prepare('DELETE FROM sites WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);

  return json({ ok: true });
}
