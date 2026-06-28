import { json, errorResponse } from '../../_lib/auth.js';
import { getRecentPages } from '../../_lib/search-query.js';

const ALLOWED_PLATFORMS = new Set(['myjay', 'neocities', 'nekoweb']);

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || undefined;
  const tag = url.searchParams.get('tag') || undefined;
  if (platform && !ALLOWED_PLATFORMS.has(platform)) {
    return errorResponse('platform must be one of: myjay, neocities, nekoweb', 400);
  }
  const limit = Math.min(50, Math.max(1, parseInt(url.searchParams.get('limit'), 10) || 24));
  const offset = Math.max(0, parseInt(url.searchParams.get('offset'), 10) || 0);

  const results = await getRecentPages(env, { platform, tag, limit, offset });
  return json({ results });
}
