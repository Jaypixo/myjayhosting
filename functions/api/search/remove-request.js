import { json, errorResponse } from '../../_lib/auth.js';

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

  // No requester contact info required, on purpose: a URL and an optional
  // reason is the whole form. See CLAUDE.md's "Indie Web Search Engine" section.
  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 1000) || null : null;

  await env.DB.prepare(
    'INSERT INTO removal_requests (id, url, reason, status, created_at) VALUES (?, ?, ?, ?, ?)'
  ).bind(crypto.randomUUID(), parsed.href, reason, 'pending', new Date().toISOString()).run();

  return json({ ok: true });
}
