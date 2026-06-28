import { json, errorResponse } from '../../../../_lib/auth.js';
import { callCrawler } from '../../../../_lib/crawler-client.js';

export async function onRequestPatch(context) {
  const { request, env, params, data } = context;
  const sub = await env.DB.prepare('SELECT * FROM submissions WHERE id = ?').bind(params.id).first();
  if (!sub) return errorResponse('Not found', 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (body.action !== 'approve' && body.action !== 'reject') {
    return errorResponse('action must be approve or reject', 400);
  }

  if (body.action === 'approve') {
    const result = await callCrawler(env, 'crawl-url', { url: sub.url, triggeredBy: `admin:${data.user.email}` });
    if (!result.ok) return errorResponse(result.error || 'Crawl failed to start', 502);
  }

  const now = new Date().toISOString();
  await env.DB.prepare(
    'UPDATE submissions SET status = ?, reviewed_at = ?, reviewed_by = ? WHERE id = ?'
  ).bind(body.action === 'approve' ? 'approved' : 'rejected', now, data.user.email, params.id).run();

  return json({ ok: true });
}
