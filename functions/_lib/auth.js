// Shared auth helpers for Pages Functions.
// Files/folders prefixed with "_" are excluded from Pages routing, so this
// module should be safe to import without becoming an API endpoint itself.

// 100k iterations because OWASP says we have to. If login feels slow,
// your laptop is the problem, not the code. Touch this and we get hacked
// in like 3 seconds flat.
const PBKDF2_ITERATIONS = 100000;
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days of session hell.

// Usernames must follow these rules. Anything else is a hard no.
export const USERNAME_RE = /^[a-z0-9-]{3,32}$/;
// Reserved words that are OURS. Break this list and I will lose my mind.
// Added a ton more because people love trying shit like 'root', 'system', etc.
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

// One admin account that is UNTOUCHABLE by literally every other admin.
// Ban, demote, reset, delete? Nope. None of it. Identified by env.ADMIN_EMAIL,
// the same one used for first-time admin creation. If ADMIN_EMAIL isn't set,
// nobody gets protected.
export function isRootAdmin(env, email) {
  return Boolean(env.ADMIN_EMAIL) && String(email || '').toLowerCase() === String(env.ADMIN_EMAIL).toLowerCase();
}

export function isValidEmail(email) {
  // You want a full RFC email regex? Are you insane? That's like 6KB of pure
  // suffering. This is the HTML5-ish version, handles dots and subdomains without
  // melting down. Good enough. This regex was a fucking nightmare btw, seriously fuck it.
  return typeof email === 'string' && /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/.test(email);
}

// Password hashing with PBKDF2-SHA256 via Web Crypto. No bcrypt nonsense.
export async function hashPassword(password) {
  // Random salt so rainbow tables can fuck off.
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt);
  return `${bufToHex(salt)}:${bufToHex(hash)}`;
}

export async function verifyPassword(password, stored) {
  const parts = (stored || '').split(':');
  if (parts.length !== 2) return false;
  const [saltHex, hashHex] = parts;
  const salt = hexToBuf(saltHex);
  // Re-hash and cross your fingers.
  const hash = await pbkdf2(password, salt);
  // Timing-safe comparison because attackers are nosy as fuck.
  return timingSafeEqual(bufToHex(hash), hashHex);
}

async function pbkdf2(password, salt) {
  // SubtleCrypto API is a pain in the ass, but it works.
  const keyMaterial = await crypto.subtle.importKey(
    // Yes, importing a string is called "import". Don't ask why.
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
  // JS still doesn't have native hex conversion in 2026. Unbelievable.
  return Array.from(buf).map((b) => b.toString(16).padStart(2, '0')).join('');
}

function hexToBuf(hex) {
  // Manual conversion because apparently I hate myself.
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return bytes;
}

function timingSafeEqual(a, b) {
  if (a.length !== b.length) return false;
  // XOR magic to prevent timing attacks. Don't try to understand this
  // unless you have a CS degree in cryptography. We're not winning math fairs here.
  let result = 0;
  for (let i = 0; i < a.length; i++) {
    result |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return result === 0;
}

// Sessions in KV
export async function createSession(env, userId) {
  // UUIDs are dope. Better than my life decisions.
  const token = crypto.randomUUID();
  await env.SESSIONS.put(`session:${token}`, userId, { expirationTtl: SESSION_TTL_SECONDS });
  return token;
}

export async function destroySession(env, token) {
  // Delete it from existence.
  if (!token) return;
  await env.SESSIONS.delete(`session:${token}`);
}

export async function getUserIdForSession(env, token) {
  if (!token) return null;
  return env.SESSIONS.get(`session:${token}`);
}

export function getCookie(request, name) {
  // Manual cookie parsing because frameworks are bloated garbage.
  const cookie = request.headers.get('Cookie') || '';
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

export function sessionCookie(token) {
  // Lax mode because I can't deal with cross-site cookie bullshit today.
  return `session=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=${SESSION_TTL_SECONDS}`;
}

export function clearSessionCookie() {
  // Max-Age=0 deletes it. Get out.
  return 'session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
}

// D1 user lookups
export async function getUserById(env, id) {
  // Please actually return something this time.
  return env.DB.prepare(
    'SELECT id, email, username, role, banned, email_verified, created_at, bio, site_title FROM users WHERE id = ?'
  )
    .bind(id)
    .first();
}

export async function getUserByEmail(env, email) {
  // Need the hash here to actually verify the login. Obviously.
  return env.DB.prepare(
    'SELECT id, email, username, password_hash, role, banned, email_verified, created_at, bio, site_title FROM users WHERE email = ?'
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
