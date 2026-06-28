// robots.txt fetch/parse/cache, per-domain rate limiting, and the shared
// fetch wrapper every outbound crawler request goes through (so the
// User-Agent and X-Crawler-Info header are guaranteed identical everywhere,
// not just on page fetches). See CLAUDE.md's "Indie Web Search Engine" ->
// crawler carefulness section for the policy this implements.

export const CRAWLER_INFO_URL = 'https://myjay.net/docs/search-indexing';
export const USER_AGENT = `MyJaySearch/1.0 (+${CRAWLER_INFO_URL})`;
export const DEFAULT_CRAWL_DELAY_SECONDS = 1;
const FETCH_TIMEOUT_MS = 10000;
const ROBOTS_CACHE_TTL_SECONDS = 60 * 60 * 24; // 24h

export async function crawlerFetch(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'User-Agent': USER_AGENT,
        'X-Crawler-Info': CRAWLER_INFO_URL,
        ...(options.headers || {}),
      },
    });
  } finally {
    clearTimeout(timer);
  }
}

function pathToRegex(pattern) {
  const endAnchor = pattern.endsWith('$');
  const body = endAnchor ? pattern.slice(0, -1) : pattern;
  const escaped = body
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*');
  return new RegExp('^' + escaped + (endAnchor ? '$' : ''));
}

// robots.txt allows several "User-agent:" lines in a row to share one rule
// block; a new block only starts once the current one has already seen a
// rule or crawl-delay line.
export function parseRobotsTxt(body) {
  const groups = [];
  let current = null;

  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();

    if (key === 'user-agent') {
      const startNew = !current || current.rules.length > 0 || current.crawlDelay !== undefined;
      if (startNew) {
        current = { agents: [value.toLowerCase()], rules: [], crawlDelay: undefined };
        groups.push(current);
      } else {
        current.agents.push(value.toLowerCase());
      }
    } else if ((key === 'disallow' || key === 'allow') && current) {
      current.rules.push({ type: key, path: value });
    } else if (key === 'crawl-delay' && current) {
      const n = Number(value);
      if (!Number.isNaN(n)) current.crawlDelay = n;
    }
  }

  const ours = groups.find((g) => g.agents.includes('myjaysearch'));
  const wildcard = groups.find((g) => g.agents.includes('*'));
  return ours || wildcard || { agents: ['*'], rules: [], crawlDelay: undefined };
}

export function isAllowedByRules(rules, path) {
  let best = null;
  for (const rule of rules) {
    if (rule.type === 'disallow' && rule.path === '') continue;
    if (pathToRegex(rule.path).test(path)) {
      if (!best || rule.path.length > best.path.length || (rule.path.length === best.path.length && rule.type === 'allow')) {
        best = rule;
      }
    }
  }
  return !best || best.type === 'allow';
}

// Returns { rules, crawlDelay, failed }. `failed: true` means robots.txt
// could not be determined (network error, timeout, 5xx, malformed
// response) and there's no usable cached copy — callers must skip the
// domain for this run rather than guess. A 404 is a well-defined "no
// restrictions" signal, not a failure.
export async function getRobotsRules(env, origin) {
  const cacheKey = `robots:${origin}`;
  const cached = await env.SEARCH_CACHE.get(cacheKey, 'json');
  if (cached) return cached;

  let body = '';
  try {
    const res = await crawlerFetch(`${origin}/robots.txt`);
    if (res.status === 404) {
      body = '';
    } else if (res.ok) {
      body = await res.text();
    } else {
      return { failed: true };
    }
  } catch {
    return { failed: true };
  }

  const group = parseRobotsTxt(body);
  const result = { rules: group.rules, crawlDelay: group.crawlDelay, failed: false };
  await env.SEARCH_CACHE.put(cacheKey, JSON.stringify(result), { expirationTtl: ROBOTS_CACHE_TTL_SECONDS });
  return result;
}

// KV-backed last-fetched-at timestamp per domain. `allowed: false` means
// the caller should re-deliver the queue message with `retryAfterSeconds`
// rather than fetch now.
export async function checkRateLimit(env, domain, minIntervalSeconds) {
  const lastFetched = await env.SEARCH_CACHE.get(`ratelimit:${domain}`);
  if (lastFetched) {
    const elapsedMs = Date.now() - Number(lastFetched);
    const minMs = minIntervalSeconds * 1000;
    if (elapsedMs < minMs) {
      return { allowed: false, retryAfterSeconds: Math.ceil((minMs - elapsedMs) / 1000) };
    }
  }
  return { allowed: true };
}

export async function markFetched(env, domain, minIntervalSeconds) {
  await env.SEARCH_CACHE.put(`ratelimit:${domain}`, String(Date.now()), {
    expirationTtl: Math.max(60, minIntervalSeconds),
  });
}
