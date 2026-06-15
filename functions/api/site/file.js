import { sanitizeFilePath, isAllowedFile, extensionOf } from '../../_lib/storage.js';
import { json, errorResponse } from '../../_lib/auth.js';

// Extensions the dashboard's textarea editor can open and save.
const TEXT_EXTENSIONS = new Set(['html', 'htm', 'css', 'js', 'json', 'xml', 'txt', 'md', 'svg']);

export async function onRequestGet(context) {
  const { request, env, data } = context;
  const user = data.user;

  const url = new URL(request.url);
  const relPath = sanitizeFilePath(url.searchParams.get('key') || '');

  if (!relPath || !isAllowedFile(relPath) || !TEXT_EXTENSIONS.has(extensionOf(relPath))) {
    return errorResponse('File is not editable as text', 400);
  }

  const object = await env.SITES.get(`sites/${user.username}/${relPath}`);
  if (!object) {
    return errorResponse('File not found', 404);
  }

  return json({ key: relPath, content: await object.text() });
}
