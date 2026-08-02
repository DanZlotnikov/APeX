/**
 * Individual athlete routine — see supabase/migrations/014_athlete_routines.sql,
 * 021_individual_routines.sql, and 022_routine_sets.sql. Every athlete (team
 * or individual) has their own athlete_routine_sets rows: an ORDERED list of
 * sets per exercise, each with its own target rep count. Presence of >=1 set
 * row for an exercise means it's in the routine (RLS-enforced, not just UI
 * hiding controls) — there is no separate enabled flag. An individual
 * (teamless) athlete edits their own rows directly; a team athlete's rows are
 * edited by their manager only (both paths funnel through the mutations
 * below, which don't know or care which case they're in — RLS decides).
 */
import { PipelineExerciseKey, getPipelineExerciseKeys } from '../utils/pipelineExercise';
import { supabase } from './supabase';

export interface RoutineSet {
  index: number; // set_index — ascending order only, values may have gaps
  targetReps: number; // 1-10
}

export interface RoutineExercise {
  exerciseType: PipelineExerciseKey;
  sets: RoutineSet[]; // ordered ascending by index; empty means not in the routine
}

const DEFAULT_SET_REPS = 3;

function emptyExercise(exerciseType: PipelineExerciseKey): RoutineExercise {
  return { exerciseType, sets: [] };
}

function rowsToExercises(
  keys: PipelineExerciseKey[],
  rows: { exercise_type: string; set_index: number; target_reps: number }[],
): RoutineExercise[] {
  const setsByKey = new Map<string, RoutineSet[]>();
  for (const r of rows) {
    const list = setsByKey.get(r.exercise_type) ?? [];
    list.push({ index: r.set_index, targetReps: r.target_reps });
    setsByKey.set(r.exercise_type, list);
  }
  return keys.map((key) => {
    const sets = setsByKey.get(key);
    if (!sets) return emptyExercise(key);
    return { exerciseType: key, sets: sets.slice().sort((a, b) => a.index - b.index) };
  });
}

function nextSetIndex(sets: RoutineSet[]): number {
  return sets.length ? Math.max(...sets.map((s) => s.index)) + 1 : 0;
}

// Always returns exactly one entry per currently-enabled exercise (see
// utils/pipelineExercise.ts's getPipelineExerciseKeys), in display order. An
// exercise not in this athlete's routine simply has no DB rows and falls
// back to an empty sets list here, rather than every athlete needing
// pre-seeded rows up front.
export async function getRoutine(athleteId: string): Promise<RoutineExercise[]> {
  const [keys, { data, error }] = await Promise.all([
    getPipelineExerciseKeys(),
    supabase.from('athlete_routine_sets').select('exercise_type, set_index, target_reps').eq('athlete_id', athleteId),
  ]);
  if (error) throw error;
  return rowsToExercises(keys, data ?? []);
}

// Bulk version of getRoutine for a whole roster — one query instead of N.
// Always returns an entry for every id in athleteIds, each a full
// RoutineExercise[] (same empty-sets defaulting) covering every currently-
// enabled exercise.
export async function getRoutinesForAthletes(athleteIds: string[]): Promise<Map<string, RoutineExercise[]>> {
  const result = new Map<string, RoutineExercise[]>();
  if (!athleteIds.length) return result;

  const [keys, { data, error }] = await Promise.all([
    getPipelineExerciseKeys(),
    supabase.from('athlete_routine_sets').select('athlete_id, exercise_type, set_index, target_reps').in('athlete_id', athleteIds),
  ]);
  if (error) throw error;

  const rowsByAthlete = new Map<string, { exercise_type: string; set_index: number; target_reps: number }[]>();
  for (const r of data ?? []) {
    const list = rowsByAthlete.get(r.athlete_id) ?? [];
    list.push(r);
    rowsByAthlete.set(r.athlete_id, list);
  }
  for (const athleteId of athleteIds) {
    result.set(athleteId, rowsToExercises(keys, rowsByAthlete.get(athleteId) ?? []));
  }
  return result;
}

// Adds an exercise to the routine with a single starting set at the default
// rep target — mirrors the old "add exercise -> immediately usable" flow,
// just as one set instead of one flat target. Further sets are added one at
// a time via addSet.
export async function addExercise(athleteId: string, exerciseType: PipelineExerciseKey): Promise<void> {
  const { error } = await supabase
    .from('athlete_routine_sets')
    .upsert(
      { athlete_id: athleteId, exercise_type: exerciseType, set_index: 0, target_reps: DEFAULT_SET_REPS },
      { onConflict: 'athlete_id,exercise_type,set_index' },
    );
  if (error) throw error;
}

// Removes an exercise from the routine entirely — deletes every set row for
// it. A re-add starts fresh at one default-reps set rather than reviving
// whatever sets were last configured.
export async function removeExercise(athleteId: string, exerciseType: PipelineExerciseKey): Promise<void> {
  const { error } = await supabase
    .from('athlete_routine_sets')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('exercise_type', exerciseType);
  if (error) throw error;
}

// Appends a new set to an exercise at the default rep target. `currentSets`
// is the caller's already-loaded set list for this exercise (avoids a round
// trip just to compute the next index) — the new index is always
// max(existing) + 1, never a reused/filled gap, so this can't collide with a
// set some other in-flight write is still creating.
export async function addSet(
  athleteId: string,
  exerciseType: PipelineExerciseKey,
  currentSets: RoutineSet[],
): Promise<void> {
  const { error } = await supabase
    .from('athlete_routine_sets')
    .insert({
      athlete_id: athleteId,
      exercise_type: exerciseType,
      set_index: nextSetIndex(currentSets),
      target_reps: DEFAULT_SET_REPS,
    });
  if (error) throw error;
}

// Removes a single set from an exercise. Removing an exercise's last
// remaining set is blocked client-side (IndividualRoutineScreen disables
// that control) — use removeExercise for that instead, so a stray tap can't
// silently wipe out the whole exercise.
export async function removeSet(athleteId: string, exerciseType: PipelineExerciseKey, setIndex: number): Promise<void> {
  const { error } = await supabase
    .from('athlete_routine_sets')
    .delete()
    .eq('athlete_id', athleteId)
    .eq('exercise_type', exerciseType)
    .eq('set_index', setIndex);
  if (error) throw error;
}

export async function updateSetReps(
  athleteId: string,
  exerciseType: PipelineExerciseKey,
  setIndex: number,
  targetReps: number,
): Promise<void> {
  const { error } = await supabase
    .from('athlete_routine_sets')
    .update({ target_reps: targetReps })
    .eq('athlete_id', athleteId)
    .eq('exercise_type', exerciseType)
    .eq('set_index', setIndex);
  if (error) throw error;
}
