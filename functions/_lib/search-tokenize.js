// Shared, pure tokenizer for the search index. Imported by both the search
// API (functions/api/search/*, to normalize a query into lookup terms) and
// the crawler Worker (crawler/, to build search_terms rows at index time),
// via a relative import that crosses the Pages Functions / Worker project
// boundary on purpose: this has to stay byte-identical on both sides, or
// indexed terms and query terms silently stop matching. See CLAUDE.md's
// "Indie Web Search Engine" section. No I/O, no env, safe to run anywhere
// (including a plain Node script for local testing).

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'for',
  'from', 'had', 'has', 'have', 'he', 'her', 'his', 'i', 'if', 'in', 'into',
  'is', 'it', 'its', 'me', 'my', 'no', 'not', 'of', 'on', 'or', 'our', 'she',
  'so', 'than', 'that', 'the', 'their', 'them', 'then', 'there', 'these',
  'they', 'this', 'to', 'too', 'was', 'we', 'were', 'what', 'when', 'which',
  'who', 'will', 'with', 'you', 'your',
]);

const MIN_TERM_LENGTH = 2;
const MAX_TERM_LENGTH = 40;

// Crawled pages overwhelmingly use typographic ('smart') quotes (from CMSes,
// word processors, auto-conversion), while a query typed on a plain
// keyboard almost always uses straight quotes. Without normalizing both to
// the same character first, "don't" indexed from a page (with U+2019) and
// "don't" typed in the search box (with U+0027) tokenize to different
// strings and never match, this was reported as search "completely
// failing" on anything with an apostrophe or quote in it. Both the indexer
// and the query path run text through this before anything else.
export function normalizeQuotes(text) {
  return String(text)
    .replace(/[‘’ʼʻ]/g, "'")
    .replace(/[“”]/g, '"');
}

// Splits on anything that isn't a letter, digit, or apostrophe (so
// contractions like "don't" survive as one token), lowercases, and drops
// stopwords/too-short/too-long tokens. Both the indexer and the query path
// call this and nothing else, so they're guaranteed to agree on what a
// "term" is.
export function tokenize(text) {
  if (!text) return [];
  const raw = normalizeQuotes(text)
    .toLowerCase()
    .split(/[^a-z0-9']+/i)
    .map((t) => t.replace(/^'+|'+$/g, '')); // strip leading/trailing quotes, keep internal ones
  const tokens = [];
  for (const t of raw) {
    if (t.length < MIN_TERM_LENGTH || t.length > MAX_TERM_LENGTH) continue;
    if (STOPWORDS.has(t)) continue;
    tokens.push(t);
  }
  return tokens;
}

// A query like `"old web" zine` is a phrase ("old web", matched as a
// contiguous substring) plus an ordinary term (zine). Only the search API
// calls this, the crawler never parses a "query", it only ever tokenizes
// plain page text. Returns the phrase lowercased and quote-normalized (for
// a literal substring check against stored field text) alongside the full
// term list (phrase words included) so a quoted query still benefits from
// the normal inverted-index lookup instead of requiring a table scan.
export function parseQuery(rawQuery) {
  const normalized = normalizeQuotes(rawQuery || '');
  const phraseMatch = normalized.match(/"([^"]+)"/);
  if (!phraseMatch || !phraseMatch[1].trim()) {
    return { phrase: null, terms: [...new Set(tokenize(normalized))] };
  }
  const phrase = phraseMatch[1].trim().toLowerCase();
  const remainder = normalized.slice(0, phraseMatch.index) + normalized.slice(phraseMatch.index + phraseMatch[0].length);
  const terms = [...new Set([...tokenize(phrase), ...tokenize(remainder)])];
  return { phrase, terms };
}

// Term -> frequency within one field's text, clamped at `cap` so a page
// that repeats one word hundreds of times (keyword stuffing, accidental or
// not) can't dominate ranking purely on volume.
export function termWeights(text, cap = 50) {
  const counts = new Map();
  for (const term of tokenize(text)) {
    counts.set(term, Math.min(cap, (counts.get(term) || 0) + 1));
  }
  return counts;
}

// Levenshtein edit distance, used only for "did you mean" against a small
// candidate set (same first letter, similar length) on zero-result queries.
// Plain O(n*m) dynamic programming, fine at the word lengths this runs against.
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;

  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const curr = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,      // deletion
        curr[j - 1] + 1,  // insertion
        prev[j - 1] + cost // substitution
      );
    }
    prev = curr;
  }
  return prev[b.length];
}

// HTML-escape, then wrap (already-escaped) term matches in <mark>. Crawled
// body text is third-party content; it must never reach innerHTML on
// myjay.net unescaped, or a crawled page could plant markup that runs in
// our own search results. This is the only function in this module allowed
// to produce HTML, and it always escapes first.
export function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function highlightExcerpt(text, terms, { radius = 100, maxLength = 220 } = {}) {
  const source = String(text || '');
  if (!source) return '';

  const lowerSource = source.toLowerCase();
  let matchIndex = -1;
  let matchLength = 0;
  for (const term of terms) {
    const idx = lowerSource.indexOf(term.toLowerCase());
    if (idx !== -1 && (matchIndex === -1 || idx < matchIndex)) {
      matchIndex = idx;
      matchLength = term.length;
    }
  }

  let start = 0;
  let end = Math.min(source.length, maxLength);
  if (matchIndex !== -1) {
    start = Math.max(0, matchIndex - radius);
    end = Math.min(source.length, matchIndex + matchLength + radius);
  }

  let snippet = source.slice(start, end);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < source.length ? '…' : '';

  // Escape first, then highlight, so the escaping can't itself be undone
  // by a term that happens to look like markup.
  let escaped = escapeHtml(snippet);
  const sortedTerms = [...terms].sort((a, b) => b.length - a.length);
  for (const term of sortedTerms) {
    if (!term) continue;
    const escapedTerm = escapeHtml(term);
    const re = new RegExp(`(${escapedTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'ig');
    escaped = escaped.replace(re, '<mark>$1</mark>');
  }

  return `${prefix}${escaped}${suffix}`;
}
