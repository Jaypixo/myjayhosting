import { json } from '../../../_lib/auth.js';

const DAYS = 30;

export async function onRequestGet(context) {
  const { env } = context;
  const today = new Date().toISOString().slice(0, 10);
  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (DAYS - 1));
  const sinceDate = since.toISOString().slice(0, 10);

  const [sentToday, totals, opens, bounces, unsubscribes, daily, topErrors] = await Promise.all([
    env.DB.prepare(`SELECT COUNT(*) AS count FROM email_log WHERE created_at >= ?`).bind(today).first(),
    env.DB.prepare(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN status IN ('sent', 'delivered') THEN 1 ELSE 0 END) AS delivered,
         SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_log`
    ).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM email_log WHERE opened = 1`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM bounce_suppression`).first(),
    env.DB.prepare(`SELECT COUNT(*) AS count FROM notification_prefs WHERE unsubscribed = 1`).first(),
    env.DB.prepare(
      `SELECT substr(created_at, 1, 10) AS date,
              SUM(CASE WHEN status IN ('sent', 'delivered') THEN 1 ELSE 0 END) AS sent,
              SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM email_log
       WHERE created_at >= ?
       GROUP BY date ORDER BY date ASC`
    ).bind(sinceDate).all(),
    env.DB.prepare(
      `SELECT error, COUNT(*) AS count FROM email_log
       WHERE status = 'failed' AND error IS NOT NULL
       GROUP BY error ORDER BY count DESC LIMIT 5`
    ).all(),
  ]);

  const total = totals.total || 0;
  const delivered = totals.delivered || 0;

  return json({
    sentToday: sentToday.count,
    totalSent: total,
    totalFailed: totals.failed || 0,
    deliveryRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0,
    openRate: delivered > 0 ? Math.round((opens.count / delivered) * 1000) / 10 : 0,
    bounceCount: bounces.count,
    unsubscribeCount: unsubscribes.count,
    last30Days: daily.results,
    topErrors: topErrors.results,
  });
}
