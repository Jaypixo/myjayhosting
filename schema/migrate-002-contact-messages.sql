-- Migration: adds the contact form inbox used by public/contact.html and
-- the admin panel's Contact tab. Safe to run against an existing myjay-db,
-- all statements are idempotent.
--
-- Run with: npx wrangler d1 execute myjay-db --file=schema/migrate-002-contact-messages.sql

CREATE TABLE IF NOT EXISTS contact_messages (
  id TEXT PRIMARY KEY,            -- UUID
  category TEXT NOT NULL,         -- see CATEGORIES in functions/api/contact/index.js
  username TEXT,                  -- optional, the sender's myjay username if provided
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new', -- 'new' | 'read' | 'replied'
  created_at TEXT NOT NULL        -- ISO 8601
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at DESC);
