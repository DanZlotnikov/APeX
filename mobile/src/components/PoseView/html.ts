import { EXERCISE_ANALYZER_JS } from '../../utils/exerciseAnalyzer';

/**
 * Self-contained HTML page that runs MediaPipe Pose Landmarker entirely in a
 * browser/WebView context — no backend needed.
 *
 * The skeleton is drawn LIVE on a canvas while the original video plays
 * inside this same page — there is no separate bake/export step and no
 * video file is produced. Rep counting / exercise analysis comes from
 * exerciseAnalyzer.ts (EXERCISE_ANALYZER_JS below), unchanged from the
 * bake-pipeline version — only how the result gets shown differs.
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
    display:flex;align-items:center;justify-content:center;
  }
  #wrap{position:relative}
  #vid{display:block;width:100%;height:100%}
  #cvs{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}

  /* controls overlay — hidden by default, shown on tap */
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
<div id="wrap">
  <video id="vid" playsinline webkit-playsinline></video>
  <canvas id="cvs"></canvas>
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
import { PoseLandmarker, FilesetResolver, DrawingUtils }
  from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs";

const vid  = document.getElementById('vid');
const cvs  = document.getElementById('cvs');
const ctx  = cvs.getContext('2d');
const wrap = document.getElementById('wrap');
const ctrl = document.getElementById('ctrl');
const pbtn = document.getElementById('pbtn');
const sk   = document.getElementById('sk');
const tm   = document.getElementById('tm');
const msg  = document.getElementById('msg');

let landmarker = null;
let drawUtils  = null;
let rafId      = null;
let hideTimer  = null;

// Adaptive landmark smoothing — see the "landmark smoothing" section below
// for the One Euro Filter implementation. landmarkFilters holds per-joint,
// per-axis filter state; reset via resetSmoothing() on every video load/seek.
let landmarkFilters = null;
let lastSmoothT = null;

// 'preprocess': silent 8× pass to collect landmarks before user sees video
// 'show':       normal 1× playback for the user
let phase = 'idle';
let playingNotified = false; // send 'playing' only once per video load
// null = draw all landmarks; Set<number> = only draw these MediaPipe indices
let activeJoints = null;

// Rep-completion timestamps per exercise, computed once after the preprocess
// pass (see computeRepTimes in exerciseAnalyzer.ts). The HUD count at any
// moment is a pure function of these plus the current video time, so it's
// always correct — including while the user scrubs/replays.
let repTimes = { squat: [], jump: [], pullup: [] };
function countLE(arr, t) { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i] <= t) n++; return n; }

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
    drawUtils = new DrawingUtils(ctx);
    vid.muted = true;
    setMsg('');
    postUp({ type: 'ready' });
  } catch (e) {
    setMsg('Model error: ' + e.message);
    postUp({ type: 'error', message: String(e.message) });
  }
}

// ── wrap sizing (no letterbox bars) ─────────────────────────────────────────

function sizeWrap() {
  if (!vid.videoWidth) return;
  const vw = vid.videoWidth, vh = vid.videoHeight;
  const bw = document.body.clientWidth, bh = document.body.clientHeight;
  const scale = Math.min(bw / vw, bh / vh);
  wrap.style.width  = Math.round(vw * scale) + 'px';
  wrap.style.height = Math.round(vh * scale) + 'px';
  cvs.width  = vw;
  cvs.height = vh;
}

window.addEventListener('resize', sizeWrap);

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
    f.z = f.z * 0.7 + (lm.z ?? 0) * 0.3;
    f.v = f.v * 0.7 + (lm.visibility ?? 1) * 0.3;
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

// ── joint filter (computed after preprocess, applied during show) ────────────

// MediaPipe Pose landmark indices for each body region
const JOINTS = {
  shoulders: [11, 12],
  hips:      [23, 24],
  knees:     [25, 26],
  ankles:    [27, 28],
};

function computeActiveJoints(results) {
  if (!results) return null;
  const s = new Set();
  if (results.squat > 0) {
    // Shoulders + hips + knees + ankles cover the whole movement chain
    [...JOINTS.shoulders, ...JOINTS.hips, ...JOINTS.knees, ...JOINTS.ankles].forEach(i => s.add(i));
  }
  if (results.verticalJump > 0) {
    [...JOINTS.hips, ...JOINTS.knees, ...JOINTS.ankles].forEach(i => s.add(i));
  }
  if (results.pullup > 0) {
    // Shoulders + elbows + wrists for the pulling chain
    [11, 12, 13, 14, 15, 16].forEach(i => s.add(i));
  }
  return s.size > 0 ? s : null;
}

// ── HUD counter ─────────────────────────────────────────────────────────────
// Drawn directly on the pose canvas so it lives inside the video frame.
// Count at time t is a pure function of repTimes + t (see repTimes above),
// so it's correct immediately on scrub/replay, not just on first playthrough.

