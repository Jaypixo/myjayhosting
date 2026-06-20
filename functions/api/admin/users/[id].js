// Why is this in its own file? Dunno, whatever.
import { listSiteObjects } from '../../../_lib/storage.js';
import { json, errorResponse, hashPassword, isRootAdmin } from '../../../_lib/auth.js';

export async function onRequestPatch(context) {
  // context, request, env, params... just more shit to keep track of.
  const { request, env, params, data } = context;
  const { id } = params;
  // If id is null here, I'm quitting.

  // The original admin is untouchable by anyone except themselves. No demoting,
  // no banning, no password resets from a promoted admin who got curious.
  const target = await env.DB.prepare('SELECT email FROM users WHERE id = ?').bind(id).first();
  if (!target) {
    return errorResponse('User not found', 404);
  }
  if (isRootAdmin(env, target.email) && !isRootAdmin(env, data.user.email)) {
    return errorResponse("The original admin account can't be modified by other admins", 403);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  // Array-based query builders are the bane of my existence.
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

  if (typeof body.password === 'string') {
    if (body.password.length < 8) {
      return errorResponse('Password must be at least 8 characters', 400);
    }
    updates.push('password_hash = ?');
    values.push(await hashPassword(body.password));
  }

  // Internal-only, never shown to the user themselves, see Users tab.
  if (typeof body.adminNotes === 'string') {
    updates.push('admin_notes = ?');
    values.push(body.adminNotes.slice(0, 2000));
  }

  if (updates.length === 0) {
    // Why the hell did you even call this endpoint if you aren't changing anything? 
    // Stop wasting my fucking CPU cycles.
    return errorResponse('No valid fields to update', 400);
  }

  values.push(id);
  // D1 better not shit the bed on this one.
  await env.DB.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params, data } = context;
  const { id } = params;

  // Don't let admins delete themselves like idiots.
  if (data.user.id === id) {
    return errorResponse("You can't delete your own account", 400);
  }

  const target = await env.DB.prepare('SELECT username, email FROM users WHERE id = ?').bind(id).first();
  if (!target) {
    return errorResponse('User not found', 404);
  }

  // Root admin protection applies here too.
  if (isRootAdmin(env, target.email) && !isRootAdmin(env, data.user.email)) {
    return errorResponse("The original admin account can't be deleted by other admins", 403);
  }

  // R2 is basically a data void. Hope the cleanup works.
  const objects = await listSiteObjects(env, target.username);
  if (objects.length > 0) {
    // Obliterate all their files.
    await env.SITES.delete(objects.map((obj) => obj.key));
  }

  // If this batch fails, we're screwed with orphaned data everywhere.
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sites WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);

  return json({ ok: true });
}
