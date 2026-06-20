// %placeholder substitution for admin-composed emails (one-off send, broadcast).
// Runs on raw markdown BEFORE marked touches it, so substituted values are just
// plain text and get escaped like everything else. No extra escaping needed.
//
// Only known placeholders get replaced, anything else starting with %
// ("50% off", typos, whatever) passes through untouched. The regex below only
// matches names in PLACEHOLDERS, not bare %words.

const PLACEHOLDERS = {
  username: (r) => r.username || 'User',
  email: (r) => r.email || '',
  sitetitle: (r) => r.siteTitle || 'your site',
  role: (r) => r.role || 'user',
};

const PATTERN = new RegExp(`%(${Object.keys(PLACEHOLDERS).join('|')})\\b`, 'gi');

export function applyPlaceholders(text, recipient = {}) {
  return String(text ?? '').replace(PATTERN, (_match, name) => PLACEHOLDERS[name.toLowerCase()](recipient));
}

// Fake-but-obvious placeholder values for the live preview endpoint.
// No real recipient yet, so using real fallbacks ("User", empty string)
// would make it look like nothing actually got substituted.
export const SAMPLE_RECIPIENT = {
  username: 'sampleuser',
  email: 'sample@example.com',
  siteTitle: 'Sample Site',
  role: 'user',
};
