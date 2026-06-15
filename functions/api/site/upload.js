import { contentTypeFor, isAllowedFile, sanitizeFilePath, getStorageUsed } from '../../_lib/storage.js';
import { json, errorResponse } from '../../_lib/auth.js';

// Another upload endpoint.
export async function onRequestPost(context) {
  const { request, env, data } = context;
  const user = data.user;

  let formData;
  try {
    // Because parsing multipart/form-data is always a joy. fml.
    formData = await request.formData();
  } catch {
    return errorResponse('Expected multipart/form-data', 400);
  }

  // Filter out the non-files. Because users will upload anything. ANYTHING.
  const files = formData.getAll('files').filter((entry) => entry instanceof File);
  if (files.length === 0) {
    // You called an upload endpoint without files? Are you fucking serious?
    return errorResponse('No files provided', 400);
  }

  for (const file of files) {
    if (!isAllowedFile(file.name)) {
      return errorResponse(`File type not allowed: ${file.name}`, 400);
    }
  }

  // check-then-write, so two uploads landing at the exact same moment could
  // both slip past this and put someone slightly over quota. not fixing that
  // for now, worst case is someone's site is 51MB instead of 50.
  // If it breaks, it's a "known issue" for the next poor bastard.
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
    // Constructing the R2 key. Hope nobody tries to inject anything here.
    const key = `sites/${user.username}/${relPath}`;
    // Finally, actually putting the file. R2 better not be slow today.
    // TODO: Rate limit this or something, because if R2 is slow, this endpoint is gonna be a nightmare.
    await env.SITES.put(key, await file.arrayBuffer(), {
      httpMetadata: { contentType: contentTypeFor(relPath) },
    });
    uploaded.push(relPath);
  }

  // Update the site's metadata. Because consistency is apparently important.
  const now = new Date().toISOString();
  const storageBytes = await getStorageUsed(env, user.username);
  await env.DB.prepare('UPDATE sites SET updated_at = ?, storage_bytes = ? WHERE user_id = ?')
    .bind(now, storageBytes, user.id)
    .run();

  return json({ uploaded });
}
