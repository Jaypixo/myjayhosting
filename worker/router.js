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

function pageShell(title, bodyHtml) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
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
  .box { max-width: 480px; }
  h1 { font-family: 'Crimson Pro', serif; font-style: italic; font-weight: 300; font-size: 2.2rem; margin: 0 0 0.5rem; }
  p { color: var(--muted); }
  .terminal { background: var(--ink); color: var(--paper); padding: 1rem; text-align: left; font-size: 0.8rem; margin-top: 1.5rem; line-height: 1.6; }
  a { color: var(--primary); text-decoration: none; border-bottom: 1px dashed var(--primary); }
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
    <h1><em>nothing here yet.</em></h1>
    <p><strong>${safe}.myjay.net</strong> hasn't published a site, or doesn't exist.</p>
    <div class="terminal">
$ curl ${safe}.myjay.net<br>
status: 404, site not published<br>
hint: claim this name at <a href="https://myjay.net/register.html">myjay.net</a>
    </div>
  `);
  return new Response(html, { status: 404, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}

function fileNotFoundResponse(username) {
  const safe = escapeHtml(username);
  const html = pageShell(`${safe}.myjay.net | 404`, `
    <h1><em>404</em></h1>
    <p>That page doesn't exist on <strong>${safe}.myjay.net</strong>.</p>
    <div class="terminal">
$ ls sites/${safe}/<br>
error: ENOENT, no such file
    </div>
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
