import { EXERCISE_KEYS, ExerciseKey } from '../utils/exerciseMetrics';
import { supabase } from './supabase';

export interface TeamExerciseConfig {
  exerciseKey: ExerciseKey;
  enabled: boolean;
  minReps: number;
  thresholds: Record<string, number>;
  sortOrder: number;
}

export async function getTeamExercises(teamId: string): Promise<TeamExerciseConfig[]> {
  const { data, error } = await supabase
    .from('team_exercises')
    .select('*')
    .eq('team_id', teamId)
    .order('sort_order');
  if (error) throw error;

  return (data ?? []).map((r) => ({
    exerciseKey: r.exercise_key as ExerciseKey,
    enabled:     r.enabled,
    minReps:     r.min_reps,
    thresholds:  (r.thresholds ?? {}) as Record<string, number>,
    sortOrder:   r.sort_order,
  }));
}

export async function updateTeamExercise(
  teamId: string,
  exerciseKey: ExerciseKey,
  patch: Partial<{ enabled: boolean; minReps: number; thresholds: Record<string, number> }>,
): Promise<void> {
  const update: Record<string, unknown> = {};
  if (patch.enabled    !== undefined) update.enabled    = patch.enabled;
  if (patch.minReps    !== undefined) update.min_reps   = patch.minReps;
  if (patch.thresholds !== undefined) update.thresholds = patch.thresholds;
  if (Object.keys(update).length === 0) return;

  const { error } = await supabase
    .from('team_exercises')
    .update(update)
    .eq('team_id', teamId)
    .eq('exercise_key', exerciseKey);
  if (error) throw error;
}

// Effective per-athlete assignment: team_exercises.enabled is the default,
// overridden by any explicit row in athlete_exercise_assignments.
export async function getEffectiveAssignments(
  teamId: string,
  athleteIds: string[],
): Promise<Map<string, Set<ExerciseKey>>> {
  const [{ data: configs, error: cErr }, { data: overrides, error: oErr }] = await Promise.all([
    supabase.from('team_exercises').select('exercise_key, enabled').eq('team_id', teamId),
    athleteIds.length
      ? supabase.from('athlete_exercise_assignments').select('athlete_id, exercise_key, assigned').in('athlete_id', athleteIds)
      : Promise.resolve({ data: [] as any[], error: null }),
  ]);
  if (cErr) throw cErr;
  if (oErr) throw oErr;

  const enabledDefaults = new Set(
    (configs ?? []).filter((c: any) => c.enabled).map((c: any) => c.exercise_key as ExerciseKey),
  );

  const overrideMap = new Map<string, Map<ExerciseKey, boolean>>();
  for (const o of overrides ?? []) {
    const m = overrideMap.get(o.athlete_id) ?? new Map<ExerciseKey, boolean>();
    m.set(o.exercise_key as ExerciseKey, o.assigned);
    overrideMap.set(o.athlete_id, m);
  }

  const result = new Map<string, Set<ExerciseKey>>();
  for (const athleteId of athleteIds) {
    const athleteOverrides = overrideMap.get(athleteId);
    const set = new Set<ExerciseKey>();
    for (const key of EXERCISE_KEYS) {
      const override = athleteOverrides?.get(key);
      const assigned = override !== undefined ? override : enabledDefaults.has(key);
      if (assigned) set.add(key);
    }
    result.set(athleteId, set);
  }
  return result;
}

// Pass `null` to clear an override and revert to the team default.
export async function setAssignmentOverride(
  athleteId: string,
  exerciseKey: ExerciseKey,
  assigned: boolean | null,
): Promise<void> {
  if (assigned === null) {
    const { error } = await supabase
      .from('athlete_exercise_assignments')
      .delete()
      .eq('athlete_id', athleteId)
      .eq('exercise_key', exerciseKey);
    if (error) throw error;
    return;
  }

  const { error } = await supabase
    .from('athlete_exercise_assignments')
    .upsert(
      { athlete_id: athleteId, exercise_key: exerciseKey, assigned },
      { onConflict: 'athlete_id,exercise_key' },
    );
  if (error) throw error;
}
