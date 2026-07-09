import { EXERCISE_ANALYZER_JS } from '../../utils/exerciseAnalyzer';

/**
 * Self-contained HTML page that runs MediaPipe Pose Landmarker entirely in a
 * browser/WebView context — no backend needed.
 *
 * Two-panel presentation: the source <video> is never shown directly (it's
 * an invisible decode source for MediaPipe). Instead every frame is drawn
 * twice — once as a cropped video frame (left panel) and once as a skeleton
 * over an abstract "virtual room" scene (right panel) — both driven by the
 * SAME <video> element's playback, so play/pause/scrub/replay affect both
 * identically by construction. Rep counting / exercise analysis comes from
 * exerciseAnalyzer.ts (EXERCISE_ANALYZER_JS below), unchanged — only how the
 * result gets shown differs.
 *
 * Communication:
 *   host → page  : postMessage({ type:'loadVideo', uri })
 *   page → host  : postMessage({ type:'ready' })            once model is loaded
 *                  postMessage({ type:'error', message })    on failure
 *                  postMessage({ type:'progress', pct })     0..1 during the analysis pass
 *                  postMessage({ type:'playing' })           once visible 1× playback starts
 *                  postMessage({ type:'exerciseResults', results })
 *                  postMessage({ type:'assessment', assessment })
 */
export const MEDIAPIPE_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Pose</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{
    width:100%;height:100%;
    background:#07101C;overflow:hidden;
  }

  /* Real decode source for MediaPipe — never shown. Kept at full size
     (rather than shrunk to 1x1) so nothing about how the browser decodes it
     changes from the previously-working single-panel version; only its
     visibility does. */
  #vid{position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none;z-index:-1}

  #stage{
    position:relative;width:100%;height:100%;
    display:flex;flex-direction:row;align-items:center;justify-content:center;gap:8px;padding:8px;
    opacity:0;transition:opacity .25s;
  }
  #stage.on{opacity:1}

  /* Width/height are set in JS to exactly match the crop window's own aspect
     ratio (see layoutStage) — no flex-stretch here, so the box always hugs
     the content with zero letterbox / blank margin. */
  .panel{
    position:relative;flex:0 0 auto;
    overflow:hidden;border-radius:14px;
    background:#0E1E2F;border:1px solid #1C2E40;
  }
  .panel canvas{position:absolute;inset:0;width:100%;height:100%;display:block}

  /* controls overlay — spans both panels, hidden by default, shown on tap */
  #ctrl{
    position:absolute;inset:0;
    display:flex;flex-direction:column;justify-content:flex-end;
    background:linear-gradient(to bottom,transparent 55%,rgba(0,0,0,.65) 100%);
    opacity:0;transition:opacity .2s;
  }
  #ctrl.on{opacity:1}
  #ctrl:not(.on) #cbar{pointer-events:none}
  #cbar{
    display:flex;align-items:center;gap:10px;
    padding:0 14px 20px;
  }
  #pbtn{
    width:40px;height:40px;border-radius:50%;flex-shrink:0;
    background:rgba(0,0,0,.5);border:1.5px solid rgba(255,255,255,.6);
    display:flex;align-items:center;justify-content:center;
    cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;
  }
  #pbtn svg{display:block;}
  #sk{
    flex:1;height:3px;cursor:pointer;
    accent-color:#00D4BC;
    -webkit-appearance:none;appearance:none;
    background:rgba(255,255,255,.25);border-radius:2px;
  }
  #sk::-webkit-slider-thumb{
    -webkit-appearance:none;width:14px;height:14px;
    border-radius:50%;background:#00D4BC;cursor:pointer;
  }
  #tm{
    color:rgba(255,255,255,.8);
    font:11px/1 -apple-system,system-ui,sans-serif;
    white-space:nowrap;min-width:36px;text-align:right;
  }

  /* status / loading message — fixed so it's visible before video loads */
  #msg{
    position:fixed;inset:0;
    display:flex;align-items:center;justify-content:center;
    color:#94A3B8;font:13px -apple-system,system-ui,sans-serif;
    pointer-events:none;text-align:center;padding:16px;
  }
</style>
</head>
<body>
<video id="vid" playsinline webkit-playsinline></video>
<div id="stage">
  <div class="panel" id="leftPanel"><canvas id="leftCvs"></canvas></div>
  <div class="panel" id="rightPanel"><canvas id="roomCvs"></canvas><canvas id="skelCvs"></canvas></div>
  <div id="ctrl">
    <div id="cbar">
      <div id="pbtn"><svg viewBox="0 0 24 24" width="15" height="15" fill="white"><polygon points="6,3 20,12 6,21"/></svg></div>
      <input id="sk" type="range" min="0" max="1000" step="1" value="0">
      <span id="tm">0:00</span>
    </div>
  </div>
</div>
<div id="msg">Loading MediaPipe model…</div>

<script type="module">
import { PoseLandmarker, FilesetResolver }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const vid   = document.getElementById('vid');
const stage = document.getElementById('stage');
const leftPanel  = document.getElementById('leftPanel');
const rightPanel = document.getElementById('rightPanel');
const leftCvs  = document.getElementById('leftCvs');
const roomCvs  = document.getElementById('roomCvs');
const skelCvs  = document.getElementById('skelCvs');
const leftCtx  = leftCvs.getContext('2d');
const roomCtx  = roomCvs.getContext('2d');
const skelCtx  = skelCvs.getContext('2d');
const ctrl = document.getElementById('ctrl');
const pbtn = document.getElementById('pbtn');
const sk   = document.getElementById('sk');
const tm   = document.getElementById('tm');
const msg  = document.getElementById('msg');

let landmarker = null;
let rafId      = null;
let hideTimer  = null;

