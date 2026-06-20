// %placeholder substitution for admin-composed emails (one-off send,
// broadcast). Runs on the raw markdown source before it hits marked, so a
// substituted value is just plain text and gets escaped like any other
// text token, no separate escaping needed here.
//
// Only known placeholder names get replaced, anything else starting with
// % (a literal "50% off", a typo, whatever) passes through untouched, see
// the regex below: it only matches names in PLACEHOLDERS, not bare "%word".

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

// Obviously-fake but obviously-substituted values, used by the live preview
// endpoint where there's no real recipient yet. Real fallbacks ("User", "")
// would make it look like nothing happened.
export const SAMPLE_RECIPIENT = {
  username: 'sampleuser',
  email: 'sample@example.com',
  siteTitle: 'Sample Site',
  role: 'user',
};
