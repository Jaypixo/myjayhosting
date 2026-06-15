# MyJay (`myjay.net`)

A Neocities-style static site host. Claim `username.myjay.net`, upload HTML/CSS/JS/images, flip a switch, and it's live. No trackers, no algorithms, no server-side code for user sites.

Runs entirely on Cloudflare's free tier:

| Piece | Cloudflare product | Purpose |
|---|---|---|
| Platform UI (`myjay.net`) | **Pages** | Hosts `public/`: homepage, dashboard, admin, etc. |
| API | **Pages Functions** | Everything under `functions/api/` |
| Subdomain sites (`*.myjay.net`) | **Worker** (`myjay-router`) | Serves user files from R2 |
| Accounts & site metadata | **D1** | `users`, `sites`, and `settings` tables |
| User-uploaded files | **R2** | Bucket `myjay-sites`, keyed as `sites/{username}/{path}` |
| Login sessions | **KV** | Namespace `myjay-sessions` |

There is no Node backend, no Docker, and no build step, `public/` is served as-is.

> **Status:** the full stack, registration, login/logout, the dashboard file
> manager (upload/list/edit/delete/publish), the explore page, admin user/site
> management, and the `username.myjay.net` router, has been exercised
> end-to-end against a local Miniflare simulation of D1/R2/KV and works as
> described below. See [§7](#7-whats-been-tested) for details.

---

## 1. Prerequisites

- A Cloudflare account (the free plan is enough)
- [Node.js](https://nodejs.org/) installed (for `npm` / `wrangler`)
- This repo pushed to a GitHub repository (Pages deploys from GitHub)

Install dependencies:

```bash
npm install
npx wrangler login
```

---

## 2. Quick setup (recommended)

Most of the Cloudflare setup is one-time resource creation that's tedious to
do by hand: create a D1 database, an R2 bucket, a KV namespace, copy three IDs
into `wrangler.toml`, run the schema. A script automates all of that:

```bash
npm run setup
```

This uses your already-authenticated `wrangler` session to:

- create the `myjay-db` D1 database (or find it if it already exists)
- create the `myjay-sites` R2 bucket
- create the `myjay-sessions` KV namespace
- ask for the email address that should become the admin account
- write `wrangler.toml` and `worker/wrangler.toml` with the correct IDs
- apply `schema/d1-init.sql` to the new database

It's safe to re-run, existing resources are detected by name and reused.

After it finishes, **four manual steps remain** (Cloudflare doesn't expose
these over the API in a scriptable way):

1. **Create the Pages project** and connect it to this GitHub repo
2. **Add custom domains** (`myjay.net`, `www.myjay.net`)
3. **Set the `SESSION_SECRET`** secret
4. **Deploy the router worker** and give it the `*.myjay.net` trigger

`npm run setup` prints these as a checklist at the end. The full walkthrough
for each is in [§3](#3-manual-cloudflare-setup) below, read it once if
anything in the checklist is unclear.

---

## 3. Manual Cloudflare setup

If you'd rather do everything by hand (or `npm run setup` didn't work for some
step), here's the full picture. Steps marked **(automated)** are what
`npm run setup` does for you.

### Step 1: D1, R2, KV **(automated)**

- D1 database named `myjay-db`: `npx wrangler d1 create myjay-db`
- R2 bucket named `myjay-sites`: `npx wrangler r2 bucket create myjay-sites`
- KV namespace named `myjay-sessions`: `npx wrangler kv namespace create myjay-sessions`
- Apply the schema: `npm run db:init` (runs `schema/d1-init.sql`)

### Step 2: `wrangler.toml` **(automated)**

```bash
cp wrangler.toml.example wrangler.toml
```

Fill in `account_id`, `database_id`, and the KV namespace `id` (all visible in
the Cloudflare dashboard, or in the output of the commands above). Also set
`ADMIN_EMAIL`: whoever **registers** with this email automatically gets
`role = 'admin'` and can access `/admin.html`. Register with this email first.

`wrangler.toml` is gitignored, it contains account-specific IDs, so every
developer/environment copies the `.example` and fills in their own.

### Step 3: Create the Pages project

1. Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**
2. Pick this repository
3. Build settings:
   - **Build command:** leave blank (no build step)
   - **Build output directory:** `public`
   - **Production branch:** `main`
4. Project name: `myjay`
5. Deploy, it'll go live at a `*.pages.dev` URL first, that's expected

### Step 4: Add your custom domain

1. In the `myjay` Pages project → **Custom domains** → **Set up a custom domain**
2. Add `myjay.net`
3. Add `www.myjay.net` as well (Cloudflare will offer to redirect it to the apex, accept that)
4. SSL certificates are issued automatically; this can take a few minutes

### Step 5: Bindings

`wrangler.toml` ships `[[d1_databases]]`, `[[r2_buckets]]`, `[[kv_namespaces]]`,
and `[vars]` sections, Cloudflare Pages picks these up automatically on
deploy. After your first deploy, double-check **Settings → Functions →
Bindings** on the Pages project shows:

| Type | Variable name | Resource |
|---|---|---|
| D1 database binding | `DB` | `myjay-db` |
| R2 bucket binding | `SITES` | `myjay-sites` |
| KV namespace binding | `SESSIONS` | `myjay-sessions` |
| Environment variable | `ADMIN_EMAIL` | your email |
| Environment variable | `MAX_UPLOAD_BYTES` | `52428800` |

If any are missing, add them manually, git-based deploys occasionally don't
pick up config-file bindings on the very first build.

### Step 6: Session secret

```bash
npx wrangler pages secret put SESSION_SECRET --project-name myjay
```
Generate a value with `openssl rand -hex 32` (or any long random string) when prompted. This is sensitive, never put it in `wrangler.toml` or an env var.

### Step 7: The subdomain router Worker

This is the trickiest part: user sites live at `username.myjay.net`, and Pages can't natively catch a wildcard subdomain, that's what `worker/router.js` is for.

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
# fill in account_id and database_id (same as wrangler.toml)
npm run router:deploy
```

This deploys a Worker named `myjay-router` with `DB` (D1) and `SITES` (R2)
bindings. Then, in the dashboard:

1. **Workers & Pages** → `myjay-router` → **Settings** → **Triggers** → **Custom Domains** → **Add Custom Domain**: `*.myjay.net`

That's it, `*.myjay.net` now routes to the worker, which looks up
`sites.published` in D1 and streams the matching file from R2.

---

## 4. Local development

```bash
npm install
npm run db:init:local
npm run dev
```

> `schema/d1-init.sql` is idempotent (`CREATE TABLE IF NOT EXISTS` /
> `INSERT OR IGNORE`), so if you have an existing local D1 from before the
> `settings` table existed, just re-run `npm run db:init:local`, it'll add
> the new table without touching your existing users/sites.

`npm run dev` runs `wrangler pages dev public`, serves `public/` plus
everything under `functions/`, simulating D1/R2/KV locally (no Cloudflare
account needed for this part, though `wrangler.toml` must still exist with
*some* IDs in it, placeholders are fine for local-only use).

The first account you register locally with the email matching `ADMIN_EMAIL`
becomes the admin, visit `/register.html`, sign up, then `/admin.html`.

### Testing the router worker locally

The router (`worker/router.js`) is a separate Worker and isn't served by
`wrangler pages dev`. To test it against the same local D1/R2 data:

```bash
cp worker/wrangler.toml.example worker/wrangler.toml
# placeholder account_id / database_id are fine for local-only use
cd worker
npx wrangler dev --local --persist-to "<absolute-path-to-repo>/.wrangler/state" --port 8789
```

Then send requests with a `Host` header to simulate a subdomain:

```bash
curl -H "Host: yourusername.myjay.net" http://127.0.0.1:8789/
```

> Older Wrangler versions store standalone-Worker local state one directory
> level deeper than `wrangler pages dev` does, so the two dev servers don't
> automatically share data even with the same `--persist-to`. This only
> affects local testing, production D1/R2 are shared normally. If you hit
> this, run `npm run db:init:local`, it stores schema in the `pages dev`
> location, and re-run it pointing at `worker`'s state directory too.

---

## 5. Deploying

Cloudflare Pages auto-deploys on every push to `main`:

```bash
git push origin main
```

The router Worker (`worker/router.js`) is **not** part of the Pages deploy, redeploy it manually if you change it:

```bash
npm run router:deploy
```

---

## 6. How it all fits together

- **`myjay.net`**: Pages serves `public/*.html` and `public/assets/*`. API calls go to `functions/api/*` (Pages Functions).
- **`functions/_middleware.js`**: runs on every `/api/*` request: validates the `session` cookie against KV, loads the user from D1, enforces auth on protected routes and `role = 'admin'` on `/api/admin/*`. Non-`/api/*` requests (your static pages) pass straight through.
- **`functions/_lib/`**: shared helpers (password hashing, session cookies, R2 file helpers). The leading underscore keeps Pages from treating these as routes.
- **`username.myjay.net`**: handled entirely by the `myjay-router` Worker via its `*.myjay.net` custom domain. It looks up `sites.published` in D1, then streams the matching object from `sites/{username}/{path}` in R2. Unpublished/missing sites and missing files get on-brand 404 pages, and each HTML page view increments `sites.view_count`.
- **R2 layout**: flat key namespace, `sites/{username}/{relative/path}`. No "folders" really exist; the dashboard's file tree is built by grouping keys on `/`.
- **D1**: `users` (accounts) and `sites` (one row per user: published flag, storage usage, view count). No table for individual files, R2 is the source of truth for file listings.

---

## 7. What's been tested

Verified end-to-end against a local Miniflare simulation (`wrangler pages dev`
+ `wrangler dev` for the router), walking through the full user journey:

- **Registration & login**: `/api/auth/register`, `/api/auth/check-username`,
  `/api/auth/login`, `/api/auth/logout`. Registering with the address in
  `ADMIN_EMAIL` correctly assigns `role = 'admin'`; the session cookie is set,
  validated by `_middleware.js`, and cleared on logout (subsequent requests
  correctly get `401`).
- **Dashboard file flow**: `/api/site/upload`, `/api/site/files`,
  `/api/site/file`, `/api/site/delete`, `/api/site/publish`. Upload writes to
  R2 with the right `Content-Type` and updates `sites.storage_bytes` /
  `updated_at`; delete removes the object and updates the file tree; publish
  toggles `sites.published`.
- **Explore & stats**: `/api/explore` returns published sites ordered by
  `updated_at`; `/api/admin/stats` aggregates user/site/storage counts
  correctly as data changes.
- **Admin**: `/api/admin/users`, `/api/admin/sites`, `/api/admin/stats` work
  for an admin session and correctly return `403 Forbidden` for a non-admin
  user.
- **Subdomain router**: `worker/router.js` correctly: serves a published
  site's `index.html` with the right `Content-Type`, returns a styled 404 for
  a missing file, returns a "not published" page for an unpublished or
  unknown username, ignores requests without a subdomain, and increments
  `sites.view_count` on HTML page views.

One issue was found and fixed during testing: `public/admin.html` built its
users/sites tables with `innerHTML` template strings containing DB-sourced
`email` fields, which is a stored-XSS vector if a user registers with HTML in
their email's local part. It now builds rows with `textContent` instead.

---

## 8. Limits (Phase 1)

- 50MB total storage per account (`MAX_UPLOAD_BYTES`)
- Allowed file types: `html htm css js json xml txt md jpg jpeg png gif webp svg ico woff woff2 ttf`
- 25MB per upload request (Cloudflare Pages Functions hard limit), bigger files need a pre-signed R2 URL flow, deferred to Phase 2
- One site per account, no custom domains yet

See [`public/about.html`](public/about.html) for the user-facing version of this, plus the roadmap.

---

## 9. Branding, maintenance mode, and admin controls

### Branding assets

Drop these three PNGs into `public/assets/img/` (the folder ships with a
`PLACE_IMAGES_HERE.txt` placeholder and is otherwise empty):

| File | Used for |
|---|---|
| `logo.png` | The header logo on every page |
| `favicon.png` | Browser tab icon (`<link rel="icon">` on every page) |
| `MyJayErrorMascot.png` | Centered on `/maintenance.html` |

None of these are required, every `<img>` tag has an inline `onerror`
fallback. If `logo.png` is missing, the header falls back to the text
wordmark ("MyJay" + ".net"); if the mascot is missing, it's just not shown.
Add the files whenever you have them, no code changes needed.

### Maintenance mode

Toggled from `/admin.html` → **Settings** tab. When enabled:

- Every non-API, non-asset request is redirected (302) to `/maintenance.html`,
  *except* for an active admin session, `/login.html`, and `/assets/*`, so
  an admin can always log in and turn it back off.
- `/maintenance.html` shows the mascot image (if present), a styled "back
  soon" message, and a terminal-log block.
- `/status.html` reflects the current state live via `/api/settings`.

This is stored in D1 (`settings.maintenance_mode`), not an env var, so it can
be flipped instantly without a redeploy.

### Announcement banner

Also in `/admin.html` → **Settings**: a short (≤280 char) message that, when
enabled, is injected at the top of every page by `main.js`
(`/api/settings` → `announcementEnabled` + `announcement`). Visitors can
dismiss it with the ✕; the dismissal is remembered per-tab via
`sessionStorage` for that exact message (editing the message re-shows it).

### Registration open/closed

A switch in **Settings** that, when off, makes
`/api/auth/register` return `403` for everyone *except* a signup using
`ADMIN_EMAIL` (so you can never lock yourself out). Useful for pausing
signups without taking the whole site down.

### Admin user search

The **Users** tab in `/admin.html` has a search box that filters the table
server-side (`GET /api/admin/users?q=...`, matched against `username` and
`email` via SQL `LIKE`).

### New static pages

- **`/help.html`**: getting-started guide and troubleshooting FAQ
- **`/status.html`**: live maintenance state + Cloudflare component status
- **`/privacy.html`**: privacy policy
- **`/terms.html`**: terms of use
- **`/maintenance.html`**: shown platform-wide during maintenance mode

All follow the Papyrus/Terminal design system and are linked from the footer
(`[3]`) and main nav (`Help`) on every page.
