import { json, errorResponse } from '../../../_lib/auth.js';

const VALID_STATUSES = new Set(['new', 'read', 'replied']);

export async function onRequestPatch(context) {
  const { request, env, params } = context;
  const { id } = params;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (!VALID_STATUSES.has(body.status)) {
    return errorResponse('status must be one of: new, read, replied', 400);
  }

  await env.DB.prepare('UPDATE contact_messages SET status = ? WHERE id = ?').bind(body.status, id).run();

  return json({ ok: true });
}

export async function onRequestDelete(context) {
  const { env, params } = context;
  const { id } = params;

  await env.DB.prepare('DELETE FROM contact_messages WHERE id = ?').bind(id).run();

  return json({ ok: true });
}
