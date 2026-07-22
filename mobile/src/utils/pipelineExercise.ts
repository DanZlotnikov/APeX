/**
 * Display labels for the new pipeline's exercise_type vocabulary — squat/jump/
 * pullup are the legacy-bridged keys (see legacy_metrics.legacy_exercise_key);
 * deadlift/push_up/ab_crunch are the pipeline's own raw keys, which have no
 * legacy profile (see HANDOFF_video_pipeline.md section 3.4). Used by
 * Performance/History and the Processing tab, not the old manager-module
 * catalog in exerciseMetrics.ts.
 */
const LABELS: Record<string, string> = {
  squat: 'Squat',
  jump: 'Vertical Jump',
  pullup: 'Pull-Up',
  deadlift: 'Deadlift',
  push_up: 'Push-Up',
  ab_crunch: 'Ab Crunch',
};

export function exerciseLabel(exerciseType: string | null | undefined): string {
  if (!exerciseType) return 'Exercise';
  return LABELS[exerciseType] ?? exerciseType;
}

// All 6 exercises the detection pipeline knows about, in the same bridged
// vocabulary sessions.exercise_type / video_jobs.exercise_type use (see
// migration 009's comment) — the canonical list for the Routine feature
// (migration 014), which covers every pipeline exercise, not just the older
// squat/jump/pullup-only manager-module catalog in exerciseMetrics.ts.
export type PipelineExerciseKey = 'squat' | 'jump' | 'pullup' | 'deadlift' | 'push_up' | 'ab_crunch';

export const PIPELINE_EXERCISE_KEYS: PipelineExerciseKey[] = ['squat', 'jump', 'pullup', 'deadlift', 'push_up', 'ab_crunch'];

// Resolves which exercise a completed video_jobs row actually turned out to
// be, in the bridged vocabulary above — squat/jump/pullup are bridged from
// the pipeline's own raw vertical_jump/pull_up keys via legacy_metrics;
// deadlift/push_up/ab_crunch have no bridge and pass through as-is. Mirrors
// OverviewScreen's Today's Tasks resolution logic (resolveTaskStatus)
// exactly, factored out so the Routine feature's completion-matching stays
// consistent with it without duplicating the two call sites' inline logic.
export function resolveJobExerciseKey(job: {
  exerciseType: string | null;
  analysis: { analyses?: { legacy_metrics?: { legacy_exercise_key?: string } } } | null;
}): string | null {
  return job.analysis?.analyses?.legacy_metrics?.legacy_exercise_key ?? job.exerciseType ?? null;
}
