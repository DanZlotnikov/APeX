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

// ── readiness / injury assessment types ──────────────────────────────────────
// Produced by computeAssessment() inside the WebView and posted to React Native
// as { type: 'assessment', assessment: Assessment } at the end of the preprocess
// pass. Rendered by AssessmentPanel under the video.

export type RiskStatus = 'green' | 'yellow' | 'red';

/** Which physio recommendation a factor maps to (keys into physioLibrary). */
export type RecommendationKey =
  | 'symmetry'
  | 'mobility'
  | 'landing'
  | 'hinge'
  | 'fatigue';

/** Objective, non-judgemental numbers characterising one exercise. */
export interface MovementMetrics {
  maxKneeAngle: number; // degrees (most extended)
  minKneeAngle: number; // degrees (deepest flexion)
  romDeg: number;       // knee range of motion (max - min)
  avgRepSec: number;    // average time per rep, seconds
  totalSec: number;     // total time under movement, seconds
}

/** One color-coded risk factor with a headline percentage. */
export interface RiskFactor {
  id: string;           // e.g. 'symmetry' | 'depth' | 'fatigue' | 'landing' | 'hinge'
  label: string;        // display name, e.g. 'Left / Right Symmetry'
  value: number;        // headline number shown next to the label
  unit: string;         // usually '%'
  score: number;        // 0-100 quality subscore (higher = safer)
  status: RiskStatus;   // derived from score
  detail: string;       // one-line plain-language explanation
  rec: RecommendationKey; // physio key this factor maps to when sub-green
}

export interface ExerciseAssessment {
  key: 'squat' | 'deadlift' | 'jump';
  label: string;
  reps: number;
  metrics: MovementMetrics;
  factors: RiskFactor[];
}

