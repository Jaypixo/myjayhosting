import { getCookie, destroySession, clearSessionCookie, json } from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  const token = getCookie(request, 'session');
  await destroySession(env, token);

  return json({}, { headers: { 'Set-Cookie': clearSessionCookie() } });
}
