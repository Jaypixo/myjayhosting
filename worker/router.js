// myjay-router: throws published user sites at you from R2 at username.myjay.net.
//
// Deploy: wrangler deploy worker/router.js --name myjay-router
// Trigger: Custom Domain *.myjay.net (catch all those damn subdomains)
// Bindings: DB (D1) and SITES (R2). Same shit the Pages project has.

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

// Error pages are PLAIN TEXT plus the mascot, NOT terminal-log bullshit.
// Same reason the main site does it this way: terminal blocks are for actual logs
// and code samples, not the one fucking sentence a lost visitor needs to read to
// understand what went wrong. The mascot comes from the main domain because this
// Worker doesn't haul around static assets, just user files from R2.
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

// "Nobody's registered this username" and "someone registered it but
// hasn't published anything" are different situations, the first is an
// invitation (claim it), the second isn't (it's already someone's,
// there's nothing for a random visitor to do). Every registered account
// gets a `sites` row at signup (see functions/api/auth/register.js), even
// before they publish, so "no row at all" reliably means "not claimed."
function siteNotClaimedResponse(username) {
  const safe = escapeHtml(username);
  const html = pageShell(`${safe}.myjay.net`, `
    <h1><em>Not claimed.</em></h1>
    <p>Nobody has claimed <strong>${safe}.myjay.net</strong> yet.</p>
    <img src="https://myjay.net/assets/img/MyJayErrorMascot.png" alt="" class="mascot" onerror="this.style.display='none'">
    <a class="btn" href="https://myjay.net/register">Claim this name</a>
  `);
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function siteNotPublishedResponse(username) {
  const safe = escapeHtml(username);
  const html = pageShell(`${safe}.myjay.net`, `
    <h1><em>Not published yet.</em></h1>
    <p><strong>${safe}.myjay.net</strong> is claimed, but its owner hasn't published anything here yet.</p>
    <img src="https://myjay.net/assets/img/MyJayErrorMascot.png" alt="" class="mascot" onerror="this.style.display='none'">
    <a class="btn" href="https://myjay.net">Back to MyJay.net</a>
  `);
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

// Same heading, description, and mascot as the main site's public/404.html,
// word for word, "serve our exact 404 page" was the ask. The only thing
// that's allowed to differ is the one link, which has to point at this
// subdomain's own root instead of myjay.net's, "/" already resolves there
// since this response is served from username.myjay.net itself.
function fileNotFoundResponse(username) {
  const safe = escapeHtml(username);
  const html = pageShell(`Page not found | ${safe}.myjay.net`, `
    <h1><em>404</em></h1>
    <p>This page doesn't exist. It may have been moved, renamed, or never existed in the first place.</p>
    <img src="https://myjay.net/assets/img/MyJayErrorMascot.png" alt="" class="mascot" onerror="this.style.display='none'">
    <a class="btn" href="/">Back to ${safe}.myjay.net</a>
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
    if (!site) {
      return siteNotClaimedResponse(username);
    }
    if (!site.published) {
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
