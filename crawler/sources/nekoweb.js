// Nekoweb has no bulk site-listing surface at all: the public API
// (nekoapi.nekoweb.org) only exposes per-site lookups (e.g.
// /api/site/info/:sitename), and there's no /browse-equivalent or sitemap
// of user sites the way Neocities has. Per the spec's own fallback, this
// source does no bulk seeding: every Nekoweb site enters the index either
// through a manual submission (functions/api/search/submit.js, approved
// from the admin panel) or by being linked to from a page on another
// already-indexed site, which crawler.js's link-discovery handles
// uniformly for all three platforms, not just this one.
export async function seedJobs() {
  return [];
}
