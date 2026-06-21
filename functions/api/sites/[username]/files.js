import { listSiteObjects } from '../../../_lib/storage.js';
import { json, errorResponse } from '../../../_lib/auth.js';

// Public, cross-origin "what's actually on this site" lookup, the same role
// Neocities' list API plays. No session, no myjay.net-only CORS restriction
// (see _middleware.js's OPEN_API_PREFIXES), this exists specifically so code
// running anywhere can ask "what files does username.myjay.net have" without
// scraping the rendered site for links.
//
// Mirrors the router's own "not claimed" vs "claimed but not published"
// distinction (see worker/router.js, CLAUDE.md's Subdomain Router Worker
// section) rather than collapsing both into one generic 404: that's already
// the exact same information anyone gets by just visiting the subdomain
// directly, this isn't a new leak, just the same distinction over JSON.
export async function onRequestGet(context) {
  const { env, params } = context;
  const username = String(params.username || '').trim().toLowerCase();

  if (!username) {
    return errorResponse('Username is required', 400);
  }

  const site = await env.DB.prepare('SELECT published FROM sites WHERE username = ?').bind(username).first();
  if (!site) {
    return errorResponse('No site is registered at this subdomain', 404);
  }
  if (!site.published) {
    return errorResponse('This site exists but has not been published', 403);
  }

  const prefix = `sites/${username}/`;
  const objects = await listSiteObjects(env, username);
  const files = objects
    .filter((obj) => !obj.key.endsWith('/.keep')) // internal empty-folder marker, not real content
    .map((obj) => ({
      key: obj.key.slice(prefix.length),
      size: obj.size,
      modified: obj.uploaded,
    }));

  return json({ username, files }, {
    headers: { 'Cache-Control': 'public, max-age=60' },
  });
}
