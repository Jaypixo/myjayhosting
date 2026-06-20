import { errorResponse, json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare(
    'SELECT id, label, category, subject, body FROM email_templates ORDER BY category, label'
  ).all();
  return json({ templates: results });
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const label = String(body.label || '').trim().slice(0, 100);
  const category = String(body.category || '').trim().slice(0, 50) || 'Other';
  const subject = String(body.subject || '').trim();
  const text = String(body.body || '').trim();

  if (!label || !subject || !text) {
    return errorResponse('label, subject, and body are required', 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(id, label, category, subject, text, now, now).run();

  return json({ id, label, category, subject, body: text }, { status: 201 });
}
