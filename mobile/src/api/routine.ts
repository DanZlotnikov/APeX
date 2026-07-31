/**
 * Individual athlete routine — see supabase/migrations/014_athlete_routines.sql
 * and 021_individual_routines.sql. Every athlete (team or individual) has
 * their own athlete_routines rows; presence of a row for an exercise means
 * it's in the routine (RLS-enforced, not just UI hiding controls) — there is
 * no more team-wide default. An individual (teamless) athlete edits their
 * own rows directly; a team athlete's rows are edited by their manager only
 * (both paths funnel through addOrUpdateRoutineExercise/removeRoutineExercise
 * below, which don't know or care which case they're in — RLS decides).
 */
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

function rowsToSettings(rows: { exercise_type: string; enabled: boolean; target_reps: number }[]): RoutineSetting[] {
  const byKey = new Map<string, RoutineSetting>(
    rows.map((r) => [
      r.exercise_type,
      { exerciseType: r.exercise_type as PipelineExerciseKey, enabled: r.enabled, targetReps: r.target_reps },
    ]),
  );
  return PIPELINE_EXERCISE_KEYS.map((key) => byKey.get(key) ?? defaultSetting(key));
}

// Always returns exactly one entry per PIPELINE_EXERCISE_KEYS, in that
// order. An exercise not in this athlete's routine simply has no DB row and
// falls back to off/5 here, rather than every athlete needing 6 pre-seeded
// rows up front.
export async function getRoutine(athleteId: string): Promise<RoutineSetting[]> {
  const { data, error } = await supabase
    .from('athlete_routines')
    .select('exercise_type, enabled, target_reps')
    .eq('athlete_id', athleteId);
  if (error) throw error;
  return rowsToSettings(data ?? []);
}

// Bulk version of getRoutine for a whole roster — one query instead of N.
// Always returns an entry for every id in athleteIds, each a full
// PIPELINE_EXERCISE_KEYS-length RoutineSetting[] (same off/5 defaulting).
export async function getRoutinesForAthletes(athleteIds: string[]): Promise<Map<string, RoutineSetting[]>> {
  const result = new Map<string, RoutineSetting[]>();
  if (!athleteIds.length) return result;

  const { data, error } = await supabase
    .from('athlete_routines')
    .select('athlete_id, exercise_type, enabled, target_reps')
    .in('athlete_id', athleteIds);
  if (error) throw error;

  const rowsByAthlete = new Map<string, { exercise_type: string; enabled: boolean; target_reps: number }[]>();
  for (const r of data ?? []) {
    const list = rowsByAthlete.get(r.athlete_id) ?? [];
    list.push(r);
    rowsByAthlete.set(r.athlete_id, list);
  }
  for (const athleteId of athleteIds) {
    result.set(athleteId, rowsToSettings(rowsByAthlete.get(athleteId) ?? []));
  }
  return result;
}

// Adds an exercise to the routine (or updates its rep target if already
// present) — always upserts with enabled: true, since under this model
// presence of a row IS "in the routine"; there's no separate on/off flag to
// flip (see removeRoutineExercise for the other half of that). Called
// immediately on every stepper tap, never batched/debounced. RLS (014 +
// 021) enforces server-side who may write here — a teamless athlete their
// own rows, a manager their team's athletes' rows; this rejects with an
// error for anyone else regardless of what the UI allowed.
export async function addOrUpdateRoutineExercise(
  athleteId: string,
  exerciseType: PipelineExerciseKey,
  targetReps: number,
): Promise<void> {
  const { error } = await supabase
    .from('athlete_routines')
    .upsert(
      { athlete_id: athleteId, exercise_type: exerciseType, enabled: true, target_reps: targetReps },
      { onConflict: 'athlete_id,exercise_type' },
    );
  if (error) throw error;
}

// Removes an exercise from the routine entirely (swipe-to-delete) — a real
// DELETE, not enabled: false, so a re-add starts fresh at the default reps
// rather than silently reviving whatever target was last set.
export async function removeRoutineExercise(athleteId: string, exerciseType: PipelineExerciseKey): Promise<void> {
  const { error } = await supabase
    .from('athlete_routines')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('exercise_type', exerciseType);
  if (error) throw error;
}
