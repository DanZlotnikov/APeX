#!/usr/bin/env node
/**
 * APeX full setup script — runs migrations then seeds dev data.
 * Run from mobile/: node scripts/run_all.js
 */

const fs   = require('fs');
const path = require('path');

// ── Load .env ─────────────────────────────────────────────────────────────────
const envFile = path.join(__dirname, '..', '.env');
for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
  const eq = line.indexOf('=');
  if (eq < 0) continue;
  const k = line.slice(0, eq).trim();
  const v = line.slice(eq + 1).trim();
  if (k && !process.env[k]) process.env[k] = v;
}

const SUPABASE_URL      = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY  = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('Missing env vars in mobile/.env');
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');
const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// ── SQL runner via PostgREST v12 SQL endpoint ─────────────────────────────────
async function execSQL(label, sql) {
  process.stdout.write(`  Running ${label}... `);
  const res = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/sql',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey':        SERVICE_ROLE_KEY,
      'Prefer':        'tx=commit',
    },
    body: sql,
  });

  if (!res.ok) {
    const body = await res.text();
    // Try to parse as JSON for PostgREST error detail
    let msg = body;
    try { msg = JSON.parse(body).message ?? body; } catch {}
    // Ignore "already exists" errors so re-runs are safe
    if (msg.toLowerCase().includes('already exists')) {
      console.log('already applied.');
      return;
    }
    console.error(`FAILED (HTTP ${res.status})`);
    console.error('  ', msg.trim());
    throw new Error(`Migration "${label}" failed: ${msg.trim()}`);
  }
  console.log('done.');
}

const MIGRATIONS = [
  { label: '001_schema.sql',       file: path.join(__dirname, '../../supabase/migrations/001_schema.sql') },
  { label: '002_invite_codes.sql', file: path.join(__dirname, '../../supabase/migrations/002_invite_codes.sql') },
  { label: 'seed_function.sql',    file: path.join(__dirname, '../../supabase/seeds/seed_dev_data.sql') },
];

const DEV_USERS = [
  { email: 'daniel.cohen@apex.dev', password: 'apex_dev_123' },
  { email: 'noa.levy@apex.dev',     password: 'apex_dev_123' },
  { email: 'amit.bar@apex.dev',     password: 'apex_dev_123' },
  { email: 'coach@apex.dev',        password: 'apex_dev_123' },
];

async function main() {
  console.log('\nAPeX Setup\n');

  // ── 1. Run SQL migrations ──────────────────────────────────────────────────
  console.log('── Migrations ─────────────────────────────────────────────');

  // Test if the SQL endpoint is available first
  const probe = await fetch(`${SUPABASE_URL}/rest/v1/`, {
    method: 'POST',
    headers: {
      'Content-Type':  'application/sql',
      'Authorization': `Bearer ${SERVICE_ROLE_KEY}`,
      'apikey':        SERVICE_ROLE_KEY,
    },
    body: 'SELECT 1;',
  });

  if (probe.status === 404 || probe.status === 405) {
    console.error('\n  ✗ PostgREST SQL endpoint not available on this Supabase instance.');
    console.error('    Please run the two migration files manually in the Supabase SQL Editor:\n');
    console.error('    1. supabase/migrations/001_schema.sql');
    console.error('    2. supabase/migrations/002_invite_codes.sql');
    console.error('    3. supabase/seeds/seed_dev_data.sql\n');
    console.error('    Then re-run: node scripts/seed.js  (skips migrations, just creates users + calls RPC)\n');
    process.exit(1);
  }

  for (const { label, file } of MIGRATIONS) {
    const sql = fs.readFileSync(file, 'utf8');
    await execSQL(label, sql);
  }

  // ── 2. Create dev auth users ───────────────────────────────────────────────
  console.log('\n── Auth users ─────────────────────────────────────────────');
  for (const u of DEV_USERS) {
    const { error } = await supabase.auth.admin.createUser({
      email:         u.email,
      password:      u.password,
      email_confirm: true,
    });
    const exists = error?.message?.toLowerCase().includes('already');
    if (error && !exists) {
      console.error(`  ✗ ${u.email}:`, error.message);
    } else {
      console.log(`  ✓ ${u.email}${exists ? ' (already exists)' : ''}`);
    }
  }

  // ── 3. Seed DB via the stored function ────────────────────────────────────
  console.log('\n── Seeding database ───────────────────────────────────────');
  const { data: seedResult, error: seedErr } = await supabase.rpc('seed_dev_data');
  if (seedErr) {
    if (seedErr.message.toLowerCase().includes('already seeded')) {
      console.log('  Already seeded — skipping.');
    } else {
      console.error('  ✗', seedErr.message);
      process.exit(1);
    }
  } else {
    console.log(' ', seedResult);
  }

  // ── 4. Show invite code ────────────────────────────────────────────────────
  const { data: team } = await supabase
    .from('teams')
    .select('invite_code')
    .eq('name', 'Wingate U21')
    .single();

  console.log('\n──────────────────────────────────────');
  console.log('Dev athlete invite code:', team?.invite_code ?? '(check teams table)');
  console.log('──────────────────────────────────────');
  console.log('\nDone.  npm start\n');
}

main().catch((e) => { console.error('\n', e.message); process.exit(1); });
