// Shared auth helpers for Pages Functions.
// Files/folders prefixed with "_" are excluded from Pages routing, so this
// module is safe to import without becoming an API endpoint itself.

const PBKDF2_ITERATIONS = 100000;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

export const USERNAME_RE = /^[a-z0-9-]{3,32}$/;
export const RESERVED_USERNAMES = new Set([
  'www', 'api', 'admin', 'mail', 'ftp', 'myjay', 'support', 'help', 'static', 'assets', 'cdn',
]);

export function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username) && !RESERVED_USERNAMES.has(username);
}

export function isValidEmail(email) {
  return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

// --- Password hashing (PBKDF2-SHA256 via Web Crypto) ------------------------

export async function hashPassword(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${bufToHex(salt)}:${bufToHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  const salt = hexToBuf(saltHex);
  const hash = await pbkdf2(password, salt);
  return timingSafeEqual(bufToHex(hash), hashHex);
}

async function pbkdf2(password, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt, iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    keyMaterial,
    256
  );
  return new Uint8Array(bits);
}

function bufToHex(buf) {
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// --- Sessions (KV) ------------------------------------------------------------

export async function createSession(env, userId) {
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`session:${token}`, userId, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function destroySession(env, token) {
  if (!token) return;
  await env.SESSIONS.delete(`session:${token}`);
}

export async function getUserIdForSession(env, token) {
  if (!token) return null;
  return env.SESSIONS.get(`session:${token}`);
}

export function getCookie(request, name) {
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token) {
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  return 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

// --- D1 user lookups ------------------------------------------------------------

export async function getUserById(env, id) {
  return env.DB.prepare(
    'SELECT id, email, username, role, banned, created_at, bio, site_title FROM users WHERE id = ?'
  )
    .bind(id)
    .first();
}

export async function getUserByEmail(env, email) {
  return env.DB.prepare(
    'SELECT id, email, username, password_hash, role, banned, created_at, bio, site_title FROM users WHERE email = ?'
  )
    .bind(email)
    .first();
}

// --- JSON response helpers ------------------------------------------------------

export function json(data, init = {}) {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

export function errorResponse(message, status = 400) {
  return json({ error: message }, { status });
}
