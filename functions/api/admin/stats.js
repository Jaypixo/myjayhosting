import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;

  const userCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const siteAgg = await env.DB.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END), 0) AS published_count,
            COALESCE(SUM(storage_bytes), 0) AS total_storage,
            COALESCE(SUM(view_count), 0) AS total_views
     FROM sites`
  ).first();

  let topCountries = [];
  try {
    const result = await env.DB.prepare(
      `SELECT country, SUM(views) AS views FROM site_view_stats
       GROUP BY country ORDER BY views DESC LIMIT 10`
    ).all();
    topCountries = result.results;
  } catch {
    // site_view_stats table doesn't exist (migration hasn't run yet).
  }

  return json({
    totalUsers: userCount.count,
    totalSites: siteAgg.count,
    publishedSites: siteAgg.published_count,
    totalStorageBytes: siteAgg.total_storage,
    totalViews: siteAgg.total_views,
    topCountries,
  });
}
