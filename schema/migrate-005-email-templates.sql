-- Email templates: the canned starting points for the admin Send/Broadcast
-- composers, previously hardcoded in public/admin.html as ONE_OFF_TEMPLATES.
-- Moving them here makes them admin-editable (add/edit/delete from the new
-- Email > Templates sub-tab) instead of requiring a code change.

CREATE TABLE IF NOT EXISTS email_templates (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'Other',
  subject TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_email_templates_category ON email_templates(category);

-- Seed with the same 23 templates that used to be hardcoded, so nothing
-- regresses for an existing install applying this migration. IDs match the
-- old object keys for continuity; anything created later through the API
-- gets a real UUID instead.
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('welcome', 'Welcome message', 'Account', 'Welcome to MyJay.net', 'Hi %username,

Welcome aboard. Your site is live at your subdomain, and the dashboard is where you''ll upload files, manage settings, and publish when you''re ready.

[Go to your dashboard](https://myjay.net/dashboard "button")

If anything''s unclear, the [docs](https://myjay.net/docs) cover the basics.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('suspended', 'Account suspended (temporary)', 'Account', 'Your MyJay.net account has been temporarily suspended', 'Hi %username,

Your account has been temporarily suspended while we look into [reason here].

Your site is offline for now, but your files and account are intact. We''ll follow up once the review is done.

If you have questions, reply to this email or use the [contact form](https://myjay.net/contact).', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('reinstated', 'Account reinstated', 'Account', 'Your MyJay.net account is active again', 'Hi %username,

Your account has been reinstated and %sitetitle is back online.

[Visit your dashboard](https://myjay.net/dashboard "button")

Thanks for your patience.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('termination', 'Account termination notice', 'Account', 'Your MyJay.net account has been terminated', 'Hi %username,

This is a notice that your MyJay.net account has been terminated for violating the platform''s terms of service.

If you believe this was a mistake, reply to this email or use the [contact form](https://myjay.net/contact) to reach us.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('deletion_confirmed', 'Account deletion confirmation', 'Account', 'Your MyJay.net account has been deleted', 'Hi %username,

This confirms that your MyJay.net account and all associated files have been permanently deleted, as requested.

If you didn''t request this, contact us immediately through the [contact form](https://myjay.net/contact).', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('verify_reminder', 'Email verification reminder', 'Account', 'Please verify your MyJay.net email', 'Hi %username,

Your email address isn''t verified yet. Until it is, you won''t be able to log back in if you ever get signed out.

Check your inbox for the verification email, or resend it from the login page.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('content_warning', 'Content warning (first notice)', 'Moderation', 'A note about content on %sitetitle', 'Hi %username,

We received a report about content on your site, %sitetitle, that may violate our [terms of service](https://myjay.net/terms).

Specifically: [describe the issue here].

This is a warning, not a takedown. Please review and update your site within 7 days. Repeated violations can lead to suspension or termination.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('dmca', 'DMCA / copyright takedown notice', 'Moderation', 'Copyright takedown notice for %sitetitle', 'Hi %username,

We received a copyright (DMCA) complaint regarding content on your site, %sitetitle.

The following material has been removed pending review: [describe the content/URL here].

If you believe this was a mistake, you can file a counter-notice through the [contact form](https://myjay.net/contact).', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('site_unpublished', 'Site unpublished for policy violation', 'Moderation', '%sitetitle has been unpublished', 'Hi %username,

Your site, %sitetitle, has been unpublished for violating our [terms of service](https://myjay.net/terms).

Reason: [describe the violation here].

Your files are still in your dashboard. Once the issue is resolved, you can republish from there.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('abuse_ack', 'Abuse report acknowledgment', 'Moderation', 'We received your abuse report', 'Hi %username,

Thanks for the report. We''re looking into it and will take action if it violates our [terms of service](https://myjay.net/terms).

We don''t always follow up individually on the outcome, but the report has been received and reviewed.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('feature_update', 'Feature / update announcement', 'Engagement', 'New on MyJay.net', 'Hi %username,

We just shipped something new: **[describe the feature here]**.

[Check it out](https://myjay.net/dashboard "button")

Let us know what you think.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('invite', 'Formal invitation to the platform', 'Engagement', 'An invitation to MyJay.net', 'Hello,

You''re invited to claim your own corner of the web at MyJay.net: free static hosting, no trackers, no algorithm deciding what you see.

[Claim your subdomain](https://myjay.net/register "button")

No strings attached.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('reengagement', 'Re-engagement ("we miss you")', 'Engagement', 'We miss you on MyJay.net', 'Hi %username,

It''s been a while since you last updated %sitetitle. Your site is still live, we just wanted to check in.

[Visit your dashboard](https://myjay.net/dashboard "button")', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('milestone', 'Milestone / thank you', 'Engagement', 'Thanks for being part of MyJay.net', 'Hi %username,

[Describe the milestone here, e.g. "it''s been a year since you joined" or "MyJay.net just crossed some number of sites"].

Just wanted to say thanks for being part of it. %sitetitle is one of the reasons this place is worth running.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('getting_started', 'Getting started nudge', 'Engagement', 'Getting started on MyJay.net', 'Hi %username,

You signed up but haven''t uploaded anything yet. Your subdomain is ready and waiting.

[Get started](https://myjay.net/dashboard "button")

The [docs](https://myjay.net/docs) walk through uploading your first file if you want a hand.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('admin_update', 'Update for fellow admins', 'Admin', 'Update for MyJay.net admins', 'Hi %username,

[Describe the admin-facing update here: new tooling, a policy change, anything that only affects how admins operate].

Let the rest of the team know if you have questions.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('storage_warning', 'Storage limit warning', 'Storage & limits', 'Your MyJay.net site is close to its storage limit', 'Hi %username,

Your site (%sitetitle) is approaching its 50MB storage limit. Once you hit it, new uploads will be rejected until you free up space.

[Manage your files](https://myjay.net/dashboard "button")', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('storage_reached', 'Storage limit reached', 'Storage & limits', '%sitetitle has reached its storage limit', 'Hi %username,

%sitetitle has hit its 50MB storage limit. New uploads will be rejected until you free up space.

[Manage your files](https://myjay.net/dashboard "button")

Delete anything you don''t need, or get in touch if you think this is a mistake.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('policy_update', 'Terms update', 'Legal & policy', 'Updates to MyJay.net''s terms', 'Hi %username,

We''ve updated our [terms of service](https://myjay.net/terms). The short version: [summarize the change here].

These changes take effect on [date]. Continued use of your account after that date means you accept the updated terms.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('privacy_update', 'Privacy policy update', 'Legal & policy', 'Updates to MyJay.net''s privacy policy', 'Hi %username,

We''ve updated our [privacy policy](https://myjay.net/privacy). The short version: [summarize the change here].

These changes take effect on [date]. Continued use of your account after that date means you accept the updated policy.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('maintenance', 'Scheduled maintenance notice', 'Legal & policy', 'Scheduled maintenance on MyJay.net', 'Hi %username,

MyJay.net will be in maintenance mode on [date] from [start time] to [end time]. Your site will be temporarily unreachable during that window.

No action needed on your end, your files and settings won''t be affected.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('support_followup', 'Support follow-up', 'Support', 'Following up on your message', 'Hi %username,

Following up on the message you sent us: [summary or response here].

Let us know if that answers it or if you need anything else.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
INSERT OR IGNORE INTO email_templates (id, label, category, subject, body, created_at, updated_at) VALUES ('bug_resolved', 'Bug report resolved', 'Support', 'The bug you reported has been fixed', 'Hi %username,

Good news: the issue you reported ([describe the bug here]) has been fixed and is live now.

Thanks for taking the time to report it, it genuinely helps.', '2026-06-20T18:57:26.531Z', '2026-06-20T18:57:26.531Z');