// Adaptive landmark smoothing — see the "landmark smoothing" section below
// for the One Euro Filter implementation. landmarkFilters holds per-joint,
// per-axis filter state; reset via resetSmoothing() on every video load/seek.
let landmarkFilters = null;
let lastSmoothT = null;

// Most recently smoothed landmark set during 'show' playback — kept around
// so a single dropped detection on one frame doesn't blank the skeleton;
// it just keeps showing the last good pose until the next one arrives.
let lastLandmarks = null;

// Which face landmark the head circle is anchored to — sticky across
// frames (see drawSkeleton) so a visibility score hovering near the
// threshold doesn't flicker the head between anchor points.
let headSourceMode = 'none'; // 'nose' | 'ears' | 'none'

// 'preprocess': silent 8× pass to collect landmarks before user sees video
// 'show':       normal 1× playback for the user
let phase = 'idle';
let playingNotified = false; // send 'playing' only once per video load

// Rep-completion timestamps per exercise, computed once after the preprocess
// pass (see computeRepTimes in exerciseAnalyzer.ts). The HUD count at any
// moment is a pure function of these plus the current video time, so it's
// always correct — including while the user scrubs/replays.
let repTimes = { squat: [], jump: [], pullup: [] };
function countLE(arr, t) { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i] <= t) n++; return n; }

// Shown clip window (video-time seconds) — first-rep-start to last-rep-end
// padded by RW_PAD_SEC on each side (see computeRepWindow in
// exerciseAnalyzer.ts), computed once after preprocess. Playback, the scrub
// bar, and the timer are all relative to THIS window, not the raw clip —
// see layoutShowWindow / the timeupdate + scrub handlers below. Falls back
// to the full clip (0..duration) if no reps were detected.
const RW_PAD_SEC = 1;
let clipStart = 0;
let clipEnd = 0;
let showFinished = false; // true once playback has reached clipEnd (or native end)

const IC_PLAY   = '<svg viewBox="0 0 24 24" width="15" height="15" fill="white"><polygon points="6,3 20,12 6,21"/></svg>';
const IC_PAUSE  = '<svg viewBox="0 0 24 24" width="15" height="15" fill="white"><rect x="4" y="3" width="5" height="18" rx="1.5"/><rect x="15" y="3" width="5" height="18" rx="1.5"/></svg>';
const IC_REPLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="white"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';

// ── host communication ──────────────────────────────────────────────────────

function postUp(obj) {
  const s = JSON.stringify(obj);
  try { window.ReactNativeWebView?.postMessage(s); } catch {}
  try { if (window.parent !== window) window.parent.postMessage(s, '*'); } catch {}
}

function setMsg(text) {
  msg.textContent = text;
  msg.style.display = text ? 'flex' : 'none';
}

// Progress during the silent preprocess pass — throttled to ~1 msg/150ms so
// the host's loading bar has a real signal to animate instead of sitting at 0%.
let lastProgressMs = -Infinity;
function sendProgress(pct) {
  const now = performance.now();
  if (now - lastProgressMs < 150) return;
  lastProgressMs = now;
  postUp({ type: 'progress', pct: Math.max(0, Math.min(1, pct)) });
}

// ── init ────────────────────────────────────────────────────────────────────

async function init() {
  setMsg('Loading MediaPipe model…');
  try {
    const vision = await FilesetResolver.forVisionTasks(
      'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm'
    );
    landmarker = await PoseLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath:
          'https://storage.googleapis.com/mediapipe-models/pose_landmarker/' +
          'pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
        delegate: 'GPU',
      },
      runningMode: 'VIDEO',
      numPoses: 1,
    });
    vid.muted = true;
    setMsg('');
    layoutStage();
    postUp({ type: 'ready' });
  } catch (e) {
    setMsg('Model error: ' + e.message);
    postUp({ type: 'error', message: String(e.message) });
  }
}

// ── panel layout ──────────────────────────────────────────────────────────
//
// Both panel boxes are explicitly sized in JS to exactly match the crop
// window's own aspect ratio (see cropAspect below) — not stretched flex
// children with content fit inside them. That means zero letterbox / blank
// margin: the panel border always hugs the video/skeleton content directly,
// and the two panels are still guaranteed identical size (both computed
// from the same aspect + available space).

const dpr = Math.min(window.devicePixelRatio || 1, 2); // capped — crispness vs. memory/perf
const PANEL_GAP = 8; // css px — must match #stage's CSS gap property
let panelFit = { x: 0, y: 0, w: 0, h: 0 }; // canvas-px rect the content fills — the full canvas, since the panel itself now matches the content's aspect

function layoutStage() {
  const r = stage.getBoundingClientRect();
  const maxW = Math.max(1, (r.width - PANEL_GAP) / 2);
  const maxH = Math.max(1, r.height);

  let wCss, hCss;
  if (maxW / maxH > cropAspect) { hCss = maxH; wCss = hCss * cropAspect; }
  else { wCss = maxW; hCss = wCss / cropAspect; }
  wCss = Math.max(1, Math.round(wCss));
  hCss = Math.max(1, Math.round(hCss));

  leftPanel.style.width  = wCss + 'px'; leftPanel.style.height  = hCss + 'px';
  rightPanel.style.width = wCss + 'px'; rightPanel.style.height = hCss + 'px';

  const wPx = Math.max(1, Math.round(wCss * dpr));
  const hPx = Math.max(1, Math.round(hCss * dpr));
  [leftCvs, roomCvs, skelCvs].forEach(c => {
    if (c.width !== wPx || c.height !== hPx) { c.width = wPx; c.height = hPx; }
  });

  panelFit = { x: 0, y: 0, w: wPx, h: hPx };
  drawRoomBackground();
}
window.addEventListener('resize', layoutStage);

