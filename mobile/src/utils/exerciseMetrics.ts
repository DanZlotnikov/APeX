/**
 * Exercise vocabulary for the retired on-device analyzer's session shape
 * (mobile/src/utils/exerciseAnalyzer.ts, mobile/src/api/sessions.ts's
 * createSession). That on-device recording flow is no longer reachable from
 * any navigation path (see MANAGER_MODULE_AUDIT.md section 5) but its types
 * still compile against this file — kept minimal, for that alone.
 *
 * The manager module and the live pipeline use the 6-exercise vocabulary in
 * mobile/src/utils/pipelineExercise.ts instead; the manager-configurable
 * per-metric threshold system that used to live in this file (EXERCISE_
 * METRICS, thresholds, passesMetric) was removed — see migration 018.
 */

export type ExerciseKey = 'squat' | 'jump' | 'pullup';

export const EXERCISE_KEYS: ExerciseKey[] = ['squat', 'jump', 'pullup'];

export const EXERCISE_LABELS: Record<ExerciseKey, string> = {
  squat: 'Squat',
  jump: 'Vertical Jump',
  pullup: 'Pull-Up',
};
