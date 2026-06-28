import { json, errorResponse } from '../../_lib/auth.js';
import { getRandomPage } from '../../_lib/search-query.js';

const ALLOWED_PLATFORMS = new Set(['myjay', 'neocities', 'nekoweb']);

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const platform = url.searchParams.get('platform') || undefined;
  if (platform && !ALLOWED_PLATFORMS.has(platform)) {
    return errorResponse('platform must be one of: myjay, neocities, nekoweb', 400);
  }

  const page = await getRandomPage(env, { platform });
  if (!page) return errorResponse('No indexed pages yet', 404);
  return json(page);
}