// ── crop window (computed once per clip, from the full landmark history) ────
//
// A per-frame "follow" crop would jitter and fight the smoothing — instead
// we compute ONE static window from the athlete's full range of motion
// across the whole clip: the min/max of EVERY landmark (all 33 joints,
// including feet and face) over EVERY frame collected during preprocess,
// plus padding. That guarantees head and toes stay in frame through the
// deepest rep and through however far the athlete moves around, and the
// crop never moves during playback. The same window (in normalised 0..1
// video space) is used to both crop the video (left panel) and re-project
// the skeleton (right panel), so the two panels always frame the athlete
// identically — see layoutStage, which sizes both panel boxes to this
// window's own aspect ratio so there's no letterbox/blank margin either.
const CROP_PAD_FRAC = 0.18; // padding added on each side, as a fraction of the raw bbox size — shows more surrounding video
const CROP_VIS_MIN  = 0.35; // ignore low-confidence landmarks when framing the crop

let cropRect   = { x0: 0, y0: 0, x1: 1, y1: 1 }; // normalised [0,1] video-space
let cropAspect = 1; // (crop width in px) / (crop height in px) — needs true video pixel aspect

function computeCropRect(history) {
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, any = false;
  for (let i = 0; i < history.length; i++) {
    const lm = history[i];
    for (let j = 0; j < lm.length; j++) {
      const p = lm[j];
      if (p.visibility != null && p.visibility < CROP_VIS_MIN) continue;
      if (p.x < minX) minX = p.x; if (p.x > maxX) maxX = p.x;
      if (p.y < minY) minY = p.y; if (p.y > maxY) maxY = p.y;
      any = true;
    }
  }
  if (!any || maxX <= minX || maxY <= minY) return { x0: 0, y0: 0, x1: 1, y1: 1 };

  const w = maxX - minX, h = maxY - minY;
  const px = w * CROP_PAD_FRAC, py = h * CROP_PAD_FRAC;
  return {
    x0: Math.max(0, minX - px), y0: Math.max(0, minY - py),
    x1: Math.min(1, maxX + px), y1: Math.min(1, maxY + py),
  };
}

// Average shoulder width (normalised video-space) over the whole clip — a
// stable per-clip constant used to size the drawn head circle. Per-frame
// shoulder/ear distances foreshorten a lot with head turn/tilt and landmark
// noise, which made the circle visibly grow and shrink through the video;
// a single clip-wide average removes that jitter (see drawSkeleton).
let canonicalShoulderWidth = 0.2; // normalised units — sane default before any clip is measured

function computeCanonicalShoulderWidth(history) {
  let sum = 0, n = 0;
  for (let i = 0; i < history.length; i++) {
    const ls = history[i][11], rs = history[i][12];
    if (!ls || !rs) continue;
    if ((ls.visibility ?? 1) < CROP_VIS_MIN || (rs.visibility ?? 1) < CROP_VIS_MIN) continue;
    sum += Math.hypot(ls.x - rs.x, ls.y - rs.y);
    n++;
  }
  return n ? sum / n : canonicalShoulderWidth;
}

// Maps a normalised [0,1] video-space point into on-screen canvas px, through
// the shared crop window + contain-fit box. Used only for the skeleton;
// the video crop itself is drawn straight from source pixels (see drawLeftPanel).
function mapPt(p) {
  const nx = (p.x - cropRect.x0) / (cropRect.x1 - cropRect.x0);
  const ny = (p.y - cropRect.y0) / (cropRect.y1 - cropRect.y0);
  return { x: panelFit.x + nx * panelFit.w, y: panelFit.y + ny * panelFit.h };
}

// ── landmark smoothing (One Euro Filter) ─────────────────────────────────────
//
// A fixed-window average can't be both smooth AND responsive: widen it to
// kill jitter at rest and it visibly lags fast motion (a squat descent, a
// jump); narrow it to track fast motion and jitter comes back at rest.
//
// The One Euro Filter (Casiez, Roussel, Vogel — CHI 2012) solves this by
// adapting its own cutoff frequency to the signal's velocity every frame:
// heavy smoothing when nearly still, almost none when moving fast. It is the
// standard technique for exactly this jitter-vs-lag tradeoff in real-time
// human-tracking signals (hand tracking, pose tracking, etc).
//
// Landmarks are normalised to [0,1] (fraction of frame), so velocities are
// tiny numbers — MIN_CUTOFF/BETA below are tuned for that scale, not pixels.
const ONEURO_MIN_CUTOFF = 1.2; // Hz — baseline smoothing strength at rest
const ONEURO_BETA       = 8.0; // how fast the cutoff rises with velocity
const ONEURO_DCUTOFF    = 1.0; // Hz — smoothing applied to the velocity estimate itself

