/**
 * Exercise metric catalog for manager-configurable test thresholds.
 *
 * Each exercise exposes exactly the three `RiskFactor`s already computed by
 * `computeAssessment` in exerciseAnalyzer.ts — `id` below matches the factor
 * id exactly (`jump`'s `flightTime` is the one exception: it isn't a factor,
 * it's derived from `perRepDurationSec` in api/sessions.ts). Default
 * thresholds are expressed in the same unit the analyzer already produces
 * (mostly `%`), so a threshold check is a direct comparison against a number
 * the app already computes — see README section "exercise metrics" for the
 * research basis of each default.
 */

export type ExerciseKey = 'squat' | 'jump' | 'pullup';

export const EXERCISE_KEYS: ExerciseKey[] = ['squat', 'jump', 'pullup'];

export const EXERCISE_LABELS: Record<ExerciseKey, string> = {
  squat: 'Squat',
  jump: 'Vertical Jump',
  pullup: 'Pull-Up',
};

export const EXERCISE_SHORT_LABELS: Record<ExerciseKey, string> = {
  squat: 'SQUAT',
  jump: 'JUMP',
  pullup: 'PULL-UP',
};

export type MetricDirection = 'min' | 'max'; // 'min' = pass if value >= threshold, 'max' = pass if value <= threshold

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  direction: MetricDirection;
  defaultThreshold: number;
  research: string;
}

export const EXERCISE_METRICS: Record<ExerciseKey, MetricDef[]> = {
  squat: [
    {
      id: 'depth', label: 'Depth', unit: '%', direction: 'min', defaultThreshold: 80,
      research: 'IJSPT 2021 / NSCA — parallel (~90° knee flexion) is the standard depth benchmark.',
    },
    {
      id: 'symmetry', label: 'L/R Symmetry', unit: '%', direction: 'max', defaultThreshold: 15,
      research: 'PMID 22801421 — ACL return-to-sport literature flags >10–15% limb-symmetry deficits as elevated re-injury risk.',
    },
    {
      id: 'fatigue', label: 'Fatigue / Consistency', unit: '%', direction: 'max', defaultThreshold: 30,
      research: 'General resistance-training fatigue-monitoring convention: ~20–30% within-session decrement signals technique breakdown.',
    },
  ],
  jump: [
    {
      id: 'landing', label: 'Landing Softness', unit: '%', direction: 'min', defaultThreshold: 65,
      research: 'PMC 11208864 / PMC 11368081 — stiff landings (<~15–20° flexion) are an established ACL-risk marker; 65% sits well above that.',
    },
    {
      id: 'symmetry', label: 'Landing Symmetry', unit: '%', direction: 'max', defaultThreshold: 15,
      research: 'Same limb-symmetry-index asymmetry rationale as squat.',
    },
    {
      id: 'flightTime', label: 'Flight Time', unit: 's', direction: 'min', defaultThreshold: 0.40,
      research: 'CMJ flight time is a standard team-sport neuromuscular-fatigue monitoring metric; floor value flags reduced power output.',
    },
  ],
  pullup: [
    {
      id: 'depth', label: 'Range of Motion', unit: '%', direction: 'min', defaultThreshold: 60,
      research: 'Full dead-hang-to-chin-over-bar is the S&C technique standard; 60% sits mid-way between the analyzer’s good/bad ROM cutoffs.',
    },
    {
      id: 'symmetry', label: 'L/R Symmetry', unit: '%', direction: 'max', defaultThreshold: 15,
      research: 'Same limb-symmetry-index asymmetry rationale as squat.',
    },
    {
      id: 'fatigue', label: 'Fatigue / Consistency', unit: '%', direction: 'max', defaultThreshold: 30,
      research: 'Same resistance-training fatigue-monitoring convention as squat.',
    },
  ],
};

export const DEFAULT_MIN_REPS: Record<ExerciseKey, number> = {
  squat: 5,
  jump: 3,
  pullup: 3,
};

export function defaultThresholds(key: ExerciseKey): Record<string, number> {
  const out: Record<string, number> = {};
  for (const m of EXERCISE_METRICS[key]) out[m.id] = m.defaultThreshold;
  return out;
}

export function passesMetric(direction: MetricDirection, value: number, threshold: number): boolean {
  return direction === 'min' ? value >= threshold : value <= threshold;
}
