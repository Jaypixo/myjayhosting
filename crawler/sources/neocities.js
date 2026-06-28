// Neocities discovery deliberately does NOT use /api/list: that endpoint
// only lists files within a site you already hold credentials for, and
// Neocities' own API docs say "Do not use the API to data mine / rip all
// of the sites" (sites caught doing this get de-listed). Their /browse
// listing (sort_by=newest / last_updated / random) is a different thing
// entirely: an ordinary public page, allowed by their robots.txt
// (`Allow: /`), and listed in their own sitemap.xml under exactly those
// sort variants. That's the sanctioned discovery surface here, scraped the
// same way any search engine would, through the same crawlerFetch/UA/rate
// limit machinery used for every other request this crawler makes.
import { crawlerFetch, checkRateLimit, markFetched, DEFAULT_CRAWL_DELAY_SECONDS } from '../robots.js';

const BROWSE_URL = 'https://neocities.org/browse';
const BROWSE_DOMAIN = 'neocities.org';
const SITE_LINK_RE = /https:\/\/([a-z0-9-]+)\.neocities\.org\b/gi;

async function scrapeBrowsePage(env, sortBy, page) {
  const rate = await checkRateLimit(env, BROWSE_DOMAIN, DEFAULT_CRAWL_DELAY_SECONDS);
  if (!rate.allowed) {
    await new Promise((resolve) => setTimeout(resolve, rate.retryAfterSeconds * 1000));
  }

  let res;
  try {
    res = await crawlerFetch(`${BROWSE_URL}?sort_by=${sortBy}&page=${page}`);
  } finally {
    await markFetched(env, BROWSE_DOMAIN, DEFAULT_CRAWL_DELAY_SECONDS);
  }
  if (!res.ok) return [];

  const html = await res.text();
  const usernames = new Set();
  let m;
  while ((m = SITE_LINK_RE.exec(html))) {
    usernames.add(m[1].toLowerCase());
  }
  return [...usernames];
}

export async function seedJobs(env, { full }) {
  const sorts = full ? ['newest', 'last_updated'] : ['last_updated'];
  const maxPages = full ? 5 : 2;

  const usernames = new Set();
  for (const sortBy of sorts) {
    for (let page = 1; page <= maxPages; page++) {
      const found = await scrapeBrowsePage(env, sortBy, page);
      if (found.length === 0) break; // ran out of pages
      found.forEach((u) => usernames.add(u));
    }
  }

  return [...usernames].map((username) => ({
    domain: `${username}.neocities.org`,
    rootUrl: `https://${username}.neocities.org/`,
  }));
}
