import { supabase } from './supabase';

export async function getTeamName(teamId: string): Promise<string> {
  const { data } = await supabase.from('teams').select('name').eq('id', teamId).single();
  return data?.name ?? 'My Team';
}

export async function getTeamInviteCode(teamId: string): Promise<string> {
  const { data } = await supabase.from('teams').select('invite_code').eq('id', teamId).single();
  return data?.invite_code ?? '';
}

export async function regenerateInviteCode(teamId: string): Promise<string> {
  const { data, error } = await supabase.rpc('regenerate_invite_code', { p_team_id: teamId });
  if (error) throw error;
  return data as string;
}
