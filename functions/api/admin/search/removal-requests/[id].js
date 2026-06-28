import { json, errorResponse } from '../../../../_lib/auth.js';

// Approving doesn't just hide the site, it purges it: removal is meant to
// actually remove, not leave a blocked-but-still-stored copy lying around.
export async function onRequestPatch(context) {
  const { request, env, params, data } = context;
  const reqRow = await env.DB.prepare('SELECT * FROM removal_requests WHERE id = ?').bind(params.id).first();
  if (!reqRow) return errorResponse('Not found', 404);

  let body;
  try {
    body = await request.json();
  } catch {
    return errorResponse('Invalid JSON body', 400);
  }
  if (body.action !== 'approve' && body.action !== 'deny') {
    return errorResponse('action must be approve or deny', 400);
  }

  const now = new Date().toISOString();

  if (body.action === 'approve') {
    let domain;
    try {
      domain = new URL(reqRow.url).hostname.toLowerCase();
    } catch {
      domain = null;
    }

    if (domain) {
      const site = await env.DB.prepare('SELECT id FROM search_sites WHERE domain = ?').bind(domain).first();
      const stmts = [
        env.DB.prepare(
          'INSERT OR IGNORE INTO blocklist (id, domain, reason, source, added_by, added_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(crypto.randomUUID(), domain, reqRow.reason, 'removal_request', data.user.email, now),
      ];
      if (site) {
        stmts.push(
          env.DB.prepare("UPDATE search_sites SET status = 'blocked' WHERE id = ?").bind(site.id),
          env.DB.prepare('DELETE FROM search_terms WHERE page_id IN (SELECT id FROM search_pages WHERE site_id = ?)').bind(site.id),
          env.DB.prepare('DELETE FROM search_page_tags WHERE page_id IN (SELECT id FROM search_pages WHERE site_id = ?)').bind(site.id),
          env.DB.prepare('DELETE FROM search_links WHERE from_page_id IN (SELECT id FROM search_pages WHERE site_id = ?)').bind(site.id),
          env.DB.prepare('DELETE FROM search_pages WHERE site_id = ?').bind(site.id)
        );
      }
      await env.DB.batch(stmts);
    }
  }

  await env.DB.prepare(
    'UPDATE removal_requests SET status = ?, resolved_at = ?, resolved_by = ? WHERE id = ?'
  ).bind(body.action === 'approve' ? 'approved' : 'denied', now, data.user.email, params.id).run();

  return json({ ok: true });
}
