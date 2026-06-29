import { json, errorResponse } from '../../../../_lib/auth.js';
import { callCrawler } from '../../../../_lib/crawler-client.js';

export async function onRequestGet(context) {
  const { env, params } = context;
  const site = await env.DB.prepare('SELECT * FROM search_sites WHERE id = ?').bind(params.id).first();
  if (!site) return errorResponse('Site not found', 404);

  const { results: pages } = await env.DB.prepare(
    `SELECT id, url, title, word_count, http_status, crawled_at FROM search_pages
     WHERE site_id = ? ORDER BY crawled_at DESC LIMIT 200`
  ).bind(site.id).all();

  return json({
    id: site.id,
    platform: site.platform,
    domain: site.domain,
    rootUrl: site.root_url,
    title: site.title,
    status: site.status,
    firstIndexedAt: site.first_indexed_at,
    lastCrawledAt: site.last_crawled_at,
    lastAttemptedAt: site.last_attempted_at,
    consecutiveFailures: site.consecutive_failures,
    pages: pages.map((p) => ({
      id: p.id,
      url: p.url,
      title: p.title,
      wordCount: p.word_count,
      httpStatus: p.http_status,
      crawledAt: p.crawled_at,
    })),
  });
}

export async function onRequestPatch(context) {
  const { request, env, params, data } = context;
  const site = await env.DB.prepare('SELECT * FROM search_sites WHERE id = ?').bind(params.id).first();
  if (!site) return errorResponse('Site not found', 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (body.action === 'recrawl') {
    const result = await callCrawler(env, 'recrawl-site', { siteId: site.id, triggeredBy: `admin:${data.user.email}` });
    if (!result.ok) return errorResponse(result.error || 'Re-crawl failed to start', 502);
    return json({ ok: true });
  }

  if (body.action === 'block') {
    await env.DB.batch([
      env.DB.prepare(
        'INSERT OR IGNORE INTO blocklist (id, domain, reason, source, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)'
      ).bind(crypto.randomUUID(), site.domain, body.reason || null, 'admin_manual', data.user.email, new Date().toISOString()),
      env.DB.prepare("UPDATE search_sites SET status = 'blocked' WHERE id = ?").bind(site.id),
    ]);
    return json({ ok: true });
  }

  if (body.action === 'unblock') {
    await env.DB.batch([
      env.DB.prepare('DELETE FROM blocklist WHERE domain = ?').bind(site.domain),
      env.DB.prepare("UPDATE search_sites SET status = 'active' WHERE id = ?").bind(site.id),
    ]);
    return json({ ok: true });
  }

  return errorResponse('Unknown action', 400);
}
