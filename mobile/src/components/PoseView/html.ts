/**
 * Self-contained HTML page that runs MediaPipe Pose Landmarker entirely in a
 * browser/WebView context — no backend needed.
 *
 * Communication:
 *   host → page  : postMessage({ type:'loadVideo', uri })
 *   page → host  : postMessage({ type:'ready' }) once model is loaded
 *                  postMessage({ type:'error', message }) on failure
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

// Temporal smoothing: EMA applied to each landmark across frames.
// Lower alpha → smoother but slightly more lag. 0.45 is a good balance.
const SMOOTH_ALPHA = 0.45;
let smoothed = null; // array of {x,y,z,visibility} mirroring the landmark array

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

// ── landmark smoothing ───────────────────────────────────────────────────────

function applySmoothing(raw) {
  if (!smoothed || smoothed.length !== raw.length) {
    // First frame or landmark count changed — bootstrap with raw values.
    smoothed = raw.map(lm => ({ x: lm.x, y: lm.y, z: lm.z, visibility: lm.visibility ?? 1 }));
    return smoothed;
  }
  const a = SMOOTH_ALPHA, b = 1 - a;
  for (let i = 0; i < raw.length; i++) {
    smoothed[i].x          = a * raw[i].x          + b * smoothed[i].x;
    smoothed[i].y          = a * raw[i].y          + b * smoothed[i].y;
    smoothed[i].z          = a * raw[i].z          + b * smoothed[i].z;
    smoothed[i].visibility = a * (raw[i].visibility ?? 1) + b * smoothed[i].visibility;
  }
  return smoothed;
}

// ── render loop ─────────────────────────────────────────────────────────────

function renderFrame() {
  if (!landmarker || vid.paused || vid.ended || vid.readyState < 2) {
    rafId = null; return;
  }
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  const result = landmarker.detectForVideo(vid, performance.now());
  if (result.landmarks?.length) {
    const landmarks = applySmoothing(result.landmarks[0]);
    drawUtils.drawConnectors(landmarks, PoseLandmarker.POSE_CONNECTIONS,
      { color: '#00FFE0', lineWidth: 3 });
    drawUtils.drawLandmarks(landmarks,
      { color: '#00FF00', lineWidth: 1, radius: 4 });
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
    if (vid.ended) { vid.currentTime = 0; ctx.clearRect(0, 0, cvs.width, cvs.height); }
    void vid.play();
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
  pbtn.innerHTML = IC_REPLAY;
  setMsg('');
  showCtrl(true);
});

// ── video lifecycle ──────────────────────────────────────────────────────────

vid.addEventListener('loadedmetadata', sizeWrap);
vid.addEventListener('seeked', () => { smoothed = null; });

vid.addEventListener('loadeddata', () => {
  if (landmarker && vid.readyState >= 2) {
    try { landmarker.detectForVideo(vid, performance.now()); } catch {}
  }
});

vid.addEventListener('playing', () => {
  setMsg('');
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  if (rafId) cancelAnimationFrame(rafId);
  renderFrame();
});

vid.addEventListener('pause', () => {
  if (rafId) { cancelAnimationFrame(rafId); rafId = null; }
});

vid.addEventListener('error', () => setMsg('Video load error — try a different file.'));

// ── receive video URI from host ──────────────────────────────────────────────

function onMsg(e) {
  try {
    const m = JSON.parse(typeof e.data === 'string' ? e.data : '{}');
    if (m.type === 'loadVideo' && m.uri) {
      vid.src = m.uri;
      vid.load();
      setMsg('');
      vid.addEventListener('canplay', () => { void vid.play(); }, { once: true });
    }
  } catch {}
}
document.addEventListener('message', onMsg);
window.addEventListener('message',   onMsg);

init();
</script>
</body>
</html>`;
