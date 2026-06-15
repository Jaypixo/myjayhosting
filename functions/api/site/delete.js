import { sanitizeFilePath, getStorageUsed } from '../../_lib/storage.js';
import { json, errorResponse } from '../../_lib/auth.js';

export async function onRequestDelete(context) {
  const { request, env, data } = context;
  const user = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const relPath = sanitizeFilePath(body.key || '');
  if (!relPath) {
    return errorResponse('Invalid file key', 400);
  }

  await env.SITES.delete(`sites/${user.username}/${relPath}`);

  const now = new Date().toISOString();
  const storageBytes = await getStorageUsed(env, user.username);
  await env.DB.prepare('UPDATE sites SET updated_at = ?, storage_bytes = ? WHERE user_id = ?')
    .bind(now, storageBytes, user.id)
    .run();

  return json({ ok: true });
}
