import { json, errorResponse } from '../../_lib/auth.js';

const PLATFORM_SUFFIXES = ['.myjay.net', '.neocities.org', '.nekoweb.org'];

function isSupportedPlatform(hostname) {
  return PLATFORM_SUFFIXES.some((suffix) => hostname.endsWith(suffix) && hostname !== suffix.slice(1));
}

export async function onRequestPost(context) {
  const { request, env } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const rawUrl = String(body.url || '').trim();
  if (!rawUrl) return errorResponse('URL is required', 400, 'url');

  let parsed;
  try {
    parsed = new URL(rawUrl.includes('://') ? rawUrl : `https://${rawUrl}`);
  } catch {
    return errorResponse("That doesn't look like a valid URL", 400, 'url');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return errorResponse('URL must be http or https', 400, 'url');
  }
  if (!isSupportedPlatform(parsed.hostname.toLowerCase())) {
    return errorResponse('MyJay Search only indexes MyJay, Neocities, and Nekoweb sites', 400, 'url');
  }

  const blocked = await env.DB.prepare('SELECT 1 FROM blocklist WHERE domain = ?')
    .bind(parsed.hostname.toLowerCase()).first();
  if (blocked) {
    return errorResponse("This site has been removed from the index and can't be resubmitted", 403, 'url');
  }

  const categoryHint = typeof body.categoryHint === 'string' ? body.categoryHint.trim().slice(0, 60) || null : null;

  await env.DB.prepare(
    'INSERT INTO submissions (id, url, category_hint, status, submitted_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), parsed.href, categoryHint, 'pending', new Date().toISOString()).run();

  return json({ ok: true });
}
