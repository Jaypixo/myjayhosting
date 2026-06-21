// Email templates: table-based HTML, inline styles only, 600px width max.
// This is the ONLY way anything renders correctly across Gmail/Outlook/etc.
// CSS classes and stylesheets get fucked by enough clients that it's not worth the risk.

import remarker from './vendor/remarker.js';

const TERRACOTTA = '#c7522a';
const INK = '#1a1716';
const MUTED = '#7a6f63';
const PAPER = '#f5f0e8';
const MONO = "'Courier New', Courier, monospace";
const SERIF = "Georgia, 'Times New Roman', serif";
const LOGO_CREAM = '#e8dacb';
const LOGO_ORANGE = '#e25728';

// The header used to pull a remote logo image from myjay.net/assets.
// Most email clients block remote images by default, so unconfirmed emails
// looked completely blank at the top. Now it's real HTML text instead (same
// colors as the real logo: cream "MyJay" + orange ".net"). Background is dark
// ink, NOT terracotta, the site never puts orange text on orange backgrounds
// because that would be invisible. We're not stupid.
function wordmark() {
  return `<span style="font-family:${SERIF};font-style:italic;font-size:25px;line-height:1;">` +
    `<span style="color:${LOGO_CREAM};">MyJay</span><span style="color:${LOGO_ORANGE};">.net</span>` +
    `</span>`;
}

// Email sign-off at the bottom. Configurable from the admin Email tab
// (functions/api/admin/email/signature.js), stored in settings table.
// These are the fallbacks.
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

// Markdown for admin-composed bodies (one-off send, broadcast), via
// `remarker` (vendor/remarker.js), a from-scratch parser. **bold**/*italic*/
// lists/etc. render normally, and `breaks: true` turns single line breaks
// into <br> so plain text typed without blank lines between paragraphs
// still looks right, matching how the old plain-text composer behaved.
//
// There's no "button" link convention here (remarker has no renderer-
// override hook to hang one on, unlike the marked.js setup this replaced).
// A CTA button is just raw HTML pasted directly into the body instead, see
// the admin Compose UI's hint text for the exact snippet to copy. The
// canned templates that used to rely on `[label](url "button")` now embed
// that HTML directly, see migrate-005-email-templates.sql.
//
// Raw HTML in the body (that button snippet, an admin's own <table>, a
// <b>, whatever) passes through untouched, remarker doesn't sanitize by
// default and this is intentionally left that way: only admins can reach
// this composer, and they already have equivalent-or-greater trust
// elsewhere in this panel (ban/delete users, delete sites). It's the same
// reasoning as the SQL-injection note on broadcast segments not applying
// here, there's no privilege boundary being crossed, an admin's own
// composed email is already fully under their control.
function renderMarkdown(source) {
  return remarker.parse(String(source ?? ''), { gfm: true, breaks: true });
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

export function welcomeEmail(username, signature) {
  const siteUrl = `https://${username}.myjay.net`;
  const subject = 'Welcome to MyJay.net';
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: "You're verified, your subdomain is ready to go.",
      bodyHtml: `
        <p style="margin:0 0 16px;">You're verified. <strong>${escapeHtml(siteUrl)}</strong> is yours, upload something and publish whenever you're ready.</p>
        ${button('https://myjay.net/dashboard', 'Go to your dashboard')}
        <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">The <a href="https://myjay.net/docs/getting-started" style="color:${TERRACOTTA};">getting started guide</a> walks through uploading your first file.</p>
      `,
    }),
  };
}

export function storageWarning(siteLabel, percentUsed, signature) {
  const subject = 'Your MyJay.net site is close to its storage limit';
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: `${siteLabel} is at ${percentUsed}% of its storage limit.`,
      bodyHtml: `
        <p style="margin:0 0 16px;"><strong>${escapeHtml(siteLabel)}</strong> is now at ${percentUsed}% of its 50MB storage limit. Once it's full, new uploads will be rejected until you free up space.</p>
        ${button('https://myjay.net/dashboard', 'Manage your files')}
      `,
    }),
  };
}

export function storageLimitReached(siteLabel, signature) {
  const subject = `${siteLabel} has reached its storage limit`;
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: `${siteLabel} is full. New uploads will be rejected until you free up space.`,
      bodyHtml: `
        <p style="margin:0 0 16px;"><strong>${escapeHtml(siteLabel)}</strong> has hit its 50MB storage limit. New uploads will be rejected until you free up space.</p>
        ${button('https://myjay.net/dashboard', 'Manage your files')}
      `,
    }),
  };
}

export function sitePublished(username, signature) {
  const url = `https://${username}.myjay.net`;
  const subject = 'Your MyJay.net site is live';
  return {
    subject,
    html: baseLayout({
      subject,
      signature,
      preheader: `${url} is now live.`,
      bodyHtml: `
        <p style="margin:0 0 16px;"><strong>${escapeHtml(url)}</strong> is live now, anyone with the link can see it.</p>
        ${button(url, 'View your site')}
        <p style="margin:16px 0 0;font-size:13px;color:${MUTED};">You can unpublish any time from the dashboard, your files stay put either way.</p>
      `,
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
