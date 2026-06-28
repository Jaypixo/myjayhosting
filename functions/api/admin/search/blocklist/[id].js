import { json, errorResponse } from '../../../../_lib/auth.js';

export async function onRequestDelete(context) {
  const { env, params } = context;
  const entry = await env.DB.prepare('SELECT domain FROM blocklist WHERE id = ?').bind(params.id).first();
  if (!entry) return errorResponse('Not found', 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM blocklist WHERE id = ?').bind(params.id),
    env.DB.prepare("UPDATE search_sites SET status = 'active' WHERE domain = ? AND status = 'blocked'").bind(entry.domain),
  ]);

  return json({ ok: true });
}
