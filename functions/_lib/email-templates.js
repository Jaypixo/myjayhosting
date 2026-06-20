// Email templates: table-based layout, inline styles only, 600px max width.
// This is what actually renders correctly in Gmail/Outlook/etc, CSS classes
// and stylesheets get stripped or ignored by enough mail clients that
// they're not worth the risk here. Keep new templates inside this file and
// reusing baseLayout(), don't hand-roll a one-off HTML string elsewhere.

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
// logo: "MyJay" cream, ".net" orange), so it always shows up.
function wordmark() {
  return `<span style="font-family:${SERIF};font-style:italic;font-size:24px;line-height:1;">` +
    `<span style="color:${LOGO_CREAM};">MyJay</span><span style="color:${LOGO_ORANGE};">.net</span>` +
    `</span>`;
}

// Sign-off shown at the bottom of every email. Configurable from the admin
// panel's Email tab (functions/api/admin/email/signature.js), stored in the
// settings table, see _lib/settings.js. These are just the hardcoded
// fallbacks for when nothing's been saved yet.
const DEFAULT_SIGNATURE = { name: 'The MyJay Team', tagline: 'Your corner of the web.' };

// There's no dedicated Impressum page on this platform yet (that needs real
// legal entity details nobody's filled in), so the footer points at the
// terms page instead until one exists. Swap this if/when /impressum is real.
const LEGAL_URL = 'https://myjay.net/terms';

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function baseLayout({ subject = '', preheader = '', bodyHtml, unsubscribeUrl, signature }) {
  const sig = {
    name: signature?.name || DEFAULT_SIGNATURE.name,
    tagline: signature?.tagline ?? DEFAULT_SIGNATURE.tagline,
  };

  const unsubscribeRow = unsubscribeUrl
    ? `<a href="${unsubscribeUrl}" style="color:${MUTED};text-decoration:underline;">Unsubscribe</a> &middot; `
    : '';

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
            <td style="background-color:${TERRACOTTA};padding:22px 28px;" align="left">
              ${wordmark()}
            </td>
          </tr>
          <tr>
            <td style="padding:32px 28px;font-family:${MONO};font-size:15px;line-height:1.6;color:${INK};">
              ${bodyHtml}
            </td>
          </tr>
          <tr>
            <td style="padding:24px 28px 20px;border-top:1px solid #e5ddd2;">
              <div style="font-family:${SERIF};font-style:italic;font-size:16px;color:${INK};margin:0 0 2px;">&mdash; ${escapeHtml(sig.name)}</div>
              ${sig.tagline ? `<div style="font-family:${MONO};font-size:12px;color:${MUTED};margin:0 0 16px;">${escapeHtml(sig.tagline)}</div>` : '<div style="margin:0 0 16px;"></div>'}
              <div style="font-family:${MONO};font-size:12px;color:${MUTED};">
                ${unsubscribeRow}<a href="${LEGAL_URL}" style="color:${MUTED};text-decoration:underline;">Legal</a>
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
      bodyHtml: `<div style="white-space:pre-line;">${escapeHtml(body)}</div>`,
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
      bodyHtml: `<div style="white-space:pre-line;">${escapeHtml(body)}</div>`,
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
