// Global Pages Functions middleware. Every fucking request gets filtered through here.
//
// For non-API shit: just check if we're in maintenance mode and whether this admin
// fuckhead gets a free pass. Everything else goes through unchanged. For API routes?
// That's where the real party starts: CORS validation, session cookie bullshit, load
// the user from D1, and shove it into context.data.user for the handlers to deal with.
// Admin routes get the special treatment of also requiring user.role === 'admin'.

import { getCookie, getUserIdForSession, getUserById, errorResponse } from './_lib/auth.js';
import { getSettingsMap } from './_lib/settings.js';

const ALLOWED_ORIGINS = new Set(['https://myjay.net', 'https://www.myjay.net']);

// These are the "public" APIs, meaning they don't need a fucking session.
const PUBLIC_API_PATHS = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/check-username',
  '/api/auth/resend-verification',
  '/api/auth/request-reset',
  '/api/auth/reset',
  '/api/stats',
  '/api/settings',
  '/api/contact',
  '/api/health',
  '/api/webhooks/resend',
  '/api/search',
  '/api/search/autocomplete',
  '/api/search/random',
  '/api/search/recent',
  '/api/search/tags',
  '/api/search/similar',
  '/api/search/stats',
  '/api/search/submit',
  '/api/search/remove-request',
]);

// Paths meant to be called by code running literally anywhere, not just
// myjay.net's own frontend, e.g. the public "what files does this site
// have" lookup. These skip both the session requirement (same as
// PUBLIC_API_PATHS) AND the same-origin restriction every other /api/
// route gets, with a wildcard CORS response instead of the
// origin-echoing one everything else gets. A prefix list, not exact
// paths, since these all have a dynamic username segment after them.
const OPEN_API_PREFIXES = ['/api/sites/'];

function isOpenApiPath(path) {
  return OPEN_API_PREFIXES.some((prefix) => path.startsWith(prefix));
}

function openCorsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
  };
}

// Paths that DON'T get yeeted to /maintenance even when we're in maintenance mode:
// the maintenance page itself (duh), shared assets, and the login page (otherwise
// the admin's locked out of their own site until maintenance is over, which is a
// special kind of fucked up). Also SEO files so Googlebot doesn't get hammered with
// 302 redirects (that would be hilarious but also bad). Cloudflare Pages does that
// stupid 308 redirect thing from "/foo.html" to "/foo", so we gotta allowlist both
// or end up in redirect hell.
const MAINTENANCE_ALLOWLIST = new Set([
  '/maintenance.html', '/maintenance',
  '/login.html', '/login',
  '/robots.txt', '/sitemap.xml', '/llms.txt',
  '/auth/verify', '/auth/reset', '/unsubscribe',
]);

function isAllowedOrigin(origin) {
  if (ALLOWED_ORIGINS.has(origin)) return true;
  // any localhost port is fine for local dev, wrangler picks a random one
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
}

function corsHeaders(origin) {
  const headers = {
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Credentials': 'true',
  };
  if (origin && isAllowedOrigin(origin)) {
    headers['Access-Control-Allow-Origin'] = origin;
  }
  return headers;
}

function withCors(response, headers) {
  const merged = new Headers(response.headers);
  for (const [key, value] of Object.entries(headers)) merged.set(key, value);
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers: merged });
}

export async function onRequest(context) {
  // Destructure context because apparently that's easier than typing it out a thousand times.
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // If it's not an API call, we only care about maintenance mode.
  if (!path.startsWith('/api/')) {
    // Assets and allowlist paths bypass all the bullshit. Thank fucking god.
    if (path.startsWith('/assets/') || MAINTENANCE_ALLOWLIST.has(path)) {
      return next();
    }

    // Check if the site is in maintenance mode.
    const settings = await getSettingsMap(env);
    if (settings.maintenance_mode === '1') {
      // If it is, check if the user is an admin. Only admins get to bypass this shit.
      const token = getCookie(request, 'session');
      const userId = await getUserIdForSession(env, token);
      const user = userId ? await getUserById(env, userId) : null;
      // Not an admin, or banned? Get fucked, you're going to /maintenance.
      if (!user || user.role !== 'admin' || user.banned) {
        return Response.redirect(new URL('/maintenance', request.url).toString(), 302);
      }
    }

    // Not an API call and not in maintenance hell? Send it through.
    return next();
  }

  // Alright, we got an API call. Time to do the annoying shit.
  const origin = request.headers.get('Origin');
  const openApi = isOpenApiPath(path);
  // CORS headers because browsers are paranoid as fuck. Open API paths get
  // the wildcard version, everything else gets the origin-restricted one.
  const cors = openApi ? openCorsHeaders() : corsHeaders(origin);

  if (!openApi && origin && !isAllowedOrigin(origin)) {
    return errorResponse('Origin not allowed', 403);
  }

  if (request.method === 'OPTIONS') {
    // Preflight request. Just send the CORS headers and get it over with.
    return new Response(null, { status: 204, headers: cors });
  }

  // Open API paths don't touch sessions at all, they're not just public,
  // they're meant to be hit by code with no cookie jar in the first place.
  if (openApi) {
    return withCors(await next(), cors);
  }

  // Try to get the session token. If it exists, try to get the user.
  const token = getCookie(request, 'session');
  const userId = await getUserIdForSession(env, token);
  let user = null;
  if (userId) {
    user = await getUserById(env, userId);
    // If the user is banned, they're basically null. Fuck 'em.
    if (user && user.banned) user = null;
  }
  // Attach the user to context.data. Because reasons.
  context.data.user = user;

  // If it's a public API path, just let it through after CORS. No need for a session here.
  if (PUBLIC_API_PATHS.has(path)) {
    return withCors(await next(), cors);
  }

  if (!user) {
    // If we're here, it's a protected API path and there's no user. Unauthorized, motherfucker.
    return withCors(errorResponse('Unauthorized', 401), cors);
  }

  if (path.startsWith('/api/admin/') && user.role !== 'admin') {
    return withCors(errorResponse('Forbidden', 403), cors);
  }
  return withCors(await next(), cors);
}
