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

  if (typeof body.published !== 'boolean') {
    return errorResponse('published must be a boolean', 400);
  }

  const now = new Date().toISOString();
  await env.DB.prepare('UPDATE sites SET published = ?, updated_at = ? WHERE id = ?')
    .bind(body.published ? 1 : 0, now, id)
    .run();

  return json({ ok: true });
}

// Nukes all a site's files and resets it to unpublished/empty.
// The sites row stays (one per user is a database invariant).
export async function onRequestDelete(context) {
  const { env, params } = context;
  const { id } = params;

  const site = await env.DB.prepare('SELECT username FROM sites WHERE id = ?').bind(id).first();
  if (!site) {
    return errorResponse('Site not found', 404);
  }

  const objects = await listSiteObjects(env, site.username);
  if (objects.length > 0) {
    await env.SITES.delete(objects.map((obj) => obj.key));
  }

  await env.DB.prepare('UPDATE sites SET published = 0, storage_bytes = 0, updated_at = ? WHERE id = ?')
    .bind(new Date().toISOString(), id)
    .run();

  return json({ ok: true });
}
