import { ExerciseKey } from '../utils/exerciseMetrics';
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

// Raw per-athlete override rows, keyed by athlete then exercise. Absence of
// an entry for a given exercise means "no override for this athlete" — the
// team default applies. This is the only place that reads
// athlete_exercise_assignments; resolveRequiredExercises below is the only
// place that interprets it.
async function getAssignmentOverrides(
  athleteIds: string[],
): Promise<Map<string, Map<ExerciseKey, boolean>>> {
  const overrideMap = new Map<string, Map<ExerciseKey, boolean>>();
  if (!athleteIds.length) return overrideMap;

  const { data, error } = await supabase
    .from('athlete_exercise_assignments')
    .select('athlete_id, exercise_key, assigned')
    .in('athlete_id', athleteIds);
  if (error) throw error;

  for (const o of data ?? []) {
    const m = overrideMap.get(o.athlete_id) ?? new Map<ExerciseKey, boolean>();
    m.set(o.exercise_key as ExerciseKey, o.assigned);
    overrideMap.set(o.athlete_id, m);
  }
  return overrideMap;
}

// SINGLE SOURCE OF TRUTH for "is this exercise required for this athlete?"
// team_exercises.enabled is only the default; an explicit per-athlete row in
// athlete_exercise_assignments always wins over it, in either direction (can
// turn an exercise ON for one athlete when the team default is off, or OFF
// when the default is on). Every other computation that needs to know an
// athlete's required exercises — readiness, the monitoring table, compliance
// counts — must derive it by calling this, not by re-deriving the rule.
export function resolveRequiredExercises(
  teamExercises: TeamExerciseConfig[],
  overrides: Map<ExerciseKey, boolean> | undefined,
): ExerciseKey[] {
  return teamExercises
    .filter((c) => overrides?.get(c.exerciseKey) ?? c.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((c) => c.exerciseKey);
}

// Effective per-athlete assignment for every athlete in athleteIds. Pass
// `teamExercises` if the caller already fetched it (e.g. alongside other
// team-scoped queries) to avoid re-fetching the same table.
export async function getEffectiveAssignments(
  teamId: string,
  athleteIds: string[],
  teamExercises?: TeamExerciseConfig[],
): Promise<Map<string, Set<ExerciseKey>>> {
  const [configs, overrideMap] = await Promise.all([
    teamExercises ?? getTeamExercises(teamId),
    getAssignmentOverrides(athleteIds),
  ]);

  const result = new Map<string, Set<ExerciseKey>>();
  for (const athleteId of athleteIds) {
    result.set(athleteId, new Set(resolveRequiredExercises(configs, overrideMap.get(athleteId))));
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
