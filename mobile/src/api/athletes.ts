import { getCachedExercisesSync } from './exercises';
import { getRoutine, getRoutinesForAthletes, RoutineExercise } from './routine';
import { supabase } from './supabase';
import { AthleteProfileData, AthleteStatus, AthleteViewModel, ExerciseReadiness } from './types';
import { AT_RISK_READINESS_FLOOR } from '../utils/readiness';
import { exerciseLabel } from '../utils/pipelineExercise';
import { AttemptForMatching, matchAttemptsToSets } from '../utils/routineSets';

export async function getTeamAthletes(teamId: string): Promise<AthleteViewModel[]> {
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, injured, injury_started_at, stats_reset_at, main_sport_key, sport_override_key, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('team_id', teamId)
    .eq('role', 'athlete');

  if (profErr) throw profErr;
  if (!profiles?.length) return [];

  const athleteIds = profiles.map((p) => p.id);

  // The manager's own main_sport_key IS the team default every athlete
  // without their own sport_override_key inherits (see effective_sport() in
  // 028_main_sport.sql) — fetched once here and reused for the whole roster
  // rather than one RPC call per athlete.
  const [sessionsRes, routinesByAthlete, managerRes] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score')
      .in('athlete_id', athleteIds)
      .order('recorded_at', { ascending: false })
      .limit(400),
    getRoutinesForAthletes(athleteIds),
    supabase.from('profiles').select('main_sport_key').eq('team_id', teamId).eq('role', 'manager').single(),
  ]);

  if (sessionsRes.error) throw sessionsRes.error;
  const teamDefaultSport = managerRes.data?.main_sport_key ?? 'general_fitness';

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
      p.id, p.full_name, aps, athSess, routinesByAthlete.get(p.id) ?? [],
      p.injured, p.injury_started_at, p.stats_reset_at,
      p.sport_override_key, teamDefaultSport, p.main_sport_key,
    );
  });
}

// Works identically for a team athlete (routine set by their manager) and an
// individual athlete (routine set by themselves) — both are just
// athlete_routines rows for this athlete_id (migration 021), so
// buildViewModel doesn't need to know or care which case this is.
export async function getAthleteById(athleteId: string): Promise<AthleteViewModel | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, injured, injury_started_at, stats_reset_at, team_id, main_sport_key, sport_override_key, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('id', athleteId)
    .single();

  if (!profile) return null;

  // Only relevant when this athlete has a team — an individual athlete's
  // own main_sport_key is already the effective value, no manager to
  // inherit from (see buildViewModel's effective-sport COALESCE below).
  const [sessionsRes, routine, teamDefaultSport] = await Promise.all([
    supabase
      .from('sessions')
      .select('exercise_type, recorded_at, rep_count, readiness_score')
      .eq('athlete_id', athleteId)
      .order('recorded_at', { ascending: false })
      .limit(200),
    getRoutine(athleteId),
    profile.team_id
      ? supabase.from('profiles').select('main_sport_key').eq('team_id', profile.team_id).eq('role', 'manager').single()
        .then((r) => r.data?.main_sport_key ?? null)
      : Promise.resolve(null),
  ]);
  if (sessionsRes.error) throw sessionsRes.error;

  const ap = profile.athlete_profiles as any;
  return buildViewModel(
    profile.id,
    profile.full_name,
    ap,
    sessionsRes.data ?? [],
    routine,
    profile.injured,
    profile.injury_started_at,
    profile.stats_reset_at,
    profile.sport_override_key,
    teamDefaultSport,
    profile.main_sport_key,
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
  routine: RoutineExercise[], // this athlete's routine — up to 6 entries
  injured: boolean,
  injuryStartedAt: string | null,
  statsResetAt: string | null,
  sportOverrideKey: string | null,
  teamDefaultSport: string | null, // this athlete's manager's main_sport_key, or null if no team
  ownMainSport: string,
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

  // Safe to read synchronously here: by the time buildViewModel runs, its
  // caller has already awaited getRoutine/getRoutinesForAthletes, which
  // themselves await getPipelineExerciseKeys() — the cache this reads is
  // guaranteed populated (see api/exercises.ts).
  const routineByKey = new Map(routine.map((r) => [r.exerciseType, r]));
  const enabledKeys = getCachedExercisesSync().map((e) => e.key);
  const activeExercises = enabledKeys.filter((k) => (routineByKey.get(k)?.sets.length ?? 0) > 0);

  const perExerciseReadiness: ExerciseReadiness[] = activeExercises.map((key) => {
    const cfg = routineByKey.get(key)!;
    const sessionsForKey = sessions.filter((s) => s.exercise_type === key);
    const todaysSessions = sessionsForKey.filter((s) => (s.recorded_at as string).startsWith(today));
    const attemptedToday = todaysSessions.length > 0;

    // Every attempt today is its own separate session row (migration 017) —
    // hand ALL of them to matchAttemptsToSets, which positionally matches
    // each against the routine's ordered sets (utils/routineSets.ts). Only
    // readiness_score, the same balance+ROM average an individual athlete
    // sees (migration 018), factors in here — no per-metric threshold.
    const attempts: AttemptForMatching[] = todaysSessions.map((s) => ({
      recordedAt: s.recorded_at,
      repCount: s.rep_count ?? 0,
      readinessPct: s.readiness_score ?? null,
    }));
    const match = matchAttemptsToSets(cfg.sets, attempts);

    return {
      key,
      label: exerciseLabel(key),
      readiness: match.avgReadiness,
      requiredSets: match.requiredSets,
      completedSets: match.completedSets,
      attemptedToday,
      completedToday: match.completedToday,
    };
  });

  // Overall readiness is an average across every active (required) exercise,
  // not just the ones completed — an exercise that's missing or not fully
  // completed today contributes 0 rather than being dropped from the
  // average, so a single good exercise can't read as a perfect overall score
  // while other required exercises are outstanding.
  const readiness = activeExercises.length
    ? Math.round(
        perExerciseReadiness.reduce((sum, e) => sum + (e.completedToday ? e.readiness ?? 0 : 0), 0) / activeExercises.length,
      )
    : 0;

  // Last test (most recent session across all exercises)
  const latest       = sessions[0];
  const lastTestDate = latest ? formatDate(latest.recorded_at) : 'Never';
  const lastTestTime = latest
    ? new Date(latest.recorded_at).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })
    : null;

  // Missing today: active (required) exercises not fully completed today —
  // "completed" means every required set, not merely attempted (see
  // supabase/migrations/022_routine_sets.sql).
  const missingTests = perExerciseReadiness.filter((e) => !e.completedToday).length;

  // Status: RED if there's no history yet, or a required exercise is either
  // fully completed with an at-risk readiness reading, or was attempted
  // today but left incomplete (a real, current problem) — YELLOW if
  // everything attempted so far is fine but some exercises haven't been
  // started yet today — else GREEN.
  const anyAtRisk = perExerciseReadiness.some((e) =>
    e.completedToday ? (e.readiness != null && e.readiness < AT_RISK_READINESS_FLOOR) : e.attemptedToday,
  );
  let status: AthleteStatus = 'green';
  if (sessions.length === 0 || anyAtRisk) status = 'red';
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
    effectiveSportKey: sportOverrideKey ?? teamDefaultSport ?? ownMainSport,
    sportOverrideKey,
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
