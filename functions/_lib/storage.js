// Shared R2 storage helpers for site files.

export const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

export function extensionOf(filename) {
  const idx = filename.lastIndexOf('.');
  return idx === -1 ? '' : filename.slice(idx + 1).toLowerCase();
}

export function contentTypeFor(filename) {
  return CONTENT_TYPES[extensionOf(filename)] || 'application/octet-stream';
}

export function isAllowedFile(filename) {
  return extensionOf(filename) in CONTENT_TYPES;
}

// Strips path traversal segments and leading slashes, returning a clean
// relative path safe to append after `sites/{username}/`.
export function sanitizeFilePath(path) {
  return String(path)
    .split('/')
    .map((p) => p.trim())
    .filter((p) => p && p !== '.' && p !== '..')
    .join('/');
}

export async function getSiteForUser(env, userId) {
  return env.DB.prepare('SELECT * FROM sites WHERE user_id = ?').bind(userId).first();
}

export async function listSiteObjects(env, username) {
  const prefix = `sites/${username}/`;
  const objects = [];
  let cursor;
  do {
    const result = await env.SITES.list({ prefix, cursor, limit: 1000 });
    objects.push(...result.objects);
    cursor = result.truncated ? result.cursor : undefined;
  } while (cursor);
  return objects;
}

export async function getStorageUsed(env, username) {
  const objects = await listSiteObjects(env, username);
  return objects.reduce((sum, obj) => sum + obj.size, 0);
}
