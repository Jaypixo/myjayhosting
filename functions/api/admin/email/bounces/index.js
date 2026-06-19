import { json } from '../../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const result = await env.DB.prepare(
    'SELECT email, reason, created_at FROM bounce_suppression ORDER BY created_at DESC'
  ).all();

  return json({
    bounces: result.results.map((b) => ({
      email: b.email,
      reason: b.reason,
      createdAt: b.created_at,
    })),
  });
}