export interface Assessment {
  perExercise: ExerciseAssessment[];
  readiness: number;          // 0-100 overall readiness for hard training
  readinessLabel: string;     // 'Ready' | 'Caution' | 'High Risk'
  recommendation: RecommendationKey | null; // worst sub-green factor, or null
  confidence: number;         // 0-1 mean landmark tracking confidence
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
var timeHistory = []; // parallel array: real video currentTime (s) per stored frame

function copyLandmarks(lm) {
  var out = [];
  for (var i = 0; i < lm.length; i++) {
    out.push({ x: lm[i].x, y: lm[i].y, visibility: lm[i].visibility == null ? 1 : lm[i].visibility });
  }
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
  var W = 2; // half-window: 2 frames each side ≈ 0.07 s at 30 fps
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

// Squat: bilateral knee flexion with torso staying relatively upright.
// Physio-oriented: thresholds adapt to the patient's actual range of motion so
// partial / rehab-depth squats count equally. wasStanding starts true so the
// very first descent is never skipped.
function countSquats(f) {
  if (!f.length) return 0;
  var LEAN_MAX = 65; // generous — physio patients often lean forward

  // Derive this patient's knee range of motion across the whole clip.
  var minKnee = Infinity, maxKnee = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (f[i].kneeAngle < minKnee) minKnee = f[i].kneeAngle;
    if (f[i].kneeAngle > maxKnee) maxKnee = f[i].kneeAngle;
  }
  var range = maxKnee - minKnee;
  if (range < 15) return 0; // no meaningful knee flexion detected

  // "Depth" = bottom 25% of range; "Standing" = top 45% of range.
  // Wide hysteresis gap so partial extensions between reps still count.
  var DEPTH = minKnee + range * 0.25;
  var STAND = minKnee + range * 0.55;

  var count = 0, wasStanding = true, atDepth = false;
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

// ── live rep counting (show phase, frame-by-frame) ────────────────────────────
// liveState is initialised once after preprocess using the landmark history to
// derive the same adaptive thresholds. stepLiveCounters() is then called every
// renderFrame in show phase; counts are drawn on the canvas by drawCounter().

var liveState = null;

function initLiveCounters(history) {
  if (!history || history.length < 15) { liveState = null; return; }
  var raw = history.map(extractFeatures);
  var f   = smoothFeatures(raw);

  var minKnee = Infinity, maxKnee = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (f[i].kneeAngle < minKnee) minKnee = f[i].kneeAngle;
    if (f[i].kneeAngle > maxKnee) maxKnee = f[i].kneeAngle;
  }
  var kRange = maxKnee - minKnee;

  var baseN = Math.max(5, Math.floor(f.length * 0.12));
  var aSum  = 0;
  for (var j = 0; j < baseN; j++) aSum += f[j].ankleY;

  liveState = {
    sqThresh:      kRange >= 15 ? { DEPTH: minKnee + kRange * 0.25, STAND: minKnee + kRange * 0.55 } : null,
    sqWasStanding: true,  sqAtDepth:  false, sqCount:  0,
    dlWasStanding: false, dlAtDepth:  false, dlCount:  0,
    jmpBaseline:   aSum / baseN, jmpInFlight: false, jmpCount: 0,
    fbuf: []
  };
}

// Reset counts and flags on video rewind, keeping preprocess-derived thresholds.
function resetLiveCounts() {
  if (!liveState) return;
  liveState.sqWasStanding = true;  liveState.sqAtDepth  = false; liveState.sqCount  = 0;
  liveState.dlWasStanding = false; liveState.dlAtDepth  = false; liveState.dlCount  = 0;
  liveState.jmpInFlight   = false; liveState.jmpCount   = 0;
  liveState.fbuf = [];
}

// Run one frame of all three state machines against raw MediaPipe landmarks.
function stepLiveCounters(lm) {
  if (!liveState) return;
  var rawF = extractFeatures(lm);
  liveState.fbuf.push(rawF);
  if (liveState.fbuf.length > 3) liveState.fbuf.shift();
  var n = liveState.fbuf.length;
  var fa = { kneeAngle: 0, hipAngle: 0, torsoLean: 0, ankleY: 0 };
  for (var i = 0; i < n; i++) {
    fa.kneeAngle += liveState.fbuf[i].kneeAngle; fa.hipAngle  += liveState.fbuf[i].hipAngle;
    fa.torsoLean += liveState.fbuf[i].torsoLean; fa.ankleY    += liveState.fbuf[i].ankleY;
  }
  fa.kneeAngle /= n; fa.hipAngle /= n; fa.torsoLean /= n; fa.ankleY /= n;
  var ls = liveState;

  // Squat
  if (ls.sqThresh) {
    var D = ls.sqThresh.DEPTH, S = ls.sqThresh.STAND;
    if (!ls.sqAtDepth && fa.kneeAngle > S) ls.sqWasStanding = true;
    if (ls.sqWasStanding && !ls.sqAtDepth && fa.kneeAngle < D && fa.torsoLean < 65)
      { ls.sqAtDepth = true; ls.sqWasStanding = false; }
    if (ls.sqAtDepth && fa.kneeAngle > S)
      { ls.sqCount++; ls.sqAtDepth = false; ls.sqWasStanding = true; }
  }
  // Deadlift
  if (!ls.dlAtDepth && fa.torsoLean < 20 && fa.hipAngle > 150) ls.dlWasStanding = true;
  if (ls.dlWasStanding && !ls.dlAtDepth && fa.torsoLean > 45 && fa.hipAngle < 90)
    { ls.dlAtDepth = true; ls.dlWasStanding = false; }
  if (ls.dlAtDepth && fa.torsoLean < 20 && fa.hipAngle > 150)
    { ls.dlCount++; ls.dlAtDepth = false; ls.dlWasStanding = true; }
  // Jump
  var rise = ls.jmpBaseline - fa.ankleY;
  if (!ls.jmpInFlight && rise > 0.06) ls.jmpInFlight = true;
  else if (ls.jmpInFlight && rise < 0.025) { ls.jmpCount++; ls.jmpInFlight = false; }
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

// ── readiness / injury assessment ─────────────────────────────────────────────
// Runs once at the end of the preprocess pass, on the same landmarkHistory used
// for counting, plus timeHistory for real per-rep timing. Produces the object
// documented by the Assessment TypeScript type in this file.

function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

// Linear quality ramp: metric == good -> 100, metric == bad -> 30 (clamped
// 15..100). good/bad may be in either order (works for "higher is better" and
// "lower is better" metrics alike).
function ramp(v, good, bad) {
  var t = (v - good) / (bad - good);
  return Math.round(clampN(100 - t * 70, 15, 100));
}

function statusFromScore(s) { return s >= 80 ? 'green' : (s >= 55 ? 'yellow' : 'red'); }

// Per-side + tilt features. Reuses angle2D. Higher joint angle = more extended.
function extractDetailed(lm) {
  var lKnee = angle2D(lm[23], lm[25], lm[27]);
  var rKnee = angle2D(lm[24], lm[26], lm[28]);
  var lHip  = angle2D(lm[11], lm[23], lm[25]);
  var rHip  = angle2D(lm[12], lm[24], lm[26]);

  var msx = (lm[11].x + lm[12].x) / 2, msy = (lm[11].y + lm[12].y) / 2;
  var mhx = (lm[23].x + lm[24].x) / 2, mhy = (lm[23].y + lm[24].y) / 2;
  var dy  = Math.abs(msy - mhy);
  var torsoLean = Math.atan2(Math.abs(msx - mhx), dy < 0.001 ? 0.001 : dy) * 180 / Math.PI;

  // Pelvic obliquity: vertical hip offset normalised by hip width (frontal shift).
  var hipW = Math.abs(lm[23].x - lm[24].x);
  if (hipW < 0.02) hipW = 0.02;
  var pelvicTilt = Math.abs(lm[23].y - lm[24].y) / hipW; // 0 = level

  return {
    lKnee: lKnee, rKnee: rKnee, lHip: lHip, rHip: rHip,
    kneeAngle: (lKnee + rKnee) / 2, hipAngle: (lHip + rHip) / 2,
    torsoLean: torsoLean, ankleY: (lm[27].y + lm[28].y) / 2, pelvicTilt: pelvicTilt
  };
}

// Mean visibility of the 8 key lower-body/torso joints across all frames.
function trackingConfidence(history) {
  var idx = [11, 12, 23, 24, 25, 26, 27, 28], sum = 0, n = 0;
  for (var i = 0; i < history.length; i++) {
    for (var j = 0; j < idx.length; j++) {
      var lm = history[i][idx[j]];
      if (lm && lm.visibility != null) { sum += lm.visibility; n++; }
    }
  }
  return n ? sum / n : 1;
}

// Symmetry % between two side values (limb symmetry index style).
function asymPct(a, b) {
  var mx = Math.max(a, b);
  if (mx < 1) return 0;
  return Math.abs(a - b) / mx * 100;
}

// Segment squat/deadlift reps into { start, bottom, end } index ranges using the
// same adaptive logic as the counters, but tracking the deepest frame per rep.
function segmentSquat(f) {
  var minK = Infinity, maxK = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (f[i].kneeAngle < minK) minK = f[i].kneeAngle;
    if (f[i].kneeAngle > maxK) maxK = f[i].kneeAngle;
  }
  var range = maxK - minK;
  if (range < 15) return { reps: [], minK: minK, maxK: maxK };
  var DEPTH = minK + range * 0.25, STAND = minK + range * 0.55;
  var reps = [], wasStanding = true, atDepth = false, start = 0, botIdx = 0, botVal = Infinity;
  for (var i = 0; i < f.length; i++) {
    var k = f[i].kneeAngle;
    if (!atDepth && k > STAND) { wasStanding = true; start = i; }
    if (wasStanding && !atDepth && k < DEPTH && f[i].torsoLean < 65) {
      atDepth = true; wasStanding = false; botVal = Infinity; botIdx = i;
    }
    if (atDepth && k < botVal) { botVal = k; botIdx = i; }
    if (atDepth && k > STAND) {
      reps.push({ start: start, bottom: botIdx, end: i });
      atDepth = false; wasStanding = true; start = i;
    }
  }
  return { reps: reps, minK: minK, maxK: maxK };
}

function segmentDeadlift(f) {
  var STAND_LEAN = 20, STAND_HIP = 150, DEPTH_LEAN = 45, DEPTH_HIP = 90;
  var reps = [], wasStanding = f[0].torsoLean < STAND_LEAN, atDepth = false, start = 0, botIdx = 0, botLean = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (!atDepth && f[i].torsoLean < STAND_LEAN && f[i].hipAngle > STAND_HIP) { wasStanding = true; start = i; }
    if (wasStanding && !atDepth && f[i].torsoLean > DEPTH_LEAN && f[i].hipAngle < DEPTH_HIP) {
      atDepth = true; wasStanding = false; botLean = -Infinity; botIdx = i;
    }
    if (atDepth && f[i].torsoLean > botLean) { botLean = f[i].torsoLean; botIdx = i; }
    if (atDepth && f[i].torsoLean < STAND_LEAN && f[i].hipAngle > STAND_HIP) {
      reps.push({ start: start, bottom: botIdx, end: i });
      atDepth = false; wasStanding = true; start = i;
    }
  }
  return reps;
}

