import { getSiteForUser } from '../../_lib/storage.js';
import { json } from '../../_lib/auth.js';

const DAYS = 30;

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;

  const site = await getSiteForUser(env, user.id);
  if (!site) {
    return json({ totalViews: 0, last30Days: [], countries: [] });
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (DAYS - 1));
  const sinceDate = since.toISOString().slice(0, 10);

  let last30Days = [];
  let countries = [];

  try {
    const daily = await env.DB.prepare(
      `SELECT date, SUM(views) AS views FROM site_view_stats
       WHERE site_id = ? AND date >= ?
       GROUP BY date ORDER BY date ASC`
    ).bind(site.id, sinceDate).all();
    last30Days = daily.results;

    const byCountry = await env.DB.prepare(
      `SELECT country, SUM(views) AS views FROM site_view_stats
       WHERE site_id = ? GROUP BY country ORDER BY views DESC LIMIT 10`
    ).bind(site.id).all();
    countries = byCountry.results;
  } catch {
    // site_view_stats doesn't exist yet (migration not run). Stats are
    // empty until the admin runs schema/migrate-001-site-view-stats.sql.
  }

  return json({
    totalViews: site.view_count,
    last30Days,
    countries,
  });
}
