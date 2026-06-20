import { json, errorResponse } from '../../_lib/auth.js';

// The only two notification types a user can actually opt out of. verify,
// reset, and security_alert are transactional and never gated (see
// mailer/mailer.js); admin_message (one-off) always bypasses preferences
// too, see broadcast.js / send.js. These map camelCase keys in the API to
// the snake_case `type` values stored in notification_prefs.
const TYPE_MAP = { broadcast: 'broadcast', blogNotification: 'blog_notification' };

async function getPrefs(env, userId) {
  const { results } = await env.DB.prepare(
    'SELECT type, unsubscribed FROM notification_prefs WHERE user_id = ?'
  ).bind(userId).all();

  const unsubscribed = new Set(results.filter((r) => r.unsubscribed).map((r) => r.type));
  const prefs = {};
  for (const [key, type] of Object.entries(TYPE_MAP)) prefs[key] = !unsubscribed.has(type);
  return prefs;
}

export async function onRequestGet(context) {
  return json(await getPrefs(context.env, context.data.user.id));
}

export async function onRequestPatch(context) {
  const { request, env, data } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  for (const [key, type] of Object.entries(TYPE_MAP)) {
    if (typeof body[key] !== 'boolean') continue;
    const unsubscribed = body[key] ? 0 : 1;
    await env.DB.prepare(
      `INSERT INTO notification_prefs (user_id, type, unsubscribed, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, type) DO UPDATE SET unsubscribed = excluded.unsubscribed, updated_at = excluded.updated_at`
    ).bind(data.user.id, type, unsubscribed, new Date().toISOString()).run();
  }

  return json(await getPrefs(env, data.user.id));
}
