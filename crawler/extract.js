// Hand-rolled HTML extraction. No DOM exists in the Workers runtime, and
// this project doesn't run `npm install` at deploy time (no build step, see
// CLAUDE.md), so a real HTML parser package isn't an option here any more
// than it was for functions/_lib/zip.js or vendor/remarker.js, same reason,
// same answer: hand-roll the small slice that's actually needed. This is
// not a spec-correct HTML5 parser, just enough regex-based extraction to
// pull title/description/body text/links out of real-world pages.

const MAX_BODY_TEXT_LENGTH = 8000;
const MAX_LINKS_PER_PAGE = 200;

const ENTITIES = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ',
  mdash: '—', ndash: '–', rsquo: '’', lsquo: '‘',
  rdquo: '”', ldquo: '“', hellip: '…',
};

function decodeEntities(text) {
  return String(text)
    .replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, code) => {
      if (code[0] === '#') {
        const isHex = code[1]?.toLowerCase() === 'x';
        const num = parseInt(code.slice(isHex ? 2 : 1), isHex ? 16 : 10);
        return Number.isNaN(num) ? match : String.fromCodePoint(num);
      }
      const key = code.toLowerCase();
      return key in ENTITIES ? ENTITIES[key] : match;
    });
}

function stripTags(html) {
  return decodeEntities(html.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function matchFirst(html, regex) {
  const m = html.match(regex);
  return m ? m[1] : null;
}

function matchAttr(tag, name) {
  // Attributes can appear in any order and with single, double, or no
  // quotes; this covers the common cases without a full attribute parser.
  const re = new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i');
  const m = tag.match(re);
  if (!m) return null;
  return m[2] ?? m[3] ?? m[4] ?? null;
}

function findMetaContent(html, metaName) {
  const metaTags = html.match(/<meta\b[^>]*>/gi) || [];
  for (const tag of metaTags) {
    const name = matchAttr(tag, 'name') || matchAttr(tag, 'property');
    if (name && name.toLowerCase() === metaName.toLowerCase()) {
      return matchAttr(tag, 'content');
    }
  }
  return null;
}

export function extractMetaRobots(html) {
  const content = (findMetaContent(html, 'robots') || '').toLowerCase();
  return {
    noindex: content.includes('noindex'),
    nofollow: content.includes('nofollow'),
  };
}

function removeBoilerplate(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<nav[\s\S]*?<\/nav>/gi, ' ')
    .replace(/<header[\s\S]*?<\/header>/gi, ' ')
    .replace(/<footer[\s\S]*?<\/footer>/gi, ' ');
}

export function extractPage(html, baseUrl) {
  const title = matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const h1 = matchFirst(html, /<h1[^>]*>([\s\S]*?)<\/h1>/i);
  const description = findMetaContent(html, 'description') || findMetaContent(html, 'og:description');

  const bodyHtml = removeBoilerplate(html);
  const bodyText = stripTags(bodyHtml).slice(0, MAX_BODY_TEXT_LENGTH);
  const wordCount = bodyText ? bodyText.split(/\s+/).filter(Boolean).length : 0;

  const links = [];
  const seen = new Set();
  const linkRe = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>/gi;
  let m;
  while ((m = linkRe.exec(html)) && links.length < MAX_LINKS_PER_PAGE) {
    const href = (m[2] ?? m[3] ?? '').trim();
    if (!href || href.startsWith('#') || href.startsWith('javascript:') || href.startsWith('mailto:')) continue;
    try {
      const resolved = new URL(href, baseUrl);
      if (resolved.protocol !== 'http:' && resolved.protocol !== 'https:') continue;
      resolved.hash = '';
      const normalized = resolved.href;
      if (seen.has(normalized)) continue;
      seen.add(normalized);
      links.push(normalized);
    } catch {
      // malformed href, skip it
    }
  }

  return {
    title: title ? decodeEntities(title).trim().slice(0, 300) : null,
    h1: h1 ? stripTags(h1).slice(0, 300) : null,
    description: description ? decodeEntities(description).trim().slice(0, 500) : null,
    bodyText,
    wordCount,
    links,
  };
}

// Simple heuristics, not a classifier: presence/frequency of a handful of
// tags and a few keyword checks. Multiple tags can apply; none is fine too.
const TAG_KEYWORDS = {
  portfolio: ['portfolio', 'my work', 'projects'],
  blog: ['blog', 'journal', 'posts'],
  art: ['gallery', 'illustration', 'artwork'],
  music: ['discography', 'album', 'soundcloud', 'bandcamp'],
  games: ['itch.io', 'gamejam', 'game jam'],
  resume: ['resume', 'cv', 'curriculum vitae'],
};

function countOccurrences(html, tagName) {
  const re = new RegExp(`<${tagName}\\b`, 'gi');
  return (html.match(re) || []).length;
}

export function inferTags(html, fields) {
  const tags = new Set();
  const haystack = `${fields.title || ''} ${fields.description || ''}`.toLowerCase();

  const imgCount = countOccurrences(html, 'img');
  const canvasCount = countOccurrences(html, 'canvas');
  const articleCount = countOccurrences(html, 'article');
  const audioVideoCount = countOccurrences(html, 'audio') + countOccurrences(html, 'video');

  if (canvasCount > 0) tags.add('art');
  if (imgCount >= 8 && fields.wordCount < imgCount * 30) tags.add('art');
  if (articleCount >= 2) tags.add('blog');
  if (audioVideoCount > 0) tags.add('media');

  for (const [tag, keywords] of Object.entries(TAG_KEYWORDS)) {
    if (keywords.some((k) => haystack.includes(k))) tags.add(tag);
  }

  return [...tags];
}
