import { json, errorResponse } from '../../_lib/auth.js';
import { searchPages, suggestCorrection, logSearchQuery, DEFAULT_PAGE_SIZE } from '../../_lib/search-query.js';

const ALLOWED_PLATFORMS = new Set(['myjay', 'neocities', 'nekoweb']);
const SINCE_WINDOW_DAYS = { '7d': 7, '30d': 30, '90d': 90 };

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const q = (url.searchParams.get('q') || '').trim();
  const platform = url.searchParams.get('platform') || undefined;
  const tag = url.searchParams.get('tag') || undefined;
  const sinceParam = url.searchParams.get('since');
  const page = Math.max(1, parseInt(url.searchParams.get('page'), 10) || 1);

  if (platform && !ALLOWED_PLATFORMS.has(platform)) {
    return errorResponse('platform must be one of: myjay, neocities, nekoweb', 400);
  }
  if (!q) {
    return errorResponse('q is required', 400, 'q');
  }

  let since;
  if (sinceParam && SINCE_WINDOW_DAYS[sinceParam]) {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - SINCE_WINDOW_DAYS[sinceParam]);
    since = d.toISOString();
  }

  const { results, total, usedFallback } = await searchPages(env, q, { platform, tag, since, page, pageSize: DEFAULT_PAGE_SIZE });

  const suggestion = results.length === 0 ? await suggestCorrection(env, q) : null;

  await logSearchQuery(env, q, total);

  return json({
    query: q,
    results,
    total,
    page,
    pageSize: DEFAULT_PAGE_SIZE,
    usedFallback,
    suggestion,
  });
}
