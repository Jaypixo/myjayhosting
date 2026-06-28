// Site-wide settings: a small key/value table (`settings`) managed from the
// admin panel. Used for maintenance mode, the announcement banner, and the
// registration on/off switch.
// Because apparently, we can't just hardcode these values like normal people.

const DEFAULTS = {
  maintenance_mode: '0',
  announcement: '',
  announcement_enabled: '0',
  registration_enabled: '1',
  email_signature_name: 'The MyJay Team',
  email_signature_tagline: 'Your corner of the web.',
  // Search crawler: pause flags per platform (the scheduled() handler in
  // crawler/ checks these and no-ops, logging a skipped crawl_log row,
  // rather than actually unregistering its own Cron Trigger) and the
  // Neocities /api/list pagination cursor.
  search_crawl_paused_myjay: '0',
  search_crawl_paused_neocities: '0',
  search_crawl_paused_nekoweb: '0',
  search_neocities_cursor: '0',
  // Resource-usage caps for the crawler, admin-editable (Search ->
  // Crawl Controls). Added after a production incident where the crawler's
  // own D1/KV/Queue usage degraded the whole platform, not just search, see
  // CLAUDE.md's "Indie Web Search Engine" section. Defaults here are
  // intentionally conservative; crawler/crawler.js falls back to its own
  // (same) defaults if these rows don't exist yet on an older database.
  search_max_pages_per_day: '300',
  search_max_pages_per_domain: '50',
  search_max_depth: '2',
  search_max_links_per_page: '15',
  // Politeness floor (seconds between requests to the same domain; a
  // site's own robots.txt Crawl-delay still wins if it asks for slower
  // than this) and a kill switch for discovering *new* sites specifically,
  // independent of re-crawling already-known ones, see crawler/crawler.js.
  search_min_crawl_delay_seconds: '1',
  search_discovery_enabled: '1',
};

function toPublicShape(map) {
  return {
    maintenanceMode: map.maintenance_mode === '1', // Dumpster fire status: yes or no?
    announcement: map.announcement || '', // What bullshit are we saying today?
    announcementEnabled: map.announcement_enabled === '1', // Should we even show it?
    registrationEnabled: map.registration_enabled !== '0', // Are we accepting randoms?
  };
}

export async function getSettingsMap(env) {
  // Fetch all the settings from D1. Pray nothing's broken.
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const map = { ...DEFAULTS };
  for (const row of results) {
    // Overwrite defaults with whatever's actually in the DB.
    map[row.key] = row.value;
  }
  return map;
}

export async function getSettings(env) {
  return toPublicShape(await getSettingsMap(env));
}

// Separate from getSettings()/toPublicShape() on purpose: those back the
// public /api/settings endpoint (used by status.html), and the signature
// has no reason to be exposed there. Used by email-templates.js call sites
// and the admin signature editor instead.
export async function getEmailSignature(env) {
  const map = await getSettingsMap(env);
  return {
    name: map.email_signature_name,
    tagline: map.email_signature_tagline,
  };
}

export async function setSetting(env, key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  await env.DB.prepare(
    // Insert or update, because we're too lazy to check if it exists first.
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, String(value)).run();
  // Just pray it works.
}