function oneEuroAlpha(cutoff, dt) {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

function makeOneEuroState() {
  return { prev: null, prevDeriv: 0 };
}

// Filters a single scalar signal (one landmark's x or y) through time.
function oneEuroStep(state, x, dt) {
  if (state.prev === null || dt <= 0) {
    state.prev = x; state.prevDeriv = 0;
    return x;
  }
  const dx  = (x - state.prev) / dt;
  const aD  = oneEuroAlpha(ONEURO_DCUTOFF, dt);
  const edx = aD * dx + (1 - aD) * state.prevDeriv;
  const cutoff = ONEURO_MIN_CUTOFF + ONEURO_BETA * Math.abs(edx);
  const a = oneEuroAlpha(cutoff, dt);
  const filtered = a * x + (1 - a) * state.prev;
  state.prev = filtered;
  state.prevDeriv = edx;
  return filtered;
}

function resetSmoothing() {
  landmarkFilters = null;
  lastSmoothT = null;
}

// Below this confidence, MediaPipe is usually guessing/extrapolating an
// occluded or off-frame joint rather than reporting a real observation —
// those guesses can land almost anywhere in the frame from one tick to the
// next, which is what reads as joints "switching places"/"spinning" on
// screen. Holding the joint at its last trusted position through a dip in
// confidence (instead of filtering the outlier in, which still drags the
// smoothed position toward it) keeps it visually stable until tracking
// recovers, at the cost of a frozen limb during a genuine long occlusion.
const VIS_HOLD_MIN = 0.35;

// z/visibility aren't drawn and don't need velocity-adaptive treatment — a
// light fixed blend is enough to keep the confidence number from flickering.
function smoothLandmarks(raw, t) {
  const L = raw.length;
  if (!landmarkFilters) {
    landmarkFilters = new Array(L);
    for (let i = 0; i < L; i++) landmarkFilters[i] = { x: makeOneEuroState(), y: makeOneEuroState(), z: 0, v: 1 };
  }
  const dt = (lastSmoothT == null) ? (1 / 30) : Math.max(1e-3, t - lastSmoothT);
  lastSmoothT = t;

  const out = new Array(L);
  for (let i = 0; i < L; i++) {
    const lm = raw[i];
    const f  = landmarkFilters[i];
    const vis = lm.visibility ?? 1;
    f.v = f.v * 0.7 + vis * 0.3;

    // Gate on the SMOOTHED confidence (f.v), not this single frame's raw
    // value — a joint whose raw confidence bounces above/below the
    // threshold frame to frame (fast motion + brief occlusion, e.g. a wrist
    // passing behind the head near the top of a pull-up) would otherwise
    // flip between "hold" and "resume filtering with a sudden raw jump"
    // every frame or two, which reads as the joint snapping/swerving rather
    // than the smooth hold this is meant to produce.
    if (f.v < VIS_HOLD_MIN && f.x.prev != null) {
      out[i] = { x: f.x.prev, y: f.y.prev, z: f.z, visibility: f.v };
      continue;
    }

    f.z = f.z * 0.7 + (lm.z ?? 0) * 0.3;
    out[i] = {
      x: oneEuroStep(f.x, lm.x, dt),
      y: oneEuroStep(f.y, lm.y, dt),
      z: f.z,
      visibility: f.v,
    };
  }
  return out;
}

${EXERCISE_ANALYZER_JS}

// ── abstract "virtual room" scene (right panel background) ──────────────────
//
// Pure canvas 2D — no 3D library — a soft one-point-perspective floor grid
// plus a radial glow and vignette, in the app's own navy/teal palette. It's
// static per panel size, so it's only (re)drawn on resize/init, not per
// frame; the skeleton canvas sits on top of it and is the only thing that
// redraws every frame.
function drawRoomBackground() {
  const w = roomCvs.width, h = roomCvs.height;
  if (w < 2 || h < 2) return;
  roomCtx.clearRect(0, 0, w, h);

  roomCtx.fillStyle = '#07101C';
  roomCtx.fillRect(0, 0, w, h);

  const vpX = w / 2, vpY = h * 0.38; // vanishing point

  // Soft glow suggesting a back wall receding into the scene
  const glow = roomCtx.createRadialGradient(vpX, vpY, 0, vpX, vpY, Math.max(w, h) * 0.8);
  glow.addColorStop(0,   'rgba(0,212,188,0.14)');
  glow.addColorStop(0.5, 'rgba(0,212,188,0.05)');
  glow.addColorStop(1,   'rgba(7,16,28,0)');
  roomCtx.fillStyle = glow;
  roomCtx.fillRect(0, 0, w, h);

  const floorTopY = vpY + h * 0.02;

  // Floor seams radiating from the vanishing point
  roomCtx.strokeStyle = 'rgba(0,212,188,0.20)';
  roomCtx.lineWidth = Math.max(1, w * 0.0022);
  const N_LINES = 9;
  for (let i = 0; i <= N_LINES; i++) {
    const fx = (i / N_LINES) * w;
    roomCtx.beginPath();
    roomCtx.moveTo(vpX, floorTopY);
    roomCtx.lineTo(fx, h);
    roomCtx.stroke();
  }

  // Floor rungs, bunching up near the horizon for a fake-depth cue
  const N_RUNGS = 6;
  for (let i = 1; i <= N_RUNGS; i++) {
    const t = Math.pow(i / N_RUNGS, 1.6);
    const y = floorTopY + t * (h - floorTopY);
    const spread = 0.15 + t * 0.85;
    roomCtx.beginPath();
    roomCtx.moveTo(vpX - spread * w / 2, y);
    roomCtx.lineTo(vpX + spread * w / 2, y);
    roomCtx.stroke();
  }

  // Horizon accent
  roomCtx.strokeStyle = 'rgba(0,212,188,0.30)';
  roomCtx.lineWidth = Math.max(1, w * 0.003);
  roomCtx.beginPath();
  roomCtx.moveTo(0, floorTopY);
  roomCtx.lineTo(w, floorTopY);
  roomCtx.stroke();

  // Vignette so the scene reads as an enclosed room, not a flat gradient
  const vg = roomCtx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.35, w / 2, h / 2, Math.max(w, h) * 0.75);
  vg.addColorStop(0, 'rgba(0,0,0,0)');
  vg.addColorStop(1, 'rgba(0,0,0,0.45)');
  roomCtx.fillStyle = vg;
  roomCtx.fillRect(0, 0, w, h);
}

