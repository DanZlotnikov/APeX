import { supabase } from './supabase';
import { TeamSettingsViewModel } from './types';

export async function getTeamSettings(teamId: string): Promise<TeamSettingsViewModel> {
  const [settingsRes, testsRes, teamRes] = await Promise.all([
    supabase.from('team_settings').select('*').eq('team_id', teamId).single(),
    supabase.from('required_tests').select('*').eq('team_id', teamId).order('sort_order'),
    supabase.from('teams').select('name').eq('id', teamId).single(),
  ]);

  const s = settingsRes.data;
  const tests = testsRes.data ?? [];
  const team  = teamRes.data;

  return {
    teamId,
    teamName:            team?.name ?? 'My Team',
    readinessThreshold:  s?.readiness_threshold  ?? 75,
    maxLRImbalance:      s?.max_lr_imbalance      ?? 15,
    requiredTestsPerDay: s?.required_tests_per_day ?? 3,
    requiredTests: tests.map((t) => ({
      id:      t.id,
      label:   t.label,
      enabled: t.enabled,
    })),
  };
}

export async function updateTeamSettings(
  teamId: string,
  patch: Partial<{
    readinessThreshold: number;
    maxLRImbalance: number;
    requiredTestsPerDay: number;
  }>,
): Promise<void> {
  const update: Record<string, number> = {};
  if (patch.readinessThreshold  !== undefined) update.readiness_threshold   = patch.readinessThreshold;
  if (patch.maxLRImbalance      !== undefined) update.max_lr_imbalance      = patch.maxLRImbalance;
  if (patch.requiredTestsPerDay !== undefined) update.required_tests_per_day = patch.requiredTestsPerDay;
  if (Object.keys(update).length > 0) {
    await supabase.from('team_settings').update(update).eq('team_id', teamId);
  }
}

export async function updateRequiredTest(testId: string, enabled: boolean): Promise<void> {
  await supabase.from('required_tests').update({ enabled }).eq('id', testId);
}

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
