// MyJay seeds straight from its own D1 `sites` table, same database the
// crawler Worker is bound to, no HTTP round-trip needed for discovery.
// Respects the publish flag and the per-site opt-out toggle (schema/
// migrate-008-search-engine.sql), exactly like the subdomain router does.
export async function seedJobs(env, { full }) {
  let sql = 'SELECT username FROM sites WHERE published = 1 AND search_opt_out = 0';
  if (!full) {
    // Incremental: only sites that changed recently. The window is wider
    // than the daily cadence on purpose, so a missed run doesn't leave a
    // gap nothing ever re-checks.
    sql += " AND updated_at >= datetime('now', '-2 days')";
  }
  const { results } = await env.DB.prepare(sql).all();
  return results.map((row) => ({
    domain: `${row.username}.myjay.net`,
    rootUrl: `https://${row.username}.myjay.net/`,
  }));
}
