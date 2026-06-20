import { errorResponse, json } from '../../../_lib/auth.js';
import { sendEmail } from '../../../_lib/mailer.js';
import { getEmailSignature } from '../../../_lib/settings.js';
import { applyPlaceholders } from '../../../_lib/placeholders.js';
import { buildUnsubscribeToken, unsubscribeUrl } from '../../../_lib/unsubscribe.js';
import { broadcastAnnouncement } from '../../../_lib/email-templates.js';

// Segments are a fixed, known-safe set of queries, not raw SQL from the
// request body, an admin panel that accepts arbitrary SQL is one bad paste
// away from a very bad day. "custom" covers the rest via a small set of
// allowed, parameterized filters instead.
const SEGMENT_QUERIES = {
  all: 'SELECT id, email, username, role, site_title FROM users WHERE banned = 0',
  published: `SELECT u.id, u.email, u.username, u.role, u.site_title FROM users u JOIN sites s ON s.user_id = u.id WHERE u.banned = 0 AND s.published = 1`,
  unpublished: `SELECT u.id, u.email, u.username, u.role, u.site_title FROM users u JOIN sites s ON s.user_id = u.id WHERE u.banned = 0 AND s.published = 0`,
  inactive_30d: `SELECT u.id, u.email, u.username, u.role, u.site_title FROM users u JOIN sites s ON s.user_id = u.id WHERE u.banned = 0 AND s.updated_at < datetime('now', '-30 days')`,
};

async function resolveCustomSegment(env, filter) {
  const clauses = ['banned = 0'];
  const values = [];

  if (filter.role === 'admin' || filter.role === 'user') {
    clauses.push('role = ?');
    values.push(filter.role);
  }
  if (typeof filter.emailVerified === 'boolean') {
    clauses.push('email_verified = ?');
    values.push(filter.emailVerified ? 1 : 0);
  }

  const sql = `SELECT id, email, username, role, site_title FROM users WHERE ${clauses.join(' AND ')}`;
  const result = await env.DB.prepare(sql).bind(...values).all();
  return result.results;
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const segment = String(body.segment || '');
  const subject = String(body.subject || '').trim();
  const message = String(body.body || '').trim();

  if (!subject || !message) {
    return errorResponse('subject and body are required', 400);
  }
  if (!SEGMENT_QUERIES[segment] && segment !== 'custom') {
    return errorResponse(
      `segment must be one of: ${[...Object.keys(SEGMENT_QUERIES), 'custom'].join(', ')}`,
      400
    );
  }

  let recipients;
  if (segment === 'custom') {
    if (!body.filter || typeof body.filter !== 'object') {
      return errorResponse('segment "custom" requires a "filter" object', 400);
    }
    recipients = await resolveCustomSegment(env, body.filter);
  } else {
    const result = await env.DB.prepare(SEGMENT_QUERIES[segment]).all();
    recipients = result.results;
  }

  let sent = 0;
  let skipped = 0;
  let failed = 0;

  const signature = await getEmailSignature(env);

  for (const row of recipients) {
    const recipient = { id: row.id, email: row.email, username: row.username, role: row.role, siteTitle: row.site_title };
    const token = await buildUnsubscribeToken(env, recipient.id, 'broadcast');
    const { subject: emailSubject, html } = broadcastAnnouncement(
      applyPlaceholders(subject, recipient),
      applyPlaceholders(message, recipient),
      unsubscribeUrl(token, 'broadcast'),
      signature
    );
    const result = await sendEmail(env, {
      to: recipient.email,
      type: 'broadcast',
      subject: emailSubject,
      bodyHtml: html,
      userId: recipient.id,
    });
    if (result.ok) sent += 1;
    else if (result.skipped) skipped += 1;
    else failed += 1;
  }

  return json({ ok: true, segment, total: recipients.length, sent, skipped, failed });
}
