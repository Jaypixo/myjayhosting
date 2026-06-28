import { json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const { results } = await env.DB.prepare(
    'SELECT * FROM removal_requests WHERE status = ? ORDER BY created_at DESC'
  ).bind(status).all();

  return json({
    requests: results.map((r) => ({
      id: r.id,
      url: r.url,
      reason: r.reason,
      status: r.status,
      createdAt: r.created_at,
      resolvedAt: r.resolved_at,
      resolvedBy: r.resolved_by,
    })),
  });
}
