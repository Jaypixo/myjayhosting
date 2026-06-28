// D1 query helpers backing the public search API (functions/api/search/*).
// Pages-Functions-only (these assume env.DB is a D1 binding reachable the
// way Pages Functions reach it; the crawler Worker writes search_terms but
// never reads it through this module, see crawler/ for its own queries).
import { tokenize, parseQuery, levenshtein, highlightExcerpt } from './search-tokenize.js';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 50;
// A search box isn't a textarea: this bounds the IN-list/CASE-expression
// size for a pasted paragraph-length query, not normal sentence-length use.
const MAX_QUERY_TERMS = 25;

const FIELD_SCORE_SQL = `(CASE st.field WHEN 'title' THEN 5 WHEN 'description' THEN 3 ELSE 1 END)`;
// Large enough to dwarf even a worst-case term_score (a single very rare
// word at title weight with high idf can reach into the low thousands),
// so an exact phrase match always outranks a same-coverage non-phrase
// match, without ever excluding non-matching pages outright (a hard
// phrase filter risks zero results over something as small as
// punctuation; this is a bonus, not a requirement). parseQuery() treats
// any multi-word query as an implicit phrase candidate even with no
// quotes, so this applies far more often than just explicitly-quoted
// searches, see its comment for why.
const PHRASE_BONUS = 100000;

function placeholders(n) {
  return Array(n).fill('?').join(',');
}

// Inverse document frequency per query term, computed in JS rather than in
// SQL: D1's SQLite build doesn't reliably expose log()/ln(), so the
// log((N+1)/(df+1))+1 smoothed-IDF formula runs here instead, then gets
// passed into rankedSearch() as a per-term multiplier. Rare terms count for
// more than common ones, the standard TF-IDF idea, layered on top of the
// existing title/description/body field weighting. One extra query, cheap
// and bounded by the number of distinct query terms, not by index size.
async function getTermIdf(env, terms) {
  const [dfResult, totalResult] = await env.DB.batch([
    env.DB.prepare(`SELECT term, COUNT(DISTINCT page_id) AS df FROM search_terms WHERE term IN (${placeholders(terms.length)}) GROUP BY term`).bind(...terms),
    env.DB.prepare('SELECT COUNT(*) AS n FROM search_pages'),
  ]);
  const totalDocs = Math.max(1, totalResult.results[0]?.n || 1);
  const dfByTerm = new Map(dfResult.results.map((r) => [r.term, r.df]));
  const idf = new Map();
  for (const term of terms) {
    const df = dfByTerm.get(term) || 1;
    idf.set(term, Math.log((totalDocs + 1) / (df + 1)) + 1);
  }
  return idf;
}

// A single ranked pass over every page matching *any* query term (never a
// hard "must match all" filter, see below for why), joined to
// search_pages/search_sites. Filters are always bound via `?`, never
// interpolated.
//
// Sort order is the whole point: similarity (how much of the query a page
// covers, `matched_terms`) comes before relevance (`term_score +
// phrase_bonus`). A page matching 4 of a 5-word sentence outranks a page
// matching one rare word in that sentence, even though the rare word
// alone might score higher on weight*idf -- requiring every word (the old
// AND-then-OR-fallback design) made anything sentence-length almost never
// match anything at all, since real pages essentially never contain every
// single word of a typed sentence. Ranking by coverage first instead of
// filtering on it means a long query degrades gracefully: the best
// partial match still comes first, nothing returns zero results just
// because the query had seven words instead of two.
async function rankedSearch(env, terms, { phrase, idfByTerm, platform, tag, since, limit, offset }) {
  const params = [];
  const idfCase = terms.map(() => 'WHEN ? THEN ?').join(' ');
  let sql = `
    SELECT p.id, p.url, p.title, p.description, p.body_text, p.crawled_at, p.depth,
           s.platform, s.domain, s.title AS site_title,
           SUM(st.weight * ${FIELD_SCORE_SQL} * (CASE st.term ${idfCase} ELSE 1 END)) AS term_score,
  `;
  for (const term of terms) params.push(term, idfByTerm.get(term) || 1);

  if (phrase) {
    sql += ` MAX(CASE WHEN (p.title LIKE ? OR p.description LIKE ? OR p.body_text LIKE ?) THEN ${PHRASE_BONUS} ELSE 0 END) AS phrase_bonus,`;
    const likeParam = `%${phrase}%`;
    params.push(likeParam, likeParam, likeParam);
  } else {
    sql += ` 0 AS phrase_bonus,`;
  }

  sql += `
           COUNT(DISTINCT st.term) AS matched_terms
    FROM search_terms st
    JOIN search_pages p ON p.id = st.page_id
    JOIN search_sites s ON s.id = p.site_id
  `;
  if (tag) {
    sql += ` JOIN search_page_tags spt ON spt.page_id = p.id AND spt.tag = ?`;
    params.push(tag);
  }
  sql += ` WHERE st.term IN (${placeholders(terms.length)}) AND s.status = 'active'`;
  params.push(...terms);
  if (platform) {
    sql += ` AND s.platform = ?`;
    params.push(platform);
  }
  if (since) {
    sql += ` AND p.crawled_at >= ?`;
    params.push(since);
  }
  sql += ` GROUP BY p.id`;

  const countResult = await env.DB.prepare(
    `SELECT COUNT(*) AS total FROM (${sql})`
  ).bind(...params).first();

  sql += ` ORDER BY matched_terms DESC, (term_score + phrase_bonus) DESC LIMIT ? OFFSET ?`;
  const rowsResult = await env.DB.prepare(sql).bind(...params, limit, offset).all();

  return { total: countResult?.total || 0, rows: rowsResult.results };
}

