import { json, errorResponse } from '../../../_lib/auth.js';
import { getSettingsMap, setSetting } from '../../../_lib/settings.js';
import { callCrawler } from '../../../_lib/crawler-client.js';

const PLATFORMS = ['myjay', 'neocities', 'nekoweb'];

// Field -> [settings key, minimum allowed value]. These are the
// resource-usage knobs crawler/crawler.js's getCrawlSettings() reads,
// added after a production incident, see CLAUDE.md. Most can legitimately
// be 0 (e.g. max depth 0 means "only ever crawl seed pages, never follow a
// link"); the crawl delay floor can't, a 0-second delay between requests
// to the same domain is exactly the footgun this settings group exists to
// prevent.
const LIMIT_KEYS = {
  maxPagesPerDay: ['search_max_pages_per_day', 1],
  maxPagesPerDomain: ['search_max_pages_per_domain', 1],
  maxDepth: ['search_max_depth', 0],
  maxLinksPerPage: ['search_max_links_per_page', 0],
  minCrawlDelaySeconds: ['search_min_crawl_delay_seconds', 1],
};

export async function onRequestGet(context) {
  const { env } = context;
  const map = await getSettingsMap(env);

  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  const [crawledRow, runsRow, errorSitesRow] = await env.DB.batch([
    env.DB.prepare('SELECT COUNT(*) AS n FROM search_pages WHERE crawled_at >= ?').bind(since.toISOString()),
    // pages_failed on runs that *started* today, an approximation (a run
    // spanning midnight undercounts slightly) but good enough for "is
    // today noisy" at a glance, not a billing-accurate figure.
    env.DB.prepare("SELECT COALESCE(SUM(pages_failed), 0) AS n FROM crawl_log WHERE started_at >= ?").bind(since.toISOString()),
    env.DB.prepare("SELECT COUNT(*) AS n FROM search_sites WHERE status = 'error'"),
  ]);

  const limits = {};
  for (const [field, [settingKey]] of Object.entries(LIMIT_KEYS)) {
    limits[field] = Number(map[settingKey]);
  }

  return json({
    paused: {
      myjay: map.search_crawl_paused_myjay === '1',
      neocities: map.search_crawl_paused_neocities === '1',
      nekoweb: map.search_crawl_paused_nekoweb === '1',
    },
    limits,
    discoveryEnabled: map.search_discovery_enabled !== '0',
    pagesCrawledToday: crawledRow.results[0]?.n || 0,
    pagesFailedToday: runsRow.results[0]?.n || 0,
    sitesInErrorState: errorSitesRow.results[0]?.n || 0,
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

  // The big emergency stop: every platform at once, one click, for when
  // something's clearly wrong and there's no time to pause three things
  // individually.
  if (action === 'pause-all' || action === 'resume-all') {
    const value = action === 'pause-all' ? '1' : '0';
    for (const p of PLATFORMS) {
      await setSetting(env, `search_crawl_paused_${p}`, value);
    }
    return json({ ok: true });
  }

  if (action === 'set-limits') {
    if (!body.limits || typeof body.limits !== 'object') {
      return errorResponse('limits object is required', 400);
    }
    for (const [field, [settingKey, min]] of Object.entries(LIMIT_KEYS)) {
      if (!(field in body.limits)) continue;
      const n = parseInt(body.limits[field], 10);
      if (!Number.isFinite(n) || n < min) {
        return errorResponse(`${field} must be a number >= ${min}`, 400);
      }
      await setSetting(env, settingKey, String(n));
    }
    return json({ ok: true });
  }

  if (action === 'set-discovery') {
    await setSetting(env, 'search_discovery_enabled', body.enabled ? '1' : '0');
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