// Flight segments for jumps: { takeoff, land } indices; land = first grounded frame.
function segmentJumps(f) {
  if (f.length < 10) return { flights: [], baseline: 0 };
  var baseN = Math.max(5, Math.floor(f.length * 0.12)), baseSum = 0;
  for (var i = 0; i < baseN; i++) baseSum += f[i].ankleY;
  var baseline = baseSum / baseN;
  var flights = [], inFlight = false, takeoff = 0;
  for (var j = 0; j < f.length; j++) {
    var rise = baseline - f[j].ankleY;
    if (!inFlight && rise > 0.06) { inFlight = true; takeoff = j; }
    else if (inFlight && rise < 0.025) { flights.push({ takeoff: takeoff, land: j }); inFlight = false; }
  }
  return { flights: flights, baseline: baseline };
}

function avgRepSeconds(reps, times) {
  if (!reps.length || !times.length) return 0;
  var sum = 0, n = 0;
  for (var i = 0; i < reps.length; i++) {
    var a = times[reps[i].start], b = times[reps[i].end];
    if (a != null && b != null && b > a) { sum += (b - a); n++; }
  }
  return n ? sum / n : 0;
}

// Fatigue: compares the first third of reps to the last third for both tempo
// (slower) and depth (shallower). Returns { pct, score }.
function fatigueFactor(reps, f, times, depthKey, deeperIsSmaller) {
  if (reps.length < 3) return { pct: 0, score: 100 };
  var third = Math.max(1, Math.floor(reps.length / 3));
  function repDur(r) { var a = times[r.start], b = times[r.end]; return (a != null && b != null && b > a) ? b - a : 0; }
  function repDepth(r) { return f[r.bottom][depthKey]; }
  var t0 = 0, tN = 0, d0 = 0, dN = 0;
  for (var i = 0; i < third; i++) { t0 += repDur(reps[i]); d0 += repDepth(reps[i]); }
  for (var i = reps.length - third; i < reps.length; i++) { tN += repDur(reps[i]); dN += repDepth(reps[i]); }
  t0 /= third; tN /= third; d0 /= third; dN /= third;

  var tempoDrift = t0 > 0.05 ? Math.max(0, (tN - t0) / t0) * 100 : 0; // slower last reps
  // depth loss: for knee angle (deeperIsSmaller) shallower = larger angle at bottom
  var depthDrift = deeperIsSmaller
    ? Math.max(0, (dN - d0)) / Math.max(10, Math.abs(d0)) * 100
    : Math.max(0, (d0 - dN)) / Math.max(10, Math.abs(d0)) * 100;
  var pct = Math.round(Math.max(tempoDrift, depthDrift));
  return { pct: pct, score: ramp(pct, 5, 45) };
}

