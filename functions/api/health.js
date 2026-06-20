import { json } from '../_lib/auth.js';

// Live, real-time checks against all the stuff we depend on.
// Each does the bare minimum read to keep this cheap on every /status page load.
async function check(fn) {
  const start = Date.now();
  try {
    await fn();
    return { ok: true, ms: Date.now() - start };
  } catch {
    return { ok: false, ms: Date.now() - start };
  }
}

export async function onRequestGet(context) {
  const { env } = context;

  const [database, storage, sessions] = await Promise.all([
    check(() => env.DB.prepare('SELECT 1').first()),
    check(() => env.SITES.list({ limit: 1 })),
    check(() => env.SESSIONS.get('healthcheck-probe')),
  ]);

  return json({ checkedAt: new Date().toISOString(), database, storage, sessions });
}
