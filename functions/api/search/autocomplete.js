import { json } from '../../_lib/auth.js';
import { getAutocomplete } from '../../_lib/search-query.js';

const CACHE_TTL_SECONDS = 300;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  if (!q) return json({ suggestions: [] });

  const cacheKey = `autocomplete:${q.toLowerCase()}`;
  const cached = await env.SEARCH_CACHE.get(cacheKey, 'json');
  if (cached) return json({ suggestions: cached });

  const suggestions = await getAutocomplete(env, q, 8);
  await env.SEARCH_CACHE.put(cacheKey, JSON.stringify(suggestions), { expirationTtl: CACHE_TTL_SECONDS });
  return json({ suggestions });
}
