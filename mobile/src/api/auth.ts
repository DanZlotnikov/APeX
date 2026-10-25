import { supabase } from './supabase';
import { DbProfile } from './types';

// ── Auth ──────────────────────────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data.user!;
}

export async function signUpManager(
  email: string,
  password: string,
  fullName: string,
  teamName: string,
  mainSportKey?: string,
) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-up returned no user');

  const { error: teamErr } = await supabase.rpc('create_manager_team', {
    p_team_name: teamName,
    p_full_name: fullName,
    p_main_sport_key: mainSportKey ?? 'general_fitness',
  });
  if (teamErr) throw teamErr;

  return data.user;
}

// inviteCode is optional: leave it blank to sign up as an individual athlete
// with no manager/team (create_individual_athlete) — everything team/manager
// -scoped (exercise assignment, compliance, injury tracking, manager
// notifications) is keyed off profiles.team_id being non-null, so it simply
// doesn't apply to these athletes. A non-blank code must still resolve to a
// real team (join_team_as_athlete throws otherwise) — a typo'd code should
// never silently fall through to an individual signup.
export async function signUpAthlete(
  email: string,
  password: string,
  fullName: string,
  inviteCode?: string,
  mainSportKey?: string,
  handedness?: 'left' | 'right',
) {
  const code = inviteCode?.trim();

  // Validate invite code before creating account (only when one was given)
  if (code) {
    const { data: teams } = await supabase.rpc('get_team_by_invite_code', { p_code: code });
    if (!teams?.length) throw new Error('Invalid invite code. Ask your manager for the correct code.');
  }

  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-up returned no user');

  const sportKey = mainSportKey ?? 'general_fitness';
  const { error: joinErr } = code
    ? await supabase.rpc('join_team_as_athlete', { p_invite_code: code, p_full_name: fullName, p_main_sport_key: sportKey })
    : await supabase.rpc('create_individual_athlete', { p_full_name: fullName, p_main_sport_key: sportKey });
  if (joinErr) throw joinErr;

  // A plain profile update rather than an RPC parameter, so the sign-up RPCs (and older app
  // builds calling them) stay unchanged. Not fatal: the hand can be set later in Settings, and
  // the pipeline works it out from the motion until then.
  if (handedness) {
    const { error: handErr } = await supabase.from('profiles').update({ handedness }).eq('id', data.user.id);
    if (handErr) console.warn('[APeX] Could not save handedness at sign-up:', handErr);
  }

  return data.user;
}

// An individual athlete joining a team after sign-up (migration 031's join_team_with_code): moves
// them onto the team and notifies the manager. Throws with the server's message on a bad code.
export async function joinTeamWithCode(code: string): Promise<{ teamId: string; teamName: string }> {
  const { data, error } = await supabase.rpc('join_team_with_code', { p_invite_code: code.trim() });
  if (error) {
    throw new Error(error.message.includes('Invalid invite code')
      ? 'Invalid invite code. Ask your manager for the correct code.'
      : error.message);
  }
  const row = Array.isArray(data) ? data[0] : data;
  return { teamId: row.team_id, teamName: row.team_name };
}

export async function lookupTeamByCode(
  code: string,
): Promise<{ teamId: string; teamName: string } | null> {
  if (code.trim().length < 4) return null;
  const { data } = await supabase.rpc('get_team_by_invite_code', { p_code: code });
  if (!data?.length) return null;
  return { teamId: data[0].team_id, teamName: data[0].team_name };
}

export async function logout() {
  await supabase.auth.signOut();
}

// Full, irreversible deletion of the caller's own account and all their data
// (profile, sessions, videos, storage files) — see delete-account Edge
// Function and APP_STORE_SUBMISSION_PLAN.md section 1.1. supabase-js attaches
// the caller's current session as the Authorization header automatically, so
// the Edge Function always deletes the calling user, never anyone else.
export async function deleteAccount() {
  const { error } = await supabase.functions.invoke('delete-account');
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export async function getProfile(userId: string): Promise<DbProfile | null> {
  const { data } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', userId)
    .single();
  return data as DbProfile | null;
}
