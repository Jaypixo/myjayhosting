// myjay-crawler: the standalone Worker that does all of the actual indexing
// work for MyJay Search. Pages Functions can be a Queue producer but never
// a consumer, and can't have Cron Triggers at all, so this lives as its
// own Worker, sibling to worker/ (the subdomain router) and mailer/ (the
// email sender). Reached two ways: Cron Triggers fire `scheduled()`
// directly, and the main Pages project reaches it via a service binding
// (env.CRAWLER, see wrangler.toml.example), the exact same pattern
// mailer.js uses for env.MAILER. No public route, no custom domain: the
// service binding and the Cron Triggers are the only ways in.
import { extractPage, extractMetaRobots, inferTags } from './extract.js';
import {
  crawlerFetch, getRobotsRules, isAllowedByRules, checkRateLimit, markFetched,
  DEFAULT_CRAWL_DELAY_SECONDS,
} from './robots.js';
import { termWeights } from '../functions/_lib/search-tokenize.js';
import * as myjaySource from './sources/myjay.js';
import * as neocitiesSource from './sources/neocities.js';
import * as nekowebSource from './sources/nekoweb.js';

const SOURCES = { myjay: myjaySource, neocities: neocitiesSource, nekoweb: nekowebSource };
const PLATFORM_SUFFIXES = { '.myjay.net': 'myjay', '.neocities.org': 'neocities', '.nekoweb.org': 'nekoweb' };

const MAX_DEPTH = 2;
const MAX_PAGES_PER_DOMAIN_PER_RUN = 200;
const MAX_CONSECUTIVE_FAILURES = 5;
const FAILSTREAK_TTL_SECONDS = 3600;

function platformForDomain(domain) {
  for (const [suffix, platform] of Object.entries(PLATFORM_SUFFIXES)) {
    if (domain.endsWith(suffix) && domain !== suffix.slice(1)) return platform;
  }
  return null;
}

async function isPaused(env, platform) {
  const row = await env.DB.prepare('SELECT value FROM settings WHERE key = ?')
    .bind(`search_crawl_paused_${platform}`).first();
  return row?.value === '1';
}

async function upsertSearchSite(env, { platform, domain, rootUrl }) {
  const existing = await env.DB.prepare('SELECT id FROM search_sites WHERE domain = ?').bind(domain).first();
  if (existing) return existing.id;
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO search_sites (id, platform, domain, root_url, status, first_indexed_at)
     VALUES (?, ?, ?, ?, 'active', ?)`
  ).bind(id, platform, domain, rootUrl, new Date().toISOString()).run();
  return id;
}

// Runs a seed pass for one platform: closes out any previous still-"running"
// row for it (best-effort completion tracking, see note below), creates a
// fresh crawl_log row, asks the source module for root URLs, upserts a
// search_sites row for each, and enqueues a depth-0 job per site.
export async function runCrawl(env, { platform, full, triggeredBy }) {
  if (await isPaused(env, platform)) {
    const id = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO crawl_log (id, platform, run_type, started_at, finished_at, status, triggered_by)
       VALUES (?, ?, ?, ?, ?, 'skipped', ?)`
    ).bind(id, platform, full ? 'full' : 'incremental', new Date().toISOString(), new Date().toISOString(), triggeredBy).run();
    return { skipped: true };
  }

  const now = new Date().toISOString();
  // Queue processing is distributed across many separate invocations with
  // no single moment that's unambiguously "done"; treating any previous
  // still-"running" row as complete whenever the next run starts is a
  // deliberate approximation for the admin overview, not a hard guarantee.
  await env.DB.prepare(
    `UPDATE crawl_log SET status = 'completed', finished_at = ? WHERE platform = ? AND status = 'running'`
  ).bind(now, platform).run();

  const crawlLogId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO crawl_log (id, platform, run_type, started_at, status, triggered_by)
     VALUES (?, ?, ?, ?, 'running', ?)`
  ).bind(crawlLogId, platform, full ? 'full' : 'incremental', now, triggeredBy).run();

  const seeds = await SOURCES[platform].seedJobs(env, { full });
  for (const seed of seeds) {
    const siteId = await upsertSearchSite(env, { platform, domain: seed.domain, rootUrl: seed.rootUrl });
    await env.CRAWL_QUEUE.send({ url: seed.rootUrl, siteId, platform, domain: seed.domain, depth: 0, crawlLogId, runStartedAt: now });
  }

  return { crawlLogId, seeded: seeds.length };
}

// Used for "re-crawl this domain now" and for newly-approved submissions:
// a one-site "manual" run that doesn't touch the platform-wide seeding logic.
async function runSiteCrawl(env, { siteId, triggeredBy }) {
  const site = await env.DB.prepare('SELECT platform, domain, root_url FROM search_sites WHERE id = ?').bind(siteId).first();
  if (!site) return { error: 'unknown site' };

  const now = new Date().toISOString();
  const crawlLogId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO crawl_log (id, platform, run_type, started_at, status, triggered_by)
     VALUES (?, ?, 'manual', ?, 'running', ?)`
  ).bind(crawlLogId, site.platform, now, triggeredBy).run();

  await env.CRAWL_QUEUE.send({ url: site.root_url, siteId, platform: site.platform, domain: site.domain, depth: 0, crawlLogId, runStartedAt: now });
  return { crawlLogId };
}

