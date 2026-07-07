import { getEffectiveAssignments, getTeamExercises, TeamExerciseConfig } from './exercises';
import { supabase } from './supabase';
import { AthleteProfileData, AthleteStatus, AthleteViewModel, ExerciseReadiness } from './types';
import { EXERCISE_KEYS, EXERCISE_LABELS, EXERCISE_METRICS, ExerciseKey, passesMetric } from '../utils/exerciseMetrics';

export async function getTeamAthletes(teamId: string): Promise<AthleteViewModel[]> {
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, injured, injury_started_at, stats_reset_at, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('team_id', teamId)
    .eq('role', 'athlete');

  if (profErr) throw profErr;
  if (!profiles?.length) return [];

  const athleteIds = profiles.map((p) => p.id);

  const [sessionsRes, teamExercises] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score, session_metrics(metric_key, value)')
      .in('athlete_id', athleteIds)
      .order('recorded_at', { ascending: false })
      .limit(200),
    getTeamExercises(teamId),
  ]);

  if (sessionsRes.error) throw sessionsRes.error;

  // Pass teamExercises through so getEffectiveAssignments doesn't re-fetch
  // the table it already has — resolveRequiredExercises (in api/exercises.ts)
  // stays the one place that decides team default vs. per-athlete override.
  const assignments = await getEffectiveAssignments(teamId, athleteIds, teamExercises);

  const sessionsByAthlete = new Map<string, any[]>();
  for (const s of sessionsRes.data ?? []) {
    const list = sessionsByAthlete.get(s.athlete_id) ?? [];
    list.push(s);
    sessionsByAthlete.set(s.athlete_id, list);
  }

  return profiles.map((p) => {
    const aps     = p.athlete_profiles as any;
    const athSess = sessionsByAthlete.get(p.id) ?? [];
    return buildViewModel(
      p.id, p.full_name, aps, athSess, teamExercises, assignments.get(p.id) ?? new Set(),
      p.injured, p.injury_started_at, p.stats_reset_at,
    );
  });
}

export async function getAthleteById(athleteId: string): Promise<AthleteViewModel | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, team_id, injured, injury_started_at, stats_reset_at, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('id', athleteId)
    .single();

  if (!profile) return null;

  const [sessionsRes, teamExercises] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, exercise_type, recorded_at, rep_count, readiness_score, session_metrics(metric_key, value)')
      .eq('athlete_id', athleteId)
      .order('recorded_at', { ascending: false })
      .limit(100),
    getTeamExercises(profile.team_id),
  ]);
  const assignments = await getEffectiveAssignments(profile.team_id, [athleteId], teamExercises);

  const ap = profile.athlete_profiles as any;
  return buildViewModel(
    profile.id,
    profile.full_name,
    ap,
    sessionsRes.data ?? [],
    teamExercises,
    assignments.get(athleteId) ?? new Set(),
    profile.injured,
    profile.injury_started_at,
    profile.stats_reset_at,
  );
}

// Marks an athlete injured: stamps injury_started_at + stats_reset_at (now),
// which the view model treats as a fresh-start cutoff — see buildViewModel
// below. Does not delete any prior session history.
export async function markAthleteInjured(athleteId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_athlete_injured', { p_athlete_id: athleteId });
  if (error) throw error;
}

// Ends injury tracking and returns the athlete to the regular roster. Also
// stamps stats_reset_at (now) — the regular-roster stats start fresh from
// this moment rather than picking back up with the pre-injury history.
export async function markAthleteRecovered(athleteId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_athlete_recovered', { p_athlete_id: athleteId });
  if (error) throw error;
}

// ── Shared view model builder ──────────────────────────────────────────────────

