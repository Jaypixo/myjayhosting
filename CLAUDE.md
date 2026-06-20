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
2. Look up user in D1: `SELECT published FROM sites WHERE username = ?`
3. If not found or `published = 0`: return a friendly "this site doesn't exist yet" page (styled in the design system)
4. Fetch from R2: `sites/noah/about.html`
5. If R2 returns null and path doesn't have extension: try `path/index.html`
6. If still null: return a 404 page styled in the design system, with the user's username visible
7. Stream the R2 response back with the correct `Content-Type`

The Worker must handle directory-style URLs: `noah.myjay.net/blog/` should try `sites/noah/blog/index.html`.

### D1 Schema
See `schema/d1-init.sql`. Tables:

```sql
users (
  id TEXT PRIMARY KEY,           -- UUID
  email TEXT UNIQUE NOT NULL,
  username TEXT UNIQUE NOT NULL, -- slug, 3-32 chars, [a-z0-9-]
  password_hash TEXT NOT NULL,   -- "salt:hash" from PBKDF2
  role TEXT DEFAULT 'user',      -- 'user' | 'admin'
  created_at TEXT NOT NULL,      -- ISO 8601
  bio TEXT,
  site_title TEXT
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

Main: Settings tab:
- Site title field
- Bio field
- Change email / password

### `explore.html`: Browse Sites
- Grid of site cards (fetch `/api/explore`)
- Each card: username, site title or "untitled", last updated, view count
- Click → opens `username.myjay.net` in new tab
- Simple text filter input (client-side filter on loaded results)

### `admin.html`: Owner Panel (role: admin only)
- Redirect to `/login.html` if not admin
- Tabs: Users / Sites / Stats
- Users tab: paginated table of all users, with ban/delete actions
- Sites tab: table of all published sites, with unpublish/delete actions
- Stats tab: total users, total sites, total storage used (aggregate from D1)

### `about.html`
Static page. Voice: dry, honest. Cover: what this is, what it isn't, the hosting limits (50MB, no server-side code, no databases for user sites), the ethos (indie web, no tracking, no ads on the platform itself). Include the roadmap for future features (blogs, guestbooks, ad network) framed as a dev log.

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

GET  /api/site/files         → { files: [{ key, size, modified }] }
POST /api/site/upload        multipart/form-data → { uploaded: [filenames] }
DELETE /api/site/delete      { key } → { ok }
POST /api/site/publish       { published: bool } → { ok }

GET  /api/explore            → { sites: [{ username, siteTitle, updatedAt, viewCount }] }
GET  /api/health             → { checkedAt, database: {ok,ms}, storage: {ok,ms}, sessions: {ok,ms} }  (public, no session)

POST /api/contact            { category, username?, email, message } → { ok }  (public, no session)

GET  /api/admin/users        → { users: [...] }
PATCH /api/admin/users/:id   { role?, banned?, password? } → { ok }
DELETE /api/admin/users/:id  → { ok }
GET  /api/admin/sites        → { sites: [...] }
DELETE /api/admin/sites/:id  → { ok }
GET  /api/admin/contact      → { messages: [{ id, category, username, email, message, status, createdAt }] }
PATCH /api/admin/contact/:id { status: 'new'|'read'|'replied' } → { ok }
DELETE /api/admin/contact/:id → { ok }
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
Courier, monospace`). `baseLayout()` renders the shared shell: a terracotta
header bar, a white content area, and a signed-off footer. Six template
functions sit on top of it: `verifyEmail`, `passwordReset`, `securityAlert`,
`adminMessage`, `broadcastAnnouncement`, `blogNotification`. Each returns
`{ subject, html }`.

The header is the platform wordmark rendered as real HTML text ("MyJay" in
cream, ".net" in orange, same colors as the actual logo), not an `<img>`.
An earlier version pulled the logo from a remote URL, but most clients block
remote images by default, so an unopened email looked completely blank at
the top, no brand at all. Text always renders.

The footer ends with a sign-off, `&mdash; {name}` plus an optional tagline
line beneath it, both pulled from `getEmailSignature(env)`
(`functions/_lib/settings.js`), which reads the `email_signature_name` /
`email_signature_tagline` keys out of the existing generic `settings`
key/value table (the same table maintenance mode and the announcement banner
live in, see `schema/d1-init.sql`). **Every** template function takes the
signature as its last argument and threads it into `baseLayout()`, so every
outgoing email (system or admin-composed) carries the current sign-off,
there's no separate "branded" vs "unbranded" template path. Every call site
(`register.js`, `reset.js`, `request-reset.js`, `resend-verification.js`,
and the three admin routes below) fetches the signature with one
`getEmailSignature(env)` call before rendering. `broadcast.js` fetches it
once before its send loop, not per recipient.

