// Global Pages Functions middleware.
//
// Runs for every request, including static asset requests. For anything
// outside /api/, it only checks maintenance mode (redirecting non-admins to
// /maintenance.html) and otherwise passes the request straight through. For
// API routes it handles CORS, validates the session cookie against KV, loads
// the user from D1, and attaches it to context.data.user for downstream
// handlers. Admin routes additionally require user.role === 'admin'.

import { getCookie, getUserIdForSession, getUserById, errorResponse } from './_lib/auth.js';
import { getSettingsMap } from './_lib/settings.js';

const ALLOWED_ORIGINS = new Set(['https://myjay.net', 'https://www.myjay.net']);

// These are the "public" APIs, meaning they don't need a fucking session.
const PUBLIC_API_PATHS = new Set([
  '/api/auth/register',
  '/api/auth/login',
  '/api/auth/logout',
  '/api/auth/check-username',
  '/api/explore',
  '/api/settings',
]);

// Paths that must stay reachable even while maintenance mode is on: the
// maintenance page itself, shared assets, and the login page (so an admin
// who isn't currently logged in can still get in to turn it back off).
// Cloudflare Pages 308-redirects "/foo.html" to "/foo", so both forms of
// each path need to be allowlisted to avoid a redirect loop.
const MAINTENANCE_ALLOWLIST = new Set(['/maintenance.html', '/maintenance', '/login.html', '/login']);

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
  // Destructure context. Because we love typing.
  const { request, env, next } = context;
  const url = new URL(request.url);
  const path = url.pathname;

  // If it's not an API call, we only care about maintenance mode.
  if (!path.startsWith('/api/')) {
    // Assets and maintenance allowlist paths get a free pass. Thank god.
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
      // If not an admin, or banned (because we don't want banned admins fixing things), redirect.
      if (!user || user.role !== 'admin' || user.banned) {
        return Response.redirect(new URL('/maintenance', request.url).toString(), 302);
      }
    }

    // If not an API call and not in maintenance mode, just let it through.
    return next();
  }

  // Okay, it's an API call. Now the real fun begins.
  const origin = request.headers.get('Origin');
  // Set up CORS headers. Because security is a pain in the ass.
  const cors = corsHeaders(origin);

  if (origin && !isAllowedOrigin(origin)) {
    return errorResponse('Origin not allowed', 403);
  }

  if (request.method === 'OPTIONS') {
    // Preflight request. Just send the CORS headers and get it over with.
    return new Response(null, { status: 204, headers: cors });
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
