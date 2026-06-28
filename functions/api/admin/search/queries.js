import { json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;

  const { results: topQueries } = await env.DB.prepare(`
    SELECT query, COUNT(*) AS count, MAX(created_at) AS last_searched_at
    FROM search_queries_log
    GROUP BY query
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const { results: zeroResultQueries } = await env.DB.prepare(`
    SELECT query, COUNT(*) AS count, MAX(created_at) AS last_searched_at
    FROM search_queries_log
    WHERE result_count = 0
    GROUP BY query
    ORDER BY count DESC
    LIMIT 20
  `).all();

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - 29);
  const { results: volume } = await env.DB.prepare(`
    SELECT substr(created_at, 1, 10) AS date, COUNT(*) AS count
    FROM search_queries_log
    WHERE created_at >= ?
    GROUP BY date
    ORDER BY date
  `).bind(since.toISOString()).all();

  return json({
    topQueries: topQueries.map((r) => ({ query: r.query, count: r.count, lastSearchedAt: r.last_searched_at })),
    zeroResultQueries: zeroResultQueries.map((r) => ({ query: r.query, count: r.count, lastSearchedAt: r.last_searched_at })),
    last30Days: volume,
  });
}