// ── skeleton (right panel) ───────────────────────────────────────────────────
//
// Full chain from ankle up through the neck, plus a synthesised head. Left/
// right pairing matches MediaPipe's own convention (odd-ish index = left,
// even = right) and the same convention already used in exerciseAnalyzer.ts.
const SKELETON_BONES = [
  [27, 25], [25, 23], [23, 11], [11, 13], [13, 15], // left:  ankle-knee-hip-shoulder-elbow-wrist
  [28, 26], [26, 24], [24, 12], [12, 14], [14, 16], // right: ankle-knee-hip-shoulder-elbow-wrist
  [23, 24], // pelvis
  [11, 12], // shoulders
];
const JOINT_DOTS = [27, 28, 25, 26, 23, 24, 11, 12, 13, 14, 15, 16];

function drawSkeleton(landmarks) {
  skelCtx.clearRect(0, 0, skelCvs.width, skelCvs.height);
  if (!landmarks) return;

  const P = (i) => mapPt(landmarks[i]);
  const unit = Math.max(1, skelCvs.width) * 0.01; // 1 unit = 1% of panel width

  skelCtx.save();
  skelCtx.lineCap = 'round';
  skelCtx.lineJoin = 'round';
  skelCtx.shadowColor = 'rgba(0,212,188,0.55)';
  skelCtx.shadowBlur = unit * 1.2;
  skelCtx.strokeStyle = 'rgba(0,212,188,0.92)';
  skelCtx.lineWidth = Math.max(2, unit * 1.0);

  SKELETON_BONES.forEach(([a, b]) => {
    const pa = P(a), pb = P(b);
    skelCtx.beginPath();
    skelCtx.moveTo(pa.x, pa.y);
    skelCtx.lineTo(pb.x, pb.y);
    skelCtx.stroke();
  });

  // Neck + head — placed from whatever face landmarks MediaPipe reports as
  // visible this frame (nose first, then ear midpoint, then a plain offset
  // above the neck if the face isn't visible at all).
  const shoulderL = P(11), shoulderR = P(12);
  const neck = { x: (shoulderL.x + shoulderR.x) / 2, y: (shoulderL.y + shoulderR.y) / 2 };
  const shoulderWidth = Math.hypot(shoulderL.x - shoulderR.x, shoulderL.y - shoulderR.y);

  const nose = landmarks[0], earL = landmarks[7], earR = landmarks[8];
  const noseVis = nose ? (nose.visibility ?? 1) : 0;
  const earsVis = (earL && earR) ? Math.min(earL.visibility ?? 1, earR.visibility ?? 1) : 0;

  // Hysteresis: easier to KEEP the current anchor than to SWITCH to a new
  // one, so a visibility score hovering right around the threshold doesn't
  // make the head flicker/whirl between nose- and ear-anchored positions.
  if (headSourceMode === 'nose') {
    if (noseVis < 0.15) headSourceMode = earsVis > 0.3 ? 'ears' : 'none';
  } else if (headSourceMode === 'ears') {
    if (earsVis < 0.15) headSourceMode = noseVis > 0.3 ? 'nose' : 'none';
  } else if (noseVis > 0.3) {
    headSourceMode = 'nose';
  } else if (earsVis > 0.3) {
    headSourceMode = 'ears';
  }

  const noseVisible = headSourceMode === 'nose';
  const earsVisible = headSourceMode === 'ears';

  // Nose/ear X position swings a lot with head turn/tilt (e.g. looking down
  // during a squat) — using it verbatim made the head, and the neck line
  // pointing at it, lean forward much more than looks right for a stick
  // figure. Damping it toward the neck's own X keeps the head roughly over
  // the spine while still allowing some natural lean to show through.
  const HEAD_X_DAMPING = 0.4;

  let headCenterRaw;
  if (noseVisible) {
    const hp = P(0);
    // Nose sits mid-face, not the crown — nudge up so the circle reads as a
    // head sitting on the neck rather than floating at chin/nose height.
    headCenterRaw = { x: neck.x + (hp.x - neck.x) * HEAD_X_DAMPING, y: hp.y - shoulderWidth * 0.18 };
  } else if (earsVisible) {
    const el = P(7), er = P(8);
    const ex = (el.x + er.x) / 2;
    headCenterRaw = { x: neck.x + (ex - neck.x) * HEAD_X_DAMPING, y: (el.y + er.y) / 2 - shoulderWidth * 0.10 };
  } else {
    headCenterRaw = { x: neck.x, y: neck.y - shoulderWidth * 0.55 };
  }

  // Fixed per-clip radius (from canonicalShoulderWidth, not this frame's live
  // shoulder/ear distance) so the circle doesn't visibly grow and shrink as
  // the athlete turns or tilts their head through the video.
  const canonicalShoulderWidthPx = canonicalShoulderWidth / (cropRect.x1 - cropRect.x0) * panelFit.w;
  const headRadius = canonicalShoulderWidthPx * 0.30;

  // Pull the head in toward the neck for a shorter neck than the raw
  // landmark-derived gap would give (nose/ears sit further from the
  // shoulders than looks right for a stick-figure neck).
  const NECK_SHRINK = 0.6;
  const headCenter = {
    x: neck.x + (headCenterRaw.x - neck.x) * NECK_SHRINK,
    y: neck.y + (headCenterRaw.y - neck.y) * NECK_SHRINK,
  };

  // Stop the neck line exactly at the head circle's edge (not inside it) —
  // project the endpoint back from headCenter toward neck by one radius.
  const toHeadDist = Math.max(1e-3, Math.hypot(headCenter.x - neck.x, headCenter.y - neck.y));
  const neckEnd = {
    x: headCenter.x - (headCenter.x - neck.x) / toHeadDist * headRadius,
    y: headCenter.y - (headCenter.y - neck.y) / toHeadDist * headRadius,
  };
  skelCtx.beginPath();
  skelCtx.moveTo(neck.x, neck.y);
  skelCtx.lineTo(neckEnd.x, neckEnd.y);
  skelCtx.stroke();

  // Joints
  skelCtx.shadowBlur = unit * 0.8;
  skelCtx.fillStyle = '#F0F6FF';
  JOINT_DOTS.forEach((i) => {
    const p = P(i);
    skelCtx.beginPath();
    skelCtx.arc(p.x, p.y, Math.max(2.5, unit * 1.1), 0, Math.PI * 2);
    skelCtx.fill();
  });
  const neckDot = neck;
  skelCtx.beginPath();
  skelCtx.arc(neckDot.x, neckDot.y, Math.max(2.5, unit * 1.1), 0, Math.PI * 2);
  skelCtx.fill();

  // Head
  skelCtx.fillStyle = 'rgba(0,212,188,0.20)';
  skelCtx.beginPath();
  skelCtx.arc(headCenter.x, headCenter.y, headRadius, 0, Math.PI * 2);
  skelCtx.fill();
  skelCtx.strokeStyle = 'rgba(0,212,188,0.95)';
  skelCtx.lineWidth = Math.max(2, unit * 0.8);
  skelCtx.stroke();

  skelCtx.restore();
}

