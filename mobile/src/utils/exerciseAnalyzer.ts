/**
 * Exercise Analysis Hub
 *
 * Detects squat, vertical jump, and pull-up repetitions from a MediaPipe Pose
 * landmark sequence, then produces a readiness/injury assessment.
 *
 * Deadlift detection was removed entirely (2026-07-08) — its torso-lean/hip-angle
 * signature intersected too much with squat, producing frequent misclassification
 * between the two. Do not reintroduce without a materially different signal.
 *
 * ── Biomechanical thresholds ────────────────────────────────────────────────
 *
 * SQUAT  (PMID 22801421; IJSPT 2021)
 *   Torso lean at bottom: < 40° from vertical
 *   Knee angle at depth:  adaptive to patient ROM (bottom 25 % of range)
 *
 * VERTICAL JUMP  (PMC 11208864; PMC 11368081)
 *   Flight phase: ankles rise > 10 % of the athlete's own standing
 *   shoulder-to-ankle height (not a fixed frame-height fraction — that broke
 *   whenever camera distance/zoom changed how much of the frame the athlete
 *   filled, causing real jumps to go undetected)
 *   Mutually exclusive with squat: an actual ankle-rise flight phase is
 *   stronger, less ambiguous evidence than knee-angle geometry alone, so a
 *   detected jump suppresses any squat count from the same clip (the jump's
 *   countermovement dip can otherwise look like a shallow squat rep)
 *
 * PULL-UP
 *   Prerequisite: wrists must be above shoulders in ≥ 30 % of frames
 *   (distinguishes from push-ups, overhead press where wrists stay lower)
 *   Elbow angle: adaptive — bottom 30 % of ROM = "pulled up", top 60 % = "hanging"
 *   Minimum elbow ROM: 30° (filters random arm movement)
 */

export interface ExerciseResults {
  squat: number;
  verticalJump: number;
  pullup: number;
}

export function hasAnyExercise(r: ExerciseResults): boolean {
  return r.squat > 0 || r.verticalJump > 0 || r.pullup > 0;
}

// ── readiness / injury assessment types ──────────────────────────────────────

export type RiskStatus = 'green' | 'yellow' | 'red';

export type RecommendationKey =
  | 'symmetry'
  | 'mobility'
  | 'landing'
  | 'hinge'
  | 'fatigue'
  | 'scapular';

export interface MovementMetrics {
  maxKneeAngle: number; // degrees (most extended; for pull-up: most extended elbow)
  minKneeAngle: number; // degrees (deepest flexion; for pull-up: most contracted elbow)
  romDeg: number;
  avgRepSec: number;
  totalSec: number;
  perRepDepth: number[];       // primary angle at the bottom/peak of each rep
  perRepDurationSec: number[]; // duration of each rep in seconds
}

export interface RiskFactor {
  id: string;
  label: string;
  value: number;
  unit: string;
  score: number;
  status: RiskStatus;
  detail: string;
  rec: RecommendationKey;
}

export interface ExerciseAssessment {
  key: 'squat' | 'jump' | 'pullup';
  label: string;
  reps: number;
  metrics: MovementMetrics;
  factors: RiskFactor[];
}

export interface Assessment {
  perExercise: ExerciseAssessment[];
  readiness: number;
  readinessLabel: string;
  recommendation: RecommendationKey | null;
  confidence: number;
}

