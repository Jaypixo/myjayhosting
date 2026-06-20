import { errorResponse, json } from '../../../../_lib/auth.js';

export async function onRequestPatch(context) {
  const { request, env, params } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const existing = await env.DB.prepare('SELECT id FROM email_templates WHERE id = ?').bind(params.id).first();
  if (!existing) return errorResponse('No template with that id', 404);

  const updates = [];
  const values = [];

  if (typeof body.label === 'string' && body.label.trim()) {
    updates.push('label = ?');
    values.push(body.label.trim().slice(0, 100));
  }
  if (typeof body.category === 'string') {
    updates.push('category = ?');
    values.push(body.category.trim().slice(0, 50) || 'Other');
  }
  if (typeof body.subject === 'string' && body.subject.trim()) {
    updates.push('subject = ?');
    values.push(body.subject.trim());
  }
  if (typeof body.body === 'string' && body.body.trim()) {
    updates.push('body = ?');
    values.push(body.body.trim());
  }

  if (updates.length === 0) {
    return errorResponse('No valid fields to update', 400);
  }

  updates.push('updated_at = ?');
  values.push(new Date().toISOString());
  values.push(params.id);

  await env.DB.prepare(`UPDATE email_templates SET ${updates.join(', ')} WHERE id = ?`).bind(...values).run();

  const updated = await env.DB.prepare(
    'SELECT id, label, category, subject, body FROM email_templates WHERE id = ?'
  ).bind(params.id).first();
  return json(updated);
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  await env.DB.prepare('DELETE FROM email_templates WHERE id = ?').bind(params.id).run();
  return json({ ok: true });
}