// ── left panel (cropped original video) ──────────────────────────────────────

function drawLeftPanel() {
  leftCtx.clearRect(0, 0, leftCvs.width, leftCvs.height);
  leftCtx.fillStyle = '#07101C';
  leftCtx.fillRect(0, 0, leftCvs.width, leftCvs.height);
  if (!vid.videoWidth || vid.readyState < 2) return;

  const sx = cropRect.x0 * vid.videoWidth;
  const sy = cropRect.y0 * vid.videoHeight;
  const sw = Math.max(1, (cropRect.x1 - cropRect.x0) * vid.videoWidth);
  const sh = Math.max(1, (cropRect.y1 - cropRect.y0) * vid.videoHeight);
  leftCtx.drawImage(vid, sx, sy, sw, sh, panelFit.x, panelFit.y, panelFit.w, panelFit.h);
}

// ── HUD counter ─────────────────────────────────────────────────────────────
// Drawn on top of the right (virtual room / skeleton) panel. Count at time t
// is a pure function of repTimes + t (see repTimes above), so it's correct
// immediately on scrub/replay too.

function drawCounter(ctx, w, h, t) {
  const rows = [];
  const sq = countLE(repTimes.squat,    t); if (sq  > 0) rows.push(['SQUAT',    sq]);
  const jm = countLE(repTimes.jump,     t); if (jm  > 0) rows.push(['JUMP',     jm]);
  const pu = countLE(repTimes.pullup,   t); if (pu  > 0) rows.push(['PULL-UP',  pu]);
  if (!rows.length) return;

  // All sizes relative to the shorter panel dimension so portrait / landscape
  // both look right regardless of native video resolution.
  const base  = Math.min(w, h);
  const u     = base / 100;           // 1 unit = 1% of shorter dimension
  const lbl   = u * 3.3;             // label font size
  const num   = u * 9.6;             // count font size
  const rh    = num + lbl + u * 4.0; // row height
  const cPad  = u * 3.8;             // horizontal padding inside card
  const tPad  = u * 2.3;             // vertical padding top
  const bPad  = u * 1.7;             // vertical padding bottom
  const cw    = u * 32;              // card width
  const ch    = rows.length * rh + tPad + bPad;
  const ox    = u * 3.5;             // card offset from left edge
  const oy    = u * 3.5;             // card offset from top edge
  const rad   = u * 2.0;             // corner radius

  // Rounded-rect path helper (no roundRect API needed)
  function rr(x, y, ww, hh, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+ww-r, y);
    ctx.arcTo(x+ww, y,   x+ww, y+r,   r);
    ctx.lineTo(x+ww, y+hh-r);
    ctx.arcTo(x+ww, y+hh, x+ww-r, y+hh, r);
    ctx.lineTo(x+r, y+hh);
    ctx.arcTo(x,   y+hh, x,   y+hh-r, r);
    ctx.lineTo(x,   y+r);
    ctx.arcTo(x,   y,   x+r, y,     r);
    ctx.closePath();
  }

  ctx.save();

  // Card shadow
  ctx.shadowColor = 'rgba(0,0,0,0.60)';
  ctx.shadowBlur  = u * 3.5;
  ctx.shadowOffsetX = u * 0.5;
  ctx.shadowOffsetY = u * 1.0;

  // Card background
  ctx.fillStyle = 'rgba(7,16,28,0.86)';
  rr(ox, oy, cw, ch, rad);
  ctx.fill();

  ctx.shadowColor = 'transparent';
  ctx.shadowBlur  = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;

  // Card border
  ctx.strokeStyle = 'rgba(0,212,188,0.30)';
  ctx.lineWidth   = u * 0.25;
  rr(ox, oy, cw, ch, rad);
  ctx.stroke();

  // Top accent stripe (teal)
  ctx.fillStyle = '#00D4BC';
  ctx.fillRect(ox + rad, oy, cw - rad * 2, u * 0.8);

  const font = '-apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif';

  rows.forEach(([label, count], i) => {
    const ry = oy + tPad + i * rh;

    // Exercise label — small, muted, letter-spaced feel via spacing in text
    ctx.font         = '600 ' + lbl + 'px ' + font;
    ctx.fillStyle    = 'rgba(148,163,184,0.90)';
    ctx.textAlign    = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(label, ox + cPad, ry);

    // Rep count — large, bold, teal, right-aligned
    ctx.font         = '900 ' + num + 'px ' + font;
    ctx.fillStyle    = '#00D4BC';
    ctx.textAlign    = 'right';
    ctx.textBaseline = 'top';
    ctx.fillText(String(count), ox + cw - cPad, ry + lbl + u * 0.6);

    // Row divider (skip after last row)
    if (i < rows.length - 1) {
      const dy = ry + rh - u * 0.8;
      ctx.strokeStyle = 'rgba(255,255,255,0.10)';
      ctx.lineWidth   = u * 0.18;
      ctx.beginPath();
      ctx.moveTo(ox + u * 1.5, dy);
      ctx.lineTo(ox + cw - u * 1.5, dy);
      ctx.stroke();
    }
  });

  ctx.restore();
}

