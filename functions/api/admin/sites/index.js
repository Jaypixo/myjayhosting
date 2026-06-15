import { json } from '../../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;

  const sites = await env.DB.prepare(
    `SELECT s.id, s.username, s.published, s.updated_at, s.view_count, s.storage_bytes, u.email
     FROM sites s JOIN users u ON s.user_id = u.id
     ORDER BY s.updated_at DESC`
  ).all();

  return json({
    sites: sites.results.map((s) => ({
      id: s.id,
      username: s.username,
      email: s.email,
      published: Boolean(s.published),
      updatedAt: s.updated_at,
      viewCount: s.view_count,
      storageBytes: s.storage_bytes,
    })),
  });
}
