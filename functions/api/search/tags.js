import { json } from '../../_lib/auth.js';
import { getTagCounts } from '../../_lib/search-query.js';

export async function onRequestGet(context) {
  const { env } = context;
  const tags = await getTagCounts(env);
  return json({ tags });
}
