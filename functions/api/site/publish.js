import { json, errorResponse } from '../../_lib/auth.js';
import { sendEmail } from '../../_lib/mailer.js';
import { getEmailSignature } from '../../_lib/settings.js';
import { sitePublished } from '../../_lib/email-templates.js';

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const user = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const published = Boolean(body.published);
  const now = new Date().toISOString();

  const site = await env.DB.prepare('SELECT published FROM sites WHERE user_id = ?').bind(user.id).first();
  const wasPublished = Boolean(site?.published);

  await env.DB.prepare('UPDATE sites SET published = ?, updated_at = ? WHERE user_id = ?')
    .bind(published ? 1 : 0, now, user.id)
    .run();

  // Only the 0 -> 1 transition, not every toggle, otherwise flipping it on
  // and off while testing would spam the inbox.
  if (published && !wasPublished) {
    const signature = await getEmailSignature(env);
    const { subject, html } = sitePublished(user.username, signature);
    await sendEmail(env, { to: user.email, type: 'site_published', subject, bodyHtml: html, userId: user.id });
  }

  return json({ ok: true });
}
