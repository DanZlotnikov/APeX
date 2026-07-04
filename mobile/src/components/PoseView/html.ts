import { EXERCISE_ANALYZER_JS } from '../../utils/exerciseAnalyzer';

/**
 * Self-contained HTML page that runs MediaPipe Pose Landmarker entirely in a
 * browser/WebView context — no backend needed.
 *
 * Communication:
 *   host → page  : postMessage({ type:'loadVideo', uri })
 *   page → host  : postMessage({ type:'ready' })          once model is loaded
 *                  postMessage({ type:'error', message })  on failure
 *                  postMessage({ type:'exerciseResults', results }) on video end
 *                  postMessage({ type:'assessment', assessment }) on video end
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
  /* Video hidden — canvas composites its pixels so there is no overlay */
  #vid{position:absolute;inset:0;width:100%;height:100%;opacity:0;pointer-events:none}
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

// Box-window (sliding-average) smoothing over the last BOX_WIN raw frames.
// Uniform weights give a flat frequency response with a hard cutoff — no
// exponential tail means fast movements track cleanly with only a fixed
// half-window lag rather than dragging indefinitely like EMA.
const BOX_WIN = 5;
// A joint below this MediaPipe visibility score is occluded / guessed (e.g. a
// shoulder hidden behind a barbell). We neither draw nor trust such points, so
// the skeleton stops snapping onto equipment.
const VIS_DRAW = 0.5;
// Max normalised movement a joint may make in one frame before we treat it as a
// tracking teleport (unless the point is also highly visible = a real fast move).
const MAX_STEP = 0.08;
let showBuf = [];   // ring buffer of raw landmark snapshots for display
let smoothed = null; // persistent last-good smoothed landmarks (outlier hold)

// 'preprocess': silent 8× pass — runInference() populates landmarkHistory/timeHistory
// 'render':     seek-based bake (fast: VideoEncoder) or 1× MediaRecorder (slow)
let phase = 'idle';
// null = draw all landmarks; Set<number> = only draw these MediaPipe indices
let activeJoints = null;
// Rep-completion timestamps per exercise (computed in preprocess). The HUD count
// at any moment is a pure function of these and the current video time, so it is
// correct while scrubbing rather than accumulating per processed frame.
let repTimes = { squat: [], deadlift: [], jump: [], pullup: [] };
function countLE(arr, t) { let n = 0; for (let i = 0; i < arr.length; i++) if (arr[i] <= t) n++; return n; }

// Progress reporting — throttled to at most one message per 150 ms.
let lastProgressMs = -Infinity;
function sendProgress(pct) {
  const now = performance.now();
  if (now - lastProgressMs < 150) return;
  lastProgressMs = now;
  postUp({ type: 'progress', pct: pct });
}

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

// ── inference engine ─────────────────────────────────────────────────────────
//
// Swap point: to replace MediaPipe with a custom model, re-implement these
// three functions.  Nothing else in the pipeline needs to change.
//
// Contract for runInference:
//   (videoEl, timestampMs) → NormalizedLandmark[] | null
//   NormalizedLandmark = { x, y, z, visibility } — all values 0..1, normalised
//   to frame width/height.  Must return exactly 33 landmarks in MediaPipe Pose
//   Landmarker order (indices match JOINTS map and PoseLandmarker.POSE_CONNECTIONS).
//   Return null when no person is detected.

async function initInferenceEngine() {
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
    // Higher confidence gates make tracking stickier and cut spurious
    // re-detections that fling landmarks onto occluding objects.
    minPoseDetectionConfidence: 0.6,
    minPosePresenceConfidence: 0.6,
    minTrackingConfidence: 0.6,
  });
  drawUtils = new DrawingUtils(ctx);
}

function runInference(videoEl, timestampMs) {
  if (!landmarker) return null;
  const result = landmarker.detectForVideo(videoEl, timestampMs);
  return result.landmarks?.length ? result.landmarks[0] : null;
}

