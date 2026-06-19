import { json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const today = new Date().toISOString().slice(0, 10);

  const [sentToday, totals, opens, bounces, unsubscribes] = await Promise.all([
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
  ]);

  const total = totals.total || 0;
  const delivered = totals.delivered || 0;

  return json({
    sentToday: sentToday.count,
    totalSent: total,
    deliveryRate: total > 0 ? Math.round((delivered / total) * 1000) / 10 : 0,
    openRate: delivered > 0 ? Math.round((opens.count / delivered) * 1000) / 10 : 0,
    bounceCount: bounces.count,
    unsubscribeCount: unsubscribes.count,
  });
}
