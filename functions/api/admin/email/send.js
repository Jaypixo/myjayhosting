import { errorResponse, json } from '../../../_lib/auth.js';
import { sendEmail } from '../../../_lib/mailer.js';
import { getEmailSignature } from '../../../_lib/settings.js';
import { applyPlaceholders } from '../../../_lib/placeholders.js';
import { adminMessage } from '../../../_lib/email-templates.js';

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
    const user = await env.DB.prepare('SELECT id, email, username, role, site_title FROM users WHERE id = ?').bind(body.userId).first();
    if (!user) return errorResponse('No user with that id', 404);
    recipient = { id: user.id, email: user.email, username: user.username, role: user.role, siteTitle: user.site_title };
  } else if (body.email) {
    const email = String(body.email).trim().toLowerCase();
    // Sending "by email" doesn't mean it's a stranger. Might just be easier
    // for the admin than looking up the User ID. Check if we have an account
    // so %username/%sitetitle still resolve instead of silently defaulting.
    const user = await env.DB.prepare('SELECT id, email, username, role, site_title FROM users WHERE email = ?').bind(email).first();
    recipient = user
      ? { id: user.id, email: user.email, username: user.username, role: user.role, siteTitle: user.site_title }
      : { id: null, email, username: null, role: null, siteTitle: null };
  } else {
    return errorResponse('Provide either userId or email', 400);
  }

  const signature = await getEmailSignature(env);
  const { subject: emailSubject, html } = adminMessage(
    applyPlaceholders(subject, recipient),
    applyPlaceholders(message, recipient),
    signature
  );
  const result = await sendEmail(env, {
    to: recipient.email,
    type: 'admin_message',
    subject: emailSubject,
    bodyHtml: html,
    userId: recipient.id,
    // One-off sends bypass notification_prefs automatically. They're addressed
    // to one person on purpose, not a bulk thing they could have muted.
    // No admin toggle, it's by design.
    bypassPrefs: true,
  });

  const status = result.ok === false && !result.skipped ? 502 : 200;
  return json(result, { status });
}
