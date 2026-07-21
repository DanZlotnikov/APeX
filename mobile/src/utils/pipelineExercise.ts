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
