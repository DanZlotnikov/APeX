// Full, irreversible account deletion — invoked directly by an authenticated
// client (mobile/src/api/account.ts -> supabase.functions.invoke('delete-account')).
// See APP_STORE_SUBMISSION_PLAN.md section 1.1 (Apple 5.1.1(v) requires
// in-app account deletion, not just deactivation).
//
// The target user is ALWAYS derived from the caller's own verified JWT —
// never from a client-supplied id — so a user can only ever delete their own
// account. A manager's team and its athletes' data are deliberately left
// untouched: teams has no FK back to a specific manager, and deleting your
// own account must never cascade-destroy other people's data.
//
// Order of operations matters: Storage objects and the notifications table
// are cleaned up explicitly BEFORE the auth user is deleted, because:
//   - Supabase Storage is a separate system from Postgres and is never
//     touched by SQL-level FK cascades.
//   - notifications.athlete_id uses ON DELETE SET NULL (not CASCADE), so its
//     `message` text (which bakes in the athlete's full name at creation
//     time) would otherwise survive indefinitely as orphaned PII.
// Everything else (profiles, athlete_profiles, sessions, session_metrics,
// video_jobs, athlete_routines, notification_reads) cascades automatically
// once auth.admin.deleteUser() removes the auth.users row.
//
// Storage/notifications cleanup is best-effort: a transient failure there
// logs a warning but must not block the auth deletion itself, since "my
// account and login access are gone" is the core promise of this feature.
//
// Deploy with: supabase functions deploy delete-account

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const BUCKET = 'exercise-videos';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader) {
    return json({ error: 'Missing Authorization header' }, 401);
  }

  const url = Deno.env.get('SUPABASE_URL')!;
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!;
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Verify the caller's identity from their own JWT — this is the only
  // source of truth for which account gets deleted.
  const callerClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authErr } = await callerClient.auth.getUser();
  if (authErr || !user) {
    return json({ error: 'Invalid or expired session' }, 401);
  }
  const userId = user.id;

  const adminClient = createClient(url, serviceRoleKey);

  try {
    await deleteAllStorageObjects(adminClient, `raw/${userId}`);
    await deleteAllStorageObjects(adminClient, `processed/${userId}`);
  } catch (e) {
    console.warn(`[delete-account] Storage cleanup failed for ${userId}:`, e);
  }

  try {
    const { error } = await adminClient.from('notifications').delete().eq('athlete_id', userId);
    if (error) console.warn(`[delete-account] notifications cleanup failed for ${userId}:`, error);
  } catch (e) {
    console.warn(`[delete-account] notifications cleanup threw for ${userId}:`, e);
  }

  const { error: deleteErr } = await adminClient.auth.admin.deleteUser(userId);
  if (deleteErr) {
    console.error(`[delete-account] auth.admin.deleteUser failed for ${userId}:`, deleteErr);
    return json({ error: 'Failed to delete account' }, 500);
  }

  return json({ success: true });
});

// Supabase Storage's list() returns both files and "folder" placeholder
// entries (id === null, metadata === null) for a given prefix — recurse into
// those rather than assuming remove() supports prefix/wildcard deletion.
async function deleteAllStorageObjects(adminClient: ReturnType<typeof createClient>, prefix: string) {
  const paths = await listAllPaths(adminClient, prefix);
  if (paths.length === 0) return;
  const { error } = await adminClient.storage.from(BUCKET).remove(paths);
  if (error) throw error;
}

async function listAllPaths(adminClient: ReturnType<typeof createClient>, prefix: string): Promise<string[]> {
  const { data, error } = await adminClient.storage.from(BUCKET).list(prefix, { limit: 1000 });
  if (error || !data) return [];

  const paths: string[] = [];
  for (const entry of data) {
    const fullPath = `${prefix}/${entry.name}`;
    if (entry.id === null) {
      paths.push(...(await listAllPaths(adminClient, fullPath)));
    } else {
      paths.push(fullPath);
    }
  }
  return paths;
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
