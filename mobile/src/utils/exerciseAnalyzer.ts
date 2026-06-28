/**
 * Exercise Analysis Hub
 *
 * Detects and counts squat, deadlift, and vertical jump repetitions from a
 * sequence of MediaPipe Pose landmark frames captured during video playback.
 *
 * This file has two responsibilities:
 *   1. Export EXERCISE_ANALYZER_JS — the browser-side JS (as a string) that is
 *      embedded inside PoseView/html.ts so it runs inside the WebView alongside
 *      MediaPipe. All landmark collection and rep-counting happen there.
 *   2. Export TypeScript types used by the React Native layer to display results.
 *
 * ── Biomechanical thresholds (research-backed) ─────────────────────────────
 *
 * SQUAT  (PMID 22801421; IJSPT 2021)
 *   Knee angle at depth:  85–130° (parallel → deep)  → threshold 115°
 *   Torso lean:           10–45° from vertical        → max 40° (stays upright)
 *   Hip angle:            95–100° at bottom
 *   Distinguisher from deadlift: torso lean significantly less
 *
 * DEADLIFT — conventional  (NSCA; Powerliftingtechnique.com)
 *   Torso lean at bottom: 45–60° from vertical        → threshold 45°
 *   Knee angle:           57–95° (hip hinge dominant) → looser range
 *   Hip angle:            <90° at bottom               → threshold 90°
 *   Distinguisher from squat: dominant torso lean + hip hinge, not knee drive
 *
 * VERTICAL JUMP  (PMC 11208864; PMC 11368081)
 *   Counter-movement knee: 70–110°
 *   Flight phase: ankle position rises > 6% of normalised frame height
 *   Distinguisher: ankles leave ground level entirely (not seen in squat/deadlift)
 */

export interface ExerciseResults {
  squat: number;
  deadlift: number;
  verticalJump: number;
}

export function hasAnyExercise(r: ExerciseResults): boolean {
  return r.squat > 0 || r.deadlift > 0 || r.verticalJump > 0;
}

/**
 * JavaScript source that runs inside the WebView (embedded via template
 * interpolation in html.ts).  Must NOT contain backtick characters.
 *
 * Defines:
 *   var landmarkHistory  — filled by renderFrame on every detected frame
 *   copyLandmarks(lm)   — snapshot helper called from renderFrame
 *   analyzeExercises()  — called on video 'ended'; returns ExerciseResults | null
 */
