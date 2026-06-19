import { json } from '../../../../_lib/auth.js';

export async function onRequestDelete(context) {
  const { env, params } = context;
  const email = decodeURIComponent(params.email || '').trim().toLowerCase();

  await env.DB.prepare('DELETE FROM bounce_suppression WHERE email = ?').bind(email).run();

  return json({ ok: true });
}
