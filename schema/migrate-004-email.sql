-- Migration: email infrastructure (mailer worker, verification, password
-- reset, unsubscribe, bounce suppression). Safe to run against an existing
-- myjay-db, all statements are idempotent.
--
-- Run with: npx wrangler d1 execute myjay-db --file=schema/migrate-004-email.sql

-- Existing accounts are backfilled as verified in the same migration that
-- adds the column, so nobody already registered gets locked out of login
-- once the verification gate goes live. Only new signups start unverified.
ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
UPDATE users SET email_verified = 1;

CREATE TABLE IF NOT EXISTS email_log (
  id TEXT PRIMARY KEY,            -- UUID
  recipient TEXT NOT NULL,
  type TEXT NOT NULL,             -- verify | reset | security_alert | admin_message | broadcast | blog_notification | welcome | storage_warning | storage_reached | site_published
  subject TEXT NOT NULL,
  body_html TEXT,                 -- the rendered HTML that was sent, needed so POST /api/admin/email/resend/:logId has something to resend
  status TEXT NOT NULL DEFAULT 'queued', -- queued | sent | delivered | bounced | failed
  opened INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  resend_id TEXT,                 -- Resend's own message id, used to match webhook events back to this row
  user_id TEXT,                   -- nullable: not every send maps to an account (e.g. a typo'd admin one-off)
  error TEXT,                     -- the exact reason a failed/skipped send didn't go out, shown in the admin log
  created_at TEXT NOT NULL
);

-- If you're applying this migration to a database that already has an
-- email_log table from before body_html / error existed, run these by hand:
--   ALTER TABLE email_log ADD COLUMN body_html TEXT;
--   ALTER TABLE email_log ADD COLUMN error TEXT;

CREATE INDEX IF NOT EXISTS idx_email_log_created ON email_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_email_log_resend_id ON email_log(resend_id);

-- One row per (user, notification type) the user has opted out of. Absence
-- of a row means subscribed (the default), a row means unsubscribed. This
-- only gates non-transactional sends, see CLAUDE.md.
CREATE TABLE IF NOT EXISTS notification_prefs (
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  unsubscribed INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, type)
);

CREATE TABLE IF NOT EXISTS bounce_suppression (
  email TEXT PRIMARY KEY,
  reason TEXT,
  created_at TEXT NOT NULL
);
