import { json, errorResponse } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const { results } = await env.DB.prepare('SELECT * FROM blocklist ORDER BY added_at DESC').all();
  return json({
    entries: results.map((r) => ({
      id: r.id,
      domain: r.domain,
      reason: r.reason,
      source: r.source,
      addedBy: r.added_by,
      addedAt: r.added_at,
    })),
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const domain = String(body.domain || '').trim().toLowerCase();
  if (!domain) return errorResponse('domain is required', 400, 'domain');

  await env.DB.batch([
    env.DB.prepare(
      'INSERT OR IGNORE INTO blocklist (id, domain, reason, source, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), domain, body.reason || null, 'admin_manual', data.user.email, new Date().toISOString()),
    env.DB.prepare("UPDATE search_sites SET status = 'blocked' WHERE domain = ?").bind(domain),
  ]);

  return json({ ok: true });
}
