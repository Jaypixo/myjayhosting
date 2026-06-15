import { contentTypeFor, isAllowedFile, sanitizeFilePath, getStorageUsed } from '../../_lib/storage.js';
import { json, errorResponse } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const user = data.user;

  let formData;
  try {
    formData = await request.formData();
  } catch {
    return errorResponse('Expected multipart/form-data', 400);
  }

  const files = formData.getAll('files').filter((entry) => entry instanceof File);
  if (files.length === 0) {
    return errorResponse('No files provided', 400);
  }

  for (const file of files) {
    if (!isAllowedFile(file.name)) {
      return errorResponse(`File type not allowed: ${file.name}`, 400);
    }
  }

  const maxTotal = Number(env.MAX_UPLOAD_BYTES) || 50 * 1024 * 1024;
  const currentUsage = await getStorageUsed(env, user.username);
  const incomingSize = files.reduce((sum, file) => sum + file.size, 0);
  if (currentUsage + incomingSize > maxTotal) {
    return errorResponse('Upload would exceed your 50MB storage quota', 413);
  }

  const uploaded = [];
  for (const file of files) {
    const relPath = sanitizeFilePath(file.name);
    if (!relPath) continue;
    const key = `sites/${user.username}/${relPath}`;
    await env.SITES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: contentTypeFor(relPath) },
    });
    uploaded.push(relPath);
  }

  const now = new Date().toISOString();
  const storageBytes = await getStorageUsed(env, user.username);
  await env.DB.prepare('UPDATE sites SET updated_at = ?, storage_bytes = ? WHERE user_id = ?')
    .bind(now, storageBytes, user.id)
    .run();

  return json({ uploaded });
}
