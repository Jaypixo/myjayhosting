import { json } from '../../../_lib/auth.js';

const PAGE_SIZE = 50;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);

  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const type = url.searchParams.get('type') || '';
  const status = url.searchParams.get('status') || '';
  const since = url.searchParams.get('since') || ''; // ISO date, e.g. 2026-06-01
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  const clauses = [];
  const values = [];
  if (type) { clauses.push('type = ?'); values.push(type); }
  if (status) { clauses.push('status = ?'); values.push(status); }
  if (since) { clauses.push('created_at >= ?'); values.push(since); }
  if (q) { clauses.push('(LOWER(recipient) LIKE ? OR LOWER(subject) LIKE ?)'); values.push(`%${q}%`, `%${q}%`); }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';

  const logs = await env.DB.prepare(
    `SELECT id, recipient, type, subject, status, opened, bounced, resend_id, error, created_at FROM email_log
     ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...values, PAGE_SIZE, offset)
    .all();

  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM email_log ${where}`)
    .bind(...values)
    .first();

  return json({
    logs: logs.results.map((l) => ({
      id: l.id,
      recipient: l.recipient,
      type: l.type,
      subject: l.subject,
      status: l.status,
      opened: Boolean(l.opened),
      bounced: Boolean(l.bounced),
      resendId: l.resend_id,
      error: l.error,
      createdAt: l.created_at,
    })),
    total: total.count,
    page,
    limit: PAGE_SIZE,
  });
}

// Deletes the ENTIRE email log. This is "start fresh", not filtered bulk delete.
// Individual rows go through logs/[id].js instead.
export async function onRequestDelete(context) {
  const { env } = context;
  await env.DB.prepare('DELETE FROM email_log').run();
  return json({ ok: true });
}