// ── render loop ─────────────────────────────────────────────────────────────

function renderFrame() {
  if (!landmarker || vid.paused || vid.ended || vid.readyState < 2) {
    rafId = null; return;
  }

  // Clip is trimmed to clipStart..clipEnd — <video> has no native trim, so
  // this is what actually stops playback at the end of the shown window
  // instead of letting it run to the true end of the raw recording.
  if (phase === 'show' && vid.currentTime >= clipEnd) {
    vid.pause();
    vid.currentTime = clipEnd;
    finishShowPlayback();
    return;
  }

  const result = landmarker.detectForVideo(vid, performance.now());

  if (phase === 'preprocess') {
    if (result.landmarks?.length) {
      // Store raw landmarks — smoothing would flatten depth peaks and skew thresholds.
      // timeHistory holds real video time (playbackRate doesn't affect currentTime)
      // so per-rep durations come out in true seconds.
      landmarkHistory.push(copyLandmarks(result.landmarks[0]));
      timeHistory.push(vid.currentTime);
      if (vid.duration > 0) sendProgress(vid.currentTime / vid.duration);
    }
  } else {
    // Keep the cropped video panel moving every frame regardless of whether
    // this particular tick produced a pose result — only the skeleton
    // depends on one, and it holds the last good pose if this tick has none.
    drawLeftPanel();
    if (result.landmarks?.length) {
      lastLandmarks = smoothLandmarks(result.landmarks[0], vid.currentTime);
    }
    drawSkeleton(lastLandmarks);
    drawCounter(skelCtx, skelCvs.width, skelCvs.height, vid.currentTime);
  }
  rafId = requestAnimationFrame(renderFrame);
}

// Redraws both panels for the single current frame while paused — used after
// a scrub/seek so dragging the slider updates the picture live instead of
// only catching up once playback resumes (the rAF loop above only runs while
// vid is actually playing).
function renderPausedFrame() {
  if (!landmarker || phase !== 'show' || vid.readyState < 2) return;
  drawLeftPanel();
  const result = landmarker.detectForVideo(vid, performance.now());
  if (result.landmarks?.length) {
    lastLandmarks = smoothLandmarks(result.landmarks[0], vid.currentTime);
  }
  drawSkeleton(lastLandmarks);
  drawCounter(skelCtx, skelCvs.width, skelCvs.height, vid.currentTime);
}

// ── controls ────────────────────────────────────────────────────────────────

function fmt(s) {
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function showCtrl(sticky) {
  ctrl.classList.add('on');
  clearTimeout(hideTimer);
  if (!sticky) hideTimer = setTimeout(() => ctrl.classList.remove('on'), 3000);
}

function hideCtrl() {
  ctrl.classList.remove('on');
  clearTimeout(hideTimer);
}

// tap on stage toggles controls
ctrl.addEventListener('click', (e) => {
  if (e.target === sk || e.target === pbtn) return;
  ctrl.classList.contains('on') ? hideCtrl() : showCtrl();
});

pbtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (vid.paused || vid.ended) {
    if (phase === 'show' && showFinished) {
      // Seek to the start of the shown window first; play from the 'seeked'
      // callback so we never call vid.play() before the seek completes. No
      // canvas clear here — the last frame stays visible on both panels
      // during the seek to avoid a blank flash.
      vid.currentTime = clipStart;
      vid.addEventListener('seeked', () => void vid.play(), { once: true });
    } else {
      void vid.play();
    }
  } else {
    vid.pause();
  }
  showCtrl();
});

sk.addEventListener('mousedown', e => e.stopPropagation());
sk.addEventListener('touchstart', e => e.stopPropagation(), { passive: true });
sk.addEventListener('input', (e) => {
  e.stopPropagation();
  if (vid.duration) vid.currentTime = clipStart + (clipEnd - clipStart) * sk.value / 1000;
  showCtrl();
});

// Scrub bar + timer are relative to the shown window (clipStart..clipEnd),
// not the raw clip — 0:00 is the start of the trimmed video, not frame 0.
vid.addEventListener('timeupdate', () => {
  if (!vid.duration) return;
  const span = Math.max(0.001, clipEnd - clipStart);
  sk.value = Math.round(clampN((vid.currentTime - clipStart) / span, 0, 1) * 1000);
  tm.textContent = fmt(Math.max(0, vid.currentTime - clipStart));
});

