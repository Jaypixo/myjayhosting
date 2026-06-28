# CLAUDE.md: MyJay Hosting Platform
> Codex for AI-assisted development. Read this entire file before writing a single line of code.

---

## Project Overview

**Product:** A Neocities-style static website hosting platform for the indie web.
**Domain:** `myjay.net`
**Stack:** 100% Cloudflare: Pages, Pages Functions (Workers), D1, R2, KV. No external servers. No Node backend. No Docker. No traditional databases.
**Repository:** GitHub → deployed via Cloudflare Pages CI/CD
**Design system:** Papyrus/Terminal (see §Design System below). Every page must conform to it.

The platform lets anyone claim a subdomain (`username.myjay.net`), upload static files, and publish a personal website. No strings attached. The spirit is the old web: messy, personal, human.

**Phase 1 scope (this build):** Core infrastructure only.
- Marketing homepage (`myjay.net`)
- User registration & login (email/password)
- User dashboard (file manager, upload, publish)
- Public site serving (`username.myjay.net/*`)
- Admin panel (owner-only)
- Static about/info pages

Superseding the original Phase 1 "Explore" page (recently updated sites):
MyJay Search, an indie-web search engine indexing MyJay, Neocities, and
Nekoweb. See the dedicated "Indie Web Search Engine" section below, it's
well past a Phase 1 scope sketch at this point.

Everything else (blog tool, guestbook, microblog, ad network, pro plan) is deferred. Build the foundation cleanly so those layers can be added later.

---

## Repository Structure

```
/
├── CLAUDE.md                  ← you are here
├── package.json
├── wrangler.toml              ← Cloudflare config (see §Cloudflare Setup)
├── public/                    ← Static assets for myjay.net itself
│   ├── index.html             ← Marketing homepage
│   ├── search.html            ← MyJay Search (see Indie Web Search Engine)
│   ├── about.html
│   ├── login.html
│   ├── register.html
│   ├── dashboard.html         ← Authenticated user dashboard
│   ├── admin.html             ← Owner admin panel
│   └── assets/
│       ├── style.css          ← Shared design system CSS (extracted)
│       └── main.js            ← Shared JS utilities
├── functions/                 ← Cloudflare Pages Functions (server-side)
│   ├── api/
│   │   ├── auth/
│   │   │   ├── register.js
│   │   │   ├── login.js
│   │   │   └── logout.js
│   │   ├── user/
│   │   │   ├── me.js          ← GET current user info
│   │   │   ├── sites.js       ← GET user's site list
│   │   │   └── update.js      ← PATCH profile
│   │   ├── site/
│   │   │   ├── upload.js      ← POST file upload to R2
│   │   │   ├── delete.js      ← DELETE file from R2
│   │   │   ├── publish.js     ← POST mark site as published
│   │   │   └── files.js       ← GET file tree for dashboard
│   │   ├── search/             ← MyJay Search API (see Indie Web Search Engine)
│   │   └── admin/
│   │       ├── users.js       ← GET/PATCH/DELETE users
│   │       └── sites.js       ← GET/DELETE any site
│   └── _middleware.js         ← Auth session validation
├── worker/                    ← Separate Worker for subdomain routing
│   └── router.js              ← Serves username.myjay.net from R2
└── schema/
    └── d1-init.sql            ← D1 database schema
```

---

## Cloudflare Setup (What YOU Configure Manually)

Claude cannot touch your Cloudflare dashboard. You must do these steps yourself before the code will work. Do them in order.

### 1. Cloudflare Pages Project
- Create a new Pages project named `myjay`
- Connect it to your GitHub repository
- Build command: `npm run build` (or leave blank, no build step needed for Phase 1)
- Output directory: `public`
- Production branch: `main`

### 2. Custom Domain
- In Pages → Custom Domains, add `myjay.net`
- Also add `www.myjay.net` (redirect to apex)
- Cloudflare will handle SSL automatically

### 3. Subdomain Wildcard Routing
This is the trickiest part. User sites live at `username.myjay.net`. A Pages Function can't natively catch wildcard subdomains. You need a **separate Worker** for this.

- In Workers & Pages → Create Worker → name it `myjay-router`
- Deploy `worker/router.js` to it
- In the Worker's Triggers tab → add Custom Domain: `*.myjay.net`
- This Worker intercepts all subdomains and serves files from R2

### 4. D1 Database
- Workers & Pages → D1 → Create database → name it `myjay-db`
- Run `schema/d1-init.sql` against it using: `npx wrangler d1 execute myjay-db --file=schema/d1-init.sql`
- In your Pages project → Settings → Bindings → add D1 binding:
  - Variable name: `DB`
  - Database: `myjay-db`
- Also bind it in your Worker (same binding name)

### 5. R2 Bucket
- R2 → Create bucket → name it `myjay-sites`
- In Pages project bindings → R2 binding:
  - Variable name: `SITES`
  - Bucket: `myjay-sites`
- In Worker bindings → same

### 6. KV Namespace (sessions)
- Workers & Pages → KV → Create namespace → name it `myjay-sessions`
- Bind to Pages project:
  - Variable name: `SESSIONS`
  - Namespace: `myjay-sessions`
- Bind to Worker as well

### 7. Environment Variables (Pages → Settings → Environment Variables)
```
SESSION_SECRET=<generate a long random string, e.g. openssl rand -hex 32>
ADMIN_EMAIL=<your email address>
MAX_UPLOAD_BYTES=52428800   # 50MB free tier limit
```

### 8. wrangler.toml
After cloning the repo, copy `wrangler.toml.example` to `wrangler.toml` and fill in your account ID and resource IDs (found in the Cloudflare dashboard). This file is gitignored.

### 9. Search Engine Infrastructure (MyJay Search)
Added well after the Phase 1 steps above; see "Indie Web Search Engine" for
the full architecture. The CLI parts (`wrangler queues create`, `wrangler kv
namespace create`, `wrangler deploy --config crawler/wrangler.toml`, the
migration) can all be run from a terminal with an authenticated `wrangler`
and need no dashboard at all. **Only the two binding adds below are
dashboard-only**, there is no `wrangler` subcommand or API call this repo's
tooling uses that can add a binding to an existing git-connected Pages
project, confirmed against current wrangler (checked both v3 and v4) and
against the Cloudflare docs before writing this down as a hard requirement
rather than a guess.

1. `wrangler queues create myjay-crawl-queue`
2. `wrangler kv namespace create myjay-search-cache` (prints an `id`, copy it)
3. Copy `crawler/wrangler.toml.example` to `crawler/wrangler.toml`, fill in
   the D1 `database_id` (same one the root `wrangler.toml` uses) and the KV
   `id` from step 2, then `npm run crawler:deploy`. This one deploy
   registers the Cron Triggers and the Queue consumer together.
4. `npx wrangler d1 execute myjay-db --remote --file=schema/migrate-008-search-engine.sql`
5. **Dashboard, binding 1 of 2**: [dash.cloudflare.com → Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages)
   → click the `myjay` Pages project → **Settings** → **Bindings** → **Add** → **KV namespace**.
   Variable name: `SEARCH_CACHE`. KV namespace: `myjay-search-cache` (the one from step 2).
6. **Dashboard, binding 2 of 2**: same project, **Settings** → **Bindings** → **Add** → **Service binding**.
   Variable name: `CRAWLER`. Service: `myjay-crawler` (the Worker from step 3).
7. Do steps 5–6 *before* the next `git push`, not after: a binding only takes
   effect on the deployment created after it's added, and Pages doesn't
   redeploy on its own just because a binding changed. If you push first,
   you'd need a second, no-op deployment afterward (an empty commit, or
   "Retry deployment" on the latest one in the dashboard) to pick it up.
8. Once deployed, bootstrap a few real Nekoweb seeds yourself via `/search`'s
  "Submit a site" link, Nekoweb has no bulk discovery surface to crawl

---

## Architecture Deep-Dive

### Auth Flow
- Registration: email + password → bcrypt hash stored in D1 → session token created in KV (TTL 30 days) → `Set-Cookie: session=<token>; HttpOnly; Secure; SameSite=Lax`
- Login: same, verify hash → new session token
- All `/api/*` routes except register/login are protected by `_middleware.js`, which reads the cookie, validates against KV, and attaches `request.user` to context
- Admin routes additionally check `user.role === 'admin'`

Use the Web Crypto API (available in Workers) for bcrypt equivalent, specifically PBKDF2 with SHA-256 and a random salt. Store as `salt:hash` in D1. Do not use bcryptjs or any npm package unless it's a pure Web Crypto wrapper.

### File Storage (R2)
User files are stored in R2 with the key pattern: `sites/{username}/{filepath}`

Example: if `noah` uploads `index.html`, it's stored as `sites/noah/index.html`.

Upload endpoint (`/api/site/upload`):
- Validate session (middleware)
- Validate file type (whitelist: html, css, js, jpg, jpeg, png, gif, webp, svg, ico, txt, md, xml, json, woff, woff2, ttf)
- Validate total storage quota (query R2 list, sum sizes, free tier: 50MB)
- Store in R2 with correct `Content-Type` header
- Update `sites.updated_at` in D1
- Return new file tree

The dashboard file manager shows a tree of the user's R2 files. Use `env.SITES.list({ prefix: 'sites/{username}/' })` to enumerate them.