export const EXERCISE_ANALYZER_JS = `
// ── exercise analysis ─────────────────────────────────────────────────────────

var landmarkHistory = [];

function copyLandmarks(lm) {
  var out = [];
  for (var i = 0; i < lm.length; i++) out.push({ x: lm[i].x, y: lm[i].y });
  return out;
}

// Angle at vertex B formed by points A-B-C (2D, degrees).
function angle2D(a, b, c) {
  var abx = a.x - b.x, aby = a.y - b.y;
  var cbx = c.x - b.x, cby = c.y - b.y;
  var dot = abx * cbx + aby * cby;
  var mag = Math.sqrt((abx * abx + aby * aby) * (cbx * cbx + cby * cby));
  if (mag < 1e-6) return 180;
  return Math.acos(Math.max(-1, Math.min(1, dot / mag))) * 180 / Math.PI;
}

// Extract the four biomechanically significant signals per frame.
// MediaPipe landmark indices (Pose 33-point model):
//   11/12 = L/R shoulder   23/24 = L/R hip
//   25/26 = L/R knee       27/28 = L/R ankle
function extractFeatures(lm) {
  // Average both sides — more robust to occlusion / sideways camera.
  var kneeAngle = (angle2D(lm[23], lm[25], lm[27]) + angle2D(lm[24], lm[26], lm[28])) / 2;
  var hipAngle  = (angle2D(lm[11], lm[23], lm[25]) + angle2D(lm[12], lm[24], lm[26])) / 2;

  // Torso lean from vertical: angle of the shoulder-midpoint → hip-midpoint vector.
  // 0° = perfectly upright, 90° = horizontal.
  var msx = (lm[11].x + lm[12].x) / 2, msy = (lm[11].y + lm[12].y) / 2;
  var mhx = (lm[23].x + lm[24].x) / 2, mhy = (lm[23].y + lm[24].y) / 2;
  var dy = Math.abs(msy - mhy);
  var torsoLean = Math.atan2(Math.abs(msx - mhx), dy < 0.001 ? 0.001 : dy) * 180 / Math.PI;

  var ankleY = (lm[27].y + lm[28].y) / 2; // higher value = lower in frame (y-down coords)

  return { kneeAngle: kneeAngle, hipAngle: hipAngle, torsoLean: torsoLean, ankleY: ankleY };
}

// Sliding-window average over each signal to reduce residual frame noise
// before the state machines run.
function smoothFeatures(features) {
  var W = 4; // half-window: 4 frames each side ≈ 0.13 s at 30 fps
  var result = [];
  for (var i = 0; i < features.length; i++) {
    var lo = Math.max(0, i - W), hi = Math.min(features.length - 1, i + W);
    var kSum = 0, hSum = 0, lSum = 0, aSum = 0, n = 0;
    for (var j = lo; j <= hi; j++) {
      kSum += features[j].kneeAngle;
      hSum += features[j].hipAngle;
      lSum += features[j].torsoLean;
      aSum += features[j].ankleY;
      n++;
    }
    result.push({ kneeAngle: kSum/n, hipAngle: hSum/n, torsoLean: lSum/n, ankleY: aSum/n });
  }
  return result;
}

// ── rep counters ─────────────────────────────────────────────────────────────

// Squat: bilateral knee flexion to 85-130° with torso staying upright (<40°).
// State: STANDING (knee>155°) -> AT_DEPTH (knee<115°, lean<40°) -> STANDING = 1 rep.
function countSquats(f) {
  var STAND = 155, DEPTH = 115, LEAN_MAX = 40;
  var count = 0, wasStanding = f[0].kneeAngle > STAND, atDepth = false;
  for (var i = 0; i < f.length; i++) {
    if (!atDepth && f[i].kneeAngle > STAND) wasStanding = true;
    if (wasStanding && !atDepth && f[i].kneeAngle < DEPTH && f[i].torsoLean < LEAN_MAX) {
      atDepth = true; wasStanding = false;
    }
    if (atDepth && f[i].kneeAngle > STAND) {
      count++; atDepth = false; wasStanding = true;
    }
  }
  return count;
}

// Deadlift: hip-hinge dominant — torso leans 45-60° forward while hip angle
// drops below 90°.  Much more torso lean than squat; knee flexion is secondary.
// State: STANDING (lean<20°, hip>150°) -> AT_DEPTH (lean>45°, hip<90°) -> STANDING = 1 rep.
function countDeadlifts(f) {
  var STAND_LEAN = 20, STAND_HIP = 150, DEPTH_LEAN = 45, DEPTH_HIP = 90;
  var count = 0, wasStanding = f[0].torsoLean < STAND_LEAN, atDepth = false;
  for (var i = 0; i < f.length; i++) {
    if (!atDepth && f[i].torsoLean < STAND_LEAN && f[i].hipAngle > STAND_HIP) wasStanding = true;
    if (wasStanding && !atDepth && f[i].torsoLean > DEPTH_LEAN && f[i].hipAngle < DEPTH_HIP) {
      atDepth = true; wasStanding = false;
    }
    if (atDepth && f[i].torsoLean < STAND_LEAN && f[i].hipAngle > STAND_HIP) {
      count++; atDepth = false; wasStanding = true;
    }
  }
  return count;
}

// Vertical jump: ankles rise more than 6% of normalised frame height above the
// standing baseline (established from the first 12% of frames).
// Each continuous period of being airborne = 1 jump.
function countJumps(f) {
  if (f.length < 10) return 0;
  var baseN = Math.max(5, Math.floor(f.length * 0.12));
  var baseSum = 0;
  for (var i = 0; i < baseN; i++) baseSum += f[i].ankleY;
  var baseline = baseSum / baseN;
  var JUMP_THRESH = 0.06;  // ankles must rise >6% of frame to count as airborne
  var LAND_THRESH = 0.025; // considered landed when back within 2.5%
  var count = 0, inFlight = false;
  for (var j = 0; j < f.length; j++) {
    var rise = baseline - f[j].ankleY; // positive = feet went up in frame (y-down coords)
    if (!inFlight && rise > JUMP_THRESH) inFlight = true;
    else if (inFlight && rise < LAND_THRESH) { count++; inFlight = false; }
  }
  return count;
}

// ── public entry point ────────────────────────────────────────────────────────

function analyzeExercises() {
  if (landmarkHistory.length < 15) return null;
  var raw      = landmarkHistory.map(extractFeatures);
  var features = smoothFeatures(raw);
  return {
    squat:        countSquats(features),
    deadlift:     countDeadlifts(features),
    verticalJump: countJumps(features)
  };
}
`;
