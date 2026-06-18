// Shared auth helpers for Pages Functions.
// Files/folders prefixed with "_" are excluded from Pages routing, so this
// module should be safe to import without becoming an API endpoint itself.

// 100k iterations per OWASP's current recommendation. Don't lower this just
// because login feels slow on your laptop, that's the point.
// 100k iterations because OWASP says so. If login feels slow, buy a better 
// fucking computer. Don't touch this or we'll get pwned in three seconds.
const PBKDF2_ITERATIONS = 100000;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days of annoying users.

// If they can't pick a name with these rules, they don't deserve an account.
export const USERNAME_RE = /^[a-z0-9-]{3,32}$/;
// These are ours. Touch them and I'll lose my goddamn mind.
// Added a metric fuck-ton more because people think they're clever trying to be 'root'.
export const RESERVED_USERNAMES = new Set([
  'www', 'api', 'admin', 'mail', 'ftp', 'myjay', 'support', 'help', 'static', 'assets', 'cdn',
  'root', 'status', 'blog', 'dev', 'test', 'user', 'login', 'register', 'dashboard', 'account',
  'security', 'legal', 'terms', 'privacy', 'docs', 'helpdesk', 'system', 'staff', 'moderator',
  'owner', 'null', 'undefined', 'public', 'private', 'internal', 'portal', 'proxy', 'secure',
  'billing', 'payment', 'subscribe', 'unsubscribe', 'webhook', 'oauth', 'callback', 'images',
  'upload', 'download', 'manage', 'settings', 'config', 'profile', 'search', 'verify', 'reset'
]);

export function isValidUsername(username) {
  return typeof username === 'string' && USERNAME_RE.test(username) && !RESERVED_USERNAMES.has(username);
}

// The one account that can't be touched by any other admin: ban, demote,
// reset, delete, none of it. Identified by env.ADMIN_EMAIL, the same value
// used at registration time to grant the first admin role. If ADMIN_EMAIL
// isn't set, nobody is protected, there's nothing to compare against.
export function isRootAdmin(env, email) {
  return Boolean(env.ADMIN_EMAIL) && String(email || '').toLowerCase() === String(env.ADMIN_EMAIL).toLowerCase();
}

export function isValidEmail(email) {
  // You want a "full" RFC regex? Are you high? That thing is like 6KB of 
  // pure concentrated misery. This is the HTML5-ish version. It handles dots in the local part
  // and doesn't shit itself when it sees a subdomain. Good enough for this project. Also this bitch was a fucking pain btw. Fuck you.
  return typeof email === 'string' && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email);
}

// Password hashing (PBKDF2-SHA256 via Web Crypto)
export async function hashPassword(password) {
  // Get some random shit for the salt so rainbow tables can eat a dick.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${bufToHex(salt)}:${bufToHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  const salt = hexToBuf(saltHex);
  // Re-hash and hope for the best.
  const hash = await pbkdf2(password, salt);
  // Use the timing safe one because hackers are nosy fucks.
  return timingSafeEqual(bufToHex(hash), hashHex);
}

async function pbkdf2(password, salt) {
  // SubtleCrypto is about as subtle as a brick to the teeth. 
  const keyMaterial = await crypto.subtle.importKey(
    // Why is this an 'import'? It's a goddamn string.
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
  // How the fuck does JS still not have a native hex converter in 2026?
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  // Doing this manually because I hate myself.
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  // Bitwise XOR magic. If you don't understand this, don't touch it.
  // We're preventing timing attacks, not winning a math fair.
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

//  Sessions (KV)
export async function createSession(env, userId) {
  // UUIDs are great. Better than my life choices.
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`session:${token}`, userId, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function destroySession(env, token) {
  // Nuke it.
  if (!token) return;
  await env.SESSIONS.delete(`session:${token}`);
}

export async function getUserIdForSession(env, token) {
  if (!token) return null;
  return env.SESSIONS.get(`session:${token}`);
}

export function getCookie(request, name) {
  // Parsing cookies with regex because frameworks are for people who like bloated nodes.
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token) {
  // Lax because I don't want to deal with cross-site bullshit today.
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  // Setting Max-Age to 0. gtfo.
  return 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

// D1 user lookups
export async function getUserById(env, id) {
  // D1 better actually return the user this time. 
  // Istg if this returns an empty object I'm jumping.
  return env.DB.prepare(
    'SELECT id, email, username, role, banned, created_at, bio, site_title FROM users WHERE id = ?'
  )
    .bind(id)
    .first();
}

export async function getUserByEmail(env, email) {
  // Need the hash here to actually verify the login. Obviously.
  return env.DB.prepare(
    'SELECT id, email, username, password_hash, role, banned, created_at, bio, site_title FROM users WHERE email = ?'
  )
    .bind(email)
    .first();
}

// JSON response helpers

export function json(data, init = {}) {
  // Just return the damn JSON.
  return new Response(JSON.stringify(data), {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init.headers || {}) },
  });
}

export function errorResponse(message, status = 400, field) {
  // Stop doing stupid shit and maybe you won't get a 400.
  // `field` is optional: when set, the frontend can attach this error to the
  // specific input instead of dumping it in a generic banner.
  return json(field ? { error: message, field } : { error: message }, { status });
}
