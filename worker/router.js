// myjay-router: serves published user sites from R2 at username.myjay.net.
//
// Deploy: wrangler deploy worker/router.js --name myjay-router
// Trigger: Custom Domain *.myjay.net
// Bindings required: DB (D1), SITES (R2), same as the Pages project.

const CONTENT_TYPES = {
  html: 'text/html; charset=utf-8',
  htm: 'text/html; charset=utf-8',
  css: 'text/css; charset=utf-8',
  js: 'application/javascript; charset=utf-8',
  json: 'application/json; charset=utf-8',
  xml: 'application/xml; charset=utf-8',
  txt: 'text/plain; charset=utf-8',
  md: 'text/markdown; charset=utf-8',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  gif: 'image/gif',
  webp: 'image/webp',
  svg: 'image/svg+xml',
  ico: 'image/x-icon',
  woff: 'font/woff',
  woff2: 'font/woff2',
  ttf: 'font/ttf',
};

function extensionOf(path) {
  const idx = path.lastIndexOf('.');
  return idx === -1 ? '' : path.slice(idx + 1).toLowerCase();
}

function contentTypeFor(path) {
  return CONTENT_TYPES[extensionOf(path)] || 'application/octet-stream';
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Both error pages below are deliberately plain prose plus the mascot, not
// a terminal-log block, the same call made for the main site's 404.html
// and maintenance.html: a terminal block is for genuinely log-like
// content, not the one paragraph a confused visitor actually needs to
// read. The mascot is fetched from the main domain (myjay.net), this
// Worker only ever has R2 user files and no static assets of its own.
function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="robots" content="noindex">
<title>${title}</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@1,300&family=IBM+Plex+Mono:wght@400;500&display=swap" rel="stylesheet">
<style>
  :root {
    --paper: #f5f0e8; --paper-alt: #ede8dc; --ink: #1a1716; --muted: #9b8f82;
    --primary: #c7522a; --border: rgba(26, 23, 22, 0.12);
  }
  @media (prefers-color-scheme: dark) {
    :root { --paper: #201e24; --paper-alt: #18161a; --ink: #e8e2d9; --muted: #7a7068; --border: rgba(232, 226, 217, 0.10); }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    background: var(--paper); color: var(--ink); font-family: 'IBM Plex Mono', monospace;
    text-align: center; padding: 2rem;
  }
  .box { max-width: 420px; }
  h1 { font-family: 'Crimson Pro', serif; font-style: italic; font-weight: 300; font-size: 2.6rem; margin: 0 0 0.5rem; }
  p { color: var(--muted); line-height: 1.5; }
  .mascot { display: block; max-width: 200px; width: 100%; margin: 1.5rem auto; }
  a.btn { display: inline-block; margin-top: 0.5rem; padding: 0.7em 1.4em; border: 1px solid var(--ink); color: var(--ink); text-decoration: none; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.06em; }
  a.btn:hover { background: var(--ink); color: var(--paper); }
</style>
</head>
<body>
  <div class="box">${bodyHtml}</div>
</body>
</html>`;
}

function siteNotPublishedResponse(username) {
  const safe = escapeHtml(username);
  const html = pageShell(`${safe}.myjay.net`, `
    <h1><em>Nothing here yet.</em></h1>
    <p><strong>${safe}.myjay.net</strong> hasn't published a site, or doesn't exist.</p>
    <img src="https://myjay.net/assets/img/MyJayErrorMascot.png" alt="" class="mascot" onerror="this.style.display='none'">
    <a class="btn" href="https://myjay.net/register">Claim this name</a>
  `);
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function fileNotFoundResponse(username) {
  const safe = escapeHtml(username);
  const html = pageShell(`${safe}.myjay.net | 404`, `
    <h1><em>404</em></h1>
    <p>That page doesn't exist on <strong>${safe}.myjay.net</strong>.</p>
    <img src="https://myjay.net/assets/img/MyJayErrorMascot.png" alt="" class="mascot" onerror="this.style.display='none'">
    <a class="btn" href="/">Back to the homepage</a>
  `);
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const labels = url.hostname.toLowerCase().split('.');

    // Expect username.myjay.net, anything without a subdomain isn't ours to serve.
    if (labels.length < 3) {
      return new Response('Not found', { status: 404 });
    }
    const username = labels[0];

    const site = await env.DB.prepare('SELECT id, published FROM sites WHERE username = ?').bind(username).first();
    if (!site || !site.published) {
      return siteNotPublishedResponse(username);
    }

    let path = decodeURIComponent(url.pathname).replace(/^\/+/, '');
    let resolvedPath = path;
    let object;

    if (path === '' || path.endsWith('/')) {
      resolvedPath = `${path}index.html`;
      object = await env.SITES.get(`sites/${username}/${resolvedPath}`);
    } else {
      object = await env.SITES.get(`sites/${username}/${path}`);
      if (!object && extensionOf(path) === '') {
        resolvedPath = `${path}/index.html`;
        object = await env.SITES.get(`sites/${username}/${resolvedPath}`);
      }
    }

    if (!object) {
      // Users can style their own 404 by uploading a 404.html to their
      // site, same as any other static host. Served with a real 404
      // status either way, search engines and link checkers should still
      // see this as "not found," not a normal 200 page.
      const custom404 = await env.SITES.get(`sites/${username}/404.html`);
      if (custom404) {
        return new Response(custom404.body, {
          status: 404,
          headers: {
            'Content-Type': custom404.httpMetadata?.contentType || 'text/html; charset=utf-8',
            'ETag': custom404.httpEtag,
          },
        });
      }
      return fileNotFoundResponse(username);
    }

    const contentType = object.httpMetadata?.contentType || contentTypeFor(resolvedPath);

    // waitUntil so the visitor gets their page immediately, the view count
    // write happens after the response is already on its way out
    if (contentType.startsWith('text/html')) {
      const country = request.cf?.country || 'XX';
      const date = new Date().toISOString().slice(0, 10);
      ctx.waitUntil(
        Promise.all([
          env.DB.prepare('UPDATE sites SET view_count = view_count + 1 WHERE id = ?').bind(site.id).run(),
          env.DB.prepare(
            `INSERT INTO site_view_stats (site_id, date, country, views) VALUES (?, ?, ?, 1)
             ON CONFLICT(site_id, date, country) DO UPDATE SET views = views + 1`
          ).bind(site.id, date, country).run(),
        ])
      );
    }

    const headers = new Headers();
    headers.set('Content-Type', contentType);
    headers.set('ETag', object.httpEtag);
    headers.set('Cache-Control', 'public, max-age=60');

    return new Response(object.body, { headers });
  },
};
