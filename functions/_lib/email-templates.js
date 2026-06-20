// Email templates: table-based layout, inline styles only, 600px max width.
// This is what actually renders correctly in Gmail/Outlook/etc, CSS classes
// and stylesheets get stripped or ignored by enough mail clients that
// they're not worth the risk here. Keep new templates inside this file and
// reusing baseLayout(), don't hand-roll a one-off HTML string elsewhere.

import { Marked } from './vendor/marked.js';

const TERRACOTTA = '#c7522a';
const INK = '#1a1716';
const MUTED = '#7a6f63';
const PAPER = '#f5f0e8';
const MONO = "'Courier New', Courier, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";
const LOGO_CREAM = '#e8dacb';
const LOGO_ORANGE = '#e25728';

// The header used to be a single <img> pulling the logo from myjay.net/assets.
// Most clients block remote images by default, so an unopened "display
// images" email looked completely blank at the top, no brand, nothing. This
// renders the wordmark as real HTML text instead (same colors as the actual
// logo: "MyJay" cream, ".net" orange). The background behind it has to be
// the dark ink color, not terracotta, the real site never puts the orange
// ".net" on an orange/terracotta background either, same color on same
// color is illegible regardless of which one it technically is.
function wordmark() {
  return `<span style="font-family:${SERIF};font-style:italic;font-size:25px;line-height:1;">` +
    `<span style="color:${LOGO_CREAM};">MyJay</span><span style="color:${LOGO_ORANGE};">.net</span>` +
    `</span>`;
}

// Sign-off shown at the bottom of every email. Configurable from the admin
// panel's Email tab (functions/api/admin/email/signature.js), stored in the
// settings table, see _lib/settings.js. These are just the hardcoded
// fallbacks for when nothing's been saved yet.
const DEFAULT_SIGNATURE = { name: 'The MyJay Team', tagline: 'Your corner of the web.' };

const HOME_URL = 'https://myjay.net';
const CONTACT_URL = 'https://myjay.net/contact';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function footerLink(href, label) {
  return `<a href="${href}" style="color:${MUTED};text-decoration:underline;">${label}</a>`;
}

function baseLayout({ subject = '', preheader = '', bodyHtml, unsubscribeUrl, signature }) {
  const sig = {
    name: signature?.name || DEFAULT_SIGNATURE.name,
    tagline: signature?.tagline ?? DEFAULT_SIGNATURE.tagline,
  };

  const footerLinks = [footerLink(HOME_URL, 'myjay.net'), footerLink(CONTACT_URL, 'Contact')];
  if (unsubscribeUrl) footerLinks.push(footerLink(unsubscribeUrl, 'Unsubscribe'));

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${PAPER};">
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:${PAPER};">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:100%;background-color:#ffffff;">
          <tr>
            <td style="background-color:${INK};padding:24px 28px;" align="left">
              ${wordmark()}
            </td>
          </tr>
          <tr>
            <td style="background-color:${TERRACOTTA};height:4px;line-height:4px;font-size:0;">&nbsp;</td>
          </tr>
          <tr>
            <td style="padding:32px 28px;font-family:${MONO};font-size:15px;line-height:1.6;color:${INK};">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 20px;border-top:1px solid #e5ddd2;">
              <div style="font-family:${SERIF};font-style:italic;font-size:16px;color:${INK};margin:0 0 2px;">${escapeHtml(sig.name)}</div>
              ${sig.tagline ? `<div style="font-family:${MONO};font-size:12px;color:${MUTED};margin:0 0 16px;">${escapeHtml(sig.tagline)}</div>` : '<div style="margin:0 0 16px;"></div>'}
              <div style="font-family:${MONO};font-size:12px;color:${MUTED};">
                ${footerLinks.join(' &middot; ')}
                <div style="margin-top:8px;">&copy; MyJay.net</div>
              </div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function button(url, label) {
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0;">
    <tr>
      <td style="background-color:${TERRACOTTA};">
        <a href="${url}" style="display:inline-block;padding:12px 24px;font-family:${MONO};font-size:14px;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`;
}

// Markdown for admin-composed bodies (one-off send, broadcast), via the real
// `marked` library, not a hand-rolled subset. **bold**/*italic*/lists/etc.
// render normally, and `breaks: true` turns single line breaks into <br>
// so plain text typed without blank lines between paragraphs still looks
// right, matching how the old plain-text composer behaved.
//
// The only renderer override is `link`: a markdown link whose title is
// literally "button" (`[Click here](https://example.com "button")`) renders
// as the same terracotta CTA button used elsewhere in these templates,
// instead of a plain inline link. Document this convention in the admin
// Compose UI, it's not discoverable otherwise.
//
// Raw HTML in the body (an admin pasting their own <table> button, a <b>,
// whatever) passes through untouched, marked doesn't sanitize by default
// and this is intentionally left that way: only admins can reach this
// composer, and they already have equivalent-or-greater trust elsewhere in
// this panel (ban/delete users, delete sites). It's the same reasoning as
// the SQL-injection note on broadcast segments not applying here, there's
// no privilege boundary being crossed, an admin's own composed email is
// already fully under their control.
const markdown = new Marked({
  gfm: true,
  breaks: true,
  renderer: {
    link(token) {
      const href = escapeHtml(token.href || '');
      if ((token.title || '').trim().toLowerCase() === 'button') {
        return button(href, token.text);
      }
      const label = this.parser.parseInline(token.tokens);
      return `<a href="${href}" style="color:${TERRACOTTA};text-decoration:underline;">${label}</a>`;
    },
  },
});

function renderMarkdown(source) {
  return markdown.parse(String(source ?? ''));
}

export function verifyEmail(token, signature) {
  const url = `https://myjay.net/auth/verify?token=${encodeURIComponent(token)}`;
  const subject = 'Confirm your MyJay.net account';
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: 'Confirm your email to finish setting up your account.',
      bodyHtml: `
        <p style="margin:0 0 16px;">One step left: confirm this is your email address.</p>
        ${button(url, 'Verify email address')}
        <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">Or paste this into your browser: ${escapeHtml(url)}</p>
        <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">This link expires in 24 hours. If you didn't create a MyJay.net account, you can ignore this email.</p>
      `,
    }),
  };
}

