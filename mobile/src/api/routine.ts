/**
 * Athlete daily routine — see supabase/migrations/014_athlete_routines.sql.
 * An individual (teamless) athlete edits their own athlete_routines rows
 * directly (RLS-enforced, not just RoutineScreen hiding its controls). A
 * team athlete's routine is instead resolved from their manager's team-wide
 * default plus any per-athlete override (migration 018,
 * mobile/src/api/teamRoutine.ts) — that athlete's own athlete_routines rows
 * are never read or written, since editing is manager-only for team
 * athletes. Either way this returns the SAME RoutineSetting[] shape, so
 * every caller (RoutineScreen, OverviewScreen, routineProgress.ts) works
 * unchanged regardless of which source the data came from.
 */
import { getEffectiveRoutines } from './teamRoutine';
import { PipelineExerciseKey, PIPELINE_EXERCISE_KEYS } from '../utils/pipelineExercise';
import { supabase } from './supabase';

export interface RoutineSetting {
  exerciseType: PipelineExerciseKey;
  enabled: boolean;
  targetReps: number; // 1-10
}

const DEFAULT_TARGET_REPS = 5;

function defaultSetting(exerciseType: PipelineExerciseKey): RoutineSetting {
  return { exerciseType, enabled: false, targetReps: DEFAULT_TARGET_REPS };
}

// Always returns exactly one entry per PIPELINE_EXERCISE_KEYS, in that
// order. An exercise nobody has touched yet simply has no DB row and falls
// back to off/5 here, rather than every athlete/team needing 6 pre-seeded
// rows up front.
export async function getRoutine(athleteId: string, teamId: string | null): Promise<RoutineSetting[]> {
  if (teamId) {
    const resolved = await getEffectiveRoutines(teamId, [athleteId]);
    return (resolved.get(athleteId) ?? []).map((r) => ({
      exerciseType: r.exerciseType,
      enabled: r.enabled,
      targetReps: r.targetReps,
    }));
  }

  const { data, error } = await supabase
    .from('athlete_routines')
    .select('exercise_type, enabled, target_reps')
    .eq('athlete_id', athleteId);
  if (error) throw error;

  const byKey = new Map<string, RoutineSetting>(
    (data ?? []).map((r: any) => [
      r.exercise_type,
      { exerciseType: r.exercise_type, enabled: r.enabled, targetReps: r.target_reps } as RoutineSetting,
    ]),
  );
  return PIPELINE_EXERCISE_KEYS.map((key) => byKey.get(key) ?? defaultSetting(key));
}

// Upserts one exercise's routine row — called immediately on every toggle
// flip or slider commit (see RoutineScreen), never batched/debounced. RLS
// (migration 014) enforces server-side that only a teamless athlete can
// write here; this rejects with an error for a team athlete regardless of
// what the UI allowed.
export async function setRoutineExercise(
  athleteId: string,
  exerciseType: PipelineExerciseKey,
  enabled: boolean,
  targetReps: number,
): Promise<void> {
  const { error } = await supabase
    .from('athlete_routines')
    .upsert(
      { athlete_id: athleteId, exercise_type: exerciseType, enabled, target_reps: targetReps },
      { onConflict: 'athlete_id,exercise_type' },
    );
  if (error) throw error;
}
