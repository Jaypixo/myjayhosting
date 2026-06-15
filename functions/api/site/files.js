import { listSiteObjects } from '../../_lib/storage.js';
import { json } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env, data } = context;
  const user = data.user;

  const prefix = `sites/${user.username}/`;
  const objects = await listSiteObjects(env, user.username);
  const files = objects.map((obj) => ({
    key: obj.key.slice(prefix.length),
    size: obj.size,
    modified: obj.uploaded,
  }));

  return json({ files });
}
