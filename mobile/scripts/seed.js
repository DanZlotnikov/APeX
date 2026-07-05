#!/usr/bin/env node
/**
 * APeX dev seed script — creates auth users and seeds the database.
 *
 * Prerequisites:
 *   1. Run 001_schema.sql and 002_invite_codes.sql in Supabase SQL Editor.
 *   2. Copy mobile/.env.example → mobile/.env, fill in EXPO_PUBLIC_SUPABASE_URL
 *      and EXPO_PUBLIC_SUPABASE_ANON_KEY.
 *   3. Add your service role key to mobile/.env:
 *        SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
 *      (Project Settings → API → service_role  ⚠ Never commit this key)
 *
 * Run from the mobile/ directory:
 *   npm run seed
 */

const fs   = require('fs');
const path = require('path');

// ── Load mobile/.env ──────────────────────────────────────────────────────────
const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split('\n')) {
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const k = line.slice(0, eq).trim();
    const v = line.slice(eq + 1).trim();
    if (k && !process.env[k]) process.env[k] = v;
  }
}

const SUPABASE_URL     = process.env.EXPO_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error('\nMissing env vars. Add to mobile/.env:\n');
  if (!SUPABASE_URL)     console.error('  EXPO_PUBLIC_SUPABASE_URL=https://xxx.supabase.co');
  if (!SERVICE_ROLE_KEY) console.error('  SUPABASE_SERVICE_ROLE_KEY=<service_role key from Project Settings → API>');
  console.error();
  process.exit(1);
}

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const DEV_USERS = [
  { email: 'daniel.cohen@apex.dev', password: 'apex_dev_123' },
  { email: 'noa.levy@apex.dev',     password: 'apex_dev_123' },
  { email: 'amit.bar@apex.dev',     password: 'apex_dev_123' },
  { email: 'coach@apex.dev',        password: 'apex_dev_123' },
];

async function main() {
  console.log('\nAPeX Dev Seed\n');

  // 1. Create auth users
  console.log('Creating auth users...');
  for (const u of DEV_USERS) {
    const { error } = await supabase.auth.admin.createUser({
      email:         u.email,
      password:      u.password,
      email_confirm: true,
    });
    const alreadyExists = error?.message?.toLowerCase().includes('already');
    if (error && !alreadyExists) {
      console.error(`  ✗ ${u.email}:`, error.message);
    } else {
      console.log(`  ✓ ${u.email}${alreadyExists ? ' (already exists)' : ''}`);
    }
  }

  // 2. Seed database
  console.log('\nSeeding database...');
  const { data: seedResult, error: seedErr } = await supabase.rpc('seed_dev_data');
  if (seedErr) {
    console.error('  ✗', seedErr.message);
    console.error('\n  Make sure you ran 001_schema.sql and 002_invite_codes.sql first.');
    process.exit(1);
  }
  console.log(' ', seedResult);

  // 3. Show invite code for dev athlete sign-up
  const { data: team } = await supabase
    .from('teams')
    .select('invite_code')
    .eq('name', 'Wingate U21')
    .single();

  console.log('\n─────────────────────────────');
  console.log('Dev athlete invite code:', team?.invite_code ?? '(check teams table)');
  console.log('─────────────────────────────');
  console.log('\nDone. Start the app: npm start\n');
}

main().catch((e) => { console.error(e); process.exit(1); });
