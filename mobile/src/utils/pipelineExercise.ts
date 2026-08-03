/**
 * The app's exercise vocabulary — which exercises exist, their display
 * labels, and the bridged/raw key mapping — is sourced from Supabase (see
 * api/exercises.ts, supabase/migrations/023_exercises_registry.sql) rather
 * than hardcoded here, so disabling/relabeling/reordering/re-enabling any
 * exercise the pipeline already detects is a data change, not an app-store
 * release. This file just wraps that cache for the rest of the app (Performance/
 * History, the Processing tab, the manager module, the routine screens),
 * which all share this one vocabulary.
 *
 * Bridged vs. raw: `sessions.exercise_type` / `athlete_routine_sets.exercise_type`
 * always store the BRIDGED key; `video_jobs.exercise_type` /
 * `video_jobs.analysis_json.exercise` always store the pipeline's own RAW
 * key (see migration 009's comment) — identical for most exercises, but
 * different for vertical_jump/pull_up (bridged: jump/pullup). Passing a raw
 * key straight into exerciseLabel() without resolving it first is exactly
 * the bug that once made a completed pull-up card's header read "pull_up"
 * verbatim — resolveJobExerciseKey() below is the fix, unchanged by the
 * move to a DB-driven registry.
 */
import {
  ExerciseInfo, getAvailableExercises, getCachedExerciseCategoriesSync, getCachedExercisesSync,
} from '../api/exercises';

// Loosened from a fixed string-literal union now that the actual set of
// keys is DB-driven, not a fixed compile-time list — callers that need the
// CURRENT list at a point in time should call getPipelineExerciseKeys()
// (always complete/correct) rather than assume a fixed set.
export type PipelineExerciseKey = string;

export function exerciseLabel(exerciseType: string | null | undefined): string {
  if (!exerciseType) return 'Exercise';
  const match = getCachedExercisesSync().find((e) => e.key === exerciseType);
  return match?.label ?? exerciseType;
}

// Same cached-lookup/raw-key-fallback shape as exerciseLabel() above, for
// the exercise's category rather than the exercise itself.
export function categoryLabel(categoryKey: string | null | undefined): string {
  if (!categoryKey) return 'Category';
  const match = getCachedExerciseCategoriesSync().find((c) => c.key === categoryKey);
  return match?.label ?? categoryKey;
}

// Every currently-enabled exercise key, in display (sort_order) order —
// replaces the old static PIPELINE_EXERCISE_KEYS constant. Async because
// the registry is fetched from Supabase; memoized (api/exercises.ts), so
// this resolves instantly after the first real call anywhere in the app.
export async function getPipelineExerciseKeys(): Promise<PipelineExerciseKey[]> {
  const list = await getAvailableExercises();
  return list.map((e) => e.key);
}

// Same as getPipelineExerciseKeys(), but returns the full ExerciseInfo
// (label included) for call sites building a picker/list that need both —
// avoids a second cache lookup per row.
export async function getAvailableExerciseInfos(): Promise<ExerciseInfo[]> {
  return getAvailableExercises();
}

// Resolves which exercise a completed video_jobs row actually turned out to
// be, in the bridged vocabulary above. Used by the Routine feature's
// completion-matching (routineProgress.ts) so it stays consistent with how
// sessions.exercise_type is populated.
export function resolveJobExerciseKey(job: { exerciseType: string | null }): string | null {
  if (!job.exerciseType) return null;
  const match = getCachedExercisesSync().find((e) => e.rawKey === job.exerciseType);
  return match?.key ?? job.exerciseType;
}

// Readiness = the average of whichever of {L/R balance, range of motion,
// arm fixation} this exercise actually produced (see migration 027's
// save_video_job) — a perfectly symmetric but shallow rep, or vice versa,
// shouldn't read as "Ready" on one score alone; same reasoning extends to
// fixation for exercises like Padel Stroke that only ever produce that one
// analysis (no balance/rom profile registered for it — see
// biomechanics/fixation_thresholds.py). Falls back to whichever subset of
// scores is present; null only if none of the three analyzers produced a
// result (e.g. 0 reps). The ONE place this formula lives client-side —
// every screen that shows a "readiness" number for a completed-but-not-yet-
// saved video_jobs row (the Routine progress table, BiomechanicsReport's
// gauge) must call this rather than reading overall_balance_pct/
// overall_rom_pct/overall_fixation_pct directly, so a job never shows a
// different readiness number before Save than sessions.readiness_score
// gives it after.
export function readinessPctFromAnalysis(analysis: {
  analyses?: {
    balance?: { overall_balance_pct: number };
    rom?: { overall_rom_pct: number };
    fixation?: { overall_fixation_pct: number };
  };
} | null | undefined): number | null {
  const pcts = [
    analysis?.analyses?.balance?.overall_balance_pct,
    analysis?.analyses?.rom?.overall_rom_pct,
    analysis?.analyses?.fixation?.overall_fixation_pct,
  ].filter((v): v is number => v != null);
  if (pcts.length === 0) return null;
  return pcts.reduce((sum, v) => sum + v, 0) / pcts.length;
}
