import { json } from '../../../_lib/auth.js';

const PAGE_SIZE = 25;

// Full crawl history, paginated -- distinct from /api/admin/search/stats's
// "last run per platform" snapshot, this is every run, every platform,
// newest first, for actually digging into what happened over time.
export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;

  const { results } = await env.DB.prepare(
    `SELECT id, platform, run_type, started_at, finished_at, status, pages_crawled, pages_failed, triggered_by, error
     FROM crawl_log ORDER BY started_at DESC LIMIT ? OFFSET ?`
  ).bind(PAGE_SIZE, offset).all();

  const total = await env.DB.prepare('SELECT COUNT(*) AS count FROM crawl_log').first();

  return json({
    runs: results.map((r) => ({
      id: r.id,
      platform: r.platform,
      runType: r.run_type,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      pagesCrawled: r.pages_crawled,
      pagesFailed: r.pages_failed,
      triggeredBy: r.triggered_by,
      error: r.error,
    })),
    total: total.count,
    page,
    limit: PAGE_SIZE,
  });
}