vid.addEventListener('play', () => { pbtn.innerHTML = IC_PAUSE; });
vid.addEventListener('ended', () => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }

  if (phase === 'preprocess') {
    // Silent pass complete — run analysis before user sees anything
    const results = analyzeExercises();
    if (results) postUp({ type: 'exerciseResults', results: results });

    // Full readiness/injury assessment — computed on the same landmark history,
    // with real per-rep timing, before the history is cleared.
    try {
      const assessment = computeAssessment(landmarkHistory, timeHistory, results);
      if (assessment) postUp({ type: 'assessment', assessment: assessment });
    } catch (err) { postUp({ type: 'error', message: 'assessment: ' + String(err && err.message) }); }

    repTimes = computeRepTimes(landmarkHistory, timeHistory, results); // must come before history is cleared

    // Trim the shown clip to first-rep-start .. last-rep-end (±RW_PAD_SEC),
    // instead of the whole raw recording — falls back to the full clip if no
    // reps were detected. Must happen before history is cleared below.
    const repWindow = computeRepWindow(landmarkHistory, timeHistory, results);
    const dur = vid.duration || 0;
    clipStart = Math.max(0, (repWindow.start ?? 0) - RW_PAD_SEC);
    clipEnd   = Math.min(dur || Infinity, (repWindow.end ?? dur) + RW_PAD_SEC);
    if (!(clipEnd > clipStart)) { clipStart = 0; clipEnd = dur; }

    // Frame both panels from only the landmarks within the shown window —
    // setup/walk-off time outside it shouldn't widen the crop.
    const framingHistory = [];
    for (let i = 0; i < timeHistory.length; i++) {
      if (timeHistory[i] >= clipStart && timeHistory[i] <= clipEnd) framingHistory.push(landmarkHistory[i]);
    }
    const framingSource = framingHistory.length ? framingHistory : landmarkHistory;

    // Static crop window for both panels, from the full range of motion
    // just collected — must happen before history is cleared below. Resize
    // the panel boxes themselves to this aspect now that it's known.
    cropRect = computeCropRect(framingSource);
    cropAspect = ((cropRect.x1 - cropRect.x0) * vid.videoWidth) / ((cropRect.y1 - cropRect.y0) * vid.videoHeight);
    canonicalShoulderWidth = computeCanonicalShoulderWidth(framingSource);
    layoutStage();

    // Reset state and replay at 1× for the user
    landmarkHistory.length = 0;
    timeHistory.length = 0;
    resetSmoothing();
    lastLandmarks = null;
    phase = 'show';
    showFinished = false;
    skelCtx.clearRect(0, 0, skelCvs.width, skelCvs.height);
    vid.playbackRate = 1;
    stage.classList.add('on');
    vid.currentTime = clipStart;
    vid.addEventListener('seeked', () => void vid.play(), { once: true });
    return;
  }

  // Display phase ended (native duration reached) — fallback for when
  // clipEnd lands within rounding of the true duration; the normal case is
  // caught in renderFrame reaching clipEnd first (see finishShowPlayback).
  finishShowPlayback();
});

// Shared "the shown clip is done" state — reachable either by hitting
// clipEnd during renderFrame (the normal case) or by the video's native
// 'ended' event (fallback, see above).
function finishShowPlayback() {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  showFinished = true;
  pbtn.innerHTML = IC_REPLAY;
  setMsg('');
  showCtrl(true);
}

// ── video lifecycle ──────────────────────────────────────────────────────────

vid.addEventListener('loadedmetadata', layoutStage);
vid.addEventListener('seeked', () => {
  resetSmoothing();
  lastLandmarks = null;
  if (vid.paused) {
    // Scrubbing to/past clipEnd while paused shows the replay icon, same as
    // reaching it during playback; scrubbing back off it goes back to plain
    // play, not staying stuck on replay. Also redraw both panels for the
    // frame just scrubbed to instead of leaving the old one on screen until
    // playback resumes.
    showFinished = vid.currentTime >= clipEnd;
    pbtn.innerHTML = showFinished ? IC_REPLAY : IC_PLAY;
    renderPausedFrame();
  }
});

vid.addEventListener('loadeddata', () => {
  if (landmarker && vid.readyState >= 2) {
    try { landmarker.detectForVideo(vid, performance.now()); } catch {}
  }
});

vid.addEventListener('playing', () => {
  setMsg('');
  if (rafId) cancelAnimationFrame(rafId);
  renderFrame();
  // Only notify host when the video is visible to the user (not during silent pass)
  if (phase === 'show' && !playingNotified) {
    playingNotified = true;
    postUp({ type: 'playing' });
  }
});

vid.addEventListener('pause', () => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
  // Only the single source of truth for the icon: 'pause' fires for BOTH a
  // normal user pause and the pause finishShowPlayback() triggers when
  // clipEnd is reached, and the two can race (pause is queued async, so it
  // can land either before or after finishShowPlayback's own icon update
  // depending on which path triggered it). Deferring to showFinished here
  // means whichever actually reflects "are we done" wins, instead of this
  // unconditionally stomping the replay icon back to plain play.
  if (!showFinished) pbtn.innerHTML = IC_PLAY;
});

vid.addEventListener('error', () => {
  if (phase === 'preprocess') {
    // Unblock the host overlay even if the video fails
    phase = 'show';
    stage.classList.add('on');
    vid.playbackRate = 1;
    if (!playingNotified) { playingNotified = true; postUp({ type: 'playing' }); }
  }
  setMsg('Video load error — try a different file.');
});

// ── receive video URI from host ──────────────────────────────────────────────

function onMsg(e) {
  try {
    const m = JSON.parse(typeof e.data === 'string' ? e.data : '{}');
    if (m.type === 'loadVideo' && m.uri) {
      landmarkHistory.length = 0;
      timeHistory.length = 0;
      resetSmoothing();
      lastLandmarks = null;
      repTimes = { squat: [], jump: [], pullup: [] };
      cropRect = { x0: 0, y0: 0, x1: 1, y1: 1 };
      cropAspect = 1;
      canonicalShoulderWidth = 0.2;
      clipStart = 0;
      clipEnd = 0;
      showFinished = false;
      headSourceMode = 'none';
      phase = 'preprocess';
      playingNotified = false;
      stage.classList.remove('on'); // hidden during silent analysis pass
      skelCtx.clearRect(0, 0, skelCvs.width, skelCvs.height);
      vid.src = m.uri;
      vid.load();
      setMsg('');
      vid.addEventListener('canplay', () => {
        vid.playbackRate = 8; // fast-forward through the video to collect landmarks
        void vid.play();
      }, { once: true });
    }
  } catch {}
}
document.addEventListener('message', onMsg);
window.addEventListener('message',   onMsg);

init();
</script>
</body>
</html>`;
