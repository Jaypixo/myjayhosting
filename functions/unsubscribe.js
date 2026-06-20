// GET /unsubscribe?token=X&type=Y[&action=resub]. The type in the query
// string is only for display before we've verified anything; the actual
// write uses the type embedded in the signed token, never the raw query
// param, so nobody can edit the URL to unsubscribe a different category
// than they were sent. action=resub reverses it using that same token, so
// a misclick is one more click away from undone, not a trip to account
// settings, the token has no expiry so this works whenever someone notices.
import { verifyUnsubscribeToken } from './_lib/unsubscribe.js';

const TYPE_LABELS = {
  admin_message: 'admin messages',
  broadcast: 'announcements',
  blog_notification: 'blog post notifications',
};

function page({ title, heading, message, resubscribeUrl }) {
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
      <div style="display:flex;gap:0.75rem;justify-content:center;flex-wrap:wrap;margin-top:1rem;">
        ${resubscribeUrl ? `<a class="btn btn-sm" href="${resubscribeUrl}">Didn't mean to? Resubscribe</a>` : ''}
        <a class="btn btn-ghost btn-sm" href="/">Back to MyJay.net</a>
      </div>
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
  const url = new URL(request.url);
  const token = url.searchParams.get('token') || '';
  const resub = url.searchParams.get('action') === 'resub';

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
  const unsubscribed = resub ? 0 : 1;

  await env.DB.prepare(
    `INSERT INTO notification_prefs (user_id, type, unsubscribed, updated_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(user_id, type) DO UPDATE SET unsubscribed = excluded.unsubscribed, updated_at = excluded.updated_at`
  )
    .bind(userId, type, unsubscribed, new Date().toISOString())
    .run();

  const label = TYPE_LABELS[type] || type;

  if (resub) {
    const html = page({
      title: 'Resubscribed',
      heading: "You're back in.",
      message: `You'll get ${label} from MyJay.net again.`,
    });
    return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
  }

  const html = page({
    title: 'Unsubscribed',
    heading: 'Done.',
    message: `You won't get ${label} from MyJay.net anymore. This doesn't affect account emails like password resets or security alerts.`,
    resubscribeUrl: `/unsubscribe?token=${encodeURIComponent(token)}&action=resub`,
  });
  return new Response(html, { headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
