import { getEffectiveRoutines, EffectiveRoutineEntry } from './teamRoutine';
import { getRoutine } from './routine';
import { supabase } from './supabase';
import { AthleteProfileData, AthleteStatus, AthleteViewModel, ExerciseReadiness } from './types';
import { AT_RISK_READINESS_FLOOR } from '../utils/readiness';
import { exerciseLabel, PIPELINE_EXERCISE_KEYS } from '../utils/pipelineExercise';

export async function getTeamAthletes(teamId: string): Promise<AthleteViewModel[]> {
  const { data: profiles, error: profErr } = await supabase
    .from('profiles')
    .select('id, full_name, injured, injury_started_at, stats_reset_at, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('team_id', teamId)
    .eq('role', 'athlete');

  if (profErr) throw profErr;
  if (!profiles?.length) return [];

  const athleteIds = profiles.map((p) => p.id);

  const [sessionsRes, resolvedRoutines] = await Promise.all([
    supabase
      .from('sessions')
      .select('id, athlete_id, exercise_type, recorded_at, rep_count, readiness_score')
      .in('athlete_id', athleteIds)
      .order('recorded_at', { ascending: false })
      .limit(400),
    getEffectiveRoutines(teamId, athleteIds),
  ]);

  if (sessionsRes.error) throw sessionsRes.error;

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
      p.id, p.full_name, aps, athSess, resolvedRoutines.get(p.id) ?? [],
      p.injured, p.injury_started_at, p.stats_reset_at,
    );
  });
}

// Works for both a team athlete (resolved from their manager's team routine
// + any per-athlete override — migration 018) and an individual athlete
// (resolved from their own athlete_routines, exactly what they see/edit on
// their own Routine screen) — same buildViewModel either way, so "the
// readiness assessment" is identical in shape for every athlete regardless
// of team membership (see MANAGER_MODULE_AUDIT.md section 2).
export async function getAthleteById(athleteId: string): Promise<AthleteViewModel | null> {
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, full_name, team_id, injured, injury_started_at, stats_reset_at, athlete_profiles(height_cm, weight_kg, position, date_of_birth)')
    .eq('id', athleteId)
    .single();

  if (!profile) return null;

  const [sessionsRes, routine] = await Promise.all([
    supabase
      .from('sessions')
      .select('exercise_type, recorded_at, rep_count, readiness_score')
      .eq('athlete_id', athleteId)
      .order('recorded_at', { ascending: false })
      .limit(200),
    profile.team_id
      ? getEffectiveRoutines(profile.team_id, [athleteId]).then((m) => m.get(athleteId) ?? [])
      : getRoutine(athleteId, null),
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
  routine: EffectiveRoutineEntry[], // this athlete's resolved routine — up to 6 entries
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

  const routineByKey = new Map(routine.map((r) => [r.exerciseType, r]));
  const activeExercises = PIPELINE_EXERCISE_KEYS.filter((k) => routineByKey.get(k)?.enabled);

  const perExerciseReadiness: ExerciseReadiness[] = activeExercises.map((key) => {
    const cfg = routineByKey.get(key)!;
    // sessions is newest → oldest, so the first match for this exercise is
    // the most recent one, whenever it was recorded.
    const sessionsForKey = sessions.filter((s) => s.exercise_type === key);
    const latestSession  = sessionsForKey[0] ?? null;
    const testedToday    = !!latestSession && (latestSession.recorded_at as string).startsWith(today);

    if (!latestSession) {
      return { key, label: exerciseLabel(key), readiness: null, testedToday: false, passed: null };
    }

    // Every attempt today is its own separate session row (migration 017,
    // same fix mobile/src/utils/routineProgress.ts already applies on the
    // athlete-facing side) — sum today's reps across ALL of them rather than
    // just the latest attempt, so an athlete who split their reps across two
    // clips isn't marked as having failed the requirement.
    const repsForCheck = testedToday
      ? sessionsForKey
          .filter((s) => (s.recorded_at as string).startsWith(today))
          .reduce((sum, s) => sum + (s.rep_count ?? 0), 0)
      : latestSession.rep_count ?? 0;

    const readiness    = latestSession.readiness_score ?? null;
    const repsOk        = repsForCheck >= cfg.targetReps;
    // Readiness is sessions.readiness_score directly — the same balance+ROM
    // average an individual athlete sees, not a manager-tunable per-metric
    // threshold (see migration 018 / MANAGER_MODULE_AUDIT.md sections 2, 3,
    // 6). "Passed" means today's reading isn't in the "at risk" band, using
    // the exact same bands readinessColor renders everywhere else.
    const readinessOk   = readiness == null || readiness >= AT_RISK_READINESS_FLOOR;

    return { key, label: exerciseLabel(key), readiness, testedToday, passed: repsOk && readinessOk };
  });

  // Overall readiness is an average across every active (required) exercise,
  // not just the ones actually tested — an exercise that's missing or wasn't
  // tested today contributes 0 rather than being dropped from the average,
  // so a single good test can't read as a perfect overall score while other
  // required exercises are outstanding.
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

  // Missing today: active (required) exercises with no session recorded today
  const missingTests = perExerciseReadiness.filter((e) => !e.testedToday).length;

  // Status: REVIEW if no history yet or any required exercise's most recent
  // attempt failed (reps/readiness); WATCH if everything so far passes but
  // today's tests aren't all done; else READY.
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