function computeAssessment(history, times, counts) {
  if (!history || history.length < 15 || !counts) return null;
  var d = history.map(extractDetailed);
  // light 5-frame smoothing over the detailed signals
  var f = [];
  for (var i = 0; i < d.length; i++) {
    var lo = Math.max(0, i - 2), hi = Math.min(d.length - 1, i + 2), n = 0;
    var acc = { lKnee: 0, rKnee: 0, lHip: 0, rHip: 0, kneeAngle: 0, hipAngle: 0, torsoLean: 0, ankleY: 0, pelvicTilt: 0 };
    for (var j = lo; j <= hi; j++) {
      acc.lKnee += d[j].lKnee; acc.rKnee += d[j].rKnee; acc.lHip += d[j].lHip; acc.rHip += d[j].rHip;
      acc.kneeAngle += d[j].kneeAngle; acc.hipAngle += d[j].hipAngle; acc.torsoLean += d[j].torsoLean;
      acc.ankleY += d[j].ankleY; acc.pelvicTilt += d[j].pelvicTilt; n++;
    }
    f.push({
      lKnee: acc.lKnee/n, rKnee: acc.rKnee/n, lHip: acc.lHip/n, rHip: acc.rHip/n,
      kneeAngle: acc.kneeAngle/n, hipAngle: acc.hipAngle/n, torsoLean: acc.torsoLean/n,
      ankleY: acc.ankleY/n, pelvicTilt: acc.pelvicTilt/n
    });
  }

  var perExercise = [], allScores = [], allWeights = [], worst = null;
  function consider(factor, weight) {
    allScores.push(factor.score); allWeights.push(weight);
    if (factor.score < 80 && (!worst || factor.score < worst.score)) worst = factor;
  }

  // ── SQUAT ──────────────────────────────────────────────────────────────────
  if (counts.squat > 0) {
    var sq = segmentSquat(f);
    var reps = sq.reps;
    var factors = [];

    // per-leg deepest knee flexion (min angle) averaged across reps
    var lBot = 0, rBot = 0, nb = 0;
    for (var i = 0; i < reps.length; i++) { var b = f[reps[i].bottom]; lBot += b.lKnee; rBot += b.rKnee; nb++; }
    if (nb) { lBot /= nb; rBot /= nb; }
    // symmetry uses flexion magnitude (180 - angle) so 0° cancels out cleanly
    var lFlex = 180 - lBot, rFlex = 180 - rBot;
    var symP = Math.round(asymPct(lFlex, rFlex));
    var symScore = ramp(symP, 5, 25);
    var symF = { id: 'symmetry', label: 'Left / Right Symmetry', value: symP, unit: '%',
      score: symScore, status: statusFromScore(symScore),
      detail: symP <= 10 ? 'Legs share load evenly.' : (lFlex < rFlex ? 'Right leg goes deeper — left may be guarding.' : 'Left leg goes deeper — right may be guarding.'),
      rec: 'symmetry' };
    factors.push(symF); consider(symF, 1);

    // depth: deepest knee angle across the clip (lower = deeper)
    var depthScore = ramp(sq.minK, 95, 150);
    var depthPctOfParallel = Math.round(clampN((180 - sq.minK) / (180 - 90) * 100, 0, 120));
    var depF = { id: 'depth', label: 'Squat Depth', value: depthPctOfParallel, unit: '%',
      score: depthScore, status: statusFromScore(depthScore),
      detail: depthScore >= 80 ? 'Reaches good depth.' : 'Limited depth — likely ankle/hip mobility.',
      rec: 'mobility' };
    factors.push(depF); consider(depF, 1);

    // fatigue
    var fat = fatigueFactor(reps, f, times, 'kneeAngle', true);
    var fatF = { id: 'fatigue', label: 'Fatigue / Consistency', value: fat.pct, unit: '%',
      score: fat.score, status: statusFromScore(fat.score),
      detail: fat.score >= 80 ? 'Reps stay consistent.' : 'Later reps lose depth or slow down.',
      rec: 'fatigue' };
    factors.push(fatF); consider(fatF, 0.6);

    perExercise.push({
      key: 'squat', label: 'SQUAT', reps: counts.squat,
      metrics: {
        maxKneeAngle: Math.round(sq.maxK), minKneeAngle: Math.round(sq.minK),
        romDeg: Math.round(sq.maxK - sq.minK),
        avgRepSec: Math.round(avgRepSeconds(reps, times) * 10) / 10,
        totalSec: Math.round((times[times.length-1] - times[0]) * 10) / 10
      },
      factors: factors
    });
  }

  // ── DEADLIFT ─────────────────────────────────────────────────────────────────
  if (counts.deadlift > 0) {
    var dreps = segmentDeadlift(f);
    var factors2 = [];

    // symmetry: lateral pelvic shift at the bottom (hinge) position
    var tiltSum = 0, nt = 0;
    for (var i = 0; i < dreps.length; i++) { tiltSum += f[dreps[i].bottom].pelvicTilt; nt++; }
    var pelvic = nt ? tiltSum / nt : 0;
    var pelvicPct = Math.round(clampN(pelvic * 100, 0, 60)); // ratio -> %
    var dSymScore = ramp(pelvicPct, 6, 30);
    var dSymF = { id: 'symmetry', label: 'Left / Right Symmetry', value: pelvicPct, unit: '%',
      score: dSymScore, status: statusFromScore(dSymScore),
      detail: dSymScore >= 80 ? 'Hips stay level through the hinge.' : 'Hips shift to one side under load.',
      rec: 'symmetry' };
    factors2.push(dSymF); consider(dSymF, 1);

    // hinge control: variability of bottom torso lean across reps (consistency)
    var leans = [];
    for (var i = 0; i < dreps.length; i++) leans.push(f[dreps[i].bottom].torsoLean);
    var mean = 0; for (var i = 0; i < leans.length; i++) mean += leans[i]; mean = leans.length ? mean/leans.length : 0;
    var varc = 0; for (var i = 0; i < leans.length; i++) varc += (leans[i]-mean)*(leans[i]-mean); varc = leans.length ? Math.sqrt(varc/leans.length) : 0;
    var cv = mean > 1 ? Math.round(varc / mean * 100) : 0;
    var hingeScore = leans.length < 2 ? 90 : ramp(cv, 5, 30);
    var hingeF = { id: 'hinge', label: 'Hinge Control', value: cv, unit: '%',
      score: hingeScore, status: statusFromScore(hingeScore),
      detail: hingeScore >= 80 ? 'Torso angle repeats consistently.' : 'Torso angle drifts between reps — bracing may be inconsistent.',
      rec: 'hinge' };
    factors2.push(hingeF); consider(hingeF, 1);

    // fatigue
    var dfat = fatigueFactor(dreps, f, times, 'torsoLean', false);
    var dfatF = { id: 'fatigue', label: 'Fatigue / Consistency', value: dfat.pct, unit: '%',
      score: dfat.score, status: statusFromScore(dfat.score),
      detail: dfat.score >= 80 ? 'Reps stay consistent.' : 'Later reps slow down or change shape.',
      rec: 'fatigue' };
    factors2.push(dfatF); consider(dfatF, 0.6);

    var kMin = Infinity, kMax = -Infinity;
    for (var i = 0; i < f.length; i++) { if (f[i].kneeAngle < kMin) kMin = f[i].kneeAngle; if (f[i].kneeAngle > kMax) kMax = f[i].kneeAngle; }
    perExercise.push({
      key: 'deadlift', label: 'DEADLIFT', reps: counts.deadlift,
      metrics: {
        maxKneeAngle: Math.round(kMax), minKneeAngle: Math.round(kMin), romDeg: Math.round(kMax - kMin),
        avgRepSec: Math.round(avgRepSeconds(dreps, times) * 10) / 10,
        totalSec: Math.round((times[times.length-1] - times[0]) * 10) / 10
      },
      factors: factors2
    });
  }

  // ── VERTICAL JUMP ────────────────────────────────────────────────────────────
  if (counts.verticalJump > 0) {
    var js = segmentJumps(f);
    var factors3 = [];

    // landing knee flexion: deepest bend in the 0.4s absorption window after landing
    var lLandFlex = [], rLandFlex = [], allFlex = [];
    for (var i = 0; i < js.flights.length; i++) {
      var land = js.flights[i].land;
      var minL = 180, minR = 180;
      for (var k = land; k < f.length && (times[k] - times[land]) < 0.4; k++) {
        if (f[k].lKnee < minL) minL = f[k].lKnee;
        if (f[k].rKnee < minR) minR = f[k].rKnee;
      }
      lLandFlex.push(180 - minL); rLandFlex.push(180 - minR); allFlex.push(180 - (minL + minR) / 2);
    }
    var meanFlex = 0; for (var i = 0; i < allFlex.length; i++) meanFlex += allFlex[i]; meanFlex = allFlex.length ? meanFlex/allFlex.length : 0;
    var softScore = ramp(meanFlex, 60, 15); // more flexion = softer = higher score
    var softPct = Math.round(clampN(meanFlex / 60 * 100, 0, 120));
    var softF = { id: 'landing', label: 'Landing Softness', value: softPct, unit: '%',
      score: softScore, status: statusFromScore(softScore),
      detail: softScore >= 80 ? 'Absorbs landings with soft, bent knees.' : 'Stiff landing — knees stay extended, raising impact load.',
      rec: 'landing' };
    factors3.push(softF); consider(softF, 1);

    // landing symmetry
    var lm2 = 0, rm2 = 0; for (var i = 0; i < lLandFlex.length; i++) { lm2 += lLandFlex[i]; rm2 += rLandFlex[i]; }
    if (lLandFlex.length) { lm2 /= lLandFlex.length; rm2 /= rLandFlex.length; }
    var jSymP = Math.round(asymPct(lm2, rm2));
    var jSymScore = ramp(jSymP, 5, 25);
    var jSymF = { id: 'symmetry', label: 'Landing Symmetry', value: jSymP, unit: '%',
      score: jSymScore, status: statusFromScore(jSymScore),
      detail: jSymScore >= 80 ? 'Both legs absorb landings equally.' : 'One leg absorbs more of the landing than the other.',
      rec: 'symmetry' };
    factors3.push(jSymF); consider(jSymF, 1);

    var jkMin = Infinity, jkMax = -Infinity;
    for (var i = 0; i < f.length; i++) { if (f[i].kneeAngle < jkMin) jkMin = f[i].kneeAngle; if (f[i].kneeAngle > jkMax) jkMax = f[i].kneeAngle; }
    perExercise.push({
      key: 'jump', label: 'VERTICAL JUMP', reps: counts.verticalJump,
      metrics: {
        maxKneeAngle: Math.round(jkMax), minKneeAngle: Math.round(jkMin), romDeg: Math.round(jkMax - jkMin),
        avgRepSec: counts.verticalJump > 0 ? Math.round((times[times.length-1]-times[0]) / counts.verticalJump * 10) / 10 : 0,
        totalSec: Math.round((times[times.length-1] - times[0]) * 10) / 10
      },
      factors: factors3
    });
  }

  if (!perExercise.length) return null;

  // overall readiness = weighted mean of every factor score
  var wsum = 0, wtot = 0;
  for (var i = 0; i < allScores.length; i++) { wsum += allScores[i] * allWeights[i]; wtot += allWeights[i]; }
  var readiness = wtot ? Math.round(wsum / wtot) : 100;
  var readinessLabel = readiness >= 80 ? 'Ready' : (readiness >= 55 ? 'Caution' : 'High Risk');

  return {
    perExercise: perExercise,
    readiness: readiness,
    readinessLabel: readinessLabel,
    recommendation: worst ? worst.rec : null,
    confidence: Math.round(trackingConfidence(history) * 100) / 100
  };
}
`;