// Warm up the model on the first decoded frame — eliminates the latency spike
// on the very first real inference call.  Safe to no-op for models that don't need it.
function warmupInference(videoEl) {
  if (!landmarker) return;
  try { landmarker.detectForVideo(videoEl, performance.now()); } catch {}
}

async function init() {
  setMsg('Loading model…');
  try {
    await initInferenceEngine();
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

// ── landmark smoothing ───────────────────────────────────────────────────────

// Visibility-weighted, velocity-clamped smoothing.
//  - Each buffered sample is weighted by its visibility² so low-confidence
//    (occluded) frames barely move the result.
//  - If no confident samples exist for a joint, we hold its last good position.
//  - A jump larger than MAX_STEP from the last good position is rejected unless
//    the joint is also highly visible — this kills the "snap onto the barbell".
function boxSmooth(raw) {
  const snap = raw.map(lm => ({ x: lm.x, y: lm.y, z: lm.z ?? 0, visibility: lm.visibility ?? 1 }));
  showBuf.push(snap);
  if (showBuf.length > BOX_WIN) showBuf.shift();
  const n = showBuf.length, L = raw.length;
  if (!smoothed) smoothed = snap.map(p => ({ x: p.x, y: p.y, z: p.z, visibility: p.visibility }));

  const out = [];
  for (let i = 0; i < L; i++) {
    let wx = 0, wy = 0, wz = 0, wsum = 0, vmax = 0;
    for (let j = 0; j < n; j++) {
      const p = showBuf[j][i];
      const w = p.visibility * p.visibility; // emphasise confident frames
      wx += p.x * w; wy += p.y * w; wz += p.z * w; wsum += w;
      if (p.visibility > vmax) vmax = p.visibility;
    }
    const prev = smoothed[i];
    let nx, ny, nz;
    if (wsum < 1e-3) {
      // nothing confident this window → keep the last good position
      nx = prev.x; ny = prev.y; nz = prev.z;
    } else {
      nx = wx / wsum; ny = wy / wsum; nz = wz / wsum;
      const dx = nx - prev.x, dy = ny - prev.y;
      if (Math.sqrt(dx * dx + dy * dy) > MAX_STEP && vmax < 0.75) {
        nx = prev.x; ny = prev.y; nz = prev.z; // reject teleport on a low-vis joint
      }
    }
    const cur = { x: nx, y: ny, z: nz, visibility: vmax };
    smoothed[i] = cur;
    out.push(cur);
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
  if (results.squat > 0 || results.deadlift > 0) {
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
// Appears as exercises are first counted and increments naturally on scrub.

function drawCounter(counts) {
  if (!counts) return;
  const rows = [];
  if (counts.squat    > 0) rows.push(['SQUAT',    counts.squat]);
  if (counts.deadlift > 0) rows.push(['DEADLIFT', counts.deadlift]);
  if (counts.jump     > 0) rows.push(['JUMP',     counts.jump]);
  if (counts.pullup   > 0) rows.push(['PULL-UP',  counts.pullup]);
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

// ── MediaRecorder (render pass) ─────────────────────────────────────────────
var mediaRecorder = null;

// Interpolating landmark lookup: binary-search for the surrounding preprocess
// frames at time t, then linearly blend positions for smooth skeleton motion.
// landmarkHistory / timeHistory are kept alive from the preprocess pass so the
// render pass never needs to run MediaPipe inference again.
function lookupLandmarks(t) {
  var n = timeHistory.length;
  if (!n) return null;
  if (n === 1 || t <= timeHistory[0]) return landmarkHistory[0];
  if (t >= timeHistory[n - 1]) return landmarkHistory[n - 1];

  var lo = 0, hi = n - 2;
  while (lo < hi) {
    var mid = (lo + hi + 1) >> 1;
    if (timeHistory[mid] <= t) lo = mid; else hi = mid - 1;
  }
  var t0 = timeHistory[lo], t1 = timeHistory[lo + 1];
  var alpha = (t - t0) / (t1 - t0);
  var a = landmarkHistory[lo], b = landmarkHistory[lo + 1];
  return a.map(function(pa, i) {
    var pb = b[i];
    return {
      x: pa.x + (pb.x - pa.x) * alpha,
      y: pa.y + (pb.y - pa.y) * alpha,
      z: pa.z + (pb.z - pa.z) * alpha,
      visibility: pa.visibility < pb.visibility ? pa.visibility : pb.visibility,
    };
  });
}

// ── bake pipeline ───────────────────────────────────────────────────────────
//
// Architecture: fully decoupled from video playback.
//
//   preprocess  (8×): MediaPipe → landmarkHistory / timeHistory
//   bake        (seek-based, no real-time constraint):
//                 for each frame at target fps:
//                   seek → drawCompositeAt → VideoEncoder.encode(timestamp)
//                 → webm-muxer → base64 chunks → host
//
// The "swap inference engine" point is drawCompositeAt / lookupLandmarks.
// When we move to a custom model, replace landmarkHistory lookup with model
// inference here — nothing else in the pipeline changes.
//
// Fast path : VideoEncoder + webm-muxer (Chrome / Android)
//             seek-based → ~5–10 s for a 30 s video
// Slow path : MediaRecorder at 1× (Firefox, older Android)
//             real-time → video_duration seconds
// No support: iOS WKWebView (no captureStream / VideoEncoder)
//             → host falls back to original video immediately

function drawCompositeAt(t) {
  ctx.drawImage(vid, 0, 0, cvs.width, cvs.height);
  var lm = lookupLandmarks(t);
  if (lm) {
    var vis = function(i) { return lm[i] && lm[i].visibility >= VIS_DRAW; };
    var baseConns = activeJoints
      ? PoseLandmarker.POSE_CONNECTIONS.filter(function(c) { return activeJoints.has(c.start) && activeJoints.has(c.end); })
      : PoseLandmarker.POSE_CONNECTIONS;
    var conns = baseConns.filter(function(c) { return vis(c.start) && vis(c.end); });
    var dotIdx = activeJoints
      ? Array.from(activeJoints).filter(vis)
      : lm.map(function(_, i) { return i; }).filter(vis);
    drawUtils.drawConnectors(lm, conns, { color: '#00FFE0', lineWidth: 3 });
    drawUtils.drawLandmarks(dotIdx.map(function(i) { return lm[i]; }), { color: '#00FF00', lineWidth: 1, radius: 4 });
  }
  drawCounter({
    squat:    countLE(repTimes.squat,    t),
    deadlift: countLE(repTimes.deadlift, t),
    jump:     countLE(repTimes.jump,     t),
    pullup:   countLE(repTimes.pullup,   t),
  });
}

function sendRenderedChunks(b64, mimeType) {
  var CHUNK = 512 * 1024;
  var total = Math.ceil(b64.length / CHUNK);
  postUp({ type: 'renderedStart', mimeType: mimeType, total: total });
  for (var ci = 0; ci < total; ci++) {
    postUp({ type: 'renderedChunk', index: ci, data: b64.slice(ci * CHUNK, (ci + 1) * CHUNK) });
  }
  postUp({ type: 'renderedDone' });
  landmarkHistory.length = 0;
  timeHistory.length = 0;
}

// Fast path — VideoEncoder (WebCodecs) + webm-muxer loaded from CDN.
// Seeks to each frame in the video without playing it, so there is no
// real-time constraint.  Falls back to startMediaRecorder() on any failure.
async function startFastEncode() {
  var Muxer, ArrayBufferTarget;
  try {
    var mod = await import('https://cdn.jsdelivr.net/npm/webm-muxer@5.0.0/build/webm-muxer.mjs');
    Muxer = mod.Muxer; ArrayBufferTarget = mod.ArrayBufferTarget;
  } catch(e) { startMediaRecorder(); return; }

  var target = new ArrayBufferTarget();
  var muxer  = new Muxer({
    target: target,
    video:  { codec: 'V_VP9', width: cvs.width, height: cvs.height, frameRate: 30 },
  });

  var encFailed = false;
  var enc = new VideoEncoder({
    output: function(chunk, meta) { if (!encFailed) muxer.addVideoChunk(chunk, meta); },
    error:  function() { encFailed = true; },
  });
  try {
    enc.configure({
      codec: 'vp09.00.10.08', width: cvs.width, height: cvs.height,
      bitrate: 2500000, framerate: 30,
    });
  } catch(e) { startMediaRecorder(); return; }

  var TARGET_FPS = 30;
  var dur = vid.duration;
  var nFrames = Math.ceil(dur * TARGET_FPS);

  for (var fi = 0; fi < nFrames; fi++) {
    if (encFailed) { startMediaRecorder(); return; }

    // Clamp slightly before duration to avoid triggering 'ended'
    var t = Math.min(fi / TARGET_FPS, dur - 0.001);

    vid.currentTime = t;
    await new Promise(function(res) { vid.addEventListener('seeked', res, { once: true }); });

    sendProgress(fi / nFrames);
    drawCompositeAt(t);

    try {
      var vf = new VideoFrame(cvs, { timestamp: Math.round(t * 1e6) });
      enc.encode(vf, { keyFrame: fi % 60 === 0 });
      vf.close();
    } catch(e) { encFailed = true; }
  }

  if (encFailed) { startMediaRecorder(); return; }
  await enc.flush();
  if (encFailed) { startMediaRecorder(); return; }
  muxer.finalize();

  // ArrayBuffer → base64
  var bytes = new Uint8Array(target.buffer);
  var binary = '';
  for (var i = 0; i < bytes.length; i += 8192) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(i + 8192, bytes.length)));
  }
  sendRenderedChunks(btoa(binary), 'video/webm');
}

// Slow path — MediaRecorder at 1× speed (real-time constraint, video_duration seconds).
function startMediaRecorder() {
  if (!cvs.captureStream || typeof MediaRecorder === 'undefined') {
    phase = 'idle';
    landmarkHistory.length = 0; timeHistory.length = 0;
    postUp({ type: 'renderedDone', error: 'unsupported' });
    return;
  }

  var MIME_PREFS = ['video/mp4;codecs=avc1', 'video/mp4', 'video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
  var chosenMime = '';
  for (var mi = 0; mi < MIME_PREFS.length; mi++) {
    try { if (MediaRecorder.isTypeSupported(MIME_PREFS[mi])) { chosenMime = MIME_PREFS[mi]; break; } } catch(_) {}
  }

  var stream = cvs.captureStream(30);
  mediaRecorder = new MediaRecorder(
    stream,
    chosenMime ? { mimeType: chosenMime, videoBitsPerSecond: 2500000 } : { videoBitsPerSecond: 2500000 }
  );
  var recChunks = [];
  mediaRecorder.ondataavailable = function(e) { if (e.data && e.data.size > 0) recChunks.push(e.data); };
  mediaRecorder.onstop = function() {
    var outMime = mediaRecorder.mimeType || chosenMime || 'video/webm';
    var blob = new Blob(recChunks, { type: outMime });
    recChunks = [];
    var reader = new FileReader();
    reader.onload = function() { sendRenderedChunks(reader.result.split(',')[1], outMime); };
    reader.readAsDataURL(blob);
  };
  mediaRecorder.start(500);

  vid.playbackRate = 1;
  vid.currentTime = 0;
  vid.addEventListener('seeked', function onStartPlay() {
    vid.removeEventListener('seeked', onStartPlay);
    void vid.play();
  });
}

// ── render loop ─────────────────────────────────────────────────────────────

function renderFrame() {
  if (vid.paused || vid.ended || vid.readyState < 2) {
    rafId = null; return;
  }

  if (phase === 'preprocess') {
    // runInference is the single swap point — replace it to change the model.
    // Store raw (un-smoothed) landmarks: smoothing flattens depth peaks that the
    // exercise analyzer uses as rep-completion signals.
    const lm = runInference(vid, performance.now());
    if (lm) {
      landmarkHistory.push(copyLandmarks(lm));
      timeHistory.push(vid.currentTime);
    }
    if (vid.duration > 0) sendProgress(vid.currentTime / vid.duration);
  } else if (phase === 'render') {
    // MediaRecorder slow-path: video is playing at 1×, so each rAF tick bakes
    // one frame.  Fast-path (startFastEncode) never gets here — it calls
    // drawCompositeAt() directly per seek.
    if (vid.duration > 0) sendProgress(vid.currentTime / vid.duration);
    drawCompositeAt(vid.currentTime);
  } else {
    rafId = null; return;
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
    // ── 8× analysis pass complete ──────────────────────────────────────────
    const results = analyzeExercises();
    if (results) postUp({ type: 'exerciseResults', results: results });

    try {
      const assessment = computeAssessment(landmarkHistory, timeHistory, results);
      if (assessment) postUp({ type: 'assessment', assessment: assessment });
    } catch (err) { postUp({ type: 'error', message: 'assessment: ' + String(err && err.message) }); }

    activeJoints = computeActiveJoints(results);
    repTimes = computeRepTimes(landmarkHistory, timeHistory, results);

    // landmarkHistory / timeHistory are kept alive — both bake paths use them
    // for skeleton placement (lookupLandmarks) without re-running inference.
    showBuf = [];
    smoothed = null;

    // ── Start render pass ───────────────────────────────────────────────────
    // Cap render resolution at 720p to keep file size manageable.
    phase = 'render';

    var MAX_H = 720;
    if (vid.videoHeight > MAX_H) {
      var scale = MAX_H / vid.videoHeight;
      cvs.width  = Math.round(vid.videoWidth * scale);
      cvs.height = MAX_H;
    }

    // Fast path: WebCodecs VideoEncoder (seek-based, no real-time constraint).
    //   ~5–10 s for a 30 s video regardless of video length.
    // Slow path: MediaRecorder at 1× (real-time constraint).
    //   Falls back to original video on platforms with no captureStream (iOS).
    if (typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined') {
      startFastEncode().catch(function() { startMediaRecorder(); });
    } else {
      startMediaRecorder();
    }
    return;
  }

  if (phase === 'render') {
    // MediaRecorder slow-path: stop recorder → onstop fires → sends chunks.
    // Fast-path (startFastEncode) manages its own completion; this branch is
    // only reached if the video fires 'ended' during the 1× MediaRecorder pass.
    if (mediaRecorder && mediaRecorder.state !== 'inactive') {
      mediaRecorder.stop();
    }
    return;
  }
});

// ── video lifecycle ──────────────────────────────────────────────────────────

vid.addEventListener('loadedmetadata', sizeWrap);
vid.addEventListener('seeked', () => {
  showBuf = [];
  smoothed = null;
});

vid.addEventListener('loadeddata', () => {
  if (vid.readyState >= 2) warmupInference(vid);
});

vid.addEventListener('playing', () => {
  setMsg('');
  if (rafId) cancelAnimationFrame(rafId);
  renderFrame();
});

vid.addEventListener('pause', () => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
});

vid.addEventListener('error', () => {
  postUp({ type: 'error', message: 'Video load error' });
  setMsg('Video load error — try a different file.');
});

// ── receive video URI from host ──────────────────────────────────────────────

function onMsg(e) {
  try {
    const m = JSON.parse(typeof e.data === 'string' ? e.data : '{}');
    if (m.type === 'loadVideo' && m.uri) {
      landmarkHistory.length = 0;
      timeHistory.length = 0;
      showBuf = [];
      smoothed = null;
      activeJoints = null;
      liveState = null;
      repTimes = { squat: [], deadlift: [], jump: [], pullup: [] };
      phase = 'preprocess';
      ctx.clearRect(0, 0, cvs.width, cvs.height);
      vid.src = m.uri;
      vid.load();
      setMsg('');
      vid.addEventListener('canplay', () => {
        vid.playbackRate = 8;
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
