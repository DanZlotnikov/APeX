/**
 * Self-contained HTML video player with minimal custom controls.
 * No skeleton / no MediaPipe — generic playback only.
 *
 * Communication (same protocol as PoseView so the native/web wrappers are
 * identical in shape):
 *   host → page  : postMessage({ type:'loadVideo', uri })
 *   page → host  : postMessage({ type:'ready' })
 */
export const VIDEO_PLAYER_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<title>Player</title>
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{
    width:100%;height:100%;
    background:#07101C;overflow:hidden;
    display:flex;align-items:center;justify-content:center;
  }
  #wrap{position:relative}
  #vid{display:block;width:100%;height:100%}

  /* controls overlay — hidden until tap */
  #ctrl{
    position:absolute;inset:0;
    display:flex;flex-direction:column;justify-content:flex-end;
    background:linear-gradient(to bottom,transparent 55%,rgba(0,0,0,.65) 100%);
    opacity:0;transition:opacity .2s;
  }
  #ctrl.on{opacity:1}
  #ctrl:not(.on) #cbar{pointer-events:none}
  #cbar{display:flex;align-items:center;gap:10px;padding:0 14px 20px}
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
  #msg{
    position:fixed;inset:0;
    display:none;align-items:center;justify-content:center;
    color:#94A3B8;font:13px -apple-system,system-ui,sans-serif;
    pointer-events:none;text-align:center;padding:16px;
  }
</style>
</head>
<body>
<div id="wrap">
  <video id="vid" playsinline webkit-playsinline muted></video>
  <div id="ctrl">
    <div id="cbar">
      <div id="pbtn"><svg viewBox="0 0 24 24" width="15" height="15" fill="white"><polygon points="6,3 20,12 6,21"/></svg></div>
      <input id="sk" type="range" min="0" max="1000" step="1" value="0">
      <span id="tm">0:00</span>
    </div>
  </div>
</div>
<div id="msg"></div>

<script>
var vid  = document.getElementById('vid');
var wrap = document.getElementById('wrap');
var ctrl = document.getElementById('ctrl');
var pbtn = document.getElementById('pbtn');
var sk   = document.getElementById('sk');
var tm   = document.getElementById('tm');
var msg  = document.getElementById('msg');
var hideTimer = null;

var IC_PLAY   = '<svg viewBox="0 0 24 24" width="15" height="15" fill="white"><polygon points="6,3 20,12 6,21"/></svg>';
var IC_PAUSE  = '<svg viewBox="0 0 24 24" width="15" height="15" fill="white"><rect x="4" y="3" width="5" height="18" rx="1.5"/><rect x="15" y="3" width="5" height="18" rx="1.5"/></svg>';
var IC_REPLAY = '<svg viewBox="0 0 24 24" width="15" height="15" fill="white"><path d="M12 5V1L7 6l5 5V7c3.31 0 6 2.69 6 6s-2.69 6-6 6-6-2.69-6-6H4c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8z"/></svg>';

function postUp(obj) {
  var s = JSON.stringify(obj);
  try { window.ReactNativeWebView && window.ReactNativeWebView.postMessage(s); } catch(e){}
  try { if (window.parent !== window) window.parent.postMessage(s, '*'); } catch(e){}
}

function setMsg(text) {
  msg.textContent = text;
  msg.style.display = text ? 'flex' : 'none';
}

function sizeWrap() {
  if (!vid.videoWidth) return;
  var vw = vid.videoWidth, vh = vid.videoHeight;
  var bw = document.body.clientWidth, bh = document.body.clientHeight;
  var scale = Math.min(bw / vw, bh / vh);
  wrap.style.width  = Math.round(vw * scale) + 'px';
  wrap.style.height = Math.round(vh * scale) + 'px';
}

window.addEventListener('resize', sizeWrap);

function fmt(s) {
  return Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
}

function showCtrl(sticky) {
  ctrl.classList.add('on');
  clearTimeout(hideTimer);
  if (!sticky) hideTimer = setTimeout(function(){ ctrl.classList.remove('on'); }, 3000);
}

// Hover: show controls while mouse is over the video, hide when it leaves
wrap.addEventListener('mouseenter', function(){ showCtrl(); });
wrap.addEventListener('mousemove',  function(){ showCtrl(); });
wrap.addEventListener('mouseleave', function(){
  clearTimeout(hideTimer);
  ctrl.classList.remove('on');
});

ctrl.addEventListener('click', function(e) {
  if (e.target === sk || e.target === pbtn) return;
  if (ctrl.classList.contains('on')) {
    ctrl.classList.remove('on');
    clearTimeout(hideTimer);
  } else {
    showCtrl();
  }
});

pbtn.addEventListener('click', function(e) {
  e.stopPropagation();
  if (vid.paused || vid.ended) {
    if (vid.ended) vid.currentTime = 0;
    vid.play();
  } else {
    vid.pause();
  }
  showCtrl();
});

sk.addEventListener('mousedown', function(e){ e.stopPropagation(); });
sk.addEventListener('touchstart', function(e){ e.stopPropagation(); }, { passive: true });
sk.addEventListener('input', function(e) {
  e.stopPropagation();
  if (vid.duration) vid.currentTime = vid.duration * sk.value / 1000;
  showCtrl();
});
sk.addEventListener('click', function(e){ e.stopPropagation(); });

vid.addEventListener('timeupdate', function() {
  if (!vid.duration) return;
  sk.value = Math.round(vid.currentTime / vid.duration * 1000);
  tm.textContent = fmt(vid.currentTime);
});

vid.addEventListener('play',  function(){ pbtn.innerHTML = IC_PAUSE; });
vid.addEventListener('pause', function(){ pbtn.innerHTML = IC_PLAY; });
vid.addEventListener('ended', function(){
  pbtn.innerHTML = IC_REPLAY;
  showCtrl(true);
});
vid.addEventListener('seeked', function(){
  // When the user scrubs away from the end position, revert from IC_REPLAY to
  // the correct play/pause icon (IC_REPLAY is set by 'ended' and stays until
  // the video restarts — seek doesn't trigger 'play' or 'pause').
  if (!vid.ended) {
    pbtn.innerHTML = vid.paused ? IC_PLAY : IC_PAUSE;
  }
});
vid.addEventListener('loadedmetadata', sizeWrap);
vid.addEventListener('error', function(){ setMsg('Video load error.'); });

function onMsg(e) {
  try {
    var m = JSON.parse(typeof e.data === 'string' ? e.data : '{}');
    if (m.type === 'loadVideo' && m.uri) {
      vid.src = m.uri;
      vid.load();
      setMsg('');
      vid.addEventListener('canplay', function(){ vid.play(); }, { once: true });
    }
  } catch(err){}
}
document.addEventListener('message', onMsg);
window.addEventListener('message',   onMsg);

postUp({ type: 'ready' });
</script>
</body>
</html>`;
