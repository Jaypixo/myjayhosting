// GET /unsubscribe?token=X&type=Y. The type in the query string is only
// for display before we've verified anything; the actual write uses the
// type embedded in the signed token, never the raw query param, so nobody
// can edit the URL to unsubscribe a different category than they were sent.
import { verifyUnsubscribeToken } from './_lib/unsubscribe.js';

const TYPE_LABELS = {
  admin_message: 'admin messages',
  broadcast: 'announcements',
  blog_notification: 'blog post notifications',
};

function page({ title, heading, message }) {
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
      <a class="btn btn-ghost mt-1" href="/">Back to MyJay.net</a>
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

  const verified = await verifyUnsubscribeToken(env, token);
  if (!verified) {
    const html = page({
      title: 'Link invalid',
      heading: "That link didn't work.",
      message: 'It may be malformed or out of date. Manage your notification preferences from your account settings instead.',
    });
    return new Response(html, { status: 400, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const { userId, type } = verified;
  await env.DB.prepare(
    `INSERT INTO notification_prefs (user_id, type, unsubscribed, updated_at)
     VALUES (?, ?, 1, ?)
     ON CONFLICT(user_id, type) DO UPDATE SET unsubscribed = 1, updated_at = excluded.updated_at`
  )
    .bind(userId, type, new Date().toISOString())
    .run();

  const label = TYPE_LABELS[type] || type;
  const html = page({
    title: 'Unsubscribed',
    heading: 'Done.',
    message: `You won't get ${label} from MyJay.net anymore. This doesn't affect account emails like password resets or security alerts.`,
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
