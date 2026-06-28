-- Migration: Indie Web Search Engine (crawler, index, admin tooling).
-- Safe to run against an existing myjay-db, all statements are idempotent.
--
-- Run with: npx wrangler d1 execute myjay-db --file=schema/migrate-008-search-engine.sql

-- Per-site opt-out. MyJay sites are indexed by default (search_opt_out = 0);
-- the dashboard's Settings tab flips this per the user's own choice.
ALTER TABLE sites ADD COLUMN search_opt_out INTEGER NOT NULL DEFAULT 0;

-- One row per indexed domain, across all three platforms. Exists even before
-- a single page has been crawled (e.g. a pending submission), so site-level
-- state (status, robots cache flag, last_crawled_at) has somewhere to live
-- independent of whether any search_pages rows exist yet.
CREATE TABLE IF NOT EXISTS search_sites (
  id TEXT PRIMARY KEY,             -- UUID
  platform TEXT NOT NULL,          -- 'myjay' | 'neocities' | 'nekoweb'
  domain TEXT NOT NULL UNIQUE,     -- e.g. 'noah.myjay.net', 'someone.neocities.org'
  root_url TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'blocked' | 'error'
  robots_disallow_all INTEGER NOT NULL DEFAULT 0,
  first_indexed_at TEXT NOT NULL,
  last_crawled_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_search_sites_platform ON search_sites(platform);
CREATE INDEX IF NOT EXISTS idx_search_sites_status ON search_sites(status);

CREATE TABLE IF NOT EXISTS search_pages (
  id TEXT PRIMARY KEY,
  site_id TEXT NOT NULL REFERENCES search_sites(id),
  url TEXT NOT NULL UNIQUE,
  title TEXT,
  h1 TEXT,
  description TEXT,
  body_text TEXT,                  -- extracted, length-capped, see crawler/extract.js
  word_count INTEGER NOT NULL DEFAULT 0,
  depth INTEGER NOT NULL DEFAULT 0,
  http_status INTEGER,
  last_modified TEXT,
  crawled_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_pages_site ON search_pages(site_id);
CREATE INDEX IF NOT EXISTS idx_search_pages_crawled ON search_pages(crawled_at DESC);

-- Inferred content-type tags (blog/portfolio/art/etc.), see crawler/extract.js.
CREATE TABLE IF NOT EXISTS search_page_tags (
  page_id TEXT NOT NULL REFERENCES search_pages(id),
  tag TEXT NOT NULL,
  PRIMARY KEY (page_id, tag)
);

CREATE INDEX IF NOT EXISTS idx_search_page_tags_tag ON search_page_tags(tag);

-- Outbound links, capped per page at crawl time. Not used for ranking yet,
-- exists for the spec's "future graph features" (and is how link-following
-- discovery finds new pages in the first place).
CREATE TABLE IF NOT EXISTS search_links (
  from_page_id TEXT NOT NULL REFERENCES search_pages(id),
  to_url TEXT NOT NULL,
  PRIMARY KEY (from_page_id, to_url)
);

-- The inverted index. One row per (term, page, field); weight is the
-- in-field term frequency (clamped at index time so keyword-stuffing a
-- single field can't dominate ranking), used directly as a ranking score
-- contribution. `field` lets title/description matches outrank body
-- matches without a second lookup. No FTS5 virtual table here on purpose:
-- see CLAUDE.md's "Indie Web Search Engine" section for why.
CREATE TABLE IF NOT EXISTS search_terms (
  term TEXT NOT NULL,
  page_id TEXT NOT NULL REFERENCES search_pages(id),
  field TEXT NOT NULL,             -- 'title' | 'description' | 'body'
  weight INTEGER NOT NULL,
  PRIMARY KEY (term, page_id, field)
);

CREATE INDEX IF NOT EXISTS idx_search_terms_page ON search_terms(page_id);

CREATE TABLE IF NOT EXISTS crawl_log (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  run_type TEXT NOT NULL,          -- 'full' | 'incremental' | 'manual'
  started_at TEXT NOT NULL,
  finished_at TEXT,
  pages_crawled INTEGER NOT NULL DEFAULT 0,
  pages_failed INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'running', -- 'running' | 'completed' | 'failed' | 'skipped'
  triggered_by TEXT NOT NULL,      -- 'cron' | 'admin:<email>'
  error TEXT
);

CREATE INDEX IF NOT EXISTS idx_crawl_log_started ON crawl_log(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_crawl_log_platform ON crawl_log(platform);

CREATE TABLE IF NOT EXISTS blocklist (
  id TEXT PRIMARY KEY,
  domain TEXT NOT NULL UNIQUE,
  reason TEXT,
  source TEXT NOT NULL,            -- 'removal_request' | 'admin_manual'
  added_by TEXT,
  added_at TEXT NOT NULL
);

-- No requester contact info required, keeps the removal form "dead simple"
-- per spec: just a URL and an optional reason.
CREATE TABLE IF NOT EXISTS removal_requests (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  reason TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'denied'
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  resolved_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_removal_requests_status ON removal_requests(status);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  category_hint TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- 'pending' | 'approved' | 'rejected'
  submitted_at TEXT NOT NULL,
  reviewed_at TEXT,
  reviewed_by TEXT
);

CREATE INDEX IF NOT EXISTS idx_submissions_status ON submissions(status);

-- Query text only, no IP/user binding, and deliberately no record of which
-- result (if any) a query's clicks landed on. Matches the homepage's own
-- "no trackers, no algorithms" framing.
CREATE TABLE IF NOT EXISTS search_queries_log (
  id TEXT PRIMARY KEY,
  query TEXT NOT NULL,
  result_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_search_queries_log_created ON search_queries_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_search_queries_log_query ON search_queries_log(query);

-- Crawl pause flags and the Neocities pagination cursor reuse the existing
-- generic settings table (see functions/_lib/settings.js) rather than a new
-- one-off table. These are admin-internal, not part of the public
-- /api/settings shape.
INSERT OR IGNORE INTO settings (key, value) VALUES ('search_crawl_paused_myjay', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('search_crawl_paused_neocities', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('search_crawl_paused_nekoweb', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('search_neocities_cursor', '0');