export const EXERCISE_ANALYZER_JS = `
// ── exercise analysis ─────────────────────────────────────────────────────────

var landmarkHistory = [];
var timeHistory = [];

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

// MediaPipe landmark indices (33-point model):
//   0=nose  11/12=L/R shoulder  13/14=L/R elbow  15/16=L/R wrist
//   23/24=L/R hip  25/26=L/R knee  27/28=L/R ankle
function extractFeatures(lm) {
  var kneeAngle = (angle2D(lm[23], lm[25], lm[27]) + angle2D(lm[24], lm[26], lm[28])) / 2;
  var hipAngle  = (angle2D(lm[11], lm[23], lm[25]) + angle2D(lm[12], lm[24], lm[26])) / 2;

  var msx = (lm[11].x + lm[12].x) / 2, msy = (lm[11].y + lm[12].y) / 2;
  var mhx = (lm[23].x + lm[24].x) / 2, mhy = (lm[23].y + lm[24].y) / 2;
  var dy = Math.abs(msy - mhy);
  var torsoLean = Math.atan2(Math.abs(msx - mhx), dy < 0.001 ? 0.001 : dy) * 180 / Math.PI;

  var ankleY = (lm[27].y + lm[28].y) / 2;
  var hipY   = mhy; // whole-body vertical position — corroborates a genuine pull-up rep (see countPullups)

  // Elbow angles for pull-up detection
  var elbowAngle = (angle2D(lm[11], lm[13], lm[15]) + angle2D(lm[12], lm[14], lm[16])) / 2;

  // wristAbove: 1 if wrists are above shoulders in frame (y-down coords; lower y = higher).
  // Scaled to torso length (shoulder-to-hip, dy above), not a fixed frame-height
  // fraction — same fix already applied to jump's flight-phase threshold, for the
  // same reason: a fixed fraction breaks whenever camera distance/zoom changes how
  // much of the frame the athlete fills, undercounting or missing real pull-ups
  // whenever more of the scene (e.g. the whole bar) is in shot.
  var wristY    = (lm[15].y + lm[16].y) / 2;
  var shoulderY = (lm[11].y + lm[12].y) / 2;
  var torsoScale = Math.max(dy, 0.05);
  var wristAbove = (shoulderY - wristY) > torsoScale * 0.22 ? 1 : 0;

  return { kneeAngle: kneeAngle, hipAngle: hipAngle, torsoLean: torsoLean,
           ankleY: ankleY, shoulderY: shoulderY, hipY: hipY, elbowAngle: elbowAngle, wristAbove: wristAbove };
}

// Time-based window (not a fixed frame count): the preprocess pass plays the
// video at 8x speed and captures whichever frames the device keeps up with,
// so the real capture rate varies with device/model performance from one run
// to the next. A fixed-frame-count window silently smooths over far more
// real time whenever fewer frames land, which can flatten an entire rep's
// range of motion into noise (verified: at a sparser capture rate, a real
// 50°-swing pull-up motion collapsed to an 19° residue under the old
// ±2-frame box average, dropping it below the minimum-ROM gate entirely).
var FEATURE_SMOOTH_WINDOW_SEC = 0.12;

function smoothFeatures(features) {
  var result = [];
  for (var i = 0; i < features.length; i++) {
    var t = timeHistory[i];
    var lo = i, hi = i;
    while (lo > 0 && t - timeHistory[lo - 1] <= FEATURE_SMOOTH_WINDOW_SEC) lo--;
    while (hi < features.length - 1 && timeHistory[hi + 1] - t <= FEATURE_SMOOTH_WINDOW_SEC) hi++;
    var kS=0, hS=0, lS=0, aS=0, sS=0, hyS=0, eS=0, wS=0, n=0;
    for (var j = lo; j <= hi; j++) {
      kS += features[j].kneeAngle; hS += features[j].hipAngle;
      lS += features[j].torsoLean; aS += features[j].ankleY;
      sS += features[j].shoulderY; hyS += features[j].hipY;
      eS += features[j].elbowAngle; wS += features[j].wristAbove;
      n++;
    }
    result.push({ kneeAngle: kS/n, hipAngle: hS/n, torsoLean: lS/n,
                  ankleY: aS/n, shoulderY: sS/n, hipY: hyS/n, elbowAngle: eS/n, wristAbove: wS/n });
  }
  return result;
}

// ── rep counters ──────────────────────────────────────────────────────────────

// Squat: bilateral knee flexion with torso remaining upright (< 40°).
function countSquats(f) {
  if (!f.length) return 0;
  var LEAN_MAX = 40; // upright — if more forward, it's not a squat

  var minKnee = Infinity, maxKnee = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (f[i].kneeAngle < minKnee) minKnee = f[i].kneeAngle;
    if (f[i].kneeAngle > maxKnee) maxKnee = f[i].kneeAngle;
  }
  var range = maxKnee - minKnee;
  // Even a shallow quarter-squat carries ~30-45° of knee-angle change (PMID
  // 22801421 / IJSPT 2021 depth benchmarks) — 15° was low enough that
  // incidental knee movement from an unrelated exercise (e.g. leg sway
  // during a pull-up) could clear it and register as a false squat rep.
  if (range < 35) return 0;

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

// Standing shoulder-to-ankle distance over the baseline window — a per-video
// scale reference so jump-height thresholds track how large the athlete
// actually appears in frame, instead of a fixed fraction of frame height
// (which misses real jumps when the camera is further back / more zoomed out).
function jumpBaseline(f, baseN) {
  var ankleSum = 0, scaleSum = 0;
  for (var i = 0; i < baseN; i++) {
    ankleSum += f[i].ankleY;
    scaleSum += (f[i].ankleY - f[i].shoulderY);
  }
  var ankleBaseline = ankleSum / baseN;
  var bodyScale = Math.max(0.25, scaleSum / baseN); // floor guards against degenerate/missing landmarks
  return { ankleBaseline: ankleBaseline, bodyScale: bodyScale };
}

// Vertical jump: ankles rise > 10 % of the athlete's own standing
// shoulder-to-ankle height above baseline (see jumpBaseline above).
// MIN_FLIGHT_SEC filters landmark-noise blips (e.g. a heel rise at the bottom
// of a squat can momentarily nudge ankleY past JUMP_THRESH for a single
// frame) from being read as a real jump — a genuine airborne phase lasts much
// longer than one frame. Without this gate a false "jump" wrongly zeroes out
// the whole squat count via the mutual-exclusion rule below.
var MIN_FLIGHT_SEC = 0.15;

function countJumps(f) {
  if (f.length < 10) return 0;
  var baseN = Math.max(5, Math.floor(f.length * 0.12));
  var base = jumpBaseline(f, baseN);
  var JUMP_THRESH = base.bodyScale * 0.10, LAND_THRESH = base.bodyScale * 0.04;
  var count = 0, inFlight = false, takeoffIdx = 0;
  for (var j = 0; j < f.length; j++) {
    var rise = base.ankleBaseline - f[j].ankleY;
    if (!inFlight && rise > JUMP_THRESH) { inFlight = true; takeoffIdx = j; }
    else if (inFlight && rise < LAND_THRESH) {
      if (timeHistory[j] - timeHistory[takeoffIdx] >= MIN_FLIGHT_SEC) count++;
      inFlight = false;
    }
  }
  return count;
}

// Pull-up: overhead grip (wrists above shoulders in y-down coords) with elbow
// cycling from extended (hanging) to contracted (pulled up) and back.
// Uses the same adaptive-threshold pattern as countSquats so partial ROM / band-
// assisted reps count equally.
function countPullups(f) {
  if (!f.length) return 0;
  // Must have wrists above shoulders for at least 30 % of frames
  var overheadCount = 0;
  for (var i = 0; i < f.length; i++) if (f[i].wristAbove > 0.5) overheadCount++;
  if (overheadCount < f.length * 0.3) return 0;

  // Derive ROM from overhead frames only
  var minE = Infinity, maxE = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (f[i].wristAbove > 0.3) {
      if (f[i].elbowAngle < minE) minE = f[i].elbowAngle;
      if (f[i].elbowAngle > maxE) maxE = f[i].elbowAngle;
    }
  }
  var range = maxE - minE;
  // Softened from 30° so shorter/partial-ROM pull-ups still qualify — the
  // hip-rise corroboration below is what actually guards against noise, so
  // this gate no longer has to carry that weight alone.
  if (range < 18) return 0; // not enough elbow movement

  // A genuine pull-up rep necessarily moves the whole body upward, not just
  // the elbow angle reading — hip position should rise right along with
  // the bend (y-down coords, so a rise is a decrease). Requiring this
  // corroborates the elbow-angle crossing and rules out a false rep from
  // elbow tracking noise/occlusion with no real body movement. Ankle/foot
  // position is deliberately NOT used here — MediaPipe's foot tracking has
  // proven unreliable in testing, while hip tracking has not.
  var BODY_RISE_MIN = 0.05; // normalised units — a real rep moves this much easily

  // Swing (zigzag/prominence) detector rather than crossing two fixed
  // absolute levels: a rep is confirmed once the elbow angle has genuinely
  // swung down by MIN_DROP from a running local peak, then back up by
  // MIN_DROP from that trough. This only needs SOME sample to land near
  // each true local extreme — it doesn't require a sample to land inside a
  // narrow absolute crossing band, which a fixed threshold-crossing state
  // machine can skip over entirely at a sparse/irregular capture rate
  // (verified: the old BENT/EXTEND crossing check dropped to 0 reps
  // detected out of 5 real ones once frames were captured at roughly a
  // third of the dense rate, while this swing detector still recovered 4-5).
  var MIN_DROP = range * 0.30;

  var count = 0, started = false, direction = 'down';
  var extremeVal = 0, extremeHipY = 0;
  var refPeakVal = 0, refPeakHipY = 0;
  for (var i = 0; i < f.length; i++) {
    if (f[i].wristAbove < 0.3) continue; // skip non-overhead frames
    var e = f[i].elbowAngle, hy = f[i].hipY;
    if (!started) {
      started = true;
      extremeVal = e; extremeHipY = hy;
      refPeakVal = e; refPeakHipY = hy;
      continue;
    }
    if (direction === 'down') {
      if (e < extremeVal) { extremeVal = e; extremeHipY = hy; }
      else if (e - extremeVal >= MIN_DROP) {
        if (refPeakHipY - extremeHipY >= BODY_RISE_MIN) count++;
        direction = 'up'; extremeVal = e; extremeHipY = hy;
      }
    } else {
      if (e > extremeVal) { extremeVal = e; extremeHipY = hy; }
      else if (extremeVal - e >= MIN_DROP) {
        refPeakVal = extremeVal; refPeakHipY = extremeHipY;
        direction = 'down'; extremeVal = e; extremeHipY = hy;
      }
    }
  }
  // The clip may end mid-rep, at or near the top (chin-at-bar) — the athlete
  // very commonly stops recording right after finishing the last rep,
  // before descending back down. The swing detector above only confirms a
  // trough once the signal bounces back up by MIN_DROP, so a rep still "in
  // progress" at the very end would otherwise be silently dropped.
  if (direction === 'down' && refPeakVal - extremeVal >= MIN_DROP && refPeakHipY - extremeHipY >= BODY_RISE_MIN) {
    count++;
  }
  return count;
}

// ── live rep counting (dead-code path; counting is now time-based via repTimes) ─

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
    sqThresh: kRange >= 15 ? { DEPTH: minKnee + kRange * 0.25, STAND: minKnee + kRange * 0.55 } : null,
    sqWasStanding: true, sqAtDepth: false, sqCount: 0,
    jmpBaseline: aSum / baseN, jmpInFlight: false, jmpCount: 0,
    puWasExtended: true, puAtBent: false, puCount: 0,
    fbuf: []
  };
}

function resetLiveCounts() {
  if (!liveState) return;
  liveState.sqWasStanding = true;  liveState.sqAtDepth  = false; liveState.sqCount  = 0;
  liveState.jmpInFlight   = false; liveState.jmpCount   = 0;
  liveState.puWasExtended = true;  liveState.puAtBent   = false; liveState.puCount  = 0;
  liveState.fbuf = [];
}

function stepLiveCounters(lm) {
  if (!liveState) return;
  var rawF = extractFeatures(lm);
  liveState.fbuf.push(rawF);
  if (liveState.fbuf.length > 3) liveState.fbuf.shift();
  var n = liveState.fbuf.length;
  var fa = { kneeAngle:0, hipAngle:0, torsoLean:0, ankleY:0, elbowAngle:0, wristAbove:0 };
  for (var i = 0; i < n; i++) {
    fa.kneeAngle  += liveState.fbuf[i].kneeAngle;  fa.hipAngle  += liveState.fbuf[i].hipAngle;
    fa.torsoLean  += liveState.fbuf[i].torsoLean;  fa.ankleY    += liveState.fbuf[i].ankleY;
    fa.elbowAngle += liveState.fbuf[i].elbowAngle; fa.wristAbove+= liveState.fbuf[i].wristAbove;
  }
  fa.kneeAngle/=n; fa.hipAngle/=n; fa.torsoLean/=n; fa.ankleY/=n; fa.elbowAngle/=n; fa.wristAbove/=n;
  var ls = liveState;

  if (ls.sqThresh) {
    var D = ls.sqThresh.DEPTH, S = ls.sqThresh.STAND;
    if (!ls.sqAtDepth && fa.kneeAngle > S) ls.sqWasStanding = true;
    if (ls.sqWasStanding && !ls.sqAtDepth && fa.kneeAngle < D && fa.torsoLean < 40)
      { ls.sqAtDepth = true; ls.sqWasStanding = false; }
    if (ls.sqAtDepth && fa.kneeAngle > S)
      { ls.sqCount++; ls.sqAtDepth = false; ls.sqWasStanding = true; }
  }
  var rise = ls.jmpBaseline - fa.ankleY;
  if (!ls.jmpInFlight && rise > 0.06) ls.jmpInFlight = true;
  else if (ls.jmpInFlight && rise < 0.025) { ls.jmpCount++; ls.jmpInFlight = false; }
}

// ── public entry point ────────────────────────────────────────────────────────

function analyzeExercises() {
  if (landmarkHistory.length < 15) return null;
  var raw      = landmarkHistory.map(extractFeatures);
  var features = smoothFeatures(raw);
  var sqCount  = countSquats(features);
  var jCount   = countJumps(features);
  var puCount  = countPullups(features);

  // Sustained overhead grip alone — regardless of whether a full pull-up
  // rep goes on to qualify (countPullups also needs a clean 30°+ elbow ROM
  // cycle, which noisy tracking can fail even on a real pull-up) — is
  // enough on its own to rule out a jump: a standing vertical jump doesn't
  // keep the wrists overhead for a large fraction of the whole clip, only
  // briefly during the arm swing, while hanging from a bar keeps them there
  // throughout. This also covers the mechanism that creates the false
  // positive in the first place: pulling the whole body upward while
  // hanging raises ankle height right along with the rest of the body,
  // which reads to countJumps as an ordinary flight phase even though the
  // athlete never left the ground. Mirrors countPullups' own first gate.
  // Must run before the squat-vs-jump check below so a jump count zeroed
  // here doesn't wrongly take a real squat count down with it.
  var overheadFrames = 0;
  for (var oi = 0; oi < features.length; oi++) if (features[oi].wristAbove > 0.5) overheadFrames++;
  var sustainedOverhead = overheadFrames >= features.length * 0.3;
  if (sustainedOverhead && jCount > 0) {
    jCount = 0;
  }

  // Same reasoning rules out squat too: an athlete hanging from a bar isn't
  // standing free, so any knee movement during a pull-up (leg sway, a kip)
  // is incidental, not a squat — no matter how cleanly it happens to clear
  // countSquats' own thresholds. Must run before the squat-vs-jump check
  // below for the same ordering reason as above.
  if (sustainedOverhead && sqCount > 0) {
    sqCount = 0;
  }

  // A detected jump is stronger evidence than a squat: it's measured from an
  // actual ankle-rise flight phase, while squat is inferred from knee angle
  // alone — the countermovement dip before takeoff can look like a shallow
  // squat rep and get double-counted as one. If a jump was found, trust it.
  if (jCount > 0 && sqCount > 0) {
    sqCount = 0;
  }

  return { squat: sqCount, verticalJump: jCount, pullup: puCount };
}

// ── readiness / injury assessment ─────────────────────────────────────────────

function clampN(v, a, b) { return v < a ? a : (v > b ? b : v); }

function ramp(v, good, bad) {
  var t = (v - good) / (bad - good);
  return Math.round(clampN(100 - t * 70, 15, 100));
}

function statusFromScore(s) { return s >= 80 ? 'green' : (s >= 55 ? 'yellow' : 'red'); }

function extractDetailed(lm) {
  var lKnee = angle2D(lm[23], lm[25], lm[27]);
  var rKnee = angle2D(lm[24], lm[26], lm[28]);
  var lHip  = angle2D(lm[11], lm[23], lm[25]);
  var rHip  = angle2D(lm[12], lm[24], lm[26]);
  var lElbow = angle2D(lm[11], lm[13], lm[15]);
  var rElbow = angle2D(lm[12], lm[14], lm[16]);

  var msx = (lm[11].x + lm[12].x) / 2, msy = (lm[11].y + lm[12].y) / 2;
  var mhx = (lm[23].x + lm[24].x) / 2, mhy = (lm[23].y + lm[24].y) / 2;
  var dy  = Math.abs(msy - mhy);
  var torsoLean = Math.atan2(Math.abs(msx - mhx), dy < 0.001 ? 0.001 : dy) * 180 / Math.PI;

  var hipW = Math.abs(lm[23].x - lm[24].x);
  if (hipW < 0.02) hipW = 0.02;
  var pelvicTilt = Math.abs(lm[23].y - lm[24].y) / hipW;

  // Same torso-scaled threshold as extractFeatures — must stay in sync.
  var wristY    = (lm[15].y + lm[16].y) / 2;
  var shoulderY = (lm[11].y + lm[12].y) / 2;
  var torsoScale = Math.max(dy, 0.05);
  var wristAbove = (shoulderY - wristY) > torsoScale * 0.22 ? 1 : 0;

  return {
    lKnee: lKnee, rKnee: rKnee, lHip: lHip, rHip: rHip,
    lElbow: lElbow, rElbow: rElbow,
    kneeAngle: (lKnee + rKnee) / 2, hipAngle: (lHip + rHip) / 2,
    elbowAngle: (lElbow + rElbow) / 2,
    torsoLean: torsoLean, ankleY: (lm[27].y + lm[28].y) / 2, shoulderY: shoulderY,
    pelvicTilt: pelvicTilt, wristAbove: wristAbove
  };
}

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

function asymPct(a, b) {
  var mx = Math.max(a, b);
  if (mx < 1) return 0;
  return Math.abs(a - b) / mx * 100;
}

function segmentSquat(f) {
  var minK = Infinity, maxK = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (f[i].kneeAngle < minK) minK = f[i].kneeAngle;
    if (f[i].kneeAngle > maxK) maxK = f[i].kneeAngle;
  }
  var range = maxK - minK;
  if (range < 35) return { reps: [], minK: minK, maxK: maxK }; // mirrors countSquats' gate — must stay in sync
  var DEPTH = minK + range * 0.25, STAND = minK + range * 0.55;
  var reps = [], wasStanding = true, atDepth = false, start = 0, botIdx = 0, botVal = Infinity;
  for (var i = 0; i < f.length; i++) {
    var k = f[i].kneeAngle;
    if (!atDepth && k > STAND) { wasStanding = true; start = i; }
    if (wasStanding && !atDepth && k < DEPTH && f[i].torsoLean < 40) {
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

// Mirrors countJumps' body-scaled thresholds exactly — must stay in sync so
// the rep count from analyzeExercises() and the flights segmented here (used
// for factors + rep timing) never disagree.
function segmentJumps(f) {
  if (f.length < 10) return { flights: [], baseline: 0 };
  var baseN = Math.max(5, Math.floor(f.length * 0.12));
  var base = jumpBaseline(f, baseN);
  var JUMP_THRESH = base.bodyScale * 0.10, LAND_THRESH = base.bodyScale * 0.04;
  var flights = [], inFlight = false, takeoff = 0;
  for (var j = 0; j < f.length; j++) {
    var rise = base.ankleBaseline - f[j].ankleY;
    if (!inFlight && rise > JUMP_THRESH) { inFlight = true; takeoff = j; }
    else if (inFlight && rise < LAND_THRESH) {
      if (timeHistory[j] - timeHistory[takeoff] >= MIN_FLIGHT_SEC) flights.push({ takeoff: takeoff, land: j });
      inFlight = false;
    }
  }
  return { flights: flights, baseline: base.ankleBaseline };
}

// Pull-up segmentation: 'bottom' is the index of peak contraction (most bent elbow =
// lowest elbow angle = top of the movement physically). Naming mirrors segmentSquat
// so avgRepSeconds and fatigueFactor can be reused without change.
function segmentPullups(f) {
  var minE = Infinity, maxE = -Infinity;
  for (var i = 0; i < f.length; i++) {
    if (f[i].wristAbove > 0.3) {
      if (f[i].elbowAngle < minE) minE = f[i].elbowAngle;
      if (f[i].elbowAngle > maxE) maxE = f[i].elbowAngle;
    }
  }
  var range = maxE - minE;
  if (range < 18) return { reps: [], minE: minE, maxE: maxE }; // mirrors countPullups' softened gate
  // Mirrors countPullups' swing/zigzag detector exactly (including the hip
  // body-rise corroboration and the end-of-clip in-progress-rep check) —
  // must stay in sync. See countPullups for why a running-local-extreme
  // detector replaced the old fixed BENT/EXTEND crossing check.
  var MIN_DROP = range * 0.30;
  var BODY_RISE_MIN = 0.05;
  var reps = [], started = false, direction = 'down';
  var extremeVal = 0, extremeHipY = 0, extremeIdx = 0;
  var refPeakVal = 0, refPeakHipY = 0, refPeakIdx = 0;
  for (var i = 0; i < f.length; i++) {
    if (f[i].wristAbove < 0.3) continue;
    var e = f[i].elbowAngle, hy = f[i].hipY;
    if (!started) {
      started = true;
      extremeVal = e; extremeHipY = hy; extremeIdx = i;
      refPeakVal = e; refPeakHipY = hy; refPeakIdx = i;
      continue;
    }
    if (direction === 'down') {
      if (e < extremeVal) { extremeVal = e; extremeHipY = hy; extremeIdx = i; }
      else if (e - extremeVal >= MIN_DROP) {
        if (refPeakHipY - extremeHipY >= BODY_RISE_MIN) {
          reps.push({ start: refPeakIdx, bottom: extremeIdx, end: i });
        }
        direction = 'up'; extremeVal = e; extremeHipY = hy; extremeIdx = i;
      }
    } else {
      if (e > extremeVal) { extremeVal = e; extremeHipY = hy; extremeIdx = i; }
      else if (extremeVal - e >= MIN_DROP) {
        refPeakVal = extremeVal; refPeakHipY = extremeHipY; refPeakIdx = extremeIdx;
        direction = 'down'; extremeVal = e; extremeHipY = hy; extremeIdx = i;
      }
    }
  }
  if (direction === 'down' && refPeakVal - extremeVal >= MIN_DROP && refPeakHipY - extremeHipY >= BODY_RISE_MIN) {
    reps.push({ start: refPeakIdx, bottom: extremeIdx, end: extremeIdx });
  }
  return { reps: reps, minE: minE, maxE: maxE };
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

// score: null means "not enough reps to assess a fatigue trend" — callers
// must exclude this from the weighted readiness average instead of treating
// it as a passing score, otherwise a 1-2 rep clip silently gets free credit
// for a fatigue check that was never actually performed.
function fatigueFactor(reps, f, times, depthKey, deeperIsSmaller) {
  if (reps.length < 3) return { pct: 0, score: null };
  var third = Math.max(1, Math.floor(reps.length / 3));
  function repDur(r) { var a = times[r.start], b = times[r.end]; return (a != null && b != null && b > a) ? b - a : 0; }
  function repDepth(r) { return f[r.bottom][depthKey]; }
  var t0 = 0, tN = 0, d0 = 0, dN = 0;
  for (var i = 0; i < third; i++) { t0 += repDur(reps[i]); d0 += repDepth(reps[i]); }
  for (var i = reps.length - third; i < reps.length; i++) { tN += repDur(reps[i]); dN += repDepth(reps[i]); }
  t0 /= third; tN /= third; d0 /= third; dN /= third;
  var tempoDrift = t0 > 0.05 ? Math.max(0, (tN - t0) / t0) * 100 : 0;
  var depthDrift = deeperIsSmaller
    ? Math.max(0, (dN - d0)) / Math.max(10, Math.abs(d0)) * 100
    : Math.max(0, (d0 - dN)) / Math.max(10, Math.abs(d0)) * 100;
  var pct = Math.round(Math.max(tempoDrift, depthDrift));
  return { pct: pct, score: ramp(pct, 5, 45) };
}

function computeAssessment(history, times, counts) {
  if (!history || history.length < 15 || !counts) return null;
  var d = history.map(extractDetailed);
  var f = [];
  for (var i = 0; i < d.length; i++) {
    var lo = Math.max(0, i - 2), hi = Math.min(d.length - 1, i + 2), n = 0;
    var acc = {
      lKnee:0, rKnee:0, lHip:0, rHip:0, lElbow:0, rElbow:0,
      kneeAngle:0, hipAngle:0, elbowAngle:0,
      torsoLean:0, ankleY:0, shoulderY:0, pelvicTilt:0, wristAbove:0
    };
    for (var j = lo; j <= hi; j++) {
      acc.lKnee    += d[j].lKnee;    acc.rKnee    += d[j].rKnee;
      acc.lHip     += d[j].lHip;     acc.rHip     += d[j].rHip;
      acc.lElbow   += d[j].lElbow;   acc.rElbow   += d[j].rElbow;
      acc.kneeAngle+= d[j].kneeAngle;acc.hipAngle += d[j].hipAngle;
      acc.elbowAngle+=d[j].elbowAngle;
      acc.torsoLean+= d[j].torsoLean;acc.ankleY   += d[j].ankleY;
      acc.shoulderY+= d[j].shoulderY;
      acc.pelvicTilt+=d[j].pelvicTilt;acc.wristAbove+=d[j].wristAbove;
      n++;
    }
    f.push({
      lKnee: acc.lKnee/n, rKnee: acc.rKnee/n, lHip: acc.lHip/n, rHip: acc.rHip/n,
      lElbow: acc.lElbow/n, rElbow: acc.rElbow/n,
      kneeAngle: acc.kneeAngle/n, hipAngle: acc.hipAngle/n, elbowAngle: acc.elbowAngle/n,
      torsoLean: acc.torsoLean/n, ankleY: acc.ankleY/n, shoulderY: acc.shoulderY/n,
      pelvicTilt: acc.pelvicTilt/n, wristAbove: acc.wristAbove/n
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

    var lBot = 0, rBot = 0, nb = 0;
    for (var i = 0; i < reps.length; i++) { var b = f[reps[i].bottom]; lBot += b.lKnee; rBot += b.rKnee; nb++; }
    if (nb) { lBot /= nb; rBot /= nb; }
    var lFlex = 180 - lBot, rFlex = 180 - rBot;
    var symP = Math.round(asymPct(lFlex, rFlex));
    var symScore = ramp(symP, 5, 25);
    var symF = { id: 'symmetry', label: 'Left / Right Symmetry', value: symP, unit: '%',
      score: symScore, status: statusFromScore(symScore),
      detail: symP <= 10 ? 'Legs share load evenly.' : (lFlex < rFlex ? 'Right leg goes deeper — left may be guarding.' : 'Left leg goes deeper — right may be guarding.'),
      rec: 'symmetry' };
    factors.push(symF); consider(symF, 1);

    // Average of each rep's OWN bottom, not the single deepest frame in the
    // clip — otherwise one noisy or unrepresentative deep frame (tracking
    // jitter, a one-off good rep) would score the whole set as great depth
    // even if most reps stayed shallow.
    var repBottomK = reps.map(function(r) { return f[r.bottom].kneeAngle; });
    var avgBottomK = repBottomK.length ? repBottomK.reduce(function(a, b) { return a + b; }, 0) / repBottomK.length : sq.minK;
    var depthScore = ramp(avgBottomK, 95, 150);
    var depthPctOfParallel = Math.round(clampN((180 - avgBottomK) / (180 - 90) * 100, 0, 120));
    var depF = { id: 'depth', label: 'Squat Depth', value: depthPctOfParallel, unit: '%',
      score: depthScore, status: statusFromScore(depthScore),
      detail: depthScore >= 80 ? 'Reaches good depth.' : 'Limited depth — likely ankle/hip mobility.',
      rec: 'mobility' };
    factors.push(depF); consider(depF, 1);

    var fat = fatigueFactor(reps, f, times, 'kneeAngle', true);
    var fatF = { id: 'fatigue', label: 'Fatigue / Consistency', value: fat.pct, unit: '%',
      score: fat.score == null ? 100 : fat.score,
      status: fat.score == null ? 'green' : statusFromScore(fat.score),
      detail: fat.score == null ? 'Not enough reps to assess a fatigue trend.' : (fat.score >= 80 ? 'Reps stay consistent.' : 'Later reps lose depth or slow down.'),
      rec: 'fatigue' };
    factors.push(fatF);
    if (fat.score != null) consider(fatF, 0.6);

    var sqPerDepth = reps.map(function(r) { return Math.round(f[r.bottom].kneeAngle); });
    var sqPerDur   = reps.map(function(r) {
      var ta = times[r.start], tb = times[r.end];
      return (ta != null && tb != null && tb > ta) ? Math.round((tb - ta) * 10) / 10 : 0;
    });
    perExercise.push({
      key: 'squat', label: 'SQUAT', reps: counts.squat,
      metrics: {
        maxKneeAngle: Math.round(sq.maxK), minKneeAngle: Math.round(sq.minK),
        romDeg: Math.round(sq.maxK - sq.minK),
        avgRepSec: Math.round(avgRepSeconds(reps, times) * 10) / 10,
        totalSec: Math.round((times[times.length-1] - times[0]) * 10) / 10,
        perRepDepth: sqPerDepth, perRepDurationSec: sqPerDur
      },
      factors: factors
    });
  }

  // ── VERTICAL JUMP ────────────────────────────────────────────────────────────
  if (counts.verticalJump > 0) {
    var js = segmentJumps(f);
    var factors3 = [];

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
    var softScore = ramp(meanFlex, 60, 15);
    var softPct = Math.round(clampN(meanFlex / 60 * 100, 0, 120));
    var softF = { id: 'landing', label: 'Landing Softness', value: softPct, unit: '%',
      score: softScore, status: statusFromScore(softScore),
      detail: softScore >= 80 ? 'Absorbs landings with soft, bent knees.' : 'Stiff landing — knees stay extended, raising impact load.',
      rec: 'landing' };
    factors3.push(softF); consider(softF, 1);

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
    var jPerDepth = js.flights.map(function(fl) {
      var peak = 0;
      for (var jj = fl.takeoff; jj <= fl.land && jj < f.length; jj++) {
        var rise = js.baseline - f[jj].ankleY; if (rise > peak) peak = rise;
      }
      return Math.round(peak * 1000) / 10; // normalised height × 100 → e.g. 8.5
    });
    var jPerDur = js.flights.map(function(fl) {
      var ta = times[fl.takeoff], tb = times[fl.land];
      return (ta != null && tb != null && tb > ta) ? Math.round((tb - ta) * 100) / 100 : 0;
    });
    perExercise.push({
      key: 'jump', label: 'VERTICAL JUMP', reps: counts.verticalJump,
      metrics: {
        maxKneeAngle: Math.round(jkMax), minKneeAngle: Math.round(jkMin), romDeg: Math.round(jkMax - jkMin),
        avgRepSec: counts.verticalJump > 0 ? Math.round((times[times.length-1]-times[0]) / counts.verticalJump * 10) / 10 : 0,
        totalSec: Math.round((times[times.length-1] - times[0]) * 10) / 10,
        perRepDepth: jPerDepth, perRepDurationSec: jPerDur
      },
      factors: factors3
    });
  }

  // ── PULL-UP ──────────────────────────────────────────────────────────────────
  if (counts.pullup > 0) {
    var ps = segmentPullups(f);
    var preps = ps.reps;
    var factors4 = [];

    // ROM: how much elbow angle changes per rep (larger = fuller range)
    var romVal = Math.round(ps.maxE - ps.minE);
    var romScore = ramp(romVal, 100, 35); // 100+ deg = great, <35 deg = very partial
    var romPct   = Math.round(clampN(romVal / 120 * 100, 0, 100));
    var romF = { id: 'depth', label: 'Range of Motion', value: romPct, unit: '%',
      score: romScore, status: statusFromScore(romScore),
      detail: romScore >= 80 ? 'Full extension at bottom and solid contraction at top.' : 'Partial range — aim to fully straighten arms at bottom and pull chin above bar.',
      rec: 'mobility' };
    factors4.push(romF); consider(romF, 1);

    // Symmetry: left vs right elbow contraction at peak of each rep
    var lBent = 0, rBent = 0, npb = 0;
    for (var i = 0; i < preps.length; i++) {
      var top = f[preps[i].bottom];
      lBent += top.lElbow; rBent += top.rElbow; npb++;
    }
    if (npb) { lBent /= npb; rBent /= npb; }
    var lFlex4 = 180 - lBent, rFlex4 = 180 - rBent;
    var pSymP  = Math.round(asymPct(lFlex4, rFlex4));
    var pSymScore = ramp(pSymP, 5, 25);
    var pSymF = { id: 'symmetry', label: 'Left / Right Pull', value: pSymP, unit: '%',
      score: pSymScore, status: statusFromScore(pSymScore),
      detail: pSymScore >= 80 ? 'Both arms contribute equally to each rep.' : (lFlex4 > rFlex4 ? 'Left arm pulls harder — right side may need strengthening.' : 'Right arm pulls harder — left side may need strengthening.'),
      rec: 'scapular' };
    factors4.push(pSymF); consider(pSymF, 1);

    // Fatigue: does the peak contraction (min elbow angle) get shallower in later reps?
    var pfat = fatigueFactor(preps, f, times, 'elbowAngle', true);
    var pfatF = { id: 'fatigue', label: 'Fatigue / Consistency', value: pfat.pct, unit: '%',
      score: pfat.score == null ? 100 : pfat.score,
      status: pfat.score == null ? 'green' : statusFromScore(pfat.score),
      detail: pfat.score == null ? 'Not enough reps to assess a fatigue trend.' : (pfat.score >= 80 ? 'Reps stay consistent throughout.' : 'Later reps become shallower or slower — grip / pulling endurance fading.'),
      rec: 'fatigue' };
    factors4.push(pfatF);
    if (pfat.score != null) consider(pfatF, 0.6);

    var puPerDepth = preps.map(function(r) { return Math.round(f[r.bottom].elbowAngle); });
    var puPerDur   = preps.map(function(r) {
      var ta = times[r.start], tb = times[r.end];
      return (ta != null && tb != null && tb > ta) ? Math.round((tb - ta) * 10) / 10 : 0;
    });
    perExercise.push({
      key: 'pullup', label: 'PULL-UP', reps: counts.pullup,
      metrics: {
        maxKneeAngle: Math.round(ps.maxE), // max elbow angle (most extended = bottom hang)
        minKneeAngle: Math.round(ps.minE), // min elbow angle (most contracted = top pull)
        romDeg: romVal,
        avgRepSec: Math.round(avgRepSeconds(preps, times) * 10) / 10,
        totalSec: Math.round((times[times.length-1] - times[0]) * 10) / 10,
        perRepDepth: puPerDepth, perRepDurationSec: puPerDur
      },
      factors: factors4
    });
  }

  if (!perExercise.length) return null;

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

// Rep-completion timestamps per exercise.
// Accepts the counts from analyzeExercises() so mutual exclusion is respected —
// if squat was zeroed out (e.g. suppressed by a detected jump), its segment
// times are not computed.
function computeRepTimes(history, times, results) {
  var empty = { squat: [], jump: [], pullup: [] };
  if (!history || history.length < 15 || !times || times.length !== history.length) return empty;
  var raw = history.map(extractFeatures);
  var f   = smoothFeatures(raw);

  function endTimes(reps) {
    var o = [];
    for (var i = 0; i < reps.length; i++) { var t = times[reps[i].end]; if (t != null) o.push(t); }
    return o;
  }

  var sqTimes = (results && results.squat      > 0) ? endTimes(segmentSquat(f).reps)  : [];
  var puTimes = (results && results.pullup     > 0) ? endTimes(segmentPullups(f).reps): [];

  var jm = (results && results.verticalJump > 0) ? segmentJumps(f) : { flights: [] };
  var jumps = [];
  for (var i = 0; i < jm.flights.length; i++) { var t = times[jm.flights[i].land]; if (t != null) jumps.push(t); }

  return { squat: sqTimes, jump: jumps, pullup: puTimes };
}

// First-rep-start → last-rep-end video-time window for whichever exercise
// was actually detected — same priority as the mutual-exclusion logic in
// analyzeExercises (squat vs. jump; pullup is independent of both). Used to
// trim the clip shown to the athlete down to just the exercise itself,
// instead of whatever setup/walk-off time surrounds it in the raw recording.
function computeRepWindow(history, times, results) {
  var empty = { start: null, end: null };
  if (!history || history.length < 15 || !times || times.length !== history.length || !results) return empty;
  var raw = history.map(extractFeatures);
  var f   = smoothFeatures(raw);

  function windowFromReps(reps) {
    if (!reps.length) return null;
    var a = times[reps[0].start], b = times[reps[reps.length - 1].end];
    return (a != null && b != null) ? { start: a, end: b } : null;
  }

  if (results.squat > 0) {
    var sw = windowFromReps(segmentSquat(f).reps);
    if (sw) return sw;
  }
  if (results.verticalJump > 0) {
    var js = segmentJumps(f);
    if (js.flights.length) {
      var ta = times[js.flights[0].takeoff], tb = times[js.flights[js.flights.length - 1].land];
      if (ta != null && tb != null) return { start: ta, end: tb };
    }
  }
  if (results.pullup > 0) {
    var pw = windowFromReps(segmentPullups(f).reps);
    if (pw) return pw;
  }
  return empty;
}
`;