function drawCounter(t) {
  const rows = [];
  const sq = countLE(repTimes.squat,    t); if (sq  > 0) rows.push(['SQUAT',    sq]);
  const jm = countLE(repTimes.jump,     t); if (jm  > 0) rows.push(['JUMP',     jm]);
  const pu = countLE(repTimes.pullup,   t); if (pu  > 0) rows.push(['PULL-UP',  pu]);
  if (!rows.length) return;

  // All sizes relative to the shorter video dimension so portrait / landscape
  // both look right regardless of native video resolution.
  const base  = Math.min(cvs.width, cvs.height);
  const u     = base / 100;           // 1 unit = 1% of shorter dimension
  const lbl   = u * 2.8;             // label font size
  const num   = u * 8.0;             // count font size
  const rh    = num + lbl + u * 3.5; // row height
  const cPad  = u * 3.2;             // horizontal padding inside card
  const tPad  = u * 2.0;             // vertical padding top
  const bPad  = u * 1.5;             // vertical padding bottom
  const cw    = u * 27;              // card width
  const ch    = rows.length * rh + tPad + bPad;
  const ox    = u * 3.5;             // card offset from left edge
  const oy    = u * 3.5;             // card offset from top edge
  const rad   = u * 1.8;             // corner radius

  // Rounded-rect path helper (no roundRect API needed)
  function rr(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x+r, y);
    ctx.lineTo(x+w-r, y);
    ctx.arcTo(x+w, y,   x+w, y+r,   r);
    ctx.lineTo(x+w, y+h-r);
    ctx.arcTo(x+w, y+h, x+w-r, y+h, r);
    ctx.lineTo(x+r, y+h);
    ctx.arcTo(x,   y+h, x,   y+h-r, r);
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
  const result = landmarker.detectForVideo(vid, performance.now());
  if (result.landmarks?.length) {
    const raw = result.landmarks[0];
    if (phase === 'preprocess') {
      // Store raw landmarks — smoothing would flatten depth peaks and skew thresholds.
      // timeHistory holds real video time (playbackRate doesn't affect currentTime)
      // so per-rep durations come out in true seconds.
      landmarkHistory.push(copyLandmarks(raw));
      timeHistory.push(vid.currentTime);
      if (vid.duration > 0) sendProgress(vid.currentTime / vid.duration);
    } else {
      const landmarks = smoothLandmarks(raw, vid.currentTime);
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      if (activeJoints) {
        const conns = PoseLandmarker.POSE_CONNECTIONS.filter(
          c => activeJoints.has(c.start) && activeJoints.has(c.end)
        );
        const dots = Array.from(activeJoints).map(i => landmarks[i]);
        drawUtils.drawConnectors(landmarks, conns, { color: '#00FFE0', lineWidth: 3 });
        drawUtils.drawLandmarks(dots, { color: '#00FF00', lineWidth: 1, radius: 4 });
      } else {
        drawUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS,
          { color: '#00FFE0', lineWidth: 3 });
        drawUtils.drawLandmarks(landmarks,
          { color: '#00FF00', lineWidth: 1, radius: 4 });
      }
      drawCounter(vid.currentTime);
    }
  }
  rafId = requestAnimationFrame(renderFrame);
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

// tap on video area toggles controls
ctrl.addEventListener('click', (e) => {
  if (e.target === sk || e.target === pbtn) return;
  ctrl.classList.contains('on') ? hideCtrl() : showCtrl();
});

pbtn.addEventListener('click', (e) => {
  e.stopPropagation();
  if (vid.paused || vid.ended) {
    if (vid.ended) {
      // Seek to start first; play from the 'seeked' callback so we never call
      // vid.play() before the seek completes. No canvas clear here — the last
      // skeleton frame stays visible during the seek to avoid a blank flash.
      vid.currentTime = 0;
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
  if (vid.duration) vid.currentTime = vid.duration * sk.value / 1000;
  showCtrl();
});

vid.addEventListener('timeupdate', () => {
  if (!vid.duration) return;
  sk.value = Math.round(vid.currentTime / vid.duration * 1000);
  tm.textContent = fmt(vid.currentTime);
});

vid.addEventListener('play',  () => { pbtn.innerHTML = IC_PAUSE; });
vid.addEventListener('pause', () => { pbtn.innerHTML = IC_PLAY; });
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

    activeJoints = computeActiveJoints(results);
    repTimes = computeRepTimes(landmarkHistory, timeHistory, results); // must come before history is cleared

    // Reset state and replay at 1× for the user
    landmarkHistory.length = 0;
    timeHistory.length = 0;
    resetSmoothing();
    phase = 'show';
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    vid.playbackRate = 1;
    wrap.style.opacity = '1';
    vid.currentTime = 0;
    vid.addEventListener('seeked', () => void vid.play(), { once: true });
    return;
  }

  // Display phase ended — show replay button (results already sent)
  pbtn.innerHTML = IC_REPLAY;
  setMsg('');
  showCtrl(true);
});

// ── video lifecycle ──────────────────────────────────────────────────────────

vid.addEventListener('loadedmetadata', sizeWrap);
vid.addEventListener('seeked', () => {
  resetSmoothing();
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
});

vid.addEventListener('error', () => {
  if (phase === 'preprocess') {
    // Unblock the host overlay even if the video fails
    phase = 'show';
    wrap.style.opacity = '1';
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
      activeJoints = null;
      repTimes = { squat: [], jump: [], pullup: [] };
      phase = 'preprocess';
      playingNotified = false;
      wrap.style.opacity = '0'; // hidden during silent analysis pass
      ctx.clearRect(0, 0, cvs.width, cvs.height);
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