// Used by submission approval: the URL might be a brand-new domain with no
// search_sites row yet.
async function runUrlCrawl(env, { url, triggeredBy }) {
  let domain;
  try {
    domain = new URL(url).hostname.toLowerCase();
  } catch {
    return { error: 'invalid URL' };
  }
  const platform = platformForDomain(domain);
  if (!platform) return { error: 'domain is not on a supported platform' };

  const siteId = await upsertSearchSite(env, { platform, domain, rootUrl: url });
  return runSiteCrawl(env, { siteId, triggeredBy });
}

async function recordFailure(env, domain, crawlLogId) {
  const key = `failstreak:${domain}`;
  const streak = (Number(await env.SEARCH_CACHE.get(key)) || 0) + 1;
  await env.SEARCH_CACHE.put(key, String(streak), { expirationTtl: FAILSTREAK_TTL_SECONDS });
  if (crawlLogId) {
    await env.DB.prepare('UPDATE crawl_log SET pages_failed = pages_failed + 1 WHERE id = ?').bind(crawlLogId).run();
  }
  return streak;
}

async function resetFailureStreak(env, domain) {
  await env.SEARCH_CACHE.delete(`failstreak:${domain}`);
}

async function indexTerms(env, pageId, fields) {
  const stmts = [];
  for (const [field, text] of [['title', fields.title], ['description', fields.description], ['body', fields.bodyText]]) {
    if (!text) continue;
    for (const [term, weight] of termWeights(text, 50)) {
      stmts.push(env.DB.prepare('INSERT INTO search_terms (term, page_id, field, weight) VALUES (?, ?, ?, ?)').bind(term, pageId, field, weight));
    }
  }
  if (stmts.length > 0) await env.DB.batch(stmts);
}

