-- MyJay Hosting Platform — D1 schema (Phase 1)
-- Run with: npx wrangler d1 execute myjay-db --file=schema/d1-init.sql

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,            -- UUID
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL,  -- slug, 3-32 chars, [a-z0-9-]
  password_hash TEXT NOT NULL,    -- "salt:hash" from PBKDF2
  role TEXT NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  banned INTEGER NOT NULL DEFAULT 0, -- 0 = active, 1 = banned
  created_at TEXT NOT NULL,       -- ISO 8601
  bio TEXT,
  site_title TEXT
);

CREATE TABLE IF NOT EXISTS sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,         -- denormalized for fast lookup
  published INTEGER NOT NULL DEFAULT 0, -- 0 = draft, 1 = live
  updated_at TEXT NOT NULL,
  view_count INTEGER NOT NULL DEFAULT 0,
  storage_bytes INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_sites_username ON sites(username);
CREATE INDEX IF NOT EXISTS idx_sites_published_updated ON sites(published, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);

-- Site-wide key/value settings, managed from the admin panel.
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('maintenance_mode', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('announcement', '');
INSERT OR IGNORE INTO settings (key, value) VALUES ('announcement_enabled', '0');
INSERT OR IGNORE INTO settings (key, value) VALUES ('registration_enabled', '1');
