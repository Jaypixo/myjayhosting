import { json } from '../../../_lib/auth.js';

const PAGE_SIZE = 50;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();
  const platform = url.searchParams.get('platform');
  const status = url.searchParams.get('status');

  const conditions = [];
  const params = [];
  if (q) { conditions.push('domain LIKE ?'); params.push(`%${q}%`); }
  if (platform) { conditions.push('platform = ?'); params.push(platform); }
  if (status) { conditions.push('status = ?'); params.push(status); }
  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  const { results } = await env.DB.prepare(`
    SELECT s.id, s.platform, s.domain, s.root_url, s.title, s.status, s.first_indexed_at,
           s.last_crawled_at, s.last_attempted_at, s.consecutive_failures,
           (SELECT COUNT(*) FROM search_pages p WHERE p.site_id = s.id) AS page_count
    FROM search_sites s
    ${where}
    ORDER BY s.last_attempted_at DESC
    LIMIT ? OFFSET ?
  `).bind(...params, PAGE_SIZE, offset).all();

  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM search_sites ${where}`).bind(...params).first();

  return json({
    sites: results.map((s) => ({
      id: s.id,
      platform: s.platform,
      domain: s.domain,
      rootUrl: s.root_url,
      title: s.title,
      status: s.status,
      pageCount: s.page_count,
      firstIndexedAt: s.first_indexed_at,
      lastCrawledAt: s.last_crawled_at,
      lastAttemptedAt: s.last_attempted_at,
      consecutiveFailures: s.consecutive_failures,
    })),
    total: total.count,
    page,
    limit: PAGE_SIZE,
  });
}
