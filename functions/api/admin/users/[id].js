// Why the fuck is this in its own file? Whatever.
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

  // Guard against the admin nuking himself because he's a fucking idiot.
  if (data.user.id === id) {
    return errorResponse("You can't delete your own account", 400);
  }

  const target = await env.DB.prepare('SELECT username, email FROM users WHERE id = ?').bind(id).first();
  if (!target) {
    return errorResponse('User not found', 404);
  }

  // Same deal as PATCH: the original admin can't be deleted by anyone else.
  if (isRootAdmin(env, target.email) && !isRootAdmin(env, data.user.email)) {
    return errorResponse("The original admin account can't be deleted by other admins", 403);
  }

  // R2 is basically a black hole for data. Let's hope this cleanup actually works.
  const objects = await listSiteObjects(env, target.username);
  if (objects.length > 0) {
    // Nuke their files from orbit. It's the only way to be sure.
    await env.SITES.delete(objects.map((obj) => obj.key));
  }

  // If this batch fails, we're left with orphaned data and I'm going to scream.
  // SQL transactions in a serverless environment... what could go wrong?
  await env.DB.batch([
    env.DB.prepare('DELETE FROM sites WHERE user_id = ?').bind(id),
    env.DB.prepare('DELETE FROM users WHERE id = ?').bind(id),
  ]);

  return json({ ok: true });
}
