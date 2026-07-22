/**
 * Athlete daily routine — see supabase/migrations/014_athlete_routines.sql.
 * An athlete with a team can only read this (RLS blocks writes); an
 * individual (teamless) athlete can also write, enforced server-side, not
 * just by RoutineScreen hiding its controls.
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

// Always returns exactly one entry per PIPELINE_EXERCISE_KEYS, in that
// order. An exercise the athlete has never touched simply has no DB row yet
// (see setRoutineExercise) and falls back to off/5 here, rather than every
// athlete needing 6 pre-seeded rows up front.
export async function getRoutine(athleteId: string): Promise<RoutineSetting[]> {
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
