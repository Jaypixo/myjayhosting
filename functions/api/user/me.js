import { getSiteForUser } from '../../_lib/storage.js';
import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;

  const site = await getSiteForUser(env, user.id);

  return json({
    id: user.id,
    username: user.username,
    email: user.email,
    bio: user.bio,
    siteTitle: user.site_title,
    role: user.role,
    storageUsed: site ? site.storage_bytes : 0,
    published: site ? Boolean(site.published) : false,
  });
}
