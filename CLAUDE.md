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

GET  /api/admin/users        → { users: [...] }
PATCH /api/admin/users/:id   { role?, banned?, password? } → { ok }
DELETE /api/admin/users/:id  → { ok }
GET  /api/admin/sites        → { sites: [...] }
DELETE /api/admin/sites/:id  → { ok }
```

---

## Security Rules

- All user-uploaded files are served from R2 via the subdomain Worker. They never execute on the main domain.
- The main `myjay.net` domain only serves the platform UI, no user content ever appears here.
- Session tokens are UUIDs stored in KV. The cookie is `HttpOnly; Secure; SameSite=Lax`. Never expose session tokens in API responses.
- Username validation must be enforced server-side (not just client-side): regex `^[a-z0-9-]{3,32}$`. Block reserved names: `www`, `api`, `admin`, `mail`, `ftp`, `myjay`, `support`, `help`, `static`, `assets`, `cdn`.
- File uploads: validate Content-Type on the server. Reject executables. Reject files > `MAX_UPLOAD_BYTES` per file. Enforce total quota per user.
- Admin routes: middleware must verify `user.role === 'admin'`. Do not rely on client-side role checks.
- CORS: API routes should only accept requests from `myjay.net` origin.

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

---

*Last updated: Phase 1 scaffold. Future phases: blog engine, guestbook, microblog, indie ad network, pro plan (custom domains, higher quota).*