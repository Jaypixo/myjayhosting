import { errorResponse, json } from '../../../../_lib/auth.js';
import { sendEmail } from '../../../../_lib/mailer.js';
import { adminMessage } from '../../../../_lib/email-templates.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const subject = String(body.subject || '').trim();
  const message = String(body.body || '').trim();
  if (!subject || !message) {
    return errorResponse('subject and body are required', 400);
  }

  let recipient;
  if (body.userId) {
    const user = await env.DB.prepare('SELECT id, email FROM users WHERE id = ?').bind(body.userId).first();
    if (!user) return errorResponse('No user with that id', 404);
    recipient = user;
  } else if (body.email) {
    const email = String(body.email).trim().toLowerCase();
    recipient = { id: null, email };
  } else {
    return errorResponse('Provide either userId or email', 400);
  }

  const { subject: emailSubject, html } = adminMessage(subject, message);
  const result = await sendEmail(env, {
    to: recipient.email,
    type: 'admin_message',
    subject: emailSubject,
    bodyHtml: html,
    userId: recipient.id,
  });

  const status = result.ok === false && !result.skipped ? 502 : 200;
  return json(result, { status });
}
