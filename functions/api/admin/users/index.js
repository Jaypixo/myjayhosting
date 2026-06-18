import { json, isRootAdmin } from '../../../_lib/auth.js';

const PAGE_SIZE = 50;

export async function onRequestGet(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
  const offset = (page - 1) * PAGE_SIZE;
  const q = (url.searchParams.get('q') || '').trim().toLowerCase();

  const where = q ? 'WHERE username LIKE ? OR email LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`] : [];

  const users = await env.DB.prepare(
    `SELECT id, email, username, role, banned, created_at FROM users ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`
  )
    .bind(...params, PAGE_SIZE, offset)
    .all();

  const total = await env.DB.prepare(`SELECT COUNT(*) AS count FROM users ${where}`)
    .bind(...params)
    .first();

  return json({
    users: users.results.map((u) => ({
      id: u.id,
      email: u.email,
      username: u.username,
      role: u.role,
      banned: Boolean(u.banned),
      createdAt: u.created_at,
      isRootAdmin: isRootAdmin(env, u.email),
    })),
    total: total.count,
    page,
    limit: PAGE_SIZE,
  });
}
