import { errorResponse, json } from '../../../_lib/auth.js';
import { getEmailSignature, setSetting } from '../../../_lib/settings.js';

const NAME_MAX = 60;
const TAGLINE_MAX = 120;

export async function onRequestGet(context) {
  return json(await getEmailSignature(context.env));
}

export async function onRequestPatch(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, NAME_MAX);
    if (!name) return errorResponse('Sign-off name cannot be empty', 400, 'name');
    await setSetting(env, 'email_signature_name', name);
  }
  if (typeof body.tagline === 'string') {
    await setSetting(env, 'email_signature_tagline', body.tagline.trim().slice(0, TAGLINE_MAX));
  }

  return json(await getEmailSignature(env));
}
