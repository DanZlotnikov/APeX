/**
 * Display labels for the new pipeline's exercise_type vocabulary — squat/jump/
 * pullup are the bridged keys (see RAW_TO_BRIDGED below); deadlift/push_up/
 * ab_crunch are the pipeline's own raw keys, which already coincide with
 * their bridged form. Used by Performance/History, the Processing tab, and
 * the manager module — all share this one vocabulary now (see
 * MANAGER_MODULE_AUDIT.md).
 *
 * Both the bridged AND raw forms are listed for every exercise, even where
 * that's a duplicate entry — `video_jobs.analysis_json.exercise` and
 * `video_jobs.exercise_type` are always the pipeline's RAW key
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

// The pipeline's raw exercise keys -> the bridged vocabulary every table
// (sessions.exercise_type, athlete_routines.exercise_type, team_routines.
// exercise_type) actually stores — mirrors save_video_job's own CASE mapping
// (migration 018) exactly, so a completed-but-not-yet-saved job resolves to
// the SAME key saving it will produce. squat/deadlift/push_up/ab_crunch's
// raw key already equals their bridged one, so only these two need mapping.
const RAW_TO_BRIDGED: Record<string, string> = { vertical_jump: 'jump', pull_up: 'pullup' };

// Resolves which exercise a completed video_jobs row actually turned out to
// be, in the bridged vocabulary above. Mirrors OverviewScreen's Today's
// Tasks resolution logic (resolveTaskStatus) exactly, factored out so the
// Routine feature's completion-matching stays consistent with it without
// duplicating the two call sites' inline logic.
export function resolveJobExerciseKey(job: { exerciseType: string | null }): string | null {
  if (!job.exerciseType) return null;
  return RAW_TO_BRIDGED[job.exerciseType] ?? job.exerciseType;
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
