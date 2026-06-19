import { errorResponse, json } from '../../../../_lib/auth.js';
import { sendEmail } from '../../../../_lib/mailer.js';

export async function onRequestPost(context) {
  const { env, params } = context;
  const { logId } = params;

  const original = await env.DB.prepare(
    'SELECT recipient, type, subject, body_html, user_id FROM email_log WHERE id = ?'
  )
    .bind(logId)
    .first();

  if (!original) {
    return errorResponse('No log entry with that id', 404);
  }
  if (!original.body_html) {
    return errorResponse('This entry predates retry support and has no stored content to resend', 400);
  }

  const result = await sendEmail(env, {
    to: original.recipient,
    type: original.type,
    subject: original.subject,
    bodyHtml: original.body_html,
    userId: original.user_id,
  });

  const status = result.ok === false && !result.skipped ? 502 : 200;
  return json(result, { status });
}
