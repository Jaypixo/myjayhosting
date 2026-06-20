import { errorResponse, json } from '../../../../_lib/auth.js';

// Full detail for one log row, including the rendered body, used by the
// admin dashboard's "Preview" action. The list endpoint (logs.js) deliberately
// leaves body_html out, it can be large and isn't needed for the table view.
export async function onRequestGet(context) {
  const { env, params } = context;

  const log = await env.DB.prepare(
    'SELECT id, recipient, type, subject, body_html, status, opened, bounced, resend_id, error, user_id, created_at FROM email_log WHERE id = ?'
  )
    .bind(params.id)
    .first();

  if (!log) return errorResponse('No log entry with that id', 404);

  return json({
    id: log.id,
    recipient: log.recipient,
    type: log.type,
    subject: log.subject,
    bodyHtml: log.body_html,
    status: log.status,
    opened: Boolean(log.opened),
    bounced: Boolean(log.bounced),
    resendId: log.resend_id,
    error: log.error,
    userId: log.user_id,
    createdAt: log.created_at,
  });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  await env.DB.prepare('DELETE FROM email_log WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
