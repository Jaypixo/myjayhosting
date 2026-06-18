import { json } from '../../../_lib/auth.js';

// Recent-first, capped at 200. Add pagination here if the inbox ever
// genuinely needs it.
const LIMIT = 200;

export async function onRequestGet(context) {
  const { env } = context;

  const messages = await env.DB.prepare(
    'SELECT id, category, username, email, message, status, created_at FROM contact_messages ORDER BY created_at DESC LIMIT ?'
  )
    .bind(LIMIT)
    .all();

  return json({
    messages: messages.results.map((m) => ({
      id: m.id,
      category: m.category,
      username: m.username,
      email: m.email,
      message: m.message,
      status: m.status,
      createdAt: m.created_at,
    })),
  });
}
