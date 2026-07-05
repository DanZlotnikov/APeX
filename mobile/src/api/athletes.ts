import { supabase } from './supabase';
import { AthleteProfileData, AthleteStatus, AthleteViewModel } from './types';

export async function getTeamAthletes(teamId: string): Promise<AthleteViewModel[]> {
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('team_id', teamId)
    .eq('role', 'athlete');

  if (profErr) throw profErr;
  if (!profiles?.length) return [];

  const athleteIds = profiles.map((p) => p.id);

  const { data: sessions, error: sesErr } = await supabase
    .from('sessions')
    .select('id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, session_metrics(metric_key, value)')
    .in('athlete_id', athleteIds)
    .order('recorded_at', { ascending: false })
    .limit(200);

  if (sesErr) throw sesErr;

  const { data: teamSettings } = await supabase
    .from('team_settings')
    .select('required_tests_per_day')
    .eq('team_id', teamId)
    .single();

  const requiredPerDay = teamSettings?.required_tests_per_day ?? 3;

  const sessionsByAthlete = new Map<string, any[]>();
  for (const s of sessions ?? []) {
    const list = sessionsByAthlete.get(s.athlete_id) ?? [];
    list.push(s);
    sessionsByAthlete.set(s.athlete_id, list);
  }

  return profiles.map((p) => {
    const aps      = p.athlete_profiles as any;
    const athSess  = sessionsByAthlete.get(p.id) ?? [];
    return buildViewModel(p.id, p.full_name, aps, athSess, requiredPerDay);
  });
}

export async function getAthleteById(athleteId: string): Promise<AthleteViewModel | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, team_id, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('id', athleteId)
    .single();

  if (!profile) return null;

  const [sessionsRes, settingsRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, exercise_type, recorded_at, rep_count, readiness_score, session_metrics(metric_key, value)')
      .eq('athlete_id', athleteId)
      .order('recorded_at', { ascending: false })
      .limit(100),
    supabase
      .from('team_settings')
      .select('required_tests_per_day')
      .eq('team_id', profile.team_id)
      .single(),
  ]);

  const ap = profile.athlete_profiles as any;
  return buildViewModel(
    profile.id,
    profile.full_name,
    ap,
    sessionsRes.data ?? [],
    settingsRes.data?.required_tests_per_day ?? 3,
  );
}

// ── Shared view model builder ──────────────────────────────────────────────────

function buildViewModel(
  id: string,
  fullName: string,
  ap: any,
  sessions: any[],
  requiredPerDay: number,
): AthleteViewModel {
  const today       = new Date().toISOString().slice(0, 10);
  const cutoff      = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Readiness history — last 30 days, oldest → newest
  const readinessHistory = sessions
    .filter((s) => new Date(s.recorded_at) >= cutoff)
    .slice()
    .reverse()
    .map((s) => s.readiness_score ?? 0);

  const latestReadiness = sessions.length > 0 ? (sessions[0].readiness_score ?? 0) : 0;

  // Last test
  const latest      = sessions[0];
  const lastTestDate = latest ? formatDate(latest.recorded_at) : 'Never';
  const lastTestTime = latest
    ? new Date(latest.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Tests completed today
  const todayCount   = sessions.filter((s) => s.recorded_at.startsWith(today)).length;
  const missingTests = Math.max(0, requiredPerDay - todayCount);

  // L/R imbalance from most recent session
  let lrImbalance = 0;
  if (latest?.session_metrics) {
    const m = latest.session_metrics.find((m: any) => m.metric_key === 'lr_imbalance_pct');
    lrImbalance = Math.round(m?.value ?? 0);
  }

  // Status
  let status: AthleteStatus = 'green';
  if (sessions.length === 0)                             status = 'red';
  else if (latestReadiness < 65 || lrImbalance >= 20)   status = 'red';
  else if (latestReadiness < 80 || lrImbalance >= 15 || missingTests > 0) status = 'yellow';

  // Physical profile
  const age = ap?.date_of_birth
    ? Math.floor((Date.now() - new Date(ap.date_of_birth).getTime()) / (365.25 * 24 * 3_600_000))
    : 0;

  const profile: AthleteProfileData = {
    position:  ap?.position  ?? 'Unknown',
    heightCm:  ap?.height_cm ?? 0,
    weightKg:  ap?.weight_kg ?? 0,
    age,
  };

  return {
    id,
    name: fullName,
    status,
    readiness:      latestReadiness,
    lrImbalance,
    lastTestDate,
    lastTestTime,
    missingTests,
    profile,
    readinessHistory,
    totalSessions:  sessions.length,
  };
}

function formatDate(iso: string): string {
  const d      = new Date(iso);
  const now    = new Date();
  const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
