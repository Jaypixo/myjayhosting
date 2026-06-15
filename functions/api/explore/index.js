import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;

  const recent = await env.DB.prepare(
    `SELECT s.username, s.updated_at, s.view_count, u.bio, u.site_title
     FROM sites s JOIN users u ON s.user_id = u.id
     WHERE s.published = 1
     ORDER BY s.updated_at DESC
     LIMIT 24`
  ).all();

  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS total_sites, COALESCE(SUM(view_count), 0) AS total_views FROM sites`
  ).first();

  return json({
    sites: recent.results.map((site) => ({
      username: site.username,
      siteTitle: site.site_title,
      bio: site.bio,
      updatedAt: site.updated_at,
      viewCount: site.view_count,
    })),
    stats: {
      totalSites: totals.total_sites,
      totalViews: totals.total_views,
    },
  });
}
