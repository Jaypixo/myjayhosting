import { json, errorResponse } from '../../_lib/auth.js';
import { getSimilarPages } from '../../_lib/search-query.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const pageUrl = url.searchParams.get('url');
  if (!pageUrl) return errorResponse('url is required', 400, 'url');

  const results = await getSimilarPages(env, pageUrl, 6);
  return json({ results });
}
