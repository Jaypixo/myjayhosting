// HMAC-signed unsubscribe tokens. Payload is "userId:type" signed with
// SESSION_SECRET. Signature prevents anyone from forging a link to unsubscribe
// (or "resubscribe") someone else's account. Only they can control their own shit.

async function hmacKey(secret) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
}

function toBase64Url(buf) {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(str) {
  const b64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

export async function buildUnsubscribeToken(env, userId, type) {
  const payload = `${userId}:${type}`;
  const key = await hmacKey(env.SESSION_SECRET);
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  return `${toBase64Url(new TextEncoder().encode(payload))}.${toBase64Url(sig)}`;
}

// Verified token returns { userId, type }, or null if the signature is broken
// (tampered, or signed with a different secret). Can't trust the query params.
export async function verifyUnsubscribeToken(env, token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 2) return null;
  const [payloadB64, sigB64] = parts;

  let payload;
  try {
    payload = new TextDecoder().decode(fromBase64Url(payloadB64));
  } catch {
    return null;
  }
  const [userId, type] = payload.split(':');
  if (!userId || !type) return null;

  const key = await hmacKey(env.SESSION_SECRET);
  const expectedSig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
  if (toBase64Url(expectedSig) !== sigB64) return null;

  return { userId, type };
}

export function unsubscribeUrl(token, type) {
  return `https://myjay.net/unsubscribe?token=${encodeURIComponent(token)}&type=${encodeURIComponent(type)}`;
}