### Subdomain Router Worker
When a request comes in for `noah.myjay.net/about.html`:
1. Extract username from hostname: `noah`
2. Look up the site in D1: `SELECT id, published FROM sites WHERE username = ?`
3. No row at all → `siteNotClaimedResponse`. A row exists but
   `published = 0` → `siteNotPublishedResponse`. **These are deliberately
   different responses, not one generic "doesn't exist" page.** Every
   account gets a `sites` row at signup, before they ever publish (see
   `functions/api/auth/register.js`'s `env.DB.batch([...])`), so "no row"
   reliably means nobody has registered that username, and "row, but
   `published = 0`" reliably means someone has and just hasn't published
   yet. The first case invites the visitor to claim it (`Claim this name`
   → `/register`); the second doesn't, it's already someone's, there's
   nothing for a random visitor to do, so it just links back to MyJay.net.
   Don't collapse these back into one response, the distinction is the
   point.
4. Fetch from R2: `sites/noah/about.html`
5. If R2 returns null and path doesn't have extension: try `path/index.html`
6. If still null: check R2 for `sites/noah/404.html`, a custom 404 page the
   site owner uploaded themselves. If it exists, serve it (still with a
   real `404` status, not `200`, search engines and link checkers need the
   status to be honest even though the body is user content). If it
   doesn't exist, fall back to `fileNotFoundResponse`, the platform's own
   styled 404.
7. Stream the R2 response back with the correct `Content-Type`

The Worker must handle directory-style URLs: `noah.myjay.net/blog/` should try `sites/noah/blog/index.html`.

All three of the Worker's own error pages (`siteNotClaimedResponse`,
`siteNotPublishedResponse`, `fileNotFoundResponse` in `worker/router.js`)
and the main site's `public/404.html` share the same look: a short heading,
one line of plain-English explanation, the error mascot
(`MyJayErrorMascot.png`), and a single link back to somewhere useful. **No
terminal-log block on any of these**, that component is for genuinely
log-like or code-like content (see Tone, in the Design System section, and
`docs/getting-started.html`'s actual HTML code sample for a legitimate use),
not the one sentence a confused visitor needs to actually read.
`maintenance.html` had a `$ myjay status` terminal block for the same
reason and lost it for the same reason, don't reintroduce one on an
error/status page. Since `worker/router.js` is a separate Worker with no
static assets of its own, its error pages reference the mascot via the
full `https://myjay.net/assets/img/...` URL, not a relative path.

`fileNotFoundResponse`'s heading and description are **word-for-word
identical** to `public/404.html` ("404" / "This page doesn't exist. It may
have been moved, renamed, or never existed in the first place."), on
purpose, "serve our exact 404 page" was the literal ask. The only thing
that's allowed to differ between the two is the one link: the main site's
says "Back to MyJay.net" and goes to `/`; the Worker's says "Back to
{username}.myjay.net" and *also* goes to `/`, which already resolves to
that subdomain's own root since the response is served from
`username.myjay.net` itself. If the main 404's copy ever changes, update
`fileNotFoundResponse` to match, they're meant to drift together, not
independently (there's no shared source to fetch from at runtime, the
Worker is intentionally self-contained and doesn't depend on the Pages
site being reachable, so this has to be kept in sync by hand).

### D1 Schema
See `schema/d1-init.sql`. Tables:

```sql
users (
  id TEXT PRIMARY KEY,           -- UUID
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL, -- slug, 3-32 chars, [a-z0-9-]
  password_hash TEXT NOT NULL,   -- "salt:hash" from PBKDF2
  role TEXT DEFAULT 'user',      -- 'user' | 'admin'
  banned INTEGER DEFAULT 0,      -- added by migrate-002, see schema/
  created_at TEXT NOT NULL,      -- ISO 8601
  bio TEXT,
  site_title TEXT,
  email_verified INTEGER DEFAULT 0, -- added by migrate-004-email.sql
  admin_notes TEXT               -- added by migrate-006, internal-only, see "Users tab" below
)

sites (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  username TEXT NOT NULL,        -- denormalized for fast lookup
  published INTEGER DEFAULT 0,   -- 0 = draft, 1 = live
  updated_at TEXT NOT NULL,
  view_count INTEGER DEFAULT 0,
  storage_bytes INTEGER DEFAULT 0
)
```

This block is the Phase 1 baseline plus the columns later migrations added
to these two tables specifically; it's not a full re-derivation of every
table in the schema (`settings`, `notification_prefs`, `email_log`,
`email_templates`, etc. all exist too, each documented in the section
that actually uses it rather than re-listed here). `schema/*.sql` is the
authoritative source if this drifts.

No separate files table, enumerate R2 directly. This keeps D1 lean.

### Platform stats and view counts
`GET /api/stats` (`functions/api/stats.js`) returns the 24 most recently
updated published sites plus platform-wide totals (total sites, total
views). This is what it sounds like, not a search concept: it's the same
query the old Explore page ran, kept alive as its own small endpoint
because the homepage's hero counter and preview strip, and `/status`'s
platform card, all still need it, even though the actual "browse sites"
job moved to MyJay Search (see Indie Web Search Engine, below) once
Explore was retired.
```sql
SELECT s.username, s.updated_at, s.view_count, u.bio, u.site_title
FROM sites s JOIN users u ON s.user_id = u.id
WHERE s.published = 1
ORDER BY s.updated_at DESC
LIMIT 24
```

View counts: the subdomain Router Worker increments `sites.view_count` via a D1 write on each page load. To avoid hammering D1, use a KV counter as a write buffer and flush to D1 periodically (or just write directly, it's fine for Phase 1).

### Public file listing API

`GET /api/sites/:username/files` (`functions/api/sites/[username]/files.js`)
answers "what files does this site actually have", the same role
Neocities' `list` API plays, for code running anywhere, not just
myjay.net's own frontend, there's no other way to enumerate a site's files
short of scraping its rendered HTML for links. Returns
`{ username, files: [{ key, size, modified }] }`, `.keep` empty-folder
placeholders filtered out (an internal implementation detail, see
Architecture Deep-Dive on empty-folder markers, that has no business in a
public response).

Mirrors the subdomain Router Worker's own "not claimed" vs "claimed but
not published" distinction rather than collapsing both into one generic
404 (`404` + `No site is registered at this subdomain` vs `403` + `This
site exists but has not been published`): that's the exact same
distinction anyone already gets by just visiting the subdomain directly,
exposing it over JSON isn't a new leak. A short `Cache-Control: public,
max-age=60` covers repeated polling without depending on every caller
respecting it.

**This is the one `/api/*` route that's genuinely cross-origin, on
purpose.** Every other route is restricted to `myjay.net`/`www.myjay.net`
(plus localhost for dev) by `_middleware.js`'s `ALLOWED_ORIGINS` check,
which rejects anything else with a 403 before the request ever reaches a
handler. `/api/sites/*` is listed in that same file's `OPEN_API_PREFIXES`
instead, a deliberately separate list: paths there skip the origin check
entirely and get `Access-Control-Allow-Origin: *` (via `openCorsHeaders()`)
instead of the restrictive origin-echoing CORS response, and skip the
session lookup too, since this is meant to be hit by plain server-side
code with no cookie jar at all, not just by browsers. A new route that's
meant to be public-and-same-origin-only (like `/api/stats` or `/api/search`) belongs in
`PUBLIC_API_PATHS`, not `OPEN_API_PREFIXES`, those solve different
problems: one skips auth, the other skips the origin restriction too. Only
add something to `OPEN_API_PREFIXES` when the whole point is letting
arbitrary external code call it, which today is just this one feature.

---

## Pages & UI Spec

### All pages share:
- Papyrus/Terminal design system (see §Design System)
- Torn-paper header with MyJay logo
- Graph paper body background
- Footer with footnotes
- Navigation: Home / Search / About / Login (or Dashboard if logged in)
- JS checks for session cookie on page load. If present, swap Login link for Dashboard + username

### `index.html`: Marketing Homepage
Hero: large torn-paper header. Headline (Crimson Pro italic): *"Your corner of the web."* Subheadline: *"Free static hosting. No trackers. No algorithms. No VC money. Just your HTML."*

Below the header:
- Three-column feature strip (terminal card style): Upload → Publish → Done
- A live counter widget: *"X sites hosted, Y page views served"*, fetch from `/api/stats`
- A preview strip of recently updated sites (pull from `/api/stats`, show 6 cards). "See all sites" links to `/search?platform=myjay`, not a standalone browse page, see Indie Web Search Engine
- A call-to-action button: *"Claim your subdomain →"* → `/register.html`

### `register.html`: Registration
- Username field (validated: 3–32 chars, `[a-z0-9-]` only, checked live against `/api/auth/check-username`)
- Shows preview: `username.myjay.net`
- Email + password fields
- Submit → POST `/api/auth/register` → on success, redirect to `/dashboard.html`
- Link to login

### `login.html`
- Email + password
- POST `/api/auth/login` → redirect to `/dashboard.html`

### `dashboard.html`: User Dashboard (authenticated)
Layout: sidebar + main (270px / 1fr grid).

Sidebar:
- User avatar placeholder (initials-based, generated via CSS)
- Username + `username.myjay.net` link
- Storage bar: `{used}MB / 50MB`
- Nav: Files / Settings / Visit Site / Logout

Main: Files tab:
- File tree view (fetch from `/api/site/files`)
- Upload button → opens file picker (multi-file, drag-and-drop)
- Files shown as a tree with delete buttons
- Publish toggle (big, obvious): *"Site is LIVE"* / *"Site is DRAFT"*, POST `/api/site/publish`
- Code editor: clicking a file in the tree opens it in a simple `<textarea>` (or CodeMirror if you can load it from a CDN without npm) with a Save button

This is the original Phase 1 sketch. The file manager actually built is
considerably more than this (rename/move, multi-select, search/sort, a
whole-site zip export, a unified upload control, an editor dark mode
toggle), see the dedicated "Dashboard File Manager" section below for
what's really there.

Main: Settings tab:
- Site title field
- Bio field
- Change email / password
- Email preferences: which automatic, non-transactional emails the
  platform sends this user (see Notification preferences, below); separate
  form from the rest, its own save button, since it hits a different
  endpoint (`/api/user/notification-prefs`, not `/api/user/update`)
- Search indexing: "Allow this site to be indexed by MyJay Search", its own
  form/endpoint (`POST /api/site/search-indexing`) for the same reason
  email preferences gets one, see Indie Web Search Engine, below

(`explore.html` no longer exists: the original Phase 1 "browse sites" page
was retired in favor of MyJay Search, see the dedicated section below.)

### `admin.html`: Owner Panel (role: admin only)
- Redirect to `/login.html` if not admin
- Tabs: Users / Sites / Contact / Email / Stats / Settings (this list grew
  well past the original Phase 1 sketch of just Users/Sites/Stats, see the
  Email Infrastructure section above for everything under the Email tab)
- Users tab: paginated table of all users. Per-row actions: Ban/Unban,
  Make admin/Demote, Reset password (admin generates and is shown a
  plaintext password once), **Email reset link** (sends the normal
  self-service reset email instead, via the public
  `/api/auth/request-reset` endpoint, so the admin never sees or handles a
  plaintext password at all), **Resend verification** (only rendered when
  the user isn't verified yet, calls the public
  `/api/auth/resend-verification` endpoint), **Notes** (internal-only
  freeform text via `admin_notes` on `users`, never shown to the user
  themselves, button label gets a `*` suffix when notes already exist so
  it's visible at a glance without opening the modal), and Delete. The
  Status column shows an `unverified` badge next to active/banned when
  applicable, there's no separate column for it. Email reset link and
  Resend verification deliberately reuse the existing public, session-less
  auth endpoints rather than adding admin-specific versions, they're
  already idempotent and safe to call from an authenticated context.
- Sites tab: table of all published sites, with unpublish/delete actions
- Stats tab: total users, total sites, total storage used (aggregate from D1)

### `about.html`
Static page. Voice: dry, honest. Cover: what this is, what it isn't, the hosting limits (50MB, no server-side code, no databases for user sites), the ethos (indie web, no tracking, no ads on the platform itself). Include the roadmap for future features (blogs, guestbooks, ad network) framed as a dev log.

---

## Dashboard File Manager

`public/dashboard.html`'s Files tab, expanded well past the Phase 1 sketch
above. Still no separate files table (per Architecture Deep-Dive, R2 is
enumerated directly), everything here is built from the same
`GET /api/site/files` listing, plus three new endpoints under
`functions/api/site/`: `download.js`, `rename.js`, and the writer they
share, `functions/_lib/zip.js`.

**One "New ▾" menu covers every creation action.** `#new-btn` opens
`.fm-dropdown`'s menu (`#new-menu`): New file, New folder, Upload files,
Upload folder, rather than several separate, equally-weighted toolbar
buttons (an earlier pass had New folder as its own button alongside a
separate Upload split-button; consolidating both creation paths into one
menu, GitHub's "Add file" dropdown is the closest analog, freed up enough
toolbar width that the squeezed 280px layout below stopped clipping
controls off the edge). Drag-and-drop onto the file list still works
independently of this menu. **New file** (`createNewFile()`) doesn't need
its own endpoint, it's a zero-byte `File` pushed through the same
`POST /api/site/upload` everything else uses, then opens straight into
the editor, same flow as GitHub's "Create new file." It calls
`openEditor({ key: path, name })` directly with the path/name it already
has, *not* `allFiles.find(...)` after reloading the listing: entries in
`allFiles` are the bare `{ key, size, modified }` shape `/api/site/files`
returns, no `.name`, and `openEditor()` reads `file.name` (for
`extOf()`/CodeMirror mode detection) before it ever calls `cm.setValue()`.
Passing it an entry with no `.name` threw there and aborted before the
new content loaded, leaving whatever the editor last had open on screen,
which looked exactly like the new file came pre-filled with the previous
file's content. Any future code that opens a freshly-created or
freshly-renamed file the same way needs to pass an object with both `key`
and `name`, not a raw listing entry.

**Drag-and-drop preserves a dropped folder's structure, but only bothers
the `FileSystemEntry` API when there's actually a folder involved.** A
plain drop's `e.dataTransfer.files` is a flat `FileList`, files dropped as
part of a folder don't get `webkitRelativePath` set the way an `<input
webkitdirectory>` selection's files do (that property is specific to that
input), so recovering the real structure needs
`DataTransferItem.webkitGetAsEntry()` and the `FileSystemEntry` API
instead (`walkEntry()`/`walkEntries()`/`readAllDirEntries()`/
`entryToFile()`). This was missing entirely in an earlier pass (the drop
handler always called `uploadFiles(e.dataTransfer.files, false)`, the
same flat path used for individually-picked files) — not an R2/Workers
limitation, the upload endpoint already happily accepts many files with
arbitrary nested paths in one multipart request, nothing server-side ever
needed to change.

The drop handler checks `entries.some((entry) => entry.isDirectory)`
first: if nothing dropped is a folder, it skips the `FileSystemEntry`
machinery entirely and calls plain `uploadFiles(e.dataTransfer.files,
false)`, the same already-proven path file-input uploads use. This isn't
just an optimization. An earlier version always walked every drop through
`FileSystemFileEntry.file()`, resolving multiple entries' files via
`Promise.all`, and dropping two *plain* files (no folder) at once would
occasionally swap their content, e.g. `index.html` would land in R2
holding `style.css`'s bytes and vice versa. A from-scratch Node
reproduction proved this isn't an ordinary JS closure/`Promise.all`
ordering bug (mock entries with deliberately adversarial, reversed
callback timing still paired correctly), which points at the *native*
implementation of `.file()` itself misbehaving under concurrent calls
rather than anything expressible in spec-level JS semantics, an exotic
enough possibility that it isn't worth depending on this API at all for
the common case. `walkEntry()`/`walkEntries()` now also resolve strictly
one entry at a time, depth-first, with no `Promise.all` anywhere, for the
folder case where the API is unavoidable. `getDroppedEntries()` still has
to call `webkitGetAsEntry()` synchronously inside the `drop` handler for
every item before any of the `await`s that follow, browsers tear down the
drag data store as soon as the handler yields, capturing the entries
can't be deferred. Falls back to plain `uploadFiles(e.dataTransfer.files,
false)` whenever `webkitGetAsEntry` isn't available at all too (despite
the vendor prefix, that's effectively never on a current browser).

**Row actions are always visible, not hover-only.** They used to be
`display: none` until `:hover`, which made them unreachable on touch and
could read as buttons that had simply gone missing. They're rendered at
all times now (just dimmed to 0.6 opacity at rest, full opacity on
hover/focus, see `.fm-row-actions` in `style.css`), and are icon-only
(`.icon-btn`, pencil/trash) rather than labelled `.btn`s so a row with
3-4 actions doesn't run out of width. The filename column keeps its
`flex: 1; min-width: 0` + ellipsis, so a long name truncates instead of
ever pushing into the action icons. Folder rows show a recursive item
count (`N items`, `.keep` placeholders not counted) in the same column a
file row uses for its size, for the same "how much is actually in here"
reason a real file manager shows it.

**The side panel only ever opens when something is actually showing in
it.** `setPanelOpen(true/false)` toggles `.fm-container`'s `panel-open`
class, which is what squeezes `.fm-left` down to 280px to make room for
the editor/viewer. `closeEditor()`/`closeViewer()` each take a
`closePanelIfEmpty` flag (default `true`) and only call
`setPanelOpen(false)` once *both* are confirmed closed, so closing one
while the other is still open doesn't collapse the panel out from under
it. Every call site that closes both at once (`navigateTo()`,
`renameEntry()`, `deleteFolder()`) must call them with that default,
*not* `closeEditor(false)`: passing `false` was tried for navigation and
rename and was wrong, it suppressed `setPanelOpen(false)` unconditionally
since neither call alone could ever see "both are closed", leaving an
empty, still-squeezed panel open with nothing rendered inside it after
navigating away from an open file. If you add a new call site that closes
both, use the plain default-argument calls, not `false`.

**Rename doubles as move.** `POST /api/site/rename` (`{ from, to }`) is a
copy-then-delete, R2 has no native rename. The dashboard's rename prompt
(pencil icon, both file and folder rows) pre-fills the current relative
path and lets the user edit the whole thing, so changing the directory
portion *is* how something moves, there's no separate move UI, no
drag-to-a-folder interaction to maintain. Folder rename detects "folder"
by absence: an `env.SITES.head()` hit on the exact key means it's a single
file; no hit means `from` is treated as a prefix and every object beneath
it gets remapped. Moving a folder inside itself is rejected
(`newDirPrefix.startsWith(dirPrefix)`), and landing on an existing file
path is rejected with 409, both before anything is written.

**Multi-select and bulk actions.** Each file row (not folder rows, those
keep their own "Delete all") gets a checkbox; checking one swaps the
`.fm-subtoolbar` (search + sort) for `.fm-bulkbar` ("N selected · Download
· Delete · Clear") rather than showing both at once. Selection is scoped
to the current, currently-filtered folder view on purpose: navigating to
a different folder clears it, and `renderFileManager()` prunes any
selected key that's no longer visible (deleted, renamed, filtered out) on
every render, so the count can never silently include something the user
can no longer see or act on.

**Search and sort.** `#fm-search` filters the current folder's rows
client-side by substring match on name (matches a folder by its own name
too, not its contents); `#fm-sort` is Name / Size (largest first) / Type.
Both are purely client-side over the already-fetched `allFiles` listing,
no new endpoint.

**Whole-site export.** `GET /api/site/download` zips every object under
`sites/{username}/` (skipping `.keep` placeholder files, see Architecture
Deep-Dive on empty-folder markers) and returns it as
`{username}-myjay-site.zip`. Repeat `?key=` to zip a subset instead, the
bulk-selection "Download" button and the toolbar's "Download .zip" button
(whole site) both hit this same endpoint, one with keys, one without.
`functions/_lib/zip.js` is a from-scratch, dependency-free ZIP writer
(stored/uncompressed entries, hand-rolled CRC32 and the three classic
PKZIP records), for the same reason `remarker` had to be vendored instead of
bare-imported (see Email Infrastructure, above): this project doesn't run
`npm install` at deploy time, so a real zip library would hit the exact
same "Could not resolve" build failure. Each object is fetched with its
own `env.SITES.get()` subrequest; Workers' free-plan cap (50 subrequests
per request) means a site with more than ~50 files can't be exported in
one shot there, paid plans get 1000. Not worth pagination/streaming
complexity for a feature bounded by a 50MB-total quota.

**Editor dark mode.** A manual toggle (moon/sun icon button in the editor
panel header, `#editor-theme-btn`), independent of the site's own
light/dark switching via `prefers-color-scheme`, since someone may want a
dark editor on a light system or vice versa. Persisted in `localStorage`
(`myjay-editor-dark`). Swaps the CodeMirror `theme` option between
`default` and `myjay-dark`, a theme defined in `style.css`
(`.cm-s-myjay-dark`) using the same dark-mode tokens and brand accent
colors as the rest of the site, hardcoded rather than `var(...)` since
CodeMirror themes don't participate in the `prefers-color-scheme` query
themselves.

**Unsaved changes can't be silently discarded.** `editorDirty` flips true
on the editor's first real edit (a CodeMirror `change` event;
`suppressDirtyEvent` is set around the `setValue()` call that loads a
file, so loading content doesn't count as "the user changed something")
and shows a dot next to the filename (`#editor-dirty-dot`, the same
dot-on-a-tab convention most code editors use). `confirmDiscardIfDirty()`
is the one gate everything funnels through: opening a different file,
opening the viewer, navigating to another folder, renaming the open file,
or clicking the editor's own Close button all call it first and bail out
if the user cancels. It's a no-op (resolves `true` immediately) whenever
nothing is open or nothing is dirty, so it never prompts when there's
genuinely nothing to lose. A `beforeunload` listener covers the
tab-close/refresh case the same way. Deleting the open file (single or
via bulk/folder delete) does *not* go through this gate, the delete
confirmation the user already clicked through covers it, a second "discard
changes" prompt on top would be redundant.

**In-file find/replace is hand-built on CodeMirror's core API, not the
`addon/search/search.js` bundle.** That addon's own UI is a plain
unstyled prompt bar; replicating its handful of lines of search-cursor
logic (`posFromIndex`/`markText`/`setSelection`/`scrollIntoView`/
`replaceRange`, see the "Find / replace" section of the script) gets a
find bar that actually matches the design system for about the same
amount of code, with no extra CDN script. Matches are found with a plain
`indexOf` scan over `cm.getValue()`, not a real search-cursor object,
which is why replace-all walks `findMatches` in *reverse* order: replacing
a later match first means earlier matches' `{line, ch}` positions never
shift out from under it. Tested against a mock CodeMirror object (not the
real one, there's no browser in this environment) covering multi-line
matches, case sensitivity, empty-query (no infinite loop), and both
longer- and shorter-replacement-text reflow. `Ctrl-H` opens find with
replace expanded; `Cmd-H` doesn't exist as a binding at all, it's "hide
window" at the OS level on Mac and a page can never intercept that, Mac
users reach replace via the disclosure arrow next to the find input
instead. Escape closes the find bar before anything else: the global
Escape handler (`setupKeyboardShortcuts`) checks whether the find bar is
open *before* its `editingKey` check, otherwise pressing Escape with
focus on one of the find bar's own buttons (not its input, so it doesn't
register as "typing") would fall through and close the whole editor right
behind it.

**The cursor-position readout doubles as the "go to line" trigger.**
`#editor-cursor-pos` (`Ln X, Col Y`, plus a live selection-length suffix
when there's a selection) is a real `<button>`, not just text, clicking
it opens the same `Ctrl-G`/`Cmd-G` prompt. Both read off CodeMirror's
`cursorActivity` event, not a polling loop.

**File/folder info is a modal, not a new row of text.** Both the file and
folder row actions get an "info" icon (`showFileInfo()`/
`showFolderInfo()`) opening a `buildModal()` popup with a `.modal-meta`
dt/dd grid: path, exact size, last-modified date, extension, and (since
the username is already known client-side, see `currentUsername`, set in
`loadUser()`) the live `username.myjay.net` URL, each copyable via a
small inline icon button. The modal also gets a "Download" (single file)
or "Download .zip" (folder) button next to Close, reusing the same
`downloadKeysUrl()` the bulk-selection bar already uses, rather than
adding a 5th icon to an already-busy row (file rows already carry
Edit/View, info, rename, delete). Folder info aggregates item count and
total size from the already-loaded `allFiles` list, no new endpoint, same
as the existing recursive item count on each folder row. Image files get
an additional "Dimensions" row and text files a "Contents" row (line /
word / character count), both filled in *after* the modal opens
(`metaRowDeferred()` renders "Loading..." first) since both need an extra
read: dimensions come from loading the file through `new Image()` (the
same `/api/site/preview` URL the row thumbnail already uses), line/word/
character counts from the same `GET /api/site/file` the editor uses to
open a file, neither blocks the modal from appearing immediately with
the metadata that's already on hand.

**Copying to the clipboard always gives visible feedback, success or
failure, never silence.** An earlier version called
`navigator.clipboard.writeText()` and swallowed any rejection
(`.catch(() => {})`) — that API can fail or simply not exist for reasons
that have nothing to do with the user doing anything wrong (document
focus, permissions policy, browser support), and silently eating the
failure looked exactly like the button doing nothing at all, which is
exactly what got reported. `copyToClipboard()` now falls back to the
classic hidden-`<textarea>` + `document.execCommand('copy')` trick
whenever the modern API is missing or rejects, and *always* swaps the
button's icon to a checkmark (success) or the close-X (failure, with a
title telling you to copy manually) for about a second, regardless of
which path actually copied the text.

**The editor/viewer filename used to render as just its first character
plus an ellipsis.** `.fm-panel-fname` had `overflow: hidden;
text-overflow: ellipsis; white-space: nowrap;` but no `flex: 1`, so as a
flex item it defaulted to `flex: 0 1 auto`, never claimed its parent's
spare width, and ellipsis kicked in almost immediately. Giving it
`flex: 1` directly (so it claims available space first and only
truncates once genuinely squeezed by its siblings) fixed the filename's
own sizing, but wasn't the whole story: `.fm-panel-header` still laid the
filename and the entire button cluster (saved-msg, find, theme, save,
close, now also maximize) out in one shared row, so on anything but a
wide panel the buttons alone could still eat the row before the filename
got a real chance at it, "buttons take up all the space" rather than the
original one-letter-ellipsis symptom. The actual fix is structural:
`.fm-panel-header` is `flex-direction: column` now, holding two separate
`.fm-panel-header-row` rows that never compete for the same horizontal
space *by construction* — row 1 is `.fm-panel-fname-wrap` alone (filename
+ dirty dot), row 2 is the saved-message and `.fm-panel-tools` button
cluster alone. The viewer panel got the same two-row treatment, and its
close button is wrapped in `.fm-panel-tools` like the editor's, so it
also gets `flex-shrink: 0` protection. `.fm-panel-header-row` no longer
relies on `justify-content: space-between` to push `.fm-panel-tools` to
the right, that only works when there's a second sibling in the row to
space against, and the viewer's tools row has just the one Close button,
no saved-message span the way the editor's row 2 does, so space-between
would collapse to flex-start and leave Close sitting on the left.
`.fm-panel-tools` carries its own `margin-left: auto` instead, so it
self-anchors to the right edge of whichever row it's in regardless of
what else (if anything) shares that row. Both filename spans keep a `title`
attribute with the full path, for whatever truncation a genuinely narrow
window still forces.

**"File names don't show up" turned out to be about the file *list* rows
(`.fm-row-name`), not the editor/viewer panel header above.** Both use the
same `flex: 1; min-width: 0` idiom, and the panel header fix above is real
and was never the bug, it was just the wrong element: every report of
names rendering as a single character or nothing, in any window size,
turned out to reproduce only once a file was actually open. That's the
tell, because `.fm-container.panel-open .fm-left { flex: 0 0 280px; }`
locks the file list to a **fixed** 280px the moment the side panel opens,
independent of the window or browser width entirely, which is exactly why
resizing the window never changed anything. At 280px, a row's fixed-width
chrome, checkbox, type icon, the size/item-count column, the Edit/View
text button, and 2-4 icon actions, adds up to most or all of that budget
on its own before `.fm-row-name`'s `flex: 1` ever gets handed anything to
grow into, since it's the only column actually allowed to shrink. A file
row with all of Edit + info + rename + delete present is the worst case,
which is consistent with it being "one letter or none at all" rather than
a consistent amount of truncation. The fix gives two things back instead
of widening the list (which would fight directly against making the
editor bigger, the squeeze exists specifically to make room for it):
`.fm-container.panel-open .fm-row-size` and
`.fm-container.panel-open .fm-row-open-btn` both go `display: none`.
Size/item-count is one click away in the existing info modal regardless.
The Edit/View button (now tagged with the `fm-row-open-btn` class
specifically so this rule can target it without also catching folder's
"Delete all", which has no equivalent fallback and stays visible) is
genuinely redundant, not just hidden capability: `buildFileRow()` already
wires `row.addEventListener('click', ...)` to open the same file, Edit/
View was always a second way to trigger the exact same action. Worth
remembering for any future "the name's not visible" report on this same
component: check whether the side panel is open before chasing the panel
header again, the two truncate under completely different conditions.

**The editor can hide the file list entirely for more room.**
`#editor-maximize-btn` (in the editor's button row) toggles a
`.maximized` class on `.fm-container` via `toggleMaximize()`; CSS
(`.fm-container.panel-open.maximized .fm-left { display: none; }`) hides
the file tree/toolbar column so the editor panel takes the full width
instead of sharing it with the squeezed 280px file list. `updateMaximizeBtn()`
swaps the icon/title between maximize and minimize, and `setPanelOpen()`
resets `.maximized` (and the icon) back to its default state whenever the
panel fully closes, so closing the editor and opening a different file
later doesn't silently start maximized. This is the toggle, not a layout
that's always full-width: the side-by-side file list is still the default
because seeing both at once (e.g. while renaming things or checking
what's nearby) is useful most of the time, maximize is for when it isn't.

**CodeMirror needs an explicit `.refresh()` after anything resizes its
container with pure CSS, or its gutter/line-wrap measurements go stale.**
This showed up as "line markings bug out", most noticeably in `.md` files
since `lineWrapping: true` means prose lines wrap more often than code
and are therefore more sensitive to a stale cached wrap-height. Every
place that changes the editor's pixel size after it's already mounted —
opening or closing the find bar, expanding or collapsing the replace row,
toggling maximize, or the window itself resizing — now calls
`refreshEditorSoon()` (a `setTimeout(() => editor.refresh(), 50)`,
deferred one tick so the CSS change has actually applied to layout before
CodeMirror re-measures against it).

**File-type icons have more visual variety now.** Previously every
non-HTML text type (css/js/json/xml/svg/md/txt) shared one generic
"code brackets" icon; `getTypeInfo()` now looks extension up in
`CODE_ICON_BY_EXT` for five of them (`css` gets a droplet, `js` a
lightning bolt, `json` literal curly-brace strokes, `md` a hash mark,
`txt` ruled horizontal lines), and leaves `xml`/`svg` on the shared
brackets icon since they're genuinely markup rather than code, prose, or
plain text.

**Search reaches every file on the site, not just the current folder.**
Typing in `#fm-search` switches `renderFileManager()` from
`renderBrowseView()` to `renderSearchResultsView()`, which filters the
*whole* `allFiles` array by substring match on the full key (so searching
a folder's name surfaces everything under it, see below) and displays
each result's full path instead of a bare filename, replacing the
breadcrumb with a "Search results for "x" · Clear" label rather than
leaving it pointing at a folder that's no longer what's on screen.
Clearing the query (or the explicit Clear link) drops back to
`renderBrowseView()` at whatever `currentPath` was last set to,
unchanged. Deliberately files-only: a query matching a folder's *name*
still surfaces every file under it (typing "blog" finds everything in
`blog/`), but there's no synthesized folder row for it to navigate into
directly, the existing per-folder browsing already covers that case,
and inventing one just for search results wasn't worth the extra
complexity. Clicking a result (`openSearchResult()`) navigates
`currentPath` to that file's actual parent folder and re-renders the
browse view *before* opening it, the same confirm-then-close-then-mutate
order `navigateTo()` already uses, so closing the file or clearing the
search afterward leaves you looking at the folder the file actually lives
in, not wherever you happened to be browsing before you searched.
`buildFileRow()` is shared between both views (an `onOpen` parameter
swaps in `openSearchResult` instead of opening in place); `buildFolderRow`
stays browse-view-only since search has no folder rows to build.

---

## Design System

Every HTML page in `public/` must implement the Papyrus/Terminal design system exactly as specified. Extract shared CSS into `public/assets/style.css` and link it from every page, do not duplicate styles.

### CSS Custom Properties (mandatory in every file / `:root`)
```css
:root {
  --paper:       #f5f0e8;
  --paper-alt:   #ede8dc;
  --ink:         #1a1716;
  --muted:       #9b8f82;
  --primary:     #c7522a;
  --secondary:   #3b6e8f;
  --tertiary:    #5c7a3e;
  --warning:     #d4a017;
  --error:       #b83232;
  --border:      rgba(26, 23, 22, 0.12);
  --grid-line:   rgba(26, 23, 22, 0.015);
}
@media (prefers-color-scheme: dark) {
  :root {
    --paper:     #201e24;
    --paper-alt: #18161a;
    --ink:       #e8e2d9;
    --muted:     #7a7068;
    --border:    rgba(232, 226, 217, 0.10);
    --grid-line: rgba(232, 226, 217, 0.015);
  }
}
```

### Fonts
```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@1,300&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
```
- Headings → Crimson Pro, 300 italic
- Body/code/labels → IBM Plex Mono
- Nav/UI chrome → Inter, uppercase, `letter-spacing: 0.06em`

### Layout
- Landing/article pages: centered wrapper `max-width: 700px`
- Dashboard/admin: sidebar+main grid `270px 1fr`

### Required Elements (every page)
1. **Graph paper body background**: repeating-linear-gradient grid
2. **Torn-paper header**: `clip-path: polygon(...)` jagged edge, ink background
3. **Footer footnotes**: `[1]` and `[2]` in IBM Plex Mono 0.7rem muted

### Logo
`https://myjay.net/public/MyJayLogo-Transparent.png`
- "MyJay" renders white (`#e8dacb`) always
- ".net" renders orange (`#e25728`) always

### Component Rules
- Buttons: `border-radius: 0`, square. Primary: terracotta. Ghost: transparent with ink border.
- Links: no underline, `border-bottom: 1px dashed var(--primary)`. Hover: solid.
- Cards: `border-radius: 0`, `border: 1px solid var(--border)`, `background: var(--paper-alt)`
- No box shadows. No gradients on components. No rounded corners > 4px.

### Tone
- Dry, technical, slightly self-aware
- Metadata feels like system output: `v0.1.0-alpha`, `status: nominal`
- Terminal log blocks are for genuinely log-like or code-like content (raw data dumps, code samples); prefer tables, lists, and badges for anything a user needs to actually read and act on
- Write like a human, not a press release. No em dashes anywhere in user-facing copy, use commas, periods, or colons instead.
- Never name the hosting vendor (or its products: Pages, Workers, D1, R2, KV, etc.) in anything a visitor can read. Footers, status pages, and prose should describe things generically ("independently run", "the platform", "our database", "the network edge that handled the request"). This is a deliberate choice, not an oversight, don't "helpfully" add the vendor name back in.

---

## API Contract

All API routes live under `/api/`. JSON in, JSON out. Errors return `{ error: "message" }` with appropriate HTTP status.

```
POST /api/auth/register      { username, email, password } → { userId, username }
POST /api/auth/login         { email, password } → { username }  (sets cookie)
POST /api/auth/logout        → {} (clears cookie)
GET  /api/auth/check-username?u=slug → { available: bool }

GET  /api/user/me            → { id, username, email, bio, siteTitle, storageUsed }
POST /api/user/update        { bio?, siteTitle?, email?, password? } → { ok }
GET  /api/user/notification-prefs   → { broadcast, blogNotification }  (true = subscribed)
PATCH /api/user/notification-prefs  { broadcast?, blogNotification? } → { broadcast, blogNotification }

GET  /api/site/files         → { files: [{ key, size, modified }] }
POST /api/site/upload        multipart/form-data → { uploaded: [filenames] }
DELETE /api/site/delete      { key } → { ok }
POST /api/site/rename        { from, to } → { ok }  (copy+delete; also how a file/folder moves)
GET  /api/site/download      ?key= (repeatable, omit for whole site) → application/zip
POST /api/site/publish       { published: bool } → { ok }
POST /api/site/search-indexing { indexed: bool } → { ok }

GET  /api/stats              → { sites: [{ username, siteTitle, updatedAt, viewCount }], stats: { totalSites, totalViews } }
GET  /api/sites/:username/files → { username, files: [{ key, size, modified }] }  (public, no session, open CORS)
GET  /api/health             → { checkedAt, database: {ok,ms}, storage: {ok,ms}, sessions: {ok,ms} }  (public, no session)

POST /api/contact            { category, username?, email, message } → { ok }  (public, no session)

GET  /api/search             ?q=&platform=&tag=&since=&page= → { query, results, total, page, pageSize, usedFallback, suggestion }
GET  /api/search/autocomplete ?q= → { suggestions: [string] }
GET  /api/search/random      ?platform= → { url, title, platform, domain }
GET  /api/search/recent      ?platform=&tag=&limit=&offset= → { results: [...] }
GET  /api/search/tags        → { tags: [{ tag, count }] }
GET  /api/search/similar     ?url= → { results: [...] }
GET  /api/search/stats       → { totalSites, totalPages, platforms: [...] }
POST /api/search/submit      { url, categoryHint? } → { ok }  (public, no session)
POST /api/search/remove-request { url, reason? } → { ok }  (public, no session)

GET  /api/admin/users        → { users: [...] }
PATCH /api/admin/users/:id   { role?, banned?, password?, adminNotes? } → { ok }
DELETE /api/admin/users/:id  → { ok }
GET  /api/admin/sites        → { sites: [...] }
DELETE /api/admin/sites/:id  → { ok }
GET  /api/admin/contact      → { messages: [{ id, category, username, email, message, status, createdAt }] }
PATCH /api/admin/contact/:id { status: 'new'|'read'|'replied' } → { ok }
DELETE /api/admin/contact/:id → { ok }

GET  /api/admin/email/templates        → { templates: [{ id, label, category, subject, body }] }
POST /api/admin/email/templates        { label, category, subject, body } → { id, label, category, subject, body }
PATCH /api/admin/email/templates/:id   { label?, category?, subject?, body? } → { id, label, category, subject, body }
DELETE /api/admin/email/templates/:id  → { ok }

GET  /api/admin/search/stats           → { totalSites, totalPages, totalTerms, pendingSubmissions, pendingRemovals, platforms, lastRuns, last30Days }
GET/POST /api/admin/search/crawl       → { paused } / { action: 'trigger'|'pause'|'resume', platform, full? } → { ok }
GET  /api/admin/search/sites           ?page=&q=&platform=&status= → { sites: [...], total, page, limit }
GET/PATCH /api/admin/search/sites/:id  → site detail + pages / { action: 'recrawl'|'block'|'unblock' } → { ok }
GET/POST /api/admin/search/blocklist   → { entries: [...] } / { domain, reason? } → { ok }
DELETE /api/admin/search/blocklist/:id → { ok }
GET  /api/admin/search/removal-requests ?status= → { requests: [...] }
PATCH /api/admin/search/removal-requests/:id { action: 'approve'|'deny' } → { ok }
GET  /api/admin/search/submissions     ?status= → { submissions: [...] }
PATCH /api/admin/search/submissions/:id { action: 'approve'|'reject' } → { ok }
DELETE /api/admin/search/pages/:id     → { ok }  (remove one page without blocklisting its domain)
GET  /api/admin/search/queries         → { topQueries, zeroResultQueries, last30Days }
```

Contact form categories (`functions/api/contact/index.js`, mirrored in the `<select>` in
`public/contact.html` and the `CATEGORY_LABELS` map in `public/admin.html`): `general`,
`account`, `billing`, `feature`, `abuse`, `dmca`, `security`, `privacy`, `bug`, `press`,
`partnership`, `other`. Keep all three in sync if this list changes.

There is no outbound email sending configured for this project (no Email Routing / Workers
Send Email binding). The admin panel's "Reply" action on a contact message is a `mailto:`
link that opens the admin's own email client with the sender's address, a subject line, and
the original message quoted, it does not send anything server-side. If real server-side
email sending is wanted later, that needs server-side email routing (or a third-party SMTP/API
provider) configured against the `myjay.net` domain, which touches DNS and isn't something to
wire up casually.

`public/status.html` is powered entirely by `/api/health`, `/api/settings`, `/api/stats`, and `/api/search/stats`.
There is no hardcoded "everything is operational" table on that page anymore, every row is a
real, live check (a trivial query against the database, a 1-item list against file storage,
a get against the session store). If a check can't be made real with what's actually available,
don't add a fake row for it, leave it out instead.

---

## Security Rules

- All user-uploaded files are served from R2 via the subdomain Worker. They never execute on the main domain.
- The main `myjay.net` domain only serves the platform UI, no user content ever appears here.
- Session tokens are UUIDs stored in KV. The cookie is `HttpOnly; Secure; SameSite=Lax`. Never expose session tokens in API responses.
- Username validation must be enforced server-side (not just client-side): regex `^[a-z0-9-]{3,32}$`. Block reserved names: `www`, `api`, `admin`, `mail`, `ftp`, `myjay`, `support`, `help`, `static`, `assets`, `cdn`.
- File uploads: validate Content-Type on the server. Reject executables. Reject files > `MAX_UPLOAD_BYTES` per file. Enforce total quota per user.
- Admin routes: middleware must verify `user.role === 'admin'`. Do not rely on client-side role checks.
- CORS: API routes should only accept requests from `myjay.net` origin.
- **The root admin is untouchable by other admins.** The account whose email matches `env.ADMIN_EMAIL` (see `isRootAdmin()` in `_lib/auth.js`) can't be banned, demoted, password-reset, or deleted by any other admin. This is enforced in `functions/api/admin/users/[id].js` (PATCH and DELETE both check it server-side, first, before touching anything) and mirrored in `public/admin.html`'s UI (the row shows a "protected" badge instead of action buttons for everyone except the root admin themself). The root admin can still do all of this to other admins, and to themself. If `ADMIN_EMAIL` isn't set, this protection is a no-op, there's no root to protect. Never weaken or bypass this check "to make testing easier."
- **The search crawler never executes or proxies third-party content.** It fetches a crawled page's HTML, extracts plain text fields (title, description, body text, tags) into D1, and discards the rest. Search results link straight to the original external URL, myjay.net never renders or iframes a crawled page. Crawled body text is treated as untrusted: it's HTML-escaped before any `<mark>` highlighting is added (see `highlightExcerpt()` in `functions/_lib/search-tokenize.js`), and the search frontend builds result cards with `createElement`/`textContent`, never `innerHTML` over raw field values, so a crawled page can't plant markup that runs on a search results page.
- **The crawler doesn't store personally identifiable information from crawled pages.** It keeps extracted title/description/body/tags, not full raw HTML, and search query logging (`search_queries_log`) keeps the query text only, no IP address, no account link, no record of which result a query's clicks landed on.

---

## UI Conventions

- **No native `alert()` / `confirm()` / `prompt()`.** Use `showAlert()`, `showConfirm()`, `showPrompt()` from `public/assets/main.js` instead, they render an in-page modal styled to match the design system (all async, all return Promises, `await` them). Pass `{ danger: true }` to `showConfirm` for destructive actions (delete, wipe, ban), it swaps the confirm button and top border to the error color.
- **No native HTML5 validation bubbles.** Every `<form>` should have `novalidate`, then do its own validation in JS on submit using `setFieldError(input, message)` / `clearFieldError(input)` / `clearFormErrors(form)` from `main.js`. These add/remove a red border and a red message paragraph directly under the offending input, they don't touch the generic `.form-error` banner. Keep the HTML `required`/`pattern`/`minlength` attributes for semantics and accessibility, `novalidate` just stops the browser from popping up its own bubble over them.
- **Server errors should carry a `field` hint when they map to one input.** `errorResponse(message, status, field)` in `_lib/auth.js` takes an optional third argument; when present, the JSON body includes `{ error, field }`. The frontend checks `data.field` and routes the message to that specific input via `setFieldError`, falling back to the `.form-error` banner when there's no field (or when attributing the error to a field would leak information, e.g. login intentionally never says whether the email or the password was wrong).
- **Custom modals (more than a yes/no or single input) build on `buildModal()`/`attachDismiss()`, exported from `main.js`.** `showAlert`/`showConfirm`/`showPrompt` cover the generic cases; when a popup needs arbitrary content and several specific actions, e.g. the admin Contact tab's message-detail popup, call `buildModal({ title, body, wide })` directly with a hand-built `body` node, then append whatever buttons make sense to the returned `actions` element and wire `attachDismiss(overlay, onCancel)` yourself. Don't hand-roll a second `.modal-overlay`/`.modal-box` from scratch, and don't stretch `showConfirm` to do this by stuffing extra buttons into it after the fact. `wide: true` gets `.modal-wide` (560px instead of the default 420px cap) for content that needs the room, it still shrinks to fit narrow screens the same as the default size.
- **Don't lengthen a table row to show more of it, popup the row instead.** Expanding a cell in place (the contact table used to do this for the full message) pushes every row below it down and the table stops lining up with itself as you click around. Keep the table row to short, scannable values, remove any action buttons that were sitting in the row, make the row itself clickable (`tr.dataset.clickable = 'true'`, pairs with the `tr[data-clickable]` hover style in `style.css`) to open a `buildModal()` popup with the full content and the actions that used to live in the row.
- **An inline explainer that's only sometimes present (an email log's failure reason, say) is a hover tooltip, not a second line of text in the cell.** Printing it directly into the cell makes that one row taller than every other row in the table and breaks the table's alignment. Use the `.tooltip` class: a small element with `data-tooltip="..."` content, `tabIndex = 0` so keyboard users can reach it too, no separate block-level node. See the email log's status cell (`public/admin.html`) for the pattern.
- **Any table that can plausibly get more than 4-5 columns wide should sit inside a `.table-scroll` div** (`<div class="table-scroll"><table>...</table></div>`), so it scrolls horizontally on narrow screens instead of squashing every column down to illegibility or pushing the whole page wider than the viewport. `.table-scroll` also forces `white-space: nowrap` on cells, a table that's allowed to scroll should grow as wide as it needs and scroll, not wrap text first and scroll second, wrapping first just makes rows tall AND still need a scrollbar.

---

## SEO Conventions

- **Internal links use clean URLs, never `.html`.** Cloudflare Pages auto-strips the extension and 308-redirects `/foo.html` → `/foo`. Every `href`, `window.location.href`, and JS-set `.href` in this codebase must point straight at the clean URL (`/about`, `/login`, `/dashboard`, etc.), not the `.html` form. Linking to the `.html` version makes Google crawl through a pointless redirect and was previously showing up in Search Console as "page with redirect." When adding a new page, write its internal links clean from the start.
- **Every public page needs, in its `<head>`:** a unique `<meta name="description">` (under ~160 characters, no two pages share one), a `<link rel="canonical" href="https://myjay.net/<clean-path>">`, and for anything worth sharing, `og:type`/`og:title`/`og:description`/`og:url`/`og:image` plus matching `twitter:card`/`twitter:title`/`twitter:description`. Legal/utility pages (privacy, terms, status) only need the description + canonical, OG tags add no value there. `public/assets/img/logo.png` is the default `og:image` until a dedicated social card image exists.
- **Private, auth-gated pages (`dashboard.html`, `admin.html`) get `<meta name="robots" content="noindex, nofollow">`** instead of a description, and are `Disallow`'d in `robots.txt`. They have no content worth indexing and shouldn't show up in search results.
- **`public/robots.txt`, `public/sitemap.xml`, `public/llms.txt` are real static files**, not generated. Update `sitemap.xml` (clean URLs, sensible `priority`) whenever a new public page is added or removed. Update `llms.txt`'s page list and description to match. All three are allowlisted in `_middleware.js`'s `MAINTENANCE_ALLOWLIST` so crawlers don't get redirected to the maintenance page mid-crawl.
- `llms.txt` follows the llmstxt.org convention: a short summary, then a flat list of key pages with one-line descriptions, then a "Notes for crawlers and assistants" section calling out that user subdomains are independent and unmoderated, and that the dashboard/admin have no public content.

---

## Documentation Section (`/docs`)

The long-form reference for the whole platform. There is no separate
`help.html`, it was removed, `/docs/getting-started` is the quickstart and
the rest of `/docs` is the FAQ/reference, don't recreate a second "quick
help" page alongside it. Lives at `public/docs/`, one file per topic, all
served at clean URLs via the same `.html`-stripping behavior as the rest of
the site.

Current pages, in sidebar order: `index.html` (`/docs`, overview + links to
everything below), `getting-started.html`, `dashboard.html`, `file-manager.html`,
`code-editor.html`, `publishing.html`, `routing.html`, `file-types-and-limits.html`,
`analytics.html`, `search.html`, `search-indexing.html`, `account-and-security.html`,
`troubleshooting.html`.

**Every docs page is a hand-copied shell**, there's no templating, so adding
or reordering a page means touching things in multiple places:

1. Add the new `.html` file under `public/docs/`, same `<head>` SEO block pattern as the others (`og:type` is `article` for docs pages, not `website`).
2. Add it to the `.docs-nav` sidebar block in **every** existing docs page (it's duplicated, not shared), and mark the current page's link `class="active"`.
3. Wire up `.docs-pager` prev/next links on the new page and on its new neighbors.
4. Add it to `sitemap.xml` and to the "Documentation" section of `llms.txt`.
5. The main site nav (`Home / Explore / Docs / About / Contact`) only links to `/docs` itself, individual sub-pages are reached from the sidebar, not the top nav.

**Accuracy bar is high here on purpose**, this section exists to be the
correct, detailed answer, not a teaser. Before writing or editing a docs page,
verify the behavior against the actual code (`worker/router.js` for routing,
`_lib/storage.js` for file types, `functions/api/site/*` for dashboard
behavior) rather than restating what an earlier doc page already claims,
claims drift, the code doesn't.

---

## Email Infrastructure

### The mailer Worker (`mailer/`)

`myjay-mailer` is the only thing in the whole platform that talks to Resend.
Pages Functions reach it through a service binding (`env.MAILER`, wired in
`wrangler.toml`'s `[[services]]` block), never the Resend REST API directly.
It has **no public route** (`workers_dev = false`, no custom domain), the
service binding is the only way in. Deploy it with `npm run mailer:deploy`
after copying `mailer/wrangler.toml.example` to `mailer/wrangler.toml` and
filling in your account ID; set the secret with
`echo "<key>" | npx wrangler secret put RESEND_API_KEY --config mailer/wrangler.toml`.

It accepts `POST { to, type, subject, bodyHtml, userId? }`, and for every
request: checks `bounce_suppression` (skips regardless of type, there's no
inbox to deliver to), checks `notification_prefs` for non-transactional
types (`admin_message`, `broadcast`, `blog_notification`, gated; `verify`,
`reset`, `security_alert` always send), calls Resend, and logs the result to
`email_log` including the rendered `body_html` (needed so a failed send can
actually be retried later, not just re-described).

Use `sendEmail(env, {...})` from `functions/_lib/mailer.js` everywhere
instead of touching `env.MAILER` directly, it's a two-line wrapper but keeps
the call site consistent.

### Templates (`functions/_lib/email-templates.js`)

Table-based HTML, inline styles only, 600px max width, Gmail-safe (no
external stylesheet, no web fonts, monospace falls back to `'Courier New',
Courier, monospace`). `baseLayout()` renders the shared shell: a dark ink
header bar with a terracotta accent strip beneath it, a white content area,
and a signed-off footer. Six template functions sit on top of it:
`verifyEmail`, `passwordReset`, `securityAlert`, `adminMessage`,
`broadcastAnnouncement`, `blogNotification`. Each returns `{ subject, html }`.

The header is the platform wordmark rendered as real HTML text ("MyJay" in
cream, ".net" in orange, same colors as the actual logo), not an `<img>`.
An earlier version pulled the logo from a remote URL, but most clients block
remote images by default, so an unopened email looked completely blank at
the top, no brand at all. Text always renders. The header background is
`INK` (`#1a1716`), the same dark color the real site's torn-paper header
uses, not terracotta, an earlier pass put the wordmark on a terracotta
background and the orange ".net" was nearly invisible against it, same
color on same color. The real site never makes that mistake either, the
logo only ever sits on ink or paper backgrounds, never on its own accent
color. Don't reintroduce a terracotta (or orange) header background.

The footer sign-off is just the name in italic serif on its own line, no
leading dash or punctuation, plus an optional tagline line beneath it, both
pulled from `getEmailSignature(env)` (`functions/_lib/settings.js`), which
reads the `email_signature_name` / `email_signature_tagline` keys out of the
existing generic `settings` key/value table (the same table maintenance mode
and the announcement banner live in, see `schema/d1-init.sql`). **No em
dashes anywhere in these templates**, same rule as the rest of the site's
user-facing copy (see Tone, above), an earlier pass put one before the
sign-off name and it had to come back out. **Every** template function
takes the signature as its last argument and threads it into `baseLayout()`,
so every outgoing email (system or admin-composed) carries the current
sign-off, there's no separate "branded" vs "unbranded" template path. Every
call site (`register.js`, `reset.js`, `request-reset.js`,
`resend-verification.js`, and the three admin routes below) fetches the
signature with one `getEmailSignature(env)` call before rendering.
`broadcast.js` fetches it once before its send loop, not per recipient.

The admin Email tab's **Email signature** card (`public/admin.html`) is the
only place this gets edited: `GET`/`PATCH /api/admin/email/signature`
(`functions/api/admin/email/signature.js`) read and write those two settings
keys directly, no separate table, no extra migration. The card has its own
small live preview that re-renders (debounced, through the preview endpoint
below) as you type, before you've even saved.

The footer's link row is `myjay.net &middot; Contact` (and `&middot;
Unsubscribe` when applicable), not a legal link. There's still no
`/impressum` page and no real legal entity details to put one together,
that hasn't changed, the footer just doesn't pretend to have one anymore,
it points at things that actually exist: the homepage and `/contact`. If a
real Impressum or terms page ever needs a link from these emails, add it
back deliberately rather than restoring the old one on autopilot.

**`adminMessage()` and `broadcastAnnouncement()` render their `body` as
Markdown, through `remarker`** (`functions/_lib/vendor/remarker.js`), a
from-scratch parser, not a third-party package. This replaced an earlier
setup built on `marked` (vendored the same way, for the same no-build-step
reason described below); the swap was a deliberate choice to use an
in-house parser instead, not something marked did wrong.

`remarker.js` is a **UMD/CommonJS-style module**, not a real ES module the
way the old vendored `marked.esm.js` build was (that one had genuine
`export { ... }` statements). It has to be imported as a **default**
import, not a named one: `import remarker from './vendor/remarker.js'`.
`import { remarker } from ...` resolves to `undefined` and fails at
runtime, the module's own CJS-interop default export *is* the callable
`remarker` function, with `.parse`/`.parseInline`/etc. as properties on
it, there's nothing named `remarker` to destructure off of it. Confirmed
against the actual esbuild-based Pages Functions bundler, not just plain
Node, before relying on it.

It's vendored as a plain relative-path file for the same reason `marked`
was: this project has no custom Build command configured (see Cloudflare
Setup, above, "leave blank, no build step needed for Phase 1"), and in
that configuration Pages does not reliably run `npm install` before
bundling `functions/` with esbuild, so anything needing real
`node_modules` resolution has to be vendored instead. Unlike `marked`,
there's no upstream npm package to regenerate this file from, it's
hand-written, so there's no matching `devDependency` either.

`renderMarkdown()` calls `remarker.parse(source, { gfm: true, breaks:
true })` fresh each time rather than keeping one configured instance
around (remarker's API is stateless per call, there's nothing like
`marked`'s `new Marked({...})` to instantiate once). `breaks: true` is
what makes a plain message typed without blank lines between paragraphs
still look right (single line breaks become `<br>`), matching how the old
plain-text-only composer behaved; this took a small fix to
`vendor/remarker.js` itself (`renderInlineMultiline()`) since the option
was accepted but silently never wired up to anything, confirmed by testing
before and after, not just reading the source, the bug was non-obvious
(it's invisible-character sentinel logic, easy to misread by eye).

**There's no "button" link convention anymore.** `marked`'s setup had a
custom `link` renderer override that special-cased a markdown link titled
literally `"button"` into the terracotta CTA button. `remarker` has no
renderer-override hook to hang an equivalent on (by design, it's a much
simpler/smaller parser), so this was deliberately *not* rebuilt. A button
in an admin-composed message is just the button's actual HTML pasted
directly into the body instead, which already worked and still does (see
below), the Compose UI hint text under each Message textarea now shows
that literal snippet (URL/LABEL placeholders) instead of describing a
shorthand. The seven canned templates that used to rely on `[label](url
"button")` (`welcome`, `reinstated`, `feature_update`, `invite`,
`reengagement`, `getting_started`, `storage_warning`, `storage_reached`)
now embed that HTML directly in their seed `body` text in
`migrate-005-email-templates.sql`. Existing databases that already had
these rows seeded from before don't get touched by re-running that file
(`INSERT OR IGNORE`), so `migrate-007-button-html-templates.sql` carries
matching `UPDATE` statements for the same seven rows; both files were
generated from the same source text so they can't drift from each other.
Every other markdown construct (bold, italic, lists, headings,
blockquotes, code, plain links) is left to remarker's default output and
inherits font/color from the wrapping `<td>` in `baseLayout()`; plain
markdown links no longer get the terracotta color override `marked`'s
`link` renderer used to apply (same missing-hook reason), they render in
whatever color the recipient's email client defaults `<a>` to.

**Raw HTML in the body passes through untouched, on purpose.** `remarker`
doesn't sanitize by default, and nothing here adds sanitization on top.
Only admins reach this composer, and they already hold equivalent or
greater trust elsewhere in this same panel (ban/delete users, delete sites,
read the full send log including rendered bodies). Letting an admin paste
their own `<table>`-based button or arbitrary markup isn't a new privilege
boundary, it's the same trust level as everything else they can already do.
Don't add HTML sanitization here "for safety", it would just break the
"add buttons into emails" use case this was built for without protecting
against anything that isn't already covered by admin trust.

The Compose UI surfaces the button snippet as a one-line hint under each
Message textarea (`public/admin.html`, both the one-off Send form and the
Broadcast form), it isn't discoverable otherwise. Keep that hint's snippet
byte-for-byte consistent with `button()`'s actual output if either one
changes, an admin copying a stale snippet would get a button that's
subtly off from the rest of the system's emails.

A few adaptations from how this might first get described:

- `vendor/marked.js` is gone. The markdown parser used to be `marked`,
  vendored verbatim; it's been replaced by the hand-written `remarker.js`
  described above, and the `marked` devDependency (and its
  `package-lock.json` entry) went with it, there's nothing left to
  regenerate it from.
- The asset-path comment for the old logo image is gone along with the
  image itself, the wordmark is plain inline-styled HTML now, nothing to
  host.
- `blogNotification` exists as a template only, nothing calls it. There's no
  blog feature in this build (see Project Overview), it's defined because it
  was asked for by name, not because something triggers it yet.

### Live preview (`POST /api/admin/email/preview`)

Renders through `adminMessage()` / `broadcastAnnouncement()`, the exact same
functions a real send uses, so the preview can never drift from what
actually goes out, there's no separate "preview renderer" to keep in sync.
Takes `{ subject, body, broadcast?, signatureName?, signatureTagline? }` and
returns `{ subject, html }`. The two `signature*` fields are optional
overrides: the signature editor passes the currently-typed (possibly
unsaved) name/tagline so its preview reflects what you're about to save; the
compose forms below omit them and get whatever's currently saved, which is
what a real send right now would actually use.

The admin panel's one-off **Send** and **Broadcast** cards
(`public/admin.html`) each have a live preview pane next to the form, an
`<iframe sandbox="">` whose `srcdoc` is refreshed (debounced ~350ms) against
this endpoint as you type the subject/body. `sandbox=""` with no flags
blocks scripts entirely; the content is just tables and inline styles, it
never needs script execution, isolating it from the parent page costs
nothing and is good practice regardless.

### Auth integration

**Signup**: new accounts are created with `email_verified = 0` (column on
`users`, added by `schema/migrate-004-email.sql`, which also backfills every
*pre-existing* account to `1` in the same migration, nobody who could already
log in gets locked out by this shipping). A `verify:{token}` key (the token
is `crypto.randomUUID()`) goes into the `SESSIONS` KV namespace with a 24h
TTL, alongside the existing `session:{token}` keys, different prefix, same
namespace, no collision. `register.js` does **not** create a session for a
freshly-registered, unverified account, the frontend shows a "check your
email" message instead of redirecting to the dashboard. The one exception:
a signup using `ADMIN_EMAIL` is auto-verified and auto-logged-in, exactly
like its existing bypass of the "registration closed" check, two days of
new-platform bootstrapping shouldn't depend on the mailer working.

**Login** (`login.js`) rejects with `{ error, unverified: true }` (HTTP 403)
if `email_verified` is `0`. The frontend uses that flag to show a "Resend
verification email" button rather than a second generic error.

**`GET /auth/verify?token=X`** (`functions/auth/verify.js`, *not* under
`/api/`) looks up `verify:{token}` in KV, flips `email_verified` to `1`,
deletes the KV entry, and returns a styled result page directly, no JSON
round-trip. Same shape for **`GET /auth/reset?token=X`**
(`functions/auth/reset.js`), except it renders a new-password form instead
of a one-shot action, the form POSTs to `POST /api/auth/reset` with
`{ token, password }`. `POST /api/auth/request-reset` (`{ email }`) is what
sends the reset email in the first place, both endpoints return the exact
same response whether or not the email has an account, that's deliberate,
this is the one auth surface that must never confirm or deny an email's
existence. Reset tokens live under `reset:{token}` in KV, 1h TTL. A
successful reset fires a `security_alert` email (always sends, transactional)
with the requesting IP and a rough location from `request.cf`.

### Automated lifecycle emails

Four more `email_log` types beyond `verify`/`reset`/`security_alert`, all
fired by the platform itself off a real event, no admin composes or
triggers any of these. All four are transactional (`TRANSACTIONAL_TYPES`
in `mailer/mailer.js`, same set `verify`/`reset`/`security_alert` already
sit in), they're either a one-time response to something the account
holder just did, or an operational heads-up they can't usefully opt out
of, neither is the kind of recurring "category" `notification_prefs`
exists to gate (that's `broadcast`/`blog_notification` only, see
"Notification preferences" below).

- **`welcome`** (`welcomeEmail()` in `email-templates.js`): sent once,
  from `functions/auth/verify.js` right after a token successfully flips
  `email_verified` to `1`. Fired off verification rather than signup on
  purpose, signup is the one moment we don't yet know the address is real.
  Admin bootstrap signups (`ADMIN_EMAIL`) skip `/auth/verify` entirely
  (see Auth integration, above) so they never get one, consistent with
  every other bypass that account already has.
- **`storage_warning`** / **`storage_reached`** (`storageWarning()` /
  `storageLimitReached()`): sent from `functions/api/site/upload.js`,
  comparing storage-used-before-this-upload against
  storage-used-after against two fixed thresholds (`WARN_THRESHOLD = 0.8`,
  `REACHED_THRESHOLD = 0.95` of `MAX_UPLOAD_BYTES`). Each only fires the
  *first* upload that crosses its threshold, not every subsequent upload
  made while already over it, otherwise sitting above 80% would email the
  user on every single small file they add. If one upload crosses both
  thresholds at once, only `storage_reached` sends, it's the more urgent
  of the two and sending both for the same upload would be noise. Crossing
  back down (deleting files) and back up again re-fires, that's intentional.
  These are separate from the similarly-named `storage_warning` /
  `storage_reached` rows in the canned `email_templates` table, those are
  admin-composed starting text for a *manual* one-off `admin_message`,
  this is the fully automatic path, different `type` tag, different code
  path, no relationship between the two beyond covering the same scenario.
- **`site_published`** (`sitePublished()`): sent from
  `functions/api/site/publish.js`, only on the `published` 0 → 1
  transition (the route reads the row's current `published` value before
  writing the new one specifically to detect this), not on every toggle,
  so flipping it on and off while testing doesn't spam the inbox.

All four route through the existing `sendEmail()` / mailer / `email_log`
pipeline exactly like every other type, so they're logged, searchable,
and resendable from the admin Log tab for free, no special-casing needed
there. The Email tab's **Templates** sub-tab has a **System emails** card
listing all the automated types (the three above plus `verify`/`reset`/
`security_alert`) with a **Preview** button per row, calling
`POST /api/admin/email/preview-system` (`{ type }` →`{ subject, html }`),
which renders that exact template function with sample data the same way
`/api/admin/email/preview` does for admin-composed mail. This is
read-only, code is the source of truth here, not a database row, so
there's nothing to edit or save, the point is just letting an admin see
what a given trigger actually sends without waiting for a real signup,
upload, or publish to set one off.

### Unsubscribe (`functions/_lib/unsubscribe.js`, `functions/unsubscribe.js`)

Tokens are `base64url(userId:type).base64url(HMAC-SHA256(SESSION_SECRET, userId:type))`.
Verifying a token returns the **trusted** `{ userId, type }` decoded from the
token itself, never trust the `&type=` query string for the actual write,
that's display-only, otherwise editing the URL could unsubscribe someone
from a different category than the one their signed link was for.
`GET /unsubscribe?token=X&type=Y` writes `notification_prefs(user_id, type,
unsubscribed=1)`. The mailer checks this table before every non-transactional
send, see above, there's no separate enforcement point to keep in sync.

The confirmation page that renders after that write includes a "Didn't mean
to? Resubscribe" button, `GET /unsubscribe?token=X&action=resub`, same
handler, same token, just flips the write to `unsubscribed=0` instead. The
token has no expiry and isn't single-use, it's a stable HMAC over
`userId:type`, so this works whenever someone notices the misclick, not just
in the same session. Don't add a separate "are you sure" step here, the
whole point is that undoing a misclick should be as cheap as the misclick
itself.

### Notification preferences (logged-in path)

The email footer's unsubscribe link is one way into `notification_prefs`,
the dashboard's **Email preferences** card (`public/dashboard.html`,
Settings tab) is the other, both write the exact same table, there's no
separate "preferences" store. `GET`/`PATCH /api/user/notification-prefs`
(`functions/api/user/notification-prefs.js`) is a thin, session-gated
read/write over two specific `type` rows: `broadcast` ("Platform
announcements" in the UI) and `blog_notification` ("Blog post
notifications"). The API uses camelCase (`{ broadcast, blogNotification }`,
`true` meaning subscribed) and maps to the snake_case `type` values
internally, same `TYPE_MAP` pattern as `getEmailSignature()`. There's no
toggle for `admin_message`, it can't be gated at all anymore, see below,
and there never was one for `verify`/`reset`/`security_alert`, those are
transactional and always send. `blog_notification` is exposed here even
though nothing sends that type yet (see Templates, above, on
`blogNotification` existing as a template with no caller), so the
preference already works correctly the moment a blog feature starts
sending it, instead of needing a UI change at the same time.

**One-off sends always bypass `notification_prefs` entirely, broadcasts
respect it by default with an explicit opt-out per send.** This is
deliberate, not an oversight: a one-off is addressed to one specific
person on purpose (see `send.js`, `bypassPrefs: true`, hardcoded, no
admin-facing toggle, it's not a choice to make per-send), it was never a
"category" of mail someone could have muted in the first place. A
broadcast is the actual bulk category `notification_prefs` exists to let
people opt out of, so it respects preferences unless the admin explicitly
checks "Bypass recipient email preferences for this send" in the
Broadcast form, which sends `bypassPrefs: true` in the request body
(`broadcast.js` reads `body.bypassPrefs`, off/`false` unless set). Either
way, `bypassPrefs` only skips the `notification_prefs` check inside
`mailer/mailer.js`, it never skips `bounce_suppression`, a hard-bounced
address still can't be delivered to regardless of anyone's preference.
The wrapper (`functions/_lib/mailer.js`) just passes the flag through to
the Worker unchanged, the actual gating logic lives entirely in
`mailer.js` (`if (!transactional && !bypassPrefs && (await
isUnsubscribed(...)))`).

### Admin routes (`functions/api/admin/email/*`)

All under the existing `/api/admin/*` prefix, so the existing
`role === 'admin'` middleware check covers them for free, no extra
auth code needed in any of these files.

- `POST /api/admin/email/send`: one-off, by `userId` or raw `email`. There's
  no separate "send a test email" endpoint, sending a one-off to yourself
  (or any address) already covers that, a dedicated test-send feature
  existed briefly and was removed as redundant, don't re-add it.
- `POST /api/admin/email/broadcast`: by `segment`, one of `all`,
  `active_7d`, `inactive_30d`, `inactive_90d`, `new_7d`, `published`,
  `unpublished`, `near_storage_limit`, `no_uploads`, `verified`,
  `unverified`, `admins`, or `custom` with a `filter` object
  (`{ role?, emailVerified? }`). The dropdown groups these into Activity /
  Site status / Storage / Account in `public/admin.html`, but the backend
  doesn't care about the grouping, it's purely a `SEGMENT_QUERIES` lookup in
  `broadcast.js`, see that file for the exact SQL behind each one (e.g.
  `near_storage_limit` is 80%+ of the 50MB quota, `no_uploads` is exactly
  zero bytes stored). Accepts an optional `bypassPrefs: boolean`, see
  "Notification preferences" below. **There is no raw-SQL filter option**
  and there shouldn't be, an admin panel that runs arbitrary SQL from a
  request body is a SQL injection / data-exfiltration hole waiting to
  happen even when only admins can reach it (mistakes and pasted text
  happen). If a new filter dimension is needed, add a new allowlisted field
  to `resolveCustomSegment()` in `broadcast.js`, not a free-text SQL
  clause. A new *named* segment (the common case, vs. `custom`) just needs
  a new `SEGMENT_QUERIES` entry and a matching `<option>` in both the
  Broadcast select and `SEGMENT_LABELS` in `admin.html`, nothing enforces
  the three stay in sync, a mismatch just silently shows the raw key
  instead of a friendly label in the confirm dialog.
  `paid`/`free`/`blog_subscribers` from an earlier description of this
  feature don't correspond to anything real, there's no billing and no blog,
  they were replaced with the segments above.
- `POST /api/admin/email/preview`: renders a draft through the real
  templates without sending, see "Live preview" above
- `GET`/`PATCH /api/admin/email/signature`: reads/writes the sign-off name
  and tagline, see "Templates" above
- `GET`/`POST /api/admin/email/templates`, `PATCH`/`DELETE
  /api/admin/email/templates/:id`: CRUD over the `email_templates` table,
  see "Templates and placeholders for admin-composed mail" above
- `GET /api/admin/email/logs`: paginated, filters: `type`, `status`, `since`,
  and `q` (matches `recipient` or `subject`, case-insensitive `LIKE`)
- `DELETE /api/admin/email/logs`: clears the **entire** log, no filters, no
  partial delete, it's the "start fresh" button, not a filtered bulk delete.
  If filtered bulk delete is ever wanted, add it as its own thing rather than
  overloading this one.
- `GET /api/admin/email/logs/:id`: one full row including `body_html`, used
  by the dashboard's Preview action, deliberately left out of the list
  endpoint above since it can be large and isn't needed for the table view
- `DELETE /api/admin/email/logs/:id`: deletes one row
- `GET /api/admin/email/stats`: sent today, total sent, total failed,
  delivery rate, open rate, suppressed-bounce count, unsubscribe count,
  `last30Days` (daily sent/failed counts, for the chart), and `topErrors`
  (the 5 most common `error` values among failed sends, top one is what the
  health banner quotes)
- `GET /api/admin/email/bounces` / `DELETE /api/admin/email/bounces/:email`
- `POST /api/admin/email/resend/:logId`: re-sends using the stored
  `body_html` from the original log row

The admin dashboard's **Email** tab (`public/admin.html`) covers all of
this, split into its own four-way sub-nav (`Overview` / `Compose` /
`Templates` / `Log`, the `.subtabs` / `.subtab-panel` classes, scoped JS in
`setupEmailSubTabs()`) because before the split this was one single long
scroll through every card at once. **`.subtabs`/`.subtab-panel` are
deliberately separate classes from the page-level `.tabs`/`.tab-panel`**:
`setupTabs()` queries `.tabs button` / `.tab-panel` globally with no
scoping, so reusing those classes for a nested tab bar would make clicking
a sub-tab also toggle every other top-level admin panel. If another tab
ever needs this same kind of internal split, reuse
`.subtabs`/`.subtab-panel` and write a scoped handler the way
`setupEmailSubTabs()` does, querying within `#email-panel`, not the shared
one.

- **Overview**: the health banner (only shows up when something looks
  wrong, nothing has ever sent, or most recent sends are failing), stat
  cards (now including total failed), the 30-day chart, and the
  top-failure-reasons table.
- **Compose**: the signature editor, then the one-off **Send** and
  **Broadcast** cards (each full width, form on the left, a live preview
  iframe on the right). Both have a **Template** dropdown, see "Templates
  and placeholders for admin-composed mail" below.
- **Templates**: add/edit/delete the canned starting text the Template
  dropdowns above pull from. A table (Label, Category, Subject, Actions)
  plus an "Add template" button that opens the same modal as Edit, just
  with empty fields.
- **Log**: the searchable/filterable send log with Preview, Resend, and
  Delete actions per row plus a "Clear log" button above the table, and the
  bounce suppression list.

### Templates and placeholders for admin-composed mail

Two separate things share the word "template" here, don't conflate them:
the six system **template functions** in `email-templates.js`
(`verifyEmail`, `adminMessage`, etc., the HTML layout), and the
**admin-editable canned starting text** stored in the `email_templates` D1
table (`schema/migrate-005-email-templates.sql`) and managed from the
Email tab's **Templates** sub-tab. This used to be a hardcoded
`ONE_OFF_TEMPLATES` object in `public/admin.html`; it's real, editable data
now, specifically so adding/changing one doesn't require a code change or
a deploy. `id` is a UUID for anything created through the UI (the original
23 keep their old string ids, e.g. `welcome`, `termination`, for
continuity with the pre-migration version, that's cosmetic, nothing reads
meaning into the id format). `category` is free text, not an enum, the
dropdown groups by whatever distinct category strings actually exist in
the table, typing a new one creates a new group with no code change.

`GET /api/admin/email/templates` (`functions/api/admin/email/templates.js`)
returns all of them; `POST` adds one; `PATCH`/`DELETE
/api/admin/email/templates/:id` (`functions/api/admin/email/templates/
[id].js`) edit or remove one. The Send and Broadcast `<select>`s are both
populated client-side from this same list (`emailTemplates`, fetched once
in `init()` via `loadEmailTemplates()`, re-fetched after any add/edit/
delete) rather than one cloning the other's markup, so there's exactly one
place template data lives, in the database, not two DOM trees that have to
agree. Picking one is still purely a client-side prefill, it just sets the
Subject/Message fields so the admin can edit before sending, there's no
"currently selected template" concept server-side and editing or deleting
a template never touches messages that were already sent (the rendered
`body_html` is what's stored in `email_log`, not a reference back to the
template it started from). Bracketed text like `[describe the issue
here]` is a spot for the admin to fill in by hand, it's not a placeholder
and nothing substitutes it, unlike `%username`/`%sitetitle` etc. below. If
the Subject/Message fields already have content, picking a template asks
for confirmation before overwriting it (`setupTemplatePicker()`,
parameterized by which form's fields/preview it's wired to).

`%placeholder` substitution (`functions/_lib/placeholders.js`,
`applyPlaceholders(text, recipient)`) is the separate, actually-dynamic
piece: `%username`, `%email`, `%sitetitle`, `%role` in either the Subject
or Message of a one-off send or broadcast get replaced with that specific
recipient's values at send time, case-insensitively, word-boundary matched
(so `%USERNAME` works, but `50% off` is untouched, "off" isn't a known
placeholder name). `%username` falls back to the literal string `"User"`
when the recipient has no account (a one-off sent to a raw email with no
matching user row) or no username; `%sitetitle` falls back to `"your
site"`; `%role` falls back to `"user"`; `%email` is always the address
being sent to, no fallback needed. Substitution runs on the raw markdown
*before* it reaches `remarker`, so a substituted value is just plain text and
gets escaped the same as anything else the admin typed, there's no separate
escaping step to keep in sync.

Both `send.js` and `broadcast.js` now select `username, role, site_title`
alongside `id, email` wherever they look up a recipient, specifically so
these placeholders have something to substitute; if a new placeholder ever
needs a column that isn't already selected, add it to the `PLACEHOLDERS`
map in `placeholders.js` *and* to every `SELECT` that builds a recipient
object in both files, otherwise it'll silently render as empty/fallback for
real sends even though it looked fine when you tested it with the one
field you remembered to add.

**`send.js`'s "by email" path looks the address up against `users` too,
it doesn't just stuff the raw email into the recipient object.** The first
version didn't, so sending a one-off to someone's email address (instead
of their User ID) always rendered `%username` as the fallback "User" even
when that exact address belonged to a real, registered account, the lookup
was just never attempted. "By email" means "I don't have/want the User
ID," not "this address has no account," and the two need to be handled the
same once a match is found. If a future change adds another "by X" way to
address a one-off send, make sure it resolves a real user row the same way
rather than assuming an unmatched-account shape.

`preview.js` has no real recipient to substitute with (it's a generic
preview, not addressed to anyone yet), so it runs the same substitution
against `SAMPLE_RECIPIENT` (`sampleuser`, `sample@example.com`, "Sample
Site", `user`) instead of the real fallbacks. Showing the real fallback
values (`"User"`, empty string for email) in a preview would look like the
feature was broken, the sample values make it obvious something was
actually substituted.

It follows the same patterns as every other admin tab (`showConfirm`/`showAlert`
from `main.js`, no native dialogs, table + badge + card layout).

### Diagnosing a non-sending setup

`email_log` staying completely empty (not even `failed` rows) means requests
aren't reaching the mailer Worker at all, most likely the `MAILER` service
binding was never actually added on the Pages project (it has to be done in
the dashboard, see "Manual steps" below, `sendEmail()` in `_lib/mailer.js`
fails soft and returns `{ ok: false, error: 'MAILER binding not configured' }`
without the mailer ever seeing the request, so nothing gets logged). If
`email_log` has `failed` rows with a populated `error` column, the binding is
fine and Resend itself rejected the send, the most common reason being the
sending domain (`myjay.net`, for the `noreply@myjay.net` From address in
`mailer/mailer.js`) isn't verified yet in the Resend dashboard. Check this
directly by sending yourself a one-off message from the Compose tab (leave
User ID blank, put your own address in Email): it goes through the exact
same path a real signup or broadcast would, and its log entry's `error`
column will say so explicitly either way. (An earlier build had a separate
"send a test email" feature for this specifically; it was removed since a
one-off send to your own address does the same thing with no extra code to
maintain.)

### Webhook (`functions/api/webhooks/resend.js`)

`POST /api/webhooks/resend`, public (signature-verified, not session-gated,
it's in `_middleware.js`'s `PUBLIC_API_PATHS`). Verifies the `svix-id` /
`svix-timestamp` / `svix-signature` headers the way Svix signs all Resend
webhooks: base64 HMAC-SHA256 over `"{svix-id}.{svix-timestamp}.{raw body}"`,
keyed by `RESEND_WEBHOOK_SECRET` (a *different* secret than
`RESEND_API_KEY`, generated by Resend when you create the webhook endpoint
in its dashboard, not something this codebase can generate for you). Handles
`email.delivered`, `email.opened`, `email.bounced`, matching back to
`email_log` rows via `resend_id` (the id Resend's API returns when a message
is first sent). A bounce both updates the log row and inserts into
`bounce_suppression`, so the address is skipped on every future send from
that point on, not just logged.

**Manual steps that can't be done from this codebase**: add the `MAILER`
service binding to the live Pages project (Settings → Bindings → Add →
Service binding → variable `MAILER` → service `myjay-mailer`, this Pages
project deploys via git push, not local `wrangler.toml`, so the binding has
to be added in the dashboard directly); create the webhook endpoint in the
Resend dashboard pointing at `https://myjay.net/api/webhooks/resend` and set
its signing secret as `RESEND_WEBHOOK_SECRET` on the Pages project.

---

## Indie Web Search Engine

MyJay Search (`public/search.html`, `/search`) indexes public pages from
MyJay, Neocities, and Nekoweb. It replaced the original Phase 1 "Explore"
page entirely, `public/explore.html` and `functions/api/explore/` are gone,
and the header nav's "Explore" link is "Search" everywhere now. Two
foundational decisions shape everything below, both made deliberately
rather than following the most obvious approach:

- **No FTS5.** D1's SQLite FTS5 (virtual table) support is unreliable right
  now: there's an open, severe bug where exporting a D1 database containing
  FTS5 virtual tables can make the *entire database* permanently
  inaccessible. The index is a hand-rolled inverted index over plain tables
  instead (`search_terms`), same spirit as this repo's existing hand-rolled
  `zip.js`/`remarker.js`: more code, zero platform risk.
- **Neocities is never crawled via its API.** `/api/list` only lists files
  within a site you already hold credentials for, and Neocities' own API
  docs explicitly say "do not use the API to data mine / rip all of the
  sites" (sites doing this get de-listed). Discovery instead scrapes
  Neocities' own public `/browse` listing (`sort_by=newest`/`last_updated`),
  which is allowed by their `robots.txt` and listed in their own
  `sitemap.xml`, the same surface any search engine would use. See
  `crawler/sources/neocities.js`.

### Architecture

```
functions/api/search/*          Pages Functions, public search API, reads D1 directly
functions/api/admin/search/*    Pages Functions, admin controls (existing
                                 role === 'admin' middleware check covers these for free)
functions/_lib/search-tokenize.js   shared pure tokenizer/scorer/excerpt-highlighter
functions/_lib/search-query.js      D1 query helpers used by functions/api/search/*
functions/_lib/crawler-client.js    thin wrapper around the CRAWLER service binding,
                                     mirrors functions/_lib/mailer.js's MAILER pattern

crawler/                        standalone Worker, sibling to worker/ and mailer/
  crawler.js                    queue() consumer, scheduled() cron handler, and a
                                 fetch() RPC surface reached only via the CRAWLER
                                 service binding (no public route, same isolation
                                 as mailer/mailer.js)
  robots.js                     robots.txt fetch+parse+cache, per-domain rate
                                 limiting, the crawlerFetch() wrapper every
                                 outbound request goes through
  extract.js                    hand-rolled HTML extraction (no DOM exists in the
                                 Workers runtime, no npm install at deploy time
                                 either, see Email Infrastructure on why things
                                 get hand-rolled here) + tag-inference heuristics
  sources/myjay.js               seeds from MyJay's own D1 `sites` table directly
  sources/neocities.js           seeds via neocities.org/browse (see above)
  sources/nekoweb.js              no bulk listing exists; returns no seeds at all,
                                  see below
```

**Pages Functions can be a Queue producer but never a consumer, and can't
have Cron Triggers at all**, confirmed against current Cloudflare docs
before building this, not assumed. That's why crawling needs its own
Worker rather than living in `functions/`. One Queue
(`myjay-crawl-queue`): producer and consumer both live in the crawler
Worker (it enqueues its own link-discovery jobs and processes them); the
Pages project never touches the queue directly, admin-triggered actions go
through the `CRAWLER` service binding instead (`functions/_lib/crawler-client.js`),
which calls into the crawler's own `runCrawl()`/`runSiteCrawl()`/`runUrlCrawl()`
functions, the same ones its `scheduled()` handler uses. One KV namespace
(`myjay-search-cache`, binding `SEARCH_CACHE`): robots.txt cache, per-domain
rate-limit timestamps, and consecutive-failure streaks live there for the
crawler; autocomplete/hot-query caching lives there for the search API.

### D1 schema (`schema/migrate-008-search-engine.sql`)

- `search_sites`: one row per indexed domain (platform, domain, root_url,
  status `active`/`blocked`/`error`, last_crawled_at). Exists even before a
  single page is crawled, e.g. a pending submission.
- `search_pages`: one row per crawled page (title, h1, description,
  body_text capped at 8000 chars, depth, http_status, crawled_at).
- `search_page_tags`: (page_id, tag), the inferred content-type tags.
- `search_links`: (from_page_id, to_url), outbound links, for the "future
  graph features" the spec asked for; not used for ranking yet.
- `search_terms`: (term, page_id, field, weight), the inverted index. One
  row per term per field (`title`/`description`/`body`) per page; `weight`
  is the in-field term frequency, clamped at index time so keyword-stuffing
  one field can't dominate ranking.
- `crawl_log`, `blocklist`, `removal_requests`, `submissions`,
  `search_queries_log`: exactly what their names say, see the admin tab
  below for how each is used.
- `sites.search_opt_out` (added by this migration): per-MyJay-site
  opt-out, default 0 (indexed). Toggled from the dashboard's Settings tab
  (`POST /api/site/search-indexing`), surfaced in `GET /api/user/me` as
  `searchIndexed`.
- Crawl pause flags per platform and the Neocities `/browse` pagination
  cursor live as ordinary rows in the existing generic `settings` table
  (see `functions/_lib/settings.js`'s `DEFAULTS`), not a new table.

### Ranking, without FTS5

A query is tokenized with the exact same tokenizer used at index time
(`tokenize()` in `functions/_lib/search-tokenize.js`, imported by both the
search API and the crawler via a relative path that crosses the Pages
Functions / Worker project boundary on purpose: it's a pure function with
no I/O, and it has to stay byte-identical on both sides or indexed terms
and query terms silently stop matching, a correctness requirement that
outweighs this repo's usual "keep sibling Workers self-contained" instinct,
which exists to avoid *runtime* coupling, not build-time imports of a pure
function). Both `tokenize()` and the query-parsing path below run text
through `normalizeQuotes()` first: crawled pages overwhelmingly use
typographic quotes (U+2018/2019/201C/201D), a query typed on a normal
keyboard uses straight ones, and without normalizing both to the same
character first, "don't" indexed from a page and "don't" typed in the
search box tokenize to different strings and never match. This shipped as
a fix after search was reported to "completely fail" on anything with an
apostrophe or quote in it.

`parseQuery()` (same file) splits a query into an optional quoted phrase
plus the full term list (phrase words included, so a quoted query still
benefits from the inverted-index lookup rather than needing a table scan).
`searchPages()` in `functions/_lib/search-query.js` looks up each term in
`search_terms`, joins to `search_pages`/`search_sites`, and sums
`weight * fieldScore * idf` grouped by page (titles count 5x, descriptions
3x, body 1x; `idf` is a smoothed inverse-document-frequency multiplier
computed in JS by `getTermIdf()`, since D1's SQLite build doesn't reliably
expose `log()`/`ln()` for computing it in SQL, so a rare term across the
index counts for more than a common one, the standard TF-IDF idea layered
on top of the field weighting). A detected phrase adds a large flat bonus
(`PHRASE_BONUS`) when the literal phrase appears in title/description/body,
via a `LIKE` check folded into the same aggregate query, never a hard
filter, an exact-phrase requirement risks zero results over something as
small as punctuation, so it can only push a match up, never exclude one.

**Similarity before relevance, deliberately, and this replaced an earlier
AND-then-OR-fallback design.** The original approach required every query
term to be present (an AND-match), only falling back to ranking by score
over *any* matching term if that returned zero rows. That works for two or
three keywords; it falls apart for anything sentence-length, since a real
page essentially never contains every single word of a typed sentence
verbatim, every long query landed in the fallback path, ranked purely by
`term_score`, which let one rare-word match outrank a page that actually
covered most of the sentence. `rankedSearch()` now runs a single query
(matching *any* term, same as the old fallback) but orders by
`matched_terms DESC, (term_score + phrase_bonus) DESC` — coverage first,
weighted relevance only as the tiebreaker. A page matching 4 of 5 distinct
query words always outranks a page matching 1, regardless of field weight
or rarity; relevance only decides ordering among pages tied on coverage.
This is reported back as `usedFallback` in the API response (true when
even the top result didn't cover every term), kept for the same meaning
the old two-query design used it for, even though there's only one query
now. "Did you mean" only runs on single-word, zero-result queries:
Levenshtein distance in JS against a small candidate set of indexed terms
(same first letter, similar length) pulled from D1, see
`suggestCorrection()`.

Result excerpts are built by `highlightExcerpt()`: it HTML-escapes the
surrounding text first, then wraps matched terms in `<mark>`, in that
order, never the reverse, since crawled body text is third-party content
that must never reach a search results page unescaped (see Security
Rules). The frontend (`public/search.html`) is the one place on the page
that's allowed to set `innerHTML` from a dynamic value, specifically
because it's already pre-escaped server-side; everything else on that page
is built with `createElement`/`textContent`/`setAttribute`, deliberately,
so no other field (a crawled page's URL, title, etc.) gets a chance to be
parsed as markup.

### Crawling

**Self-identification, deliberately easy to trace back.** Every outbound
request (`crawlerFetch()` in `crawler/robots.js`) sends
`User-Agent: MyJaySearch/1.0 (+https://myjay.net/docs/search-indexing)`
and a custom `X-Crawler-Info` header pointing at the same URL.
`public/docs/search-indexing.html` leads with "how to stop this crawler
visiting your site" near the top, not buried, since that's what a site
owner finding this in their logs actually wants first.

**robots.txt** (`crawler/robots.js`): fetched and parsed before any page on
a domain is touched, cached in KV 24h (`getRobotsRules()`). Honors
`Crawl-delay` if a site sets one larger than the crawler's own 1
request/second default. A 404 robots.txt means "no restrictions" (a
well-defined signal); a fetch error (timeout, 5xx, malformed response)
with no usable cached copy means the domain is skipped for this run
entirely (`{ failed: true }`), fail closed rather than guess. A page-level
`<meta name="robots">` or `X-Robots-Tag` header is honored too, even when
`robots.txt` itself allows the path: `noindex` skips storing the page;
`nofollow` additionally skips enqueueing its links.

**Rate limiting and safety caps** (`crawler/crawler.js`): a KV-stored
last-fetched-at timestamp per domain (`checkRateLimit()`/`markFetched()`);
a queue consumer that isn't yet allowed to fetch a domain re-delivers the
message with `message.retry({ delaySeconds })` instead of busy-waiting. A
circuit breaker (a KV-tracked consecutive-failure streak per domain,
`failstreak:{domain}`, written only on failure and left to expire on its
own TTL rather than explicitly cleared on success, see the incident note
below for why) marks a site `status = 'error'` and stops crawling it for
the run after 5 failures in a row, so one slow or broken site can't eat
the whole run's budget.

**Incident: the crawler degraded the entire platform, not just search,
within hours of going live.** Cloudflare emailed about exceeding the free
Workers KV (1,000 puts/day) and Queues (10,000 operations/day) limits, and
myjay.net itself got slow, because KV and D1 are shared with everything
else the platform does (sessions, login, the dashboard), not sandboxed
resources search gets to itself. Root cause: `enqueueDiscoveredLinks()`
originally issued 2-4 separate D1 round-trips *per discovered link*, up to
~200 links per page, so one single page could cost 100+ sequential D1
calls and fan out into dozens of new queue messages, each of which would
do the same thing again. The fix wasn't a tuning knob, it was rewriting
that function to use a small, fixed number of *batched* D1 queries per
page (`IN (...)` over every link at once) regardless of how many links the
page has, plus hard-capping how many new messages one page can actually
produce. `resetFailureStreak()`'s explicit KV delete-on-success was also
removed entirely (letting the key expire on its TTL instead), since it
doubled KV writes for no benefit. Four settings now bound this explicitly,
admin-editable from Search → Crawl Controls → "Resource limits" (`search_max_pages_per_day`
default 300, `search_max_pages_per_domain` default 50 [was a hardcoded
200], `search_max_depth` default 2, `search_max_links_per_page` default
15), read once per queue *batch* (`getCrawlSettings()`, up to 10 messages),
not once per message. The daily cap is enforced by acking an entire
over-budget batch immediately with zero further D1/KV/fetch work, rather
than retrying it (a retry is itself a Queue operation, retrying instead of
dropping would make the exact thing being guarded against worse). A
`MAX_NEW_SITES_PER_PAGE = 5` cap on newly-discovered cross-platform domains
per page is a hardcoded constant, not a setting, organic discovery volume
isn't something that needs day-to-day tuning the way the others are.

Two more settings, same admin card, round out "maximal admin control" over
what the crawler actually does: `search_min_crawl_delay_seconds` (default
1) is the politeness floor `processPageJob()` enforces between requests to
the same domain (a site's own `robots.txt` `Crawl-delay` still wins if it
asks for slower); `search_discovery_enabled` (default on) is a kill switch
specifically for *new* cross-platform site discovery, independent of the
daily page cap, an admin who wants to stop the index from growing while
still re-crawling and refreshing everything already indexed flips this
off rather than fighting the page caps to approximate the same effect.

The admin panel also got a one-click "Pause all crawling" (and "Resume
all") button spanning all three platforms at once, pages-crawled-today
shown live against the daily cap, and a full paginated crawl history table
(`GET /api/admin/search/crawl-log`, every run on every platform, not just
the latest-per-platform snapshot the Overview tab already had). If you
ever see Cloudflare's quota-exceeded emails again, the first move is that
pause button, not a code change, since it stops new seeding immediately;
the second move is checking whether the limits above need to come down
further, not back up.

**Discovery, per platform** (`crawler/sources/*.js`):
- **MyJay**: `sources/myjay.js` queries the platform's own `sites` table
  directly (`published = 1 AND search_opt_out = 0`), no HTTP round-trip.
  Incremental runs only re-seed sites updated in the last 2 days.
- **Neocities**: `sources/neocities.js` scrapes `neocities.org/browse`
  (see the FTS5/Neocities decisions above for why, not `/api/list`),
  extracting `https://{username}.neocities.org` links directly from the
  page. Full runs scrape `sort_by=newest` and `sort_by=last_updated` up to
  5 pages each; incremental runs scrape just `last_updated`, 2 pages.
- **Nekoweb**: `sources/nekoweb.js` returns no seeds at all, Nekoweb has no
  bulk site listing of any kind, public API or otherwise. Every Nekoweb
  site enters the index through a manual submission
  (`POST /api/search/submit`, approved from the admin panel) or by being
  linked to from a page on another already-indexed site.
- **Cross-platform organic discovery** happens uniformly in
  `crawler.js`'s `enqueueDiscoveredLinks()`: any link found on a crawled
  page pointing at an unrecognized `*.myjay.net`/`*.neocities.org`/
  `*.nekoweb.org` domain (and not blocklisted) gets a fresh `search_sites`
  row and a depth-0 crawl job, regardless of which platform discovered it.
  Links to anything outside those three suffixes are recorded in
  `search_links` (for the graph-features column) but never crawled.

**Re-crawl schedule**: two Cron Triggers in `crawler/wrangler.toml`, daily
incremental and weekly full (`scheduled()` tells them apart by comparing
`controller.cron` against the `FULL_CRAWL_CRON` var). "Pause" (admin
Crawl Controls) is a flag in `settings`, not an actual Cron Trigger
removal, Pages Functions has no clean way to manage another Worker's
triggers without the Workers API and an API token; the paused platform's
`scheduled()` invocation still fires on schedule, checks the flag, and logs
a `crawl_log` row with `status = 'skipped'` instead of seeding.

**Extraction** (`crawler/extract.js`): title/h1/meta-description/body-text
via regex (no DOM in the Workers runtime, see Email Infrastructure on why
this codebase hand-rolls things instead of vendoring or installing), with
`<script>`/`<style>`/`<nav>`/`<header>`/`<footer>` stripped before the body
text is captured. Tag inference (`inferTags()`) is simple heuristics, not a
classifier: tag counts (`<canvas>`, image density vs. word count,
`<article>` frequency, `<audio>`/`<video>`) plus a small keyword list
against the title/description.

### Search API (`functions/api/search/*`, all public, no session, listed
individually in `_middleware.js`'s `PUBLIC_API_PATHS`, same pattern as the
old `/api/explore` entry it replaced)

See the API Contract section above for the full endpoint list. Two things
worth calling out:
- `GET /api/search/recent` doubles as the "browse with no query" path:
  `public/search.html` with `?platform=myjay` and no `q` is what replaced
  `/explore`'s job, hitting this endpoint instead of `searchPages()`.
- `GET /api/stats` (platform-wide site/view counts, not a search concept
  at all) and `GET /api/search/stats` (index-specific counts) are
  deliberately separate endpoints, see "Platform stats and view counts"
  above for why conflating them would be the wrong call.

### Frontend (`public/search.html`)

One file, two states, gated on whether `q`/`platform`/`tag` are present in
the URL (`isBrowsing()`): a centered hero (search bar, tagline, quick
links, a "Surprise me" random-site button, a recently-indexed preview
strip, top tags) when browsing-empty, or a sticky-search-bar results
layout (sidebar filters on ≥900px viewports, stacked above results on
narrow ones, skeleton loaders, pagination) once a query or filter is set.
State round-trips through the URL (`readStateFromUrl()`/`writeUrl()`,
`history.pushState`), so every search is a shareable, bookmarkable link,
and back/forward works via a `popstate` listener. "Submit a site" and
"Remove this site" are `buildModal()` popups, not separate pages, per the
project's general "popup the row instead of growing the page" UI
convention. "Sites like this" expands inline on a result card
(`toggleSimilar()`), fetching `/api/search/similar` only on first expand,
cached client-side per URL for the rest of the session.

### Admin panel (`public/admin.html`, "Search" tab, after "Sites")

Six subtabs, `.subtabs`/`.subtab-panel` scoped to `#search-panel`
(`setupSearchSubTabs()`, same pattern as the Email tab's
`setupEmailSubTabs()`):
- **Overview**: stat cards, a health banner (Email tab's pattern: only
  shows when something looks wrong, nothing indexed yet, or a platform has
  sites stuck in `error` status), last-run-per-platform table, 30-day
  pages-indexed chart.
- **Crawl Controls**: per-platform pause/resume + "run incremental/full
  now" cards (all three call `functions/_lib/crawler-client.js`, which
  calls the crawler's `fetch()` RPC surface), plus a searchable, paginated
  table of every `search_sites` row with re-crawl/block/unblock actions.
- **Blocklist**: add a domain manually, view/remove existing entries.
  Blocking sets `search_sites.status = 'blocked'` (filtered out of every
  public query, see `search-query.js`'s `WHERE s.status = 'active'`
  clauses) without deleting the underlying rows, reversible via unblock.
- **Removal Requests** / **Submissions**: queue tables, click a row for the
  full detail + actions in a modal, same `openContactModal()`-style pattern
  as the Contact tab. Approving a removal request actually purges the
  domain's `search_pages`/`search_terms`/`search_page_tags`/`search_links`
  rows (not just a status flag, "remove" means remove); approving a
  submission calls the crawler's `crawl-url` action immediately.
- **Query Analytics**: top searches, zero-result queries (each with an
  "Add a site" quick action that files a submission right from that row,
  the suspected-coverage-gap use case the spec asked for), 30-day search
  volume chart. Deliberately no click-through tracking, consistent with
  the homepage's own "no trackers, no algorithms" framing.

### Transparency integration

Per your explicit ask, this was integrated into existing pages rather than
built as a pile of new ones: `public/about.html` gets a "MyJay Search"
section (what's indexed, how, no click tracking), `public/status.html`
gets a "Search index" card (live counts, last crawl per platform) next to
its existing live checks, `public/terms.html` gets a "Search Indexing"
clause, and `public/register.html` discloses indexing-by-default right
under the submit button. The two genuinely new pages are both docs
entries: `public/docs/search.html` (using the engine) and
`public/docs/search-indexing.html` (how indexing/crawling/opt-out/removal
actually works, the page the crawler's own User-Agent points to).

---

## Development Workflow

```bash
# Install Wrangler
npm install -g wrangler

# Authenticate
wrangler login

# Local dev (Pages + Functions)
npx wrangler pages dev public --compatibility-date=2024-01-01

# Deploy
git push origin main   # Cloudflare Pages picks it up automatically

# Run D1 migrations
npx wrangler d1 execute myjay-db --file=schema/d1-init.sql

# Tail production logs
npx wrangler pages deployment tail
```

---

## What to Build First (Order of Operations)

1. `schema/d1-init.sql`: get the database schema right before anything else
2. `wrangler.toml.example`: document all bindings so setup is reproducible
3. `functions/_middleware.js`: auth layer everything else depends on
4. Auth functions: register → login → logout → check-username
5. `public/assets/style.css` + `public/assets/main.js`: shared design system base
6. `public/register.html` + `public/login.html`: get a user into the system
7. `functions/api/site/*`: upload, files, publish, delete
8. `public/dashboard.html`: the core user experience
9. `worker/router.js`: serve `username.myjay.net` from R2
10. `functions/api/stats.js`
11. `public/index.html`: marketing homepage (last, since it pulls live data)
12. `public/admin.html` + admin API routes
13. `public/about.html`

(MyJay Search came well after this original Phase 1 list; its own build
order is covered in the Indie Web Search Engine section below, not folded
into this one.)

---

## Notes & Constraints

- **No npm build step for the frontend.** All HTML/CSS/JS is hand-written, self-contained, and served directly as static files. No Vite, no webpack, no React.
- **Pages Functions use ES modules syntax** (`export const onRequest`). Do not use CommonJS.
- **D1 is SQLite.** Use parameterized queries only. Never interpolate user input into SQL strings.
- **R2 has no public access by default.** All R2 reads go through the subdomain Worker, which applies the published check. Do not enable R2 public buckets.
- **KV is eventually consistent.** Sessions written to KV may take a moment to propagate globally. This is acceptable.
- **File size limits:** Cloudflare Pages Functions have a 25MB request body limit. For uploads > 25MB, you'll need a pre-signed R2 URL flow, defer this to Phase 2.
- **Do not hardcode secrets.** All secrets come from environment variables or `wrangler secret put`.
- **Subdomains are case-insensitive.** Normalize usernames to lowercase everywhere.
- **No scrolling marquee / fixed top status bar.** An earlier iteration had a `position: fixed` bar across the top of every page with a blinking cursor and a scrolling marquee (`status: nominal :: ...`). It was removed as silly and distracting. Do not re-add a global ticker/marquee/status bar of this kind.
- **`public/_headers` sets `Cache-Control: no-cache` on `/assets/*`.** Cloudflare Pages' own default for static assets is several hours (`max-age=14400`), while `dashboard.html` and every other HTML page get `max-age=0` and always revalidate. That mismatch means a CSS/JS fix can be live on the server while a browser that loaded the dashboard recently keeps rendering the new HTML against an hours-old cached stylesheet, no error, just a layout that silently looks like the fix never shipped (this is exactly what happened with the editor-panel filename fix above: the deployed CSS was correct, byte-for-byte, but a stale cached copy made it look broken again). `no-cache` still lets the browser keep a cached copy, it just forces a revalidation (a cheap ETag/304, not a full re-download) before using it, so a real change is never more than one request away instead of waiting out the max-age. Don't remove this or widen its cache lifetime without the same staleness risk in mind, this file exists specifically because that risk was observed, not preemptively.

---

*Last updated: Phase 1 scaffold. Future phases: blog engine, guestbook, microblog, indie ad network, pro plan (custom domains, higher quota).*