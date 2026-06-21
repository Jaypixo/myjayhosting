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
- "Explore" page (recently updated sites)
- Static about/info pages

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
│   ├── explore.html           ← Browse user sites
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
│   │   ├── explore/
│   │   │   └── index.js       ← GET recently updated sites
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

### Explore Page
`GET /api/explore` returns the 24 most recently updated published sites. Query:
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
meant to be public-and-same-origin-only (like `/api/explore`) belongs in
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
- Navigation: Home / Explore / About / Login (or Dashboard if logged in)
- JS checks for session cookie on page load. If present, swap Login link for Dashboard + username

### `index.html`: Marketing Homepage
Hero: large torn-paper header. Headline (Crimson Pro italic): *"Your corner of the web."* Subheadline: *"Free static hosting. No trackers. No algorithms. No VC money. Just your HTML."*

Below the header:
- Three-column feature strip (terminal card style): Upload → Publish → Done
- A live counter widget: *"X sites hosted, Y files served"*, fetch from `/api/explore` count
- A preview strip of recently updated sites (pull from `/api/explore`, show 6 cards)
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

### `explore.html`: Browse Sites
- Grid of site cards (fetch `/api/explore`)
- Each card: username, site title or "untitled", last updated, view count
- Click → opens `username.myjay.net` in new tab
- Simple text filter input (client-side filter on loaded results)

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
PKZIP records), for the same reason `marked` had to be vendored instead of
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

GET  /api/explore            → { sites: [{ username, siteTitle, updatedAt, viewCount }] }
GET  /api/sites/:username/files → { username, files: [{ key, size, modified }] }  (public, no session, open CORS)
GET  /api/health             → { checkedAt, database: {ok,ms}, storage: {ok,ms}, sessions: {ok,ms} }  (public, no session)

POST /api/contact            { category, username?, email, message } → { ok }  (public, no session)

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

`public/status.html` is powered entirely by `/api/health`, `/api/settings`, and `/api/explore`.
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
`analytics.html`, `account-and-security.html`, `troubleshooting.html`.

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
Markdown, through the real `marked` package**, not a hand-rolled regex
subset, that was tried and explicitly rejected. It's imported from
`functions/_lib/vendor/marked.js`, a **vendored, verbatim copy** of marked's
own pre-built `lib/marked.esm.js` (a self-contained bundle with zero
imports of its own), not a bare `import { Marked } from 'marked'`.

That detour exists because the bare import was tried first and broke the
Cloudflare Pages build with "Could not resolve marked": this project has no
custom Build command configured (see Cloudflare Setup, above, "leave
blank, no build step needed for Phase 1"), and in that configuration Pages
does not reliably run `npm install` before bundling `functions/` with
esbuild, so a bare npm specifier that resolves fine locally can still fail
to resolve at deploy time. Vendoring the already-self-contained ESM build
sidesteps that entirely, no `node_modules` lookup happens at deploy time at
all, it's just a relative-path import to a file already checked into the
repo. `marked` itself stays a `devDependency` (used to regenerate the
vendored file, see the header comment in `vendor/marked.js` for how), it is
not what actually ships. If a future dependency needs real `node_modules` resolution inside
`functions/`, configure an explicit Build command (e.g. `npm install`) on
the Pages project first and confirm a deploy actually picks it up, don't
assume a bare import will resolve just because it works locally.

The `Marked` instance lives in `email-templates.js` itself (not a separate
`_lib/markdown.js`) because its only renderer override, `link`, needs the
module's existing `button()` helper and color constants. `gfm`/`breaks` are
both on, so a plain message typed without blank lines between paragraphs
still looks right (single line breaks become `<br>`), matching how the old
plain-text-only composer behaved. The `link` override has one special case:
a markdown link whose title is literally `"button"` (`[label](url
"button")`) renders as the same terracotta CTA button used in the system
templates, instead of a plain inline link, this is the documented way to
get a button without writing raw HTML. Every other markdown construct
(bold, italic, lists, headings, blockquotes, code) is left to marked's
default output and inherits font/color from the wrapping `<td>` in
`baseLayout()`, the only element that needed a color override at all was
`<a>` (browsers default it to blue).

**Raw HTML in the body passes through untouched, on purpose.** `marked`
doesn't sanitize by default, and nothing here adds sanitization on top.
Only admins reach this composer, and they already hold equivalent or
greater trust elsewhere in this same panel (ban/delete users, delete sites,
read the full send log including rendered bodies). Letting an admin paste
their own `<table>`-based button or arbitrary markup isn't a new privilege
boundary, it's the same trust level as everything else they can already do.
Don't add HTML sanitization here "for safety", it would just break the
"add buttons into emails" use case this was built for without protecting
against anything that isn't already covered by admin trust.

The Compose UI surfaces this as a one-line hint under each Message
textarea, the `"button"` title convention isn't discoverable otherwise.
Keep that hint in sync (`public/admin.html`, both the one-off Send form and
the Broadcast form) if the supported syntax changes.

A few adaptations from how this might first get described:

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
*before* it reaches `marked`, so a substituted value is just plain text and
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
service binding to the live Pages project (Settings → Functions → Bindings
→ Service binding → variable `MAILER` → service `myjay-mailer`, this Pages
project deploys via git push, not local `wrangler.toml`, so the binding has
to be added in the dashboard directly); create the webhook endpoint in the
Resend dashboard pointing at `https://myjay.net/api/webhooks/resend` and set
its signing secret as `RESEND_WEBHOOK_SECRET` on the Pages project.

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
10. `public/explore.html` + `functions/api/explore/index.js`
11. `public/index.html`: marketing homepage (last, since it pulls live data)
12. `public/admin.html` + admin API routes
13. `public/about.html`

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

---

*Last updated: Phase 1 scaffold. Future phases: blog engine, guestbook, microblog, indie ad network, pro plan (custom domains, higher quota).*