/**
 * Display labels for the new pipeline's exercise_type vocabulary — squat/jump/
 * pullup are the legacy-bridged keys (see legacy_metrics.legacy_exercise_key);
 * deadlift/push_up/ab_crunch are the pipeline's own raw keys, which have no
 * legacy profile (see HANDOFF_video_pipeline.md section 3.4). Used by
 * Performance/History and the Processing tab, not the old manager-module
 * catalog in exerciseMetrics.ts.
 *
 * Both the bridged AND raw forms are listed for every exercise, even where
 * that's a duplicate entry (e.g. squat/deadlift/push_up/ab_crunch's raw key
 * already equals their bridged one) — `video_jobs.analysis_json.exercise`
 * and `video_jobs.exercise_type` are always the pipeline's RAW key
 * (squat|deadlift|vertical_jump|pull_up|push_up|ab_crunch; see migration
 * 009's comment), never the bridged one, so any call site passing either of
 * those straight into exerciseLabel() was showing the raw "vertical_jump"/
 * "pull_up" string verbatim — confirmed in production (a completed pull-up
 * card's header literally read "pull_up"). Only vertical_jump/pull_up were
 * actually missing before; every other raw key already coincided with its
 * bridged form and so happened to resolve correctly by accident.
 */
const LABELS: Record<string, string> = {
  squat: 'Squat',
  jump: 'Vertical Jump',
  vertical_jump: 'Vertical Jump',
  pullup: 'Pull-Up',
  pull_up: 'Pull-Up',
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

// Readiness = the average of L/R balance and range of motion when both are
// present for this exercise (see migration 016's save_video_job) — a
// perfectly symmetric but shallow rep, or vice versa, shouldn't read as
// "Ready" on one score alone. Falls back to whichever single score is
// present if only one analyzer produced a result (e.g. 0 reps); null if
// neither did. The ONE place this formula lives client-side — every screen
// that shows a "readiness" number for a completed-but-not-yet-saved
// video_jobs row (Today's Tasks, the Routine progress table,
// BiomechanicsReport's gauge) must call this rather than reading
// overall_balance_pct directly, so a job never shows a different readiness
// number before Save than sessions.readiness_score gives it after.
export function readinessPctFromAnalysis(analysis: {
  analyses?: { balance?: { overall_balance_pct: number }; rom?: { overall_rom_pct: number } };
} | null | undefined): number | null {
  const balancePct = analysis?.analyses?.balance?.overall_balance_pct;
  const romPct = analysis?.analyses?.rom?.overall_rom_pct;
  if (balancePct != null && romPct != null) return (balancePct + romPct) / 2;
  if (balancePct != null) return balancePct;
  if (romPct != null) return romPct;
  return null;
}
