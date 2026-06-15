import { getSettings, setSetting } from '../../_lib/settings.js';
import { json, errorResponse } from '../../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  return json(await getSettings(env));
}

const KEY_MAP = {
  maintenanceMode: 'maintenance_mode',
  announcement: 'announcement',
  announcementEnabled: 'announcement_enabled',
  registrationEnabled: 'registration_enabled',
};

export async function onRequestPatch(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  for (const [field, key] of Object.entries(KEY_MAP)) {
    if (!(field in body)) continue;
    const value = body[field];
    if (key === 'announcement') {
      await setSetting(env, key, String(value).slice(0, 280));
    } else {
      await setSetting(env, key, value ? '1' : '0');
    }
  }

  return json(await getSettings(env));
}
