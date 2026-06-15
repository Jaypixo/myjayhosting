-- Migration: adds per-day, per-country view stats for the dashboard and
-- admin "Stats" panels. Safe to run against an existing myjay-db, all
-- statements are idempotent.
--
-- Run with: npx wrangler d1 execute myjay-db --file=schema/migrate-001-site-view-stats.sql

CREATE TABLE IF NOT EXISTS site_view_stats (
  site_id TEXT NOT NULL REFERENCES sites(id),
  date TEXT NOT NULL,    -- YYYY-MM-DD
  country TEXT NOT NULL, -- ISO 3166-1 alpha-2, or 'XX' if unknown
  views INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (site_id, date, country)
);

CREATE INDEX IF NOT EXISTS idx_site_view_stats_site ON site_view_stats(site_id);
