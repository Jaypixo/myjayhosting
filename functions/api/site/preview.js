import { sanitizeFilePath, isAllowedFile } from '../../_lib/storage.js';
import { errorResponse } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env, data } = context;
  const user = data.user;

  const url = new URL(request.url);
  const relPath = sanitizeFilePath(url.searchParams.get('key') || '');

  if (!relPath || !isAllowedFile(relPath)) return errorResponse('Invalid file', 400);

  const key = `sites/${user.username}/${relPath}`;
  const obj = await env.SITES.get(key);
  if (!obj) return new Response('Not found', { status: 404 });

  const contentType = obj.httpMetadata?.contentType || 'application/octet-stream';
  return new Response(obj.body, {
    headers: {
      'Content-Type': contentType,
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