function buildViewModel(
  id: string,
  fullName: string,
  ap: any,
  allSessions: any[], // ordered newest → oldest (recorded_at descending)
  teamExercises: TeamExerciseConfig[],
  assignedKeys: Set<ExerciseKey>,
  injured: boolean,
  injuryStartedAt: string | null,
  statsResetAt: string | null,
): AthleteViewModel {
  const today   = new Date().toISOString().slice(0, 10);
  const cutoff30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  // Neither "Mark as Injured" nor "Mark as Recovered" deletes history — each
  // stamps stats_reset_at (now), and every stat below is scoped to sessions
  // recorded since that cutoff. So switching status in EITHER direction
  // starts a clean stats window from the moment of the switch, instead of
  // picking back up with whatever came before — while old sessions stay in
  // the DB either way.
  const sessions = statsResetAt
    ? allSessions.filter((s) => new Date(s.recorded_at) >= new Date(statsResetAt))
    : allSessions;

  // Readiness history — last 30 days, oldest → newest (unchanged; feeds AthleteDetailPreview)
  const readinessHistory = sessions
    .filter((s) => new Date(s.recorded_at) >= cutoff30)
    .slice()
    .reverse()
    .map((s) => s.readiness_score ?? 0);

  // Latest session per exercise type — sessions is already newest → oldest.
  const latestByExercise = new Map<ExerciseKey, any>();
  for (const s of sessions) {
    const key = s.exercise_type as ExerciseKey;
    if (!latestByExercise.has(key)) latestByExercise.set(key, s);
  }

  // assignedKeys (from getEffectiveAssignments → resolveRequiredExercises in
  // api/exercises.ts) is ALREADY the fully-resolved required-exercise set for
  // this athlete — team default, overridden per-athlete where applicable.
  // Do not re-intersect it with the team-wide `enabled` flag here: that would
  // silently ignore a per-athlete override that turns an exercise ON while
  // the team default is off, defeating the whole point of the override.
  const configByKey = new Map(teamExercises.map((c) => [c.exerciseKey, c]));
  const activeExercises = EXERCISE_KEYS.filter((k) => assignedKeys.has(k));

  const perExerciseReadiness: ExerciseReadiness[] = activeExercises.map((key) => {
    const session = latestByExercise.get(key);
    const cfg = configByKey.get(key)!;

    if (!session) {
      return { key, label: EXERCISE_LABELS[key], readiness: null, testedToday: false, passed: null };
    }

    const repsOk = session.rep_count >= cfg.minReps;
    const metricsOk = EXERCISE_METRICS[key].every((m) => {
      const row = (session.session_metrics ?? []).find((sm: any) => sm.metric_key === `${key}_${m.id}`);
      if (!row) return true; // metric wasn't recorded on this (possibly older) session — don't fail on missing data
      const threshold = cfg.thresholds[m.id] ?? m.defaultThreshold;
      return passesMetric(m.direction, row.value, threshold);
    });

    return {
      key,
      label: EXERCISE_LABELS[key],
      readiness: session.readiness_score ?? 0,
      testedToday: (session.recorded_at as string).startsWith(today),
      passed: repsOk && metricsOk,
    };
  });

  // Overall readiness is an average across every active (assigned + enabled)
  // exercise, not just the ones actually tested — an exercise that's missing
  // or wasn't tested today contributes 0 rather than being dropped from the
  // average, so a single good test can't read as a perfect overall score
  // while other required exercises are outstanding.
  const readiness = activeExercises.length
    ? Math.round(
        perExerciseReadiness.reduce((sum, e) => sum + (e.testedToday ? e.readiness ?? 0 : 0), 0) / activeExercises.length,
      )
    : 0;

  // Last test (most recent session across all exercises)
  const latest       = sessions[0];
  const lastTestDate = latest ? formatDate(latest.recorded_at) : 'Never';
  const lastTestTime = latest
    ? new Date(latest.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Missing today: active (assigned + enabled) exercises with no session recorded today
  const missingTests = activeExercises.filter((key) => {
    const session = latestByExercise.get(key);
    return !session || !(session.recorded_at as string).startsWith(today);
  }).length;

  // Status: REVIEW if no history yet or any assigned exercise fails its thresholds;
  // WATCH if everything so far passes but today's tests aren't all done; else READY.
  const anyFailed = perExerciseReadiness.some((e) => e.passed === false);
  let status: AthleteStatus = 'green';
  if (sessions.length === 0 || anyFailed) status = 'red';
  else if (missingTests > 0) status = 'yellow';

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
    readiness,
    perExerciseReadiness,
    lastTestDate,
    lastTestTime,
    missingTests,
    profile,
    readinessHistory,
    totalSessions: sessions.length,
    injured,
    injuryStartedAt,
    statsResetAt,
  };
}

function formatDate(iso: string): string {
  const d       = new Date(iso);
  const now     = new Date();
  const daysAgo = Math.floor((now.getTime() - d.getTime()) / 86_400_000);
  if (daysAgo === 0) return 'Today';
  if (daysAgo === 1) return 'Yesterday';
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}