async function upsertPage(env, { siteId, url, fields, depth, httpStatus, lastModified, crawledAt }) {
  const existing = await env.DB.prepare('SELECT id FROM search_pages WHERE url = ?').bind(url).first();
  const pageId = existing ? existing.id : crypto.randomUUID();

  if (existing) {
    await env.DB.prepare(
      `UPDATE search_pages SET title=?, h1=?, description=?, body_text=?, word_count=?, depth=?, http_status=?, last_modified=?, crawled_at=?
       WHERE id = ?`
    ).bind(fields.title, fields.h1, fields.description, fields.bodyText, fields.wordCount, depth, httpStatus, lastModified, crawledAt, pageId).run();
    await env.DB.batch([
      env.DB.prepare('DELETE FROM search_terms WHERE page_id = ?').bind(pageId),
      env.DB.prepare('DELETE FROM search_page_tags WHERE page_id = ?').bind(pageId),
      env.DB.prepare('DELETE FROM search_links WHERE from_page_id = ?').bind(pageId),
    ]);
  } else {
    await env.DB.prepare(
      `INSERT INTO search_pages (id, site_id, url, title, h1, description, body_text, word_count, depth, http_status, last_modified, crawled_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(pageId, siteId, url, fields.title, fields.h1, fields.description, fields.bodyText, fields.wordCount, depth, httpStatus, lastModified, crawledAt).run();
  }

  await indexTerms(env, pageId, fields);
  return pageId;
}

async function enqueueDiscoveredLinks(env, { links, fromPageId, fromDomain, fromSiteId, fromPlatform, depth, crawlLogId, runStartedAt }) {
  for (const link of links) {
    await env.DB.prepare('INSERT OR IGNORE INTO search_links (from_page_id, to_url) VALUES (?, ?)').bind(fromPageId, link).run();

    let linkDomain;
    try {
      linkDomain = new URL(link).hostname.toLowerCase();
    } catch {
      continue;
    }

    if (linkDomain === fromDomain) {
      if (depth + 1 > MAX_DEPTH) continue;
      const already = await env.DB.prepare('SELECT 1 FROM search_pages WHERE url = ? AND crawled_at >= ?').bind(link, runStartedAt).first();
      if (already) continue;
      await env.CRAWL_QUEUE.send({ url: link, siteId: fromSiteId, platform: fromPlatform, domain: fromDomain, depth: depth + 1, crawlLogId, runStartedAt });
      continue;
    }

    const platform = platformForDomain(linkDomain);
    if (!platform) continue; // not one of the three platforms we index

    const blocked = await env.DB.prepare('SELECT 1 FROM blocklist WHERE domain = ?').bind(linkDomain).first();
    if (blocked) continue;

    const existingSite = await env.DB.prepare('SELECT id FROM search_sites WHERE domain = ?').bind(linkDomain).first();
    if (existingSite) continue; // already known; its own crawl already covers it

    const siteId = await upsertSearchSite(env, { platform, domain: linkDomain, rootUrl: `https://${linkDomain}/` });
    await env.CRAWL_QUEUE.send({ url: `https://${linkDomain}/`, siteId, platform, domain: linkDomain, depth: 0, crawlLogId, runStartedAt });
  }
}

// Returns `{ retryAfterSeconds }` to ask for a delayed re-delivery, or
// nothing if the message should just be acked (success, or a terminal skip
// like "blocklisted"/"disallowed" that's not worth retrying).
async function processPageJob(env, job) {
  const { url, siteId, platform, domain, depth, crawlLogId, runStartedAt } = job;

  const blocked = await env.DB.prepare('SELECT 1 FROM blocklist WHERE domain = ?').bind(domain).first();
  if (blocked) return;

  const streak = Number(await env.SEARCH_CACHE.get(`failstreak:${domain}`)) || 0;
  if (streak >= MAX_CONSECUTIVE_FAILURES) {
    await env.DB.prepare("UPDATE search_sites SET status = 'error' WHERE id = ?").bind(siteId).run();
    return;
  }

  const crawledSoFar = await env.DB.prepare(
    'SELECT COUNT(*) AS n FROM search_pages WHERE site_id = ? AND crawled_at >= ?'
  ).bind(siteId, runStartedAt).first();
  if ((crawledSoFar?.n || 0) >= MAX_PAGES_PER_DOMAIN_PER_RUN) return;

  let target;
  try {
    target = new URL(url);
  } catch {
    return;
  }
  const origin = target.origin;

  const robots = await getRobotsRules(env, origin);
  if (robots.failed) return; // can't determine robots.txt right now; fail closed, retry next run
  const path = target.pathname + (target.search || '');
  if (!isAllowedByRules(robots.rules, path)) return;

  const minInterval = Math.max(DEFAULT_CRAWL_DELAY_SECONDS, robots.crawlDelay || 0);
  const rate = await checkRateLimit(env, domain, minInterval);
  if (!rate.allowed) return { retryAfterSeconds: rate.retryAfterSeconds };

  let res;
  try {
    res = await crawlerFetch(url);
  } catch {
    await markFetched(env, domain, minInterval);
    await recordFailure(env, domain, crawlLogId);
    return;
  }
  await markFetched(env, domain, minInterval);

  if (!res.ok) {
    await recordFailure(env, domain, crawlLogId);
    return;
  }

  const now = new Date().toISOString();
  await env.DB.prepare("UPDATE search_sites SET last_crawled_at = ?, status = 'active' WHERE id = ?").bind(now, siteId).run();
  await env.DB.prepare('UPDATE crawl_log SET pages_crawled = pages_crawled + 1 WHERE id = ?').bind(crawlLogId).run();
  await resetFailureStreak(env, domain);

  const contentType = res.headers.get('Content-Type') || '';
  if (!contentType.includes('text/html')) return;

  const xRobotsTag = (res.headers.get('X-Robots-Tag') || '').toLowerCase();
  const html = await res.text();
  const metaRobots = extractMetaRobots(html);
  const noindex = xRobotsTag.includes('noindex') || metaRobots.noindex;
  const nofollow = xRobotsTag.includes('nofollow') || metaRobots.nofollow;

  const fields = extractPage(html, url);

  let pageId = null;
  if (!noindex) {
    pageId = await upsertPage(env, {
      siteId, url, fields, depth,
      httpStatus: res.status,
      lastModified: res.headers.get('Last-Modified'),
      crawledAt: now,
    });
    const tags = inferTags(html, fields);
    await env.DB.prepare('DELETE FROM search_page_tags WHERE page_id = ?').bind(pageId).run();
    if (tags.length > 0) {
      await env.DB.batch(tags.map((tag) =>
        env.DB.prepare('INSERT OR IGNORE INTO search_page_tags (page_id, tag) VALUES (?, ?)').bind(pageId, tag)
      ));
    }
  }

  if (!nofollow) {
    await enqueueDiscoveredLinks(env, {
      links: fields.links,
      fromPageId: pageId,
      fromDomain: domain,
      fromSiteId: siteId,
      fromPlatform: platform,
      depth,
      crawlLogId,
      runStartedAt,
    });
  }
}

export default {
  async scheduled(controller, env) {
    // Two Cron Triggers are registered (see wrangler.toml.example): a daily
    // incremental and a weekly full. `cron` distinguishes which one fired.
    const full = controller.cron === env.FULL_CRAWL_CRON;
    for (const platform of Object.keys(SOURCES)) {
      await runCrawl(env, { platform, full, triggeredBy: 'cron' });
    }
  },

  async queue(batch, env) {
    for (const message of batch.messages) {
      try {
        const result = await processPageJob(env, message.body);
        if (result?.retryAfterSeconds) {
          message.retry({ delaySeconds: result.retryAfterSeconds });
        } else {
          message.ack();
        }
      } catch (err) {
        await recordFailure(env, message.body?.domain, message.body?.crawlLogId).catch(() => {});
        message.ack();
      }
    }
  },

  // Internal RPC surface, reached only via the CRAWLER service binding from
  // the main Pages project (no public route, no custom domain, same
  // isolation as mailer/mailer.js). Never exposed to the internet directly.
  async fetch(request, env) {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 });

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    if (body.action === 'trigger-crawl') {
      const platforms = body.platform === 'all' ? Object.keys(SOURCES) : [body.platform];
      const results = [];
      for (const platform of platforms) {
        if (!SOURCES[platform]) return new Response('Unknown platform', { status: 400 });
        results.push(await runCrawl(env, { platform, full: Boolean(body.full), triggeredBy: body.triggeredBy || 'admin' }));
      }
      return Response.json({ ok: true, results });
    }

    if (body.action === 'recrawl-site') {
      const result = await runSiteCrawl(env, { siteId: body.siteId, triggeredBy: body.triggeredBy || 'admin' });
      return Response.json({ ok: !result.error, ...result });
    }

    if (body.action === 'crawl-url') {
      const result = await runUrlCrawl(env, { url: body.url, triggeredBy: body.triggeredBy || 'admin' });
      return Response.json({ ok: !result.error, ...result });
    }

    return new Response('Unknown action', { status: 400 });
  },
};
