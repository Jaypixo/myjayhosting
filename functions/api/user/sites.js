import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;

  const sites = await env.DB.prepare(
    'SELECT username, published, updated_at, view_count, storage_bytes FROM sites WHERE user_id = ?'
  )
    .bind(user.id)
    .all();

  return json({
    sites: sites.results.map((site) => ({
      username: site.username,
      published: Boolean(site.published),
      updatedAt: site.updated_at,
      viewCount: site.view_count,
      storageBytes: site.storage_bytes,
    })),
  });
}
