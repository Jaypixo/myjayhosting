import { sanitizeFilePath, getStorageUsed } from '../../_lib/storage.js';
import { json, errorResponse } from '../../_lib/auth.js';

// R2 has no native move/rename, this is a copy-then-delete. Doubles as
// "move" too: the dashboard's rename prompt pre-fills the current relative
// path, so editing the directory portion is how a file (or a whole folder)
// relocates, there's no separate move UI or endpoint.
async function listByPrefix(env, prefix) {
  const objects = [];
  let cursor;
  do {
    const result = await env.SITES.list({ prefix, cursor, limit: 1000 });
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const user = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const fromPath = sanitizeFilePath(body.from || '');
  const toPath = sanitizeFilePath(body.to || '');
  if (!fromPath || !toPath) return errorResponse('Both "from" and "to" are required', 400);
  if (fromPath === toPath) return json({ ok: true });

  const prefix = `sites/${user.username}/`;
  const fromKey = `${prefix}${fromPath}`;
  const toKey = `${prefix}${toPath}`;

  // A direct hit on the exact key means this is a single file. Folders
  // aren't real R2 objects, just a shared key prefix, so no hit means
  // "treat fromPath as a directory" instead.
  const directHit = await env.SITES.head(fromKey);

  if (directHit) {
    if (await env.SITES.head(toKey)) return errorResponse('A file already exists at that path', 409);
    const obj = await env.SITES.get(fromKey);
    if (!obj) return errorResponse('File not found', 404);
    await env.SITES.put(toKey, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
    await env.SITES.delete(fromKey);
  } else {
    const dirPrefix = fromPath.endsWith('/') ? fromPath : `${fromPath}/`;
    const newDirPrefix = toPath.endsWith('/') ? toPath : `${toPath}/`;
    if (newDirPrefix.startsWith(dirPrefix)) {
      return errorResponse("Can't move a folder inside itself", 400);
    }

    const listed = await listByPrefix(env, `${prefix}${dirPrefix}`);
    if (listed.length === 0) return errorResponse('Nothing found at that path', 404);

    for (const o of listed) {
      const rest = o.key.slice((prefix + dirPrefix).length);
      const obj = await env.SITES.get(o.key);
      if (!obj) continue;
      await env.SITES.put(`${prefix}${newDirPrefix}${rest}`, await obj.arrayBuffer(), { httpMetadata: obj.httpMetadata });
      await env.SITES.delete(o.key);
    }
  }

  const now = new Date().toISOString();
  const storageBytes = await getStorageUsed(env, user.username);
  await env.DB.prepare('UPDATE sites SET updated_at = ?, storage_bytes = ? WHERE user_id = ?')
    .bind(now, storageBytes, user.id)
    .run();

  return json({ ok: true });
}
