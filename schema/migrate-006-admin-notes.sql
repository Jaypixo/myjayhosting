-- Internal-only notes an admin can leave on a user account (flagged for
-- review, VIP, whatever). Never shown to the user themselves, only to
-- other admins in the admin panel's Users tab.
ALTER TABLE users ADD COLUMN admin_notes TEXT;
