import { json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const status = url.searchParams.get('status') || 'pending';
  const { results } = await env.DB.prepare(
    'SELECT * FROM submissions WHERE status = ? ORDER BY submitted_at DESC'
  ).bind(status).all();

  return json({
    submissions: results.map((s) => ({
      id: s.id,
      url: s.url,
      categoryHint: s.category_hint,
      status: s.status,
      submittedAt: s.submitted_at,
      reviewedAt: s.reviewed_at,
      reviewedBy: s.reviewed_by,
    })),
  });
}
