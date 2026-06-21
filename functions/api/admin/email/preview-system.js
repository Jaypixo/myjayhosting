import { errorResponse, json } from '../../../_lib/auth.js';
import { getEmailSignature } from '../../../_lib/settings.js';
import { SAMPLE_RECIPIENT } from '../../../_lib/placeholders.js';
import {
  verifyEmail,
  passwordReset,
  securityAlert,
  welcomeEmail,
  storageWarning,
  storageLimitReached,
  sitePublished,
} from '../../../_lib/email-templates.js';

// Renders the automated, self-triggered emails (welcome, storage alerts,
// publish confirmation, plus the existing verify/reset/security_alert)
// through the exact same functions a real trigger uses, with sample data,
// so they're inspectable from the admin panel without waiting for a real
// signup/upload/publish to fire one. These aren't editable here, the body
// is code, not a database row, this is preview-only.
const SAMPLE_SITE_LABEL = `${SAMPLE_RECIPIENT.username}.myjay.net`;

const RENDERERS = {
  verify: (signature) => verifyEmail('sample-token', signature),
  reset: (signature) => passwordReset('sample-token', signature),
  security_alert: (signature) => securityAlert('Password changed', '203.0.113.4', 'Berlin, DE', signature),
  welcome: (signature) => welcomeEmail(SAMPLE_RECIPIENT.username, signature),
  storage_warning: (signature) => storageWarning(SAMPLE_SITE_LABEL, 82, signature),
  storage_reached: (signature) => storageLimitReached(SAMPLE_SITE_LABEL, signature),
  site_published: (signature) => sitePublished(SAMPLE_RECIPIENT.username, signature),
};

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const type = String(body.type || '');
  const renderer = RENDERERS[type];
  if (!renderer) {
    return errorResponse(`"type" must be one of: ${Object.keys(RENDERERS).join(', ')}`, 400);
  }

  const signature = await getEmailSignature(env);
  return json(renderer(signature));
}