export function passwordReset(token, signature) {
  const url = `https://myjay.net/auth/reset?token=${encodeURIComponent(token)}`;
  const subject = 'Reset your MyJay.net password';
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: 'Reset your password.',
      bodyHtml: `
        <p style="margin:0 0 16px;">Someone (hopefully you) asked to reset the password on this account.</p>
        ${button(url, 'Reset password')}
        <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">Or paste this into your browser: ${escapeHtml(url)}</p>
        <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">This link expires in 1 hour. If you didn't request this, your password hasn't changed and you can ignore this email.</p>
      `,
    }),
  };
}

export function securityAlert(event, ip, location, signature) {
  const subject = `Security notice: ${event}`;
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: `Security notice for your account: ${event}`,
      bodyHtml: `
        <p style="margin:0 0 16px;">This is an automatic notice about a security-relevant event on your account.</p>
        <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;font-size:14px;margin:0 0 16px;">
          <tr><td style="padding:4px 0;color:${MUTED};width:90px;">Event</td><td style="padding:4px 0;">${escapeHtml(event)}</td></tr>
          <tr><td style="padding:4px 0;color:${MUTED};">IP address</td><td style="padding:4px 0;">${escapeHtml(ip || 'unknown')}</td></tr>
          <tr><td style="padding:4px 0;color:${MUTED};">Location</td><td style="padding:4px 0;">${escapeHtml(location || 'unknown')}</td></tr>
        </table>
        <p style="margin:0;font-size:13px;color:${MUTED};">If this wasn't you, change your password from the dashboard and <a href="https://myjay.net/contact" style="color:${TERRACOTTA};">get in touch</a>.</p>
      `,
    }),
  };
}

export function adminMessage(subject, body, signature) {
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: subject,
      bodyHtml: renderMarkdown(body),
    }),
  };
}

export function broadcastAnnouncement(subject, body, unsubscribeUrl, signature) {
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: subject,
      bodyHtml: renderMarkdown(body),
      unsubscribeUrl,
    }),
  };
}

export function blogNotification(siteName, postTitle, postUrl, unsubscribeUrl, signature) {
  const subject = `${siteName} just posted: ${postTitle}`;
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: `New post from ${siteName}: ${postTitle}`,
      bodyHtml: `
        <p style="margin:0 0 16px;"><strong>${escapeHtml(siteName)}</strong> just published something new.</p>
        <p style="margin:0 0 16px;font-size:17px;">${escapeHtml(postTitle)}</p>
        ${button(postUrl, 'Read it')}
      `,
      unsubscribeUrl,
    }),
  };
}
