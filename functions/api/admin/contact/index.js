import { json } from '../../../_lib/auth.js';

// Recent-first, 200 message limit. If the inbox ever actually needs pagination,
// add it then. Not before.
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
