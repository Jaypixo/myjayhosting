-- Fixes up already-seeded email_templates rows whose body still uses the
-- [label](url "button") markdown shorthand for a CTA button. That shorthand
-- relied on marked.js's custom link-renderer override; remarker.js (which
-- replaced marked.js, see functions/_lib/email-templates.js) has no such
-- hook, so these rows now embed the button's actual HTML directly instead,
-- which renders correctly through either parser since raw HTML always
-- passes through untouched. migrate-005-email-templates.sql's INSERT OR
-- IGNORE seed already has the fixed body text for fresh installs; this
-- migration is what catches up a database where these rows already exist.

UPDATE email_templates SET body = 'Hi %username,

Welcome aboard. Your site is live at your subdomain, and the dashboard is where you''ll upload files, manage settings, and publish when you''re ready.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/dashboard" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Go to your dashboard</a></td></tr></table>

If anything''s unclear, the [docs](https://myjay.net/docs) cover the basics.', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'welcome';
UPDATE email_templates SET body = 'Hi %username,

Your account has been reinstated and %sitetitle is back online.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/dashboard" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Visit your dashboard</a></td></tr></table>

Thanks for your patience.', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'reinstated';
UPDATE email_templates SET body = 'Hi %username,

We just shipped something new: **[describe the feature here]**.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/dashboard" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Check it out</a></td></tr></table>

Let us know what you think.', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'feature_update';
UPDATE email_templates SET body = 'Hello,

You''re invited to claim your own corner of the web at MyJay.net: free static hosting, no trackers, no algorithm deciding what you see.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/register" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Claim your subdomain</a></td></tr></table>

No strings attached.', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'invite';
UPDATE email_templates SET body = 'Hi %username,

It''s been a while since you last updated %sitetitle. Your site is still live, we just wanted to check in.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/dashboard" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Visit your dashboard</a></td></tr></table>', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'reengagement';
UPDATE email_templates SET body = 'Hi %username,

You signed up but haven''t uploaded anything yet. Your subdomain is ready and waiting.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/dashboard" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Get started</a></td></tr></table>

The [docs](https://myjay.net/docs) walk through uploading your first file if you want a hand.', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'getting_started';
UPDATE email_templates SET body = 'Hi %username,

Your site (%sitetitle) is approaching its 50MB storage limit. Once you hit it, new uploads will be rejected until you free up space.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/dashboard" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Manage your files</a></td></tr></table>', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'storage_warning';
UPDATE email_templates SET body = 'Hi %username,

%sitetitle has hit its 50MB storage limit. New uploads will be rejected until you free up space.

<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;"><tr><td style="background-color:#c7522a;"><a href="https://myjay.net/dashboard" style="display:inline-block;padding:12px 24px;font-family:''Courier New'', Courier, monospace;font-size:14px;color:#ffffff;text-decoration:none;">Manage your files</a></td></tr></table>

Delete anything you don''t need, or get in touch if you think this is a mistake.', updated_at = '2026-06-21T18:02:44.650Z' WHERE id = 'storage_reached';
