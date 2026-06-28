// Thin wrapper around the CRAWLER service binding (crawler/crawler.js).
// Mirrors functions/_lib/mailer.js's pattern for the MAILER binding: same
// fail-soft-if-not-configured shape, same plain-JSON request/response.
export async function callCrawler(env, action, payload = {}) {
  if (!env.CRAWLER) {
    return { ok: false, error: 'CRAWLER binding not configured' };
  }
  try {
    const res = await env.CRAWLER.fetch('https://crawler.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, ...payload }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'crawler request failed' };
  }
}
