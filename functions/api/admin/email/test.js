import { errorResponse, json, isValidEmail } from '../../../_lib/auth.js';
import { sendEmail } from '../../../_lib/mailer.js';
import {
  verifyEmail, passwordReset, securityAlert,
  adminMessage, broadcastAnnouncement, blogNotification,
} from '../../../_lib/email-templates.js';

// A real send through the real pipeline (this route -> service binding ->
// mailer Worker -> Resend), logged with the same error detail as everything
// else. This exists specifically so an admin can answer "is sending actually
// working" without registering a throwaway account and waiting.
function renderTemplate(template) {
  switch (template) {
    case 'verify':
      return { ...verifyEmail('test-token-not-a-real-link'), type: 'verify' };
    case 'reset':
      return { ...passwordReset('test-token-not-a-real-link'), type: 'reset' };
    case 'security_alert':
      return { ...securityAlert('Test security alert', '127.0.0.1', 'Test, Testland'), type: 'security_alert' };
    case 'broadcast':
      return { ...broadcastAnnouncement('Test broadcast', 'This is a test broadcast sent from the admin panel.'), type: 'broadcast' };
    case 'blog_notification':
      return { ...blogNotification('Test Site', 'A test post', 'https://example.myjay.net/post'), type: 'blog_notification' };
    case 'admin_message':
    default:
      return { ...adminMessage('Test message', 'This is a test message sent from the admin panel to confirm email delivery is working end to end.'), type: 'admin_message' };
  }
}

export async function onRequestPost(context) {
  const { request, env, data } = context;
  const admin = data.user;

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }

  const to = String(body.to || admin.email || '').trim().toLowerCase();
  if (!isValidEmail(to)) {
    return errorResponse('Please enter a valid email address', 400, 'to');
  }

  const { subject, html, type } = renderTemplate(String(body.template || 'admin_message'));

  const result = await sendEmail(env, {
    to,
    type,
    subject: `[Test] ${subject}`,
    bodyHtml: html,
    userId: admin.id,
  });

  const status = result.ok === false && !result.skipped ? 502 : 200;
  return json(result, { status });
}
