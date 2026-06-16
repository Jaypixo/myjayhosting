import { sanitizeFilePath } from '../../../_lib/storage.js';
import { json, errorResponse } from '../../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const user = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON', 400);
  }

  const { name, path: currentPath = '' } = body;
  if (!name || typeof name !== 'string') return errorResponse('Folder name required', 400);
  if (!/^[a-zA-Z0-9._-]+$/.test(name)) return errorResponse('Folder name may only contain letters, numbers, hyphens, underscores, and dots', 400);

  const rawPath = currentPath ? `${currentPath}${name}/.keep` : `${name}/.keep`;
  const safePath = sanitizeFilePath(rawPath);
  if (!safePath) return errorResponse('Invalid path', 400);

  const key = `sites/${user.username}/${safePath}`;
  await env.SITES.put(key, new Uint8Array(0), { httpMetadata: { contentType: 'text/plain' } });

  return json({ ok: true, path: safePath });
}
