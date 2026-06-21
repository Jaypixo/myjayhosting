import { listSiteObjects, sanitizeFilePath } from '../../_lib/storage.js';
import { errorResponse } from '../../_lib/auth.js';
import { buildZip } from '../../_lib/zip.js';

// Whole-site export. Also doubles as "download selected": repeat ?key= for
// each file to zip a subset instead of everything (the dashboard's bulk
// download bar uses this), omit it entirely for the full site.
//
// Every object is fetched with its own env.SITES.get(), one subrequest each.
// Workers' free-plan subrequest cap (50/request) means a site with more than
// ~50 files can't be exported in one shot there; paid plans get 1000. Not
// worth pagination/streaming complexity for a Phase 1 feature bounded by a
// 50MB-total quota, most sites won't get near either limit.
export async function onRequestGet(context) {
  const { request, env, data } = context;
  const user = data.user;
  const prefix = `sites/${user.username}/`;

  const url = new URL(request.url);
  const requestedKeys = url.searchParams.getAll('key').map(sanitizeFilePath).filter(Boolean);

  const objects = await listSiteObjects(env, user.username);
  let wanted = objects.filter((o) => !o.key.endsWith('/.keep'));
  if (requestedKeys.length > 0) {
    const requestedSet = new Set(requestedKeys);
    wanted = wanted.filter((o) => requestedSet.has(o.key.slice(prefix.length)));
  }

  if (wanted.length === 0) {
    return errorResponse('Nothing to download yet.', 400);
  }

  const entries = [];
  for (const obj of wanted) {
    const got = await env.SITES.get(obj.key);
    if (!got) continue;
    entries.push({
      name: obj.key.slice(prefix.length),
      data: new Uint8Array(await got.arrayBuffer()),
      date: obj.uploaded,
    });
  }

  const zipBytes = buildZip(entries);

  return new Response(zipBytes, {
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${user.username}-myjay-site.zip"`,
      'Content-Length': String(zipBytes.length),
      'Cache-Control': 'no-cache, no-store',
    },
  });
}
