// Site-wide settings — a small key/value table (`settings`) managed from the
// admin panel. Used for maintenance mode, the announcement banner, and the
// registration on/off switch.

const DEFAULTS = {
  maintenance_mode: '0',
  announcement: '',
  announcement_enabled: '0',
  registration_enabled: '1',
};

function toPublicShape(map) {
  return {
    maintenanceMode: map.maintenance_mode === '1',
    announcement: map.announcement || '',
    announcementEnabled: map.announcement_enabled === '1',
    registrationEnabled: map.registration_enabled !== '0',
  };
}

export async function getSettingsMap(env) {
  const { results } = await env.DB.prepare('SELECT key, value FROM settings').all();
  const map = { ...DEFAULTS };
  for (const row of results) map[row.key] = row.value;
  return map;
}

export async function getSettings(env) {
  return toPublicShape(await getSettingsMap(env));
}

export async function setSetting(env, key, value) {
  if (!(key in DEFAULTS)) throw new Error(`Unknown setting: ${key}`);
  await env.DB.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  ).bind(key, String(value)).run();
}
