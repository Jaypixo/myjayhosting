import { json, errorResponse } from '../../../../_lib/auth.js';

// Removes one page from the index without blocklisting its whole domain.
// Not durable against re-crawling: if the site isn't blocked and the page
// is still linked from somewhere, the next crawl run re-discovers and
// re-adds it. For a page that should stay gone, block the domain instead.
export async function onRequestDelete(context) {
  const { env, params } = context;
  const page = await env.DB.prepare('SELECT id FROM search_pages WHERE id = ?').bind(params.id).first();
  if (!page) return errorResponse('Page not found', 404);

  await env.DB.batch([
    env.DB.prepare('DELETE FROM search_terms WHERE page_id = ?').bind(page.id),
    env.DB.prepare('DELETE FROM search_page_tags WHERE page_id = ?').bind(page.id),
    env.DB.prepare('DELETE FROM search_links WHERE from_page_id = ?').bind(page.id),
    env.DB.prepare('DELETE FROM search_pages WHERE id = ?').bind(page.id),
  ]);

  return json({ ok: true });
}