export async function searchPages(env, query, { platform, tag, since, page = 1, pageSize = DEFAULT_PAGE_SIZE } = {}) {
  const parsed = parseQuery(query);
  const phrase = parsed.phrase;
  const terms = parsed.terms.slice(0, MAX_QUERY_TERMS);
  const limit = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  const offset = (Math.max(1, page) - 1) * limit;

  if (terms.length === 0) {
    return { results: [], total: 0, terms, usedFallback: false };
  }

  const idfByTerm = await getTermIdf(env, terms);
  const { total, rows } = await rankedSearch(env, terms, { phrase, idfByTerm, platform, tag, since, limit, offset });

  const highlightTerms = phrase ? [...terms, phrase] : terms;
  const results = rows.map((row) => ({
    url: row.url,
    title: row.title || row.url,
    excerpt: highlightExcerpt(row.body_text || row.description || '', highlightTerms),
    platform: row.platform,
    domain: row.domain,
    lastIndexedAt: row.crawled_at,
    score: row.term_score + row.phrase_bonus,
    matchedTerms: row.matched_terms,
  }));

  // Still meaningful even without the old two-query design: true whenever
  // even the best result didn't cover every term, i.e. this is the
  // closest match available, not a complete one.
  const usedFallback = results.length > 0 && results[0].matchedTerms < terms.length;

  return { results, total, terms, usedFallback };
}

// Candidate terms for "did you mean": same first letter, similar length,
// pulled from the index itself so a suggestion is always something that
// would actually return results.
export async function suggestCorrection(env, query) {
  const terms = tokenize(query);
  if (terms.length !== 1) return null; // only single-word queries get a suggestion
  const [term] = terms;

  const { results } = await env.DB.prepare(
    `SELECT DISTINCT term FROM search_terms
     WHERE term LIKE ? AND length(term) BETWEEN ? AND ?
     LIMIT 300`
  ).bind(`${term[0]}%`, term.length - 2, term.length + 2).all();

  let best = null;
  let bestDistance = Infinity;
  for (const row of results) {
    if (row.term === term) return null; // exact match exists, no correction needed
    const distance = levenshtein(term, row.term);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row.term;
    }
  }
  return bestDistance > 0 && bestDistance <= 2 ? best : null;
}

