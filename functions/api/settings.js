import { getSettings } from '../_lib/settings.js';
import { json } from '../_lib/auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const settings = await getSettings(env);
  return json(settings);
}
