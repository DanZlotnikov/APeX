/**
 * Manager-owned team routine — replaces the old team_exercises / per-metric
 * threshold system (see MANAGER_MODULE_AUDIT.md sections 1, 2, 6 and
 * supabase/migrations/018_manager_routine_rearchitecture.sql). Same
 * enabled/target_reps shape an individual athlete sets for themselves
 * (mobile/src/api/routine.ts), just team-scoped and manager-edited, plus a
 * simple per-athlete boolean override (reps are never overridden per
 * athlete — only which exercises apply to them).
 */
import { PipelineExerciseKey, PIPELINE_EXERCISE_KEYS } from '../utils/pipelineExercise';
import { supabase } from './supabase';

export interface TeamRoutineSetting {
  exerciseType: PipelineExerciseKey;
  enabled: boolean;
  targetReps: number;
}

export interface EffectiveRoutineEntry {
  exerciseType: PipelineExerciseKey;
  enabled: boolean;
  targetReps: number;
}

const DEFAULT_TARGET_REPS = 5;

function defaultSetting(exerciseType: PipelineExerciseKey): TeamRoutineSetting {
  return { exerciseType, enabled: false, targetReps: DEFAULT_TARGET_REPS };
}

// teamId is null for an individual athlete (no manager/team) — there's no
// team default to fetch, just an empty list, no query. Always returns
// exactly one entry per PIPELINE_EXERCISE_KEYS, in that order — an exercise
// the manager has never touched simply has no DB row yet and falls back to
// off/5 here, same convention athlete_routines already uses.
export async function getTeamRoutine(teamId: string | null): Promise<TeamRoutineSetting[]> {
  if (!teamId) return [];

  const { data, error } = await supabase
    .from('team_routines')
    .select('exercise_type, enabled, target_reps')
    .eq('team_id', teamId);
  if (error) throw error;

  const byKey = new Map<string, TeamRoutineSetting>(
    (data ?? []).map((r: any) => [
      r.exercise_type,
      { exerciseType: r.exercise_type, enabled: r.enabled, targetReps: r.target_reps } as TeamRoutineSetting,
    ]),
  );
  return PIPELINE_EXERCISE_KEYS.map((key) => byKey.get(key) ?? defaultSetting(key));
}

// Upserts one exercise's team-default row — called immediately on every
// toggle flip or stepper tap (mirrors athlete RoutineScreen's save pattern),
// never batched/debounced. RLS (migration 018) enforces server-side that
// only a manager of this team can write here.
export async function setTeamRoutineExercise(
  teamId: string,
  exerciseType: PipelineExerciseKey,
  enabled: boolean,
  targetReps: number,
): Promise<void> {
  const { error } = await supabase
    .from('team_routines')
    .upsert(
      { team_id: teamId, exercise_type: exerciseType, enabled, target_reps: targetReps },
      { onConflict: 'team_id,exercise_type' },
    );
  if (error) throw error;
}

// Raw per-athlete override rows, keyed by athlete then exercise. Absence of
// an entry for a given exercise means "no override for this athlete" — the
// team default applies. This is the only place that reads
// athlete_exercise_assignments; resolveEffectiveRoutine below is the only
// place that interprets it.
export async function getAssignmentOverrides(
  athleteIds: string[],
): Promise<Map<string, Map<PipelineExerciseKey, boolean>>> {
  const overrideMap = new Map<string, Map<PipelineExerciseKey, boolean>>();
  if (!athleteIds.length) return overrideMap;

  const { data, error } = await supabase
    .from('athlete_exercise_assignments')
    .select('athlete_id, exercise_type, assigned')
    .in('athlete_id', athleteIds);
  if (error) throw error;

  for (const o of data ?? []) {
    const m = overrideMap.get(o.athlete_id) ?? new Map<PipelineExerciseKey, boolean>();
    m.set(o.exercise_type as PipelineExerciseKey, o.assigned);
    overrideMap.set(o.athlete_id, m);
  }
  return overrideMap;
}

// SINGLE SOURCE OF TRUTH for "is this exercise required for this athlete,
// and how many reps" — team_routines.enabled/target_reps is the default; an
// explicit per-athlete row in athlete_exercise_assignments always wins for
// enabled (in either direction), reps are always the team default. Every
// other computation that needs an athlete's required routine — readiness,
// the monitoring table, compliance counts, the athlete's own Routine/
// Overview screens — must derive it by calling this (or getEffectiveRoutines
// below), not by re-deriving the rule.
export function resolveEffectiveRoutine(
  teamRoutine: TeamRoutineSetting[],
  overrides: Map<PipelineExerciseKey, boolean> | undefined,
): EffectiveRoutineEntry[] {
  return teamRoutine.map((d) => ({
    exerciseType: d.exerciseType,
    enabled: overrides?.get(d.exerciseType) ?? d.enabled,
    targetReps: d.targetReps,
  }));
}

// Effective routine for every athlete in athleteIds. Pass `teamRoutine` if
// the caller already fetched it (e.g. alongside other team-scoped queries)
// to avoid re-fetching the same table.
export async function getEffectiveRoutines(
  teamId: string,
  athleteIds: string[],
  teamRoutine?: TeamRoutineSetting[],
): Promise<Map<string, EffectiveRoutineEntry[]>> {
  const [routine, overrideMap] = await Promise.all([
    teamRoutine ?? getTeamRoutine(teamId),
    getAssignmentOverrides(athleteIds),
  ]);

  const result = new Map<string, EffectiveRoutineEntry[]>();
  for (const athleteId of athleteIds) {
    result.set(athleteId, resolveEffectiveRoutine(routine, overrideMap.get(athleteId)));
  }
  return result;
}

// Pass `null` to clear an override and revert to the team default.
export async function setAssignmentOverride(
  athleteId: string,
  exerciseType: PipelineExerciseKey,
  assigned: boolean | null,
): Promise<void> {
  if (assigned === null) {
    const { error } = await supabase
      .from('athlete_exercise_assignments')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('exercise_type', exerciseType);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('athlete_exercise_assignments')
    .upsert(
      { athlete_id: athleteId, exercise_type: exerciseType, assigned },
      { onConflict: 'athlete_id,exercise_type' },
    );
  if (error) throw error;
}
