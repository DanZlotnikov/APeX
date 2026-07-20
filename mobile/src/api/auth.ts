import { supabase } from './supabase';
import { DbProfile } from './types';

// Used by dev quick-login buttons in LoginScreen
export const DEV_CREDENTIALS = {
  athlete: { email: 'daniel.cohen@apex.dev', password: 'apex_dev_123' },
  manager: { email: 'coach@apex.dev',        password: 'apex_dev_123' },
} as const;

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
) {
  const { data, error } = await supabase.auth.signUp({ email, password });
  if (error) throw error;
  if (!data.user) throw new Error('Sign-up returned no user');

  const { error: teamErr } = await supabase.rpc('create_manager_team', {
    p_team_name: teamName,
    p_full_name: fullName,
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

  const { error: joinErr } = code
    ? await supabase.rpc('join_team_as_athlete', { p_invite_code: code, p_full_name: fullName })
    : await supabase.rpc('create_individual_athlete', { p_full_name: fullName });
  if (joinErr) throw joinErr;

  return data.user;
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
