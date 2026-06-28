import { json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;

  const totals = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM search_sites) AS total_sites,
      (SELECT COUNT(*) FROM search_pages) AS total_pages,
      (SELECT COUNT(DISTINCT term) FROM search_terms) AS total_terms,
      (SELECT COUNT(*) FROM submissions WHERE status = 'pending') AS pending_submissions,
      (SELECT COUNT(*) FROM removal_requests WHERE status = 'pending') AS pending_removals
  `).first();

  const { results: platforms } = await env.DB.prepare(`
    SELECT platform,
           COUNT(*) AS sites,
           SUM(CASE WHEN status = 'error' THEN 1 ELSE 0 END) AS error_sites,
           MAX(last_crawled_at) AS last_crawled_at
    FROM search_sites
    GROUP BY platform
  `).all();

  const { results: lastRuns } = await env.DB.prepare(`
    SELECT c.platform, c.run_type, c.started_at, c.finished_at, c.status, c.pages_crawled, c.pages_failed
    FROM crawl_log c
    WHERE c.started_at = (SELECT MAX(c2.started_at) FROM crawl_log c2 WHERE c2.platform = c.platform)
  `).all();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  const { results: dailyCounts } = await env.DB.prepare(`
    SELECT substr(crawled_at, 1, 10) AS date, COUNT(*) AS count
    FROM search_pages
    WHERE crawled_at >= ?
    GROUP BY date
    ORDER BY date
  `).bind(since.toISOString()).all();

  return json({
    totalSites: totals.total_sites,
    totalPages: totals.total_pages,
    totalTerms: totals.total_terms,
    pendingSubmissions: totals.pending_submissions,
    pendingRemovals: totals.pending_removals,
    platforms: platforms.map((p) => ({
      platform: p.platform,
      sites: p.sites,
      errorSites: p.error_sites,
      lastCrawledAt: p.last_crawled_at,
    })),
    lastRuns: lastRuns.map((r) => ({
      platform: r.platform,
      runType: r.run_type,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      status: r.status,
      pagesCrawled: r.pages_crawled,
      pagesFailed: r.pages_failed,
    })),
    last30Days: dailyCounts,
  });
}
