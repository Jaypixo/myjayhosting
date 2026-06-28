import { json, errorResponse } from '../../../_lib/auth.js';
import { getSettingsMap, setSetting } from '../../../_lib/settings.js';
import { callCrawler } from '../../../_lib/crawler-client.js';

const PLATFORMS = ['myjay', 'neocities', 'nekoweb'];

export async function onRequestGet(context) {
  const { env } = context;
  const map = await getSettingsMap(env);
  return json({
    paused: {
      myjay: map.search_crawl_paused_myjay === '1',
      neocities: map.search_crawl_paused_neocities === '1',
      nekoweb: map.search_crawl_paused_nekoweb === '1',
    },
  });
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const { action, platform } = body;

  if (action === 'pause' || action === 'resume') {
    if (!PLATFORMS.includes(platform)) return errorResponse('Unknown platform', 400);
    await setSetting(env, `search_crawl_paused_${platform}`, action === 'pause' ? '1' : '0');
    return json({ ok: true });
  }

  if (action === 'trigger') {
    if (platform !== 'all' && !PLATFORMS.includes(platform)) return errorResponse('Unknown platform', 400);
    const result = await callCrawler(env, 'trigger-crawl', {
      platform,
      full: Boolean(body.full),
      triggeredBy: `admin:${data.user.email}`,
    });
    if (!result.ok) return errorResponse(result.error || 'Crawl trigger failed', 502);
    return json(result);
  }

  return errorResponse('Unknown action', 400);
}