The admin Email tab's **Email signature** card (`public/admin.html`) is the
only place this gets edited: `GET`/`PATCH /api/admin/email/signature`
(`functions/api/admin/email/signature.js`) read and write those two settings
keys directly, no separate table, no extra migration. The card has its own
small live preview that re-renders (debounced, through the preview endpoint
below) as you type, before you've even saved.

A few adaptations from how this might first get described:

- The asset-path comment for the old logo image is gone along with the
  image itself, the wordmark is plain inline-styled HTML now, nothing to
  host.
- The footer's legal link points at `/terms`, there's no `/impressum` page,
  so the link is just labeled "Legal", not "Legal / Impressum". Impressum
  content needs a real legal entity name and address, neither of which
  exists in this codebase, don't fabricate one. If a real Impressum page
  gets built later, repoint `LEGAL_URL` in the templates file.
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

### Unsubscribe (`functions/_lib/unsubscribe.js`, `functions/unsubscribe.js`)

Tokens are `base64url(userId:type).base64url(HMAC-SHA256(SESSION_SECRET, userId:type))`.
Verifying a token returns the **trusted** `{ userId, type }` decoded from the
token itself, never trust the `&type=` query string for the actual write,
that's display-only, otherwise editing the URL could unsubscribe someone
from a different category than the one their signed link was for.
`GET /unsubscribe?token=X&type=Y` writes `notification_prefs(user_id, type,
unsubscribed=1)`. The mailer checks this table before every non-transactional
send, see above, there's no separate enforcement point to keep in sync.

### Admin routes (`functions/api/admin/email/*`)

All under the existing `/api/admin/*` prefix, so the existing
`role === 'admin'` middleware check covers them for free, no extra
auth code needed in any of these files.

- `POST /api/admin/email/send`: one-off, by `userId` or raw `email`
- `POST /api/admin/email/broadcast`: by `segment`, one of `all`, `published`,
  `unpublished`, `inactive_30d`, or `custom` with a `filter` object
  (`{ role?, emailVerified? }`). **There is no raw-SQL filter option** and
  there shouldn't be, an admin panel that runs arbitrary SQL from a request
  body is a SQL injection / data-exfiltration hole waiting to happen even
  when only admins can reach it (mistakes and pasted text happen). If a new
  filter dimension is needed, add a new allowlisted field to
  `resolveCustomSegment()` in `broadcast.js`, not a free-text SQL clause.
  `paid`/`free`/`blog_subscribers` from an earlier description of this
  feature don't correspond to anything real, there's no billing and no blog,
  they were replaced with the segments above.
- `POST /api/admin/email/test`: sends a real template (default `admin_message`)
  through the real pipeline to a chosen address (defaults to the admin's own
  email). This exists specifically to answer "is sending actually working"
  without registering a throwaway account, see "Diagnosing a non-sending
  setup" below.
- `POST /api/admin/email/preview`: renders a draft through the real
  templates without sending, see "Live preview" above
- `GET`/`PATCH /api/admin/email/signature`: reads/writes the sign-off name
  and tagline, see "Templates" above
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

The admin dashboard's **Email** tab (`public/admin.html`) covers all of this:
a health banner that only shows up when something looks wrong (nothing has
ever sent, or most recent sends are failing), a "send a test email" card next
to the signature editor, stat cards (now including total failed), a 30-day
chart, a top-failure-reasons table, the one-off **Send** and **Broadcast**
cards (each full width, form on the left, a live preview iframe on the
right), and a searchable/filterable send log with Preview, Resend, and
Delete actions per row plus a "Clear log" button above the table, and the
bounce suppression list. It follows the same patterns as every other admin
tab (`showConfirm`/`showAlert` from `main.js`, no native dialogs, table +
badge + card layout).

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
`mailer/mailer.js`) isn't verified yet in the Resend dashboard. Use
`POST /api/admin/email/test` (the dashboard's "Send a test email" card) to
check this directly: it goes through the exact same path a real signup or
broadcast would, and its log entry's `error` column will say so explicitly
either way.

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