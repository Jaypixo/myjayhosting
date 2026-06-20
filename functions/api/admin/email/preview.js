import { errorResponse, json } from '../../../_lib/auth.js';
import { getEmailSignature } from '../../../_lib/settings.js';
import { applyPlaceholders, SAMPLE_RECIPIENT } from '../../../_lib/placeholders.js';
import { adminMessage, broadcastAnnouncement } from '../../../_lib/email-templates.js';

// Renders through the exact same template functions a real send uses, so
// the preview can never drift from what actually goes out. signatureName /
// signatureTagline are optional overrides: the signature editor uses them
// to preview unsaved edits, the compose forms omit them and get whatever's
// currently saved.
export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const subject = applyPlaceholders(String(body.subject || '').trim() || '(no subject)', SAMPLE_RECIPIENT);
  const message = applyPlaceholders(String(body.body || ''), SAMPLE_RECIPIENT);
  const saved = await getEmailSignature(env);
  const signature = {
    name: typeof body.signatureName === 'string' && body.signatureName.trim() ? body.signatureName.trim() : saved.name,
    tagline: typeof body.signatureTagline === 'string' ? body.signatureTagline.trim() : saved.tagline,
  };

  const rendered = body.broadcast
    ? broadcastAnnouncement(subject, message, '#', signature)
    : adminMessage(subject, message, signature);

  return json(rendered);
}
