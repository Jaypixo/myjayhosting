// Thin wrapper around the MAILER service binding (mailer/mailer.js). Every
// route that needs to send an email should call sendEmail() rather than
// constructing the service-binding fetch itself.

export async function sendEmail(env, { to, type, subject, bodyHtml, userId }) {
  if (!env.MAILER) {
    // Binding not configured yet (e.g. local dev without it set up, or the
    // dashboard service binding hasn't been added). Fail soft, callers
    // shouldn't 500 a signup just because mail couldn't go out.
    return { ok: false, error: 'MAILER binding not configured' };
  }

  try {
    const res = await env.MAILER.fetch('https://mailer.internal/', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ to, type, subject, bodyHtml, userId }),
    });
    return await res.json();
  } catch {
    return { ok: false, error: 'mailer request failed' };
  }
}
