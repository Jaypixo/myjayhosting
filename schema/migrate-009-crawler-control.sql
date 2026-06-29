-- Moves per-domain rate-limiting and failure-tracking off Workers KV and
-- onto these two columns instead. See CLAUDE.md's "Indie Web Search
-- Engine" incident notes: the crawler was still exceeding the free-tier
-- daily KV put limit after the first fix, because markFetched() and
-- recordFailure() wrote to KV on essentially every single page, a
-- completely separate cost from the daily page-count budget. D1 writes
-- are not the constrained resource here, KV writes are, so this state
-- moves to the table cell that already gets written on every page anyway.
--
-- Run with: npx wrangler d1 execute myjay-db --file=schema/migrate-009-crawler-control.sql

ALTER TABLE search_sites ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE search_sites ADD COLUMN last_attempted_at TEXT;
