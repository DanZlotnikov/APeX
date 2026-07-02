/**
 * Physio / corrective-exercise library.
 *
 * The WebView assessment only decides *which* RecommendationKey applies (the
 * worst sub-green risk factor). All human-facing content — the exercise name,
 * rationale, step-by-step instructions, dosage, and which demo animation to
 * play — lives here in React Native so it's easy to edit and localise.
 *
 * Dosages are drawn from the corrective-exercise literature referenced in the
 * assessment module plan (glute/hip-abductor strengthening for valgus &
 * asymmetry, soft-landing neuromuscular retraining, hip-hinge patterning).
 */
import { RecommendationKey } from './exerciseAnalyzer';

/** Which looping stick-figure demo PhysioDemo should render. */
export type DemoKey =
  | 'lateralBandWalk'
  | 'gobletSquat'
  | 'softLanding'
  | 'singleLegRDL'
  | 'tempoSquat';

export interface PhysioExercise {
  name: string;
  target: string;      // what risk this addresses, short
  why: string;         // one/two sentence rationale
  steps: string[];     // numbered how-to
  frequency: string;   // e.g. '2–3× per week'
  duration: string;    // e.g. '3 × 15 each direction'
  timeline: string;    // expected time to improvement
  demoKey: DemoKey;
}

export const PHYSIO_LIBRARY: Record<RecommendationKey, PhysioExercise> = {
  symmetry: {
    name: 'Lateral Band Walk + Single-Leg Glute Bridge',
    target: 'Left/right imbalance & knee control',
    why:
      'Left/right asymmetry over ~10–15% raises re-injury risk. Strengthening the ' +
      'gluteus medius evens out how the legs share load and controls inward knee collapse.',
    steps: [
      'Loop a band just above the knees, feet hip-width, athletic quarter-squat.',
      'Step sideways, keeping knees pushed out over the toes and trunk upright.',
      'Take 15 controlled steps one way, then 15 back — that is one set.',
      'Then: single-leg glute bridge, 10 slow reps per side, squeezing the glute at the top.',
    ],
    frequency: '2–3× per week',
    duration: '3 × 15 steps each way · 3 × 10 bridges/side',
    timeline: 'Most see improvement in 4–8 weeks',
    demoKey: 'lateralBandWalk',
  },
  mobility: {
    name: 'Goblet Squat-to-Box + Ankle Mobilization',
    target: 'Limited squat depth',
    why:
      'Shallow depth usually comes from ankle/hip mobility limits. Squatting to a ' +
      'box teaches controlled depth while ankle drills unlock the range to get there.',
    steps: [
      'Ankle rock: half-kneel, drive the front knee forward over the toes, 10 reps/side.',
      'Hold a light weight at your chest, stand in front of a box or chair.',
      'Sit back and down until you lightly touch the box, keeping heels down.',
      'Pause 1 second, then stand tall. Lower the box over weeks as depth improves.',
    ],
    frequency: 'Mobility daily · squats 3× per week',
    duration: '3 × 8 goblet squats · 2 × 10 ankle rocks/side',
    timeline: 'Noticeable range gains in 3–6 weeks',
    demoKey: 'gobletSquat',
  },
  landing: {
    name: 'Soft Drop-Landing Drill',
    target: 'Stiff landings (impact absorption)',
    why:
      'Landing with stiff, extended knees spikes impact force and ACL strain. ' +
      'Retraining a soft, bent-knee landing lowers peak forces and injury risk.',
    steps: [
      'Stand on a low step or box (15–30 cm).',
      'Step off and land on both feet at once — do not jump up.',
      'Land quietly: bend hips, knees and ankles to absorb, knees tracking over toes.',
      'Hold the soft landing for 2 seconds. Reset and repeat.',
    ],
    frequency: '2× per week',
    duration: '3 × 5 landings',
    timeline: 'Mechanics improve in 6–8 weeks',
    demoKey: 'softLanding',
  },
  hinge: {
    name: 'Single-Leg RDL + Side Plank',
    target: 'Hinge control & lateral hip shift',
    why:
      'An inconsistent torso angle or hips drifting to one side points to weak ' +
      'lateral-hip control. Single-leg hinging and side planks rebuild that stability.',
    steps: [
      'Stand on one leg, soft knee, light weight in the opposite hand.',
      'Hinge at the hip — chest down, back leg reaching back — keep hips level.',
      'Rise back to standing under control. 8 reps, then switch sides.',
      'Finish with a 30-second side plank per side, hips stacked and lifted.',
    ],
    frequency: '2–3× per week',
    duration: '3 × 8/side · 3 × 30s side plank',
    timeline: 'Improves in 4–6 weeks',
    demoKey: 'singleLegRDL',
  },
  fatigue: {
    name: 'Tempo Endurance Sets',
    target: 'Form breakdown under fatigue',
    why:
      'Later reps losing depth or slowing down signals the pattern fails as you ' +
      'fatigue. Controlled-tempo sets build the endurance to hold form throughout.',
    steps: [
      'Pick a light-to-moderate load you can control for 12 clean reps.',
      'Lower for a 3-second count, pause 1 second at the bottom.',
      'Rise for a 2-second count — no bouncing or rushing.',
      'Keep every rep identical; stop the set the moment form changes.',
    ],
    frequency: '2× per week',
    duration: '3 × 12 controlled-tempo reps',
    timeline: 'Endurance builds in 3–5 weeks',
    demoKey: 'tempoSquat',
  },
};
