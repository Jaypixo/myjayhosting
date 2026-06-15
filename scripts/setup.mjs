#!/usr/bin/env node
// One-time setup helper: provisions the Cloudflare D1/R2/KV resources MyJay
// needs, then writes wrangler.toml / worker/wrangler.toml with the resulting
// IDs filled in. Run with `npm run setup`.
//
// This only talks to Cloudflare via `wrangler` using your already-authenticated
// account (run `npx wrangler login` first if needed). It creates real cloud
// resources, re-running it is safe (it detects existing resources by name
// and reuses them instead of creating duplicates).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function wrangler(args) {
  const result = spawnSync('npx', ['wrangler', ...args], {
    cwd: root,
    encoding: 'utf8',
    shell: true,
  });
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  };
}

function fail(message) {
  console.error(`\n✗ ${message}`);
  process.exit(1);
}

function section(title) {
  console.log(`\n:: ${title} ::`);
}

// --- 1. Confirm authentication ---------------------------------------------
section('Checking Cloudflare login');
const whoami = wrangler(['whoami']);
if (!whoami.ok || /not authenticated|not logged in/i.test(whoami.stdout)) {
  fail('Not logged in to Cloudflare. Run `npx wrangler login` first, then re-run `npm run setup`.');
}
const accountMatch = whoami.stdout.match(/([0-9a-f]{32})/i);
const accountId = accountMatch ? accountMatch[1] : null;
if (!accountId) {
  fail('Could not determine your Cloudflare account ID from `wrangler whoami`. Run it manually and check the output.');
}
console.log(`✓ Logged in. Account ID: ${accountId}`);

// --- 2. D1 database -----------------------------------------------------
section('D1 database (myjay-db)');
let databaseId = null;
{
  const create = wrangler(['d1', 'create', 'myjay-db']);
  const match = create.stdout.match(/database_id\s*=\s*"([^"]+)"/);
  if (match) {
    databaseId = match[1];
    console.log(`✓ Created myjay-db (${databaseId})`);
  } else {
    const list = wrangler(['d1', 'list', '--json']);
    try {
      const dbs = JSON.parse(list.stdout);
      const existing = dbs.find((db) => db.name === 'myjay-db');
      if (existing) {
        databaseId = existing.uuid;
        console.log(`✓ myjay-db already exists (${databaseId})`);
      }
    } catch {
      // fall through
    }
  }
  if (!databaseId) {
    fail('Could not create or find the "myjay-db" D1 database. Check the output of `npx wrangler d1 create myjay-db` manually.');
  }
}

// --- 3. R2 bucket ---------------------------------------------------------
section('R2 bucket (myjay-sites)');
{
  const create = wrangler(['r2', 'bucket', 'create', 'myjay-sites']);
  if (create.ok) {
    console.log('✓ Created bucket myjay-sites');
  } else if (/already exists/i.test(create.stderr + create.stdout)) {
    console.log('✓ Bucket myjay-sites already exists');
  } else {
    fail(`Could not create R2 bucket "myjay-sites":\n${create.stderr}`);
  }
}

// --- 4. KV namespace (sessions) --------------------------------------------
section('KV namespace (myjay-sessions)');
let kvId = null;
{
  const create = wrangler(['kv', 'namespace', 'create', 'myjay-sessions']);
  const match = create.stdout.match(/id\s*=\s*"([^"]+)"/);
  if (match) {
    kvId = match[1];
    console.log(`✓ Created KV namespace myjay-sessions (${kvId})`);
  } else {
    const list = wrangler(['kv', 'namespace', 'list']);
    try {
      const namespaces = JSON.parse(list.stdout);
      const existing = namespaces.find((ns) => ns.title === 'myjay-sessions' || ns.title.endsWith('-myjay-sessions'));
      if (existing) {
        kvId = existing.id;
        console.log(`✓ myjay-sessions already exists (${kvId})`);
      }
    } catch {
      // fall through
    }
  }
  if (!kvId) {
    fail('Could not create or find the "myjay-sessions" KV namespace. Check the output of `npx wrangler kv namespace create myjay-sessions` manually.');
  }
}

// --- 5. Admin email ---------------------------------------------------------
section('Configuration');
const rl = createInterface({ input: process.stdin, output: process.stdout });
let adminEmail = 'admin@example.com';
try {
  const answer = (await rl.question('Email address that should become the admin account: ')).trim();
  if (answer) adminEmail = answer;
} finally {
  rl.close();
}

// --- 6. Write wrangler.toml --------------------------------------------------
section('Writing wrangler.toml');
{
  const examplePath = path.join(root, 'wrangler.toml.example');
  const outPath = path.join(root, 'wrangler.toml');
  if (existsSync(outPath)) {
    console.log('• wrangler.toml already exists, leaving it untouched. Delete it and re-run `npm run setup` to regenerate.');
  } else {
    let toml = readFileSync(examplePath, 'utf8');
    toml = toml
      .replace('<your-cloudflare-account-id>', accountId)
      .replace('<your-d1-database-id>', databaseId)
      .replace('<your-kv-namespace-id>', kvId)
      .replace('<your-email@example.com>', adminEmail);
    writeFileSync(outPath, toml);
    console.log(`✓ Wrote wrangler.toml`);
  }
}

// --- 7. Write worker/wrangler.toml -------------------------------------------
section('Writing worker/wrangler.toml');
{
  const examplePath = path.join(root, 'worker', 'wrangler.toml.example');
  const outPath = path.join(root, 'worker', 'wrangler.toml');
  if (existsSync(outPath)) {
    console.log('• worker/wrangler.toml already exists, leaving it untouched.');
  } else {
    let toml = readFileSync(examplePath, 'utf8');
    toml = toml
      .replace('<your-cloudflare-account-id>', accountId)
      .replace('<your-d1-database-id>', databaseId);
    writeFileSync(outPath, toml);
    console.log(`✓ Wrote worker/wrangler.toml`);
  }
}

// --- 8. Apply D1 schema -------------------------------------------------------
section('Applying database schema');
{
  const apply = wrangler(['d1', 'execute', 'myjay-db', '--remote', '--file=schema/d1-init.sql']);
  if (apply.ok) {
    console.log('✓ Schema applied to myjay-db');
  } else {
    console.log(`• Could not apply schema automatically:\n${apply.stderr}`);
    console.log('  Run it yourself with: npm run db:init');
  }
}

// --- Done ----------------------------------------------------------------------
section('Next steps (manual, one-time, in the Cloudflare dashboard)');
console.log(`
1. Create the Pages project and connect it to your GitHub repo:
   Workers & Pages -> Create application -> Pages -> Connect to Git
     - Project name: myjay
     - Build output directory: public
     - Production branch: main

2. Add custom domains to the Pages project (Custom domains tab):
     - myjay.net
     - www.myjay.net (redirect to apex when prompted)

3. Set the session secret:
     npx wrangler pages secret put SESSION_SECRET --project-name myjay
   (generate a value with: openssl rand -hex 32)

4. Check Settings -> Functions -> Bindings on the Pages project. wrangler.toml
   usually populates these automatically on first deploy; if DB / SITES /
   SESSIONS / ADMIN_EMAIL / MAX_UPLOAD_BYTES aren't listed, add them manually
   (see README for the exact values).

5. Deploy the subdomain router worker and give it the *.myjay.net trigger:
     npm run router:deploy
   Then: Workers & Pages -> myjay-router -> Settings -> Triggers ->
   Custom Domains -> add *.myjay.net

You're set. Push to main (or run \`npm run deploy\`) to go live.
`);
