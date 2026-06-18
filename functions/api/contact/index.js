import { isValidEmail, json, errorResponse } from '../../_lib/auth.js';

// Keep this in sync with the <select> options in public/contact.html.
const CATEGORIES = new Set(['general', 'bug', 'abuse', 'account', 'feature', 'press', 'other']);

const MAX_MESSAGE_LENGTH = 4000;
const MAX_USERNAME_LENGTH = 32;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const category = String(body.category || '').trim().toLowerCase();
  const username = String(body.username || '').trim().toLowerCase();
  const email = String(body.email || '').trim().toLowerCase();
  const message = String(body.message || '').trim();

  if (!CATEGORIES.has(category)) {
    return errorResponse('Please pick a valid category', 400);
  }
  if (!isValidEmail(email)) {
    return errorResponse('Please enter a valid email address', 400);
  }
  if (!message) {
    return errorResponse('Message cannot be empty', 400);
  }
  if (message.length > MAX_MESSAGE_LENGTH) {
    return errorResponse(`Message must be under ${MAX_MESSAGE_LENGTH} characters`, 400);
  }
  if (username.length > MAX_USERNAME_LENGTH) {
    return errorResponse('Username is too long', 400);
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  await env.DB.prepare(
    'INSERT INTO contact_messages (id, category, username, email, message, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
  )
    .bind(id, category, username || null, email, message, 'new', now)
    .run();

  return json({ ok: true }, { status: 201 });
}
