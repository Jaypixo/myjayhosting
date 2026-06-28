import { json, errorResponse } from '../../_lib/auth.js';

// Mirrors functions/api/site/publish.js's shape: a one-field toggle on the
// caller's own sites row. MyJay sites are indexed by default (search_opt_out
// starts at 0); this is how an owner opts back out.
export async function onRequestPost(context) {
  const { request, env, data } = context;
  const user = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const indexed = Boolean(body.indexed);
  await env.DB.prepare('UPDATE sites SET search_opt_out = ? WHERE user_id = ?')
    .bind(indexed ? 0 : 1, user.id)
    .run();

  return json({ ok: true });
}
