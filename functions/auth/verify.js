// GET /auth/verify?token=X. Clicked from the verification email. Marks the
// account verified and consumes the token in one shot, then shows a plain
// result page. No JSON round-trip needed, this route does the work directly.

import { sendEmail } from '../_lib/mailer.js';
import { getEmailSignature } from '../_lib/settings.js';
import { welcomeEmail } from '../_lib/email-templates.js';

function page({ title, heading, message, ctaHref, ctaText }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} | MyJay.net</title>
  <meta name="robots" content="noindex">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link href="https://fonts.googleapis.com/css2?family=Crimson+Pro:ital,wght@1,300&family=IBM+Plex+Mono:wght@400;500&family=Inter:wght@300;400;500&display=swap" rel="stylesheet">
  <link rel="icon" type="image/png" href="/assets/img/favicon.png">
  <link rel="stylesheet" href="/assets/style.css">
</head>
<body>
  <header class="torn-header compact">
    <div class="logo">
      <img src="/assets/img/logo.png" alt="MyJay.net" onerror="var s=this.nextElementSibling; this.remove(); s.style.display=''">
      <span class="logo-fallback" style="display:none"><span class="myjay">MyJay</span><span class="dotnet">.net</span></span>
    </div>
  </header>
  <main class="wrapper">
    <section class="auth-section">
      <h1>${heading}</h1>
      <p class="text-muted">${message}</p>
      <a class="btn mt-1" href="${ctaHref}">${ctaText}</a>
    </section>
  </main>
  <footer class="footer">
    <span class="footnote">[2] v0.1.0-alpha, independently run.</span>
  </footer>
  <script type="module" src="/assets/main.js"></script>
</body>
</html>`;
}

export async function onRequestGet(context) {
  const { request, env } = context;
  const token = new URL(request.url).searchParams.get('token') || '';

  const userId = token ? await env.SESSIONS.get(`verify:${token}`) : null;

  if (!userId) {
    const html = page({
      title: 'Verification link invalid',
      heading: "That link didn't work.",
      message: "It may have expired (links last 24 hours) or already been used. Log in and you'll be offered a fresh one.",
      ctaHref: '/login',
      ctaText: 'Back to login →',
    });
    return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  await env.DB.prepare('UPDATE users SET email_verified = 1 WHERE id = ?').bind(userId).run();
  await env.SESSIONS.delete(`verify:${token}`);

  // Welcome email is a one-time thing, fired right off the back of
  // verification succeeding rather than at signup, since signup is the
  // moment we DON'T yet know the address is real.
  const user = await env.DB.prepare('SELECT email, username FROM users WHERE id = ?').bind(userId).first();
  if (user) {
    const signature = await getEmailSignature(env);
    const { subject, html: bodyHtml } = welcomeEmail(user.username, signature);
    await sendEmail(env, { to: user.email, type: 'welcome', subject, bodyHtml, userId });
  }

  const html = page({
    title: 'Email verified',
    heading: 'Email verified.',
    message: "You're all set. You can log in now.",
    ctaHref: '/login',
    ctaText: 'Log in →',
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