export async function getAutocomplete(env, prefix, limit = 8) {
  const normalized = String(prefix || '').toLowerCase().replace(/[^a-z0-9']/g, '');
  if (normalized.length < 2) return [];
  const { results } = await env.DB.prepare(
    `SELECT term, COUNT(DISTINCT page_id) AS doc_count
     FROM search_terms
     WHERE term LIKE ?
     GROUP BY term
     ORDER BY doc_count DESC
     LIMIT ?`
  ).bind(`${normalized}%`, limit).all();
  return results.map((r) => r.term);
}

export async function getRandomPage(env, { platform } = {}) {
  let sql = `
    SELECT p.url, p.title, s.platform, s.domain
    FROM search_pages p JOIN search_sites s ON s.id = p.site_id
    WHERE s.status = 'active'
  `;
  const params = [];
  if (platform) {
    sql += ' AND s.platform = ?';
    params.push(platform);
  }
  sql += ' ORDER BY RANDOM() LIMIT 1';
  return env.DB.prepare(sql).bind(...params).first();
}

export async function getRecentPages(env, { platform, tag, limit = 24, offset = 0 } = {}) {
  let sql = `
    SELECT p.id, p.url, p.title, p.description, p.crawled_at, s.platform, s.domain
    FROM search_pages p JOIN search_sites s ON s.id = p.site_id
  `;
  const params = [];
  if (tag) {
    sql += ' JOIN search_page_tags spt ON spt.page_id = p.id AND spt.tag = ?';
    params.push(tag);
  }
  sql += " WHERE s.status = 'active'";
  if (platform) {
    sql += ' AND s.platform = ?';
    params.push(platform);
  }
  sql += ' ORDER BY p.crawled_at DESC LIMIT ? OFFSET ?';
  params.push(Math.min(MAX_PAGE_SIZE, limit), offset);
  const { results } = await env.DB.prepare(sql).bind(...params).all();
  return results;
}

export async function getTagCounts(env) {
  const { results } = await env.DB.prepare(`
    SELECT spt.tag, COUNT(*) AS count
    FROM search_page_tags spt
    JOIN search_pages p ON p.id = spt.page_id
    JOIN search_sites s ON s.id = p.site_id
    WHERE s.status = 'active'
    GROUP BY spt.tag
    ORDER BY count DESC
  `).all();
  return results;
}

export async function getSimilarPages(env, pageUrl, limit = 6) {
  const page = await env.DB.prepare(
    `SELECT p.id, s.platform FROM search_pages p JOIN search_sites s ON s.id = p.site_id WHERE p.url = ?`
  ).bind(pageUrl).first();
  if (!page) return [];

  const { results: tagRows } = await env.DB.prepare(
    'SELECT tag FROM search_page_tags WHERE page_id = ?'
  ).bind(page.id).all();
  const tags = tagRows.map((r) => r.tag);

  if (tags.length > 0) {
    const { results } = await env.DB.prepare(`
      SELECT p.url, p.title, p.description, s.platform, s.domain, COUNT(*) AS overlap
      FROM search_page_tags spt
      JOIN search_pages p ON p.id = spt.page_id
      JOIN search_sites s ON s.id = p.site_id
      WHERE spt.tag IN (${placeholders(tags.length)}) AND p.id != ? AND s.status = 'active'
      GROUP BY p.id
      ORDER BY overlap DESC, p.crawled_at DESC
      LIMIT ?
    `).bind(...tags, page.id, limit).all();
    if (results.length > 0) return results;
  }

  const { results: fallback } = await env.DB.prepare(`
    SELECT p.url, p.title, p.description, s.platform, s.domain
    FROM search_pages p JOIN search_sites s ON s.id = p.site_id
    WHERE s.platform = ? AND p.id != ? AND s.status = 'active'
    ORDER BY p.crawled_at DESC LIMIT ?
  `).bind(page.platform, page.id, limit).all();
  return fallback;
}

export async function getPublicStats(env) {
  const totals = await env.DB.prepare(`
    SELECT
      (SELECT COUNT(*) FROM search_sites WHERE status = 'active') AS total_sites,
      (SELECT COUNT(*) FROM search_pages) AS total_pages
  `).first();
  const { results: platforms } = await env.DB.prepare(`
    SELECT platform, COUNT(*) AS sites, MAX(last_crawled_at) AS last_crawled_at
    FROM search_sites WHERE status = 'active' GROUP BY platform
  `).all();
  return {
    totalSites: totals.total_sites,
    totalPages: totals.total_pages,
    platforms,
  };
}

export async function logSearchQuery(env, query, resultCount) {
  try {
    await env.DB.prepare(
      'INSERT INTO search_queries_log (id, query, result_count, created_at) VALUES (?, ?, ?, ?)'
    ).bind(crypto.randomUUID(), query.slice(0, 200), resultCount, new Date().toISOString()).run();
  } catch {
    // Analytics-only, never block a search response over a logging failure.
  }
}
