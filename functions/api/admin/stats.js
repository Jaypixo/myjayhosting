import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;

  const userCount = await env.DB.prepare('SELECT COUNT(*) AS count FROM users').first();
  const siteAgg = await env.DB.prepare(
    `SELECT COUNT(*) AS count,
            COALESCE(SUM(CASE WHEN published = 1 THEN 1 ELSE 0 END), 0) AS published_count,
            COALESCE(SUM(storage_bytes), 0) AS total_storage
     FROM sites`
  ).first();

  return json({
    totalUsers: userCount.count,
    totalSites: siteAgg.count,
    publishedSites: siteAgg.published_count,
    totalStorageBytes: siteAgg.total_storage,
  });
}
