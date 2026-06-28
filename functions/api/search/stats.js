import { json } from '../../_lib/auth.js';
import { getPublicStats } from '../../_lib/search-query.js';

export async function onRequestGet(context) {
  const { env } = context;
  const stats = await getPublicStats(env);
  return json(stats);
}
