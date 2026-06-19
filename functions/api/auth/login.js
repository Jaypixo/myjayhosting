import {
  verifyPassword,
  createSession,
  sessionCookie,
  getUserByEmail,
  isValidEmail,
  json,
  errorResponse,
} from '../../_lib/auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const email = String(body.email || '').trim().toLowerCase();
  const password = String(body.password || '');

  if (!isValidEmail(email) || !password) {
    return errorResponse('Invalid email or password', 401);
  }

  const user = await getUserByEmail(env, email);
  if (!user || !(await verifyPassword(password, user.password_hash))) {
    return errorResponse('Invalid email or password', 401);
  }

  if (user.banned) {
    return errorResponse('This account has been suspended', 403);
  }

  if (!user.email_verified) {
    return json(
      { error: 'Please verify your email before logging in. Check your inbox, or request a new link.', unverified: true },
      { status: 403 }
    );
  }

  const token = await createSession(env, user.id);

  return json({ username: user.username }, { headers: { 'Set-Cookie': sessionCookie(token) } });
}
