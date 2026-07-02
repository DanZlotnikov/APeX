import { DemoKey } from '../../utils/physioLibrary';

/**
 * Self-contained looping stick-figure animation for a physio exercise, rendered
 * on a <canvas> so it shares the exact visual language of the live pose overlay
 * (teal #00FFE0 bones, green #00FF00 joints, #07101C background). No external
 * dependency — runs identically in a native WebView and a web iframe.
 *
 * The figure is drawn FRONT-ON in a fixed 300×300 virtual stage that is scaled
 * and centred into whatever canvas size it gets, so the proportions never
 * distort with the container's aspect ratio. Front view is deliberate: these
 * corrective moves are about the two legs sharing load, knees tracking outward,
 * and hips staying level — all of which read clearly face-on. Each exercise is
 * a short list of keyframe "poses" that are eased and interpolated on a loop.
 */

// A pose is a small set of scalar parameters; the renderer turns them into a
// full skeleton. Fields not relevant to an exercise keep their defaults.
interface Pose {
  s?: number;      // squat depth: 0 = tall stand, 1 = deep bend
  stance?: number; // horizontal distance between feet, virtual units
  liftR?: number;  // 0..1 right foot lifts off (single-leg patterns)
  air?: number;    // 0..1 both feet leave the ground (jump/landing)
  lean?: number;   // forward torso tip, degrees (hinge patterns)
  fL?: number;     // explicit left-foot X (virtual units) — 'feet' demos only
  fR?: number;     // explicit right-foot X — moving one foot at a time = a slide
}

interface Demo {
  arm: 'hips' | 'chest' | 'hang' | 'front';
  mode: 'cycle' | 'pingpong';
  period: number;  // seconds for one full loop
  feet?: boolean;  // author foot X positions directly (lateral shuffle)
  equip?: 'band' | 'goblet' | 'dumbbell'; // equipment drawn in purple
  frames: Pose[];
}

const DEMOS: Record<DemoKey, Demo> = {
  // Lateral shuffle: right foot steps out, left foot slides to follow, so the
  // body travels sideways. Each foot moves on its own keyframe = a true slide.
  // Held in a quarter-squat with a resistance band around the knees.
  lateralBandWalk: {
    arm: 'hips', mode: 'pingpong', period: 3.4, feet: true, equip: 'band',
    frames: [
      { s: 0.4, fL: 112, fR: 168 }, // feet together
      { s: 0.4, fL: 112, fR: 214 }, // right foot steps out
      { s: 0.4, fL: 158, fR: 214 }, // left foot slides to follow (moved right)
    ],
  },
  // Goblet squat to depth and back up, holding a weight at the chest.
  gobletSquat: {
    arm: 'chest', mode: 'pingpong', period: 3.6, equip: 'goblet',
    frames: [
      { s: 0.05, stance: 60, lean: 6 },
      { s: 0.95, stance: 66, lean: 18 },
    ],
  },
  // Small dip, both feet leave the ground, then a wide deep soft landing.
  softLanding: {
    arm: 'front', mode: 'cycle', period: 3.8,
    frames: [
      { s: 0.15, stance: 58, air: 0 },
      { s: 0.5, stance: 54, air: 0 },   // load
      { s: 0.0, stance: 50, air: 0.9 }, // flight, legs extended
      { s: 0.55, stance: 84, air: 0.12 },// contact
      { s: 0.95, stance: 92, air: 0 },  // soft absorb, deep + wide
      { s: 0.15, stance: 58, air: 0 },  // recover
    ],
  },
  // Single-leg balance: stand on the left leg, right leg lifts as torso tips,
  // holding a light dumbbell in the hand.
  singleLegRDL: {
    arm: 'hang', mode: 'pingpong', period: 3.8, equip: 'dumbbell',
    frames: [
      { s: 0.18, stance: 26, liftR: 0.1, lean: 4 },
      { s: 0.24, stance: 26, liftR: 1, lean: 58 },
    ],
  },
  // Controlled-tempo bodyweight squat, arms reaching forward for balance.
  tempoSquat: {
    arm: 'front', mode: 'pingpong', period: 4.4,
    frames: [
      { s: 0.05, stance: 58, lean: 6 },
      { s: 0.95, stance: 62, lean: 16 },
    ],
  },
};

export function physioDemoHtml(demoKey: DemoKey): string {
  const demo = DEMOS[demoKey] ?? DEMOS.gobletSquat;
  const demoJson = JSON.stringify(demo);

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
  *{margin:0;padding:0;box-sizing:border-box}
  html,body{width:100%;height:100%;background:#07101C;overflow:hidden}
  #c{display:block;width:100%;height:100%}
</style>
</head>
<body>
<canvas id="c"></canvas>
<script>
var DEMO = ${demoJson};
var VW = 300, VH = 300; // virtual stage — figure is authored in these units
var cvs = document.getElementById('c');
var ctx = cvs.getContext('2d');
var W = 0, H = 0, DPR = Math.min(window.devicePixelRatio || 1, 2);
var SC = 1, OX = 0, OY = 0; // stage->canvas scale + centring offset

function resize() {
  W = cvs.clientWidth; H = cvs.clientHeight;
  cvs.width = Math.round(W * DPR); cvs.height = Math.round(H * DPR);
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  SC = Math.min(W / VW, H / VH);
  OX = (W - VW * SC) / 2;
  OY = (H - VH * SC) / 2;
}
window.addEventListener('resize', resize);

function lerp(a, b, t) { return a + (b - a) * t; }
function easeInOut(t) { return t < 0.5 ? 2*t*t : 1 - Math.pow(-2*t+2, 2)/2; }

// map a virtual point to canvas space
function P(x, y) { return { x: OX + x * SC, y: OY + y * SC }; }

// ── equipment (bands, weights) drawn in a soft purple ──
var PURPLE = '#C08CFF';
function eqBand(a, b) { // resistance loop stretched between the knees
  var pa = P(a.x, a.y + 3), pb = P(b.x, b.y + 3);
  var mid = P((a.x + b.x) / 2, (a.y + b.y) / 2 + 15);
  ctx.strokeStyle = PURPLE; ctx.lineWidth = 4 * SC; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.quadraticCurveTo(mid.x, mid.y, pb.x, pb.y); ctx.stroke();
}
function eqDumbbell(pt) { // short bar with two weighted ends
  var c = P(pt.x, pt.y), len = 14 * SC, r = 5 * SC;
  ctx.strokeStyle = PURPLE; ctx.lineWidth = 3.5 * SC; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(c.x - len, c.y); ctx.lineTo(c.x + len, c.y); ctx.stroke();
  ctx.fillStyle = PURPLE;
  ctx.beginPath(); ctx.arc(c.x - len, c.y, r, 0, 6.3); ctx.fill();
  ctx.beginPath(); ctx.arc(c.x + len, c.y, r, 0, 6.3); ctx.fill();
}
function eqGoblet(pt) { // kettlebell/weight block held at the chest
  var c = P(pt.x, pt.y), w = 20 * SC, h = 22 * SC, r = 5 * SC;
  var x = c.x - w / 2, y = c.y - h / 2;
  ctx.fillStyle = PURPLE;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath(); ctx.fill();
}

// interpolate one numeric pose field across the keyframe list at phase p (0..1)
var p = 0;
function sample(field, def) {
  var n = DEMO.frames.length;
  var i, j, t;
  if (DEMO.mode === 'pingpong') {
    var span = n - 1;
    var u = p * span * 2;
    if (u > span) u = span * 2 - u; // reflect back for a smooth out-and-back
    i = Math.floor(u); j = Math.min(i + 1, n - 1); t = u - i;
  } else {
    var u2 = p * n;
    i = Math.floor(u2) % n; j = (i + 1) % n; t = u2 - Math.floor(u2);
  }
  var a = DEMO.frames[i][field]; if (a == null) a = def;
  var b = DEMO.frames[j][field]; if (b == null) b = def;
  return lerp(a, b, easeInOut(t));
}

// stage constants (virtual units)
var CX = 150, GROUND = 252;
var HIPY0 = 118, DROP = 96;     // hip height: stand -> deep
var HIPW = 30, SHW = 46, TORSO = 60, HEADR = 14;
var UPARM = 30, FOREARM = 28;

function draw() {
  ctx.clearRect(0, 0, W, H);

  var s     = sample('s', 0);
  var stance= sample('stance', 60);
  var liftR = sample('liftR', 0);
  var air   = sample('air', 0);
  var lean  = sample('lean', 0);
  var tip   = Math.max(0, Math.min(1, lean / 70)); // torso forward-tip factor

  var airLift = air * 78;
  var hipY = HIPY0 + s * DROP - airLift;

  var pelvisX, footLx, footRx, footLy, footRy;
  if (DEMO.feet) {
    // Feet authored directly (lateral shuffle) — body rides the midpoint.
    footLx = sample('fL', CX - 30); footRx = sample('fR', CX + 30);
    pelvisX = (footLx + footRx) / 2;
    footLy = GROUND; footRy = GROUND;
  } else {
    pelvisX = liftR > 0.02 ? (CX - stance * 0.5) : CX; // balance over stance leg
    footLx = pelvisX - stance * 0.5;
    footRx = pelvisX + stance * 0.5;
    footLy = GROUND - airLift;
    footRy = GROUND - airLift;
    if (liftR > 0.02) {
      footLx = pelvisX;                 // planted leg directly under hips
      footRx = pelvisX + stance * 0.5 + liftR * 24;
      footRy = GROUND - liftR * 104;    // trailing leg lifts up + back-ish
      footLy = GROUND;
    }
  }

  var hipL = { x: pelvisX - HIPW / 2, y: hipY };
  var hipR = { x: pelvisX + HIPW / 2, y: hipY };

  // knees: midway hip->foot, pushed outward so good tracking is visible
  var kOut = 5 + s * 12;
  var kneeL = { x: (hipL.x + footLx) / 2 - kOut, y: (hipY + footLy) / 2 };
  var kneeR = { x: (hipR.x + footRx) / 2 + (liftR > 0.02 ? -2 : kOut), y: (hipY + footRy) / 2 };

  // torso tips forward => shoulders drop toward hips (front-view foreshorten)
  var shMidX = pelvisX + tip * (liftR > 0.02 ? 10 : 0);
  var shMidY = hipY - TORSO * (1 - tip * 0.42);
  var shL = { x: shMidX - SHW / 2, y: shMidY + tip * 4 };
  var shR = { x: shMidX + SHW / 2, y: shMidY + tip * 4 };
  var head = { x: shMidX, y: shMidY - HEADR * 1.55 };

  // arms
  var arm = DEMO.arm, elbL, elbR, hndL, hndR;
  if (arm === 'hang') {
    elbL = { x: shL.x, y: shL.y + UPARM };      hndL = { x: shL.x, y: shL.y + UPARM + FOREARM };
    elbR = { x: shR.x, y: shR.y + UPARM };      hndR = { x: shR.x, y: shR.y + UPARM + FOREARM };
  } else if (arm === 'hips') {
    elbL = { x: shL.x - 8, y: shL.y + UPARM * 0.8 }; hndL = { x: hipL.x, y: hipY - 4 };
    elbR = { x: shR.x + 8, y: shR.y + UPARM * 0.8 }; hndR = { x: hipR.x, y: hipY - 4 };
  } else if (arm === 'chest') {
    elbL = { x: shL.x - 6, y: shL.y + UPARM * 0.7 }; hndL = { x: shMidX - 7, y: shMidY + 20 };
    elbR = { x: shR.x + 6, y: shR.y + UPARM * 0.7 }; hndR = { x: shMidX + 7, y: shMidY + 20 };
  } else { // front — arms reaching forward (toward viewer, drawn raised)
    elbL = { x: shL.x - 3, y: shL.y + UPARM * 0.55 }; hndL = { x: shMidX - 14, y: shMidY + 30 };
    elbR = { x: shR.x + 3, y: shR.y + UPARM * 0.55 }; hndR = { x: shMidX + 14, y: shMidY + 30 };
  }

  // ── ground shadows under planted feet ──
  ctx.save();
  function shadow(fx, fy, k) {
    if (k <= 0.02) return;
    var c = P(fx, GROUND + 4);
    ctx.fillStyle = 'rgba(0,212,188,' + (0.14 * k) + ')';
    ctx.beginPath();
    ctx.ellipse(c.x, c.y, 26 * SC * k, 5 * SC * k, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  shadow(footLx, footLy, (1 - air) * (liftR > 0.02 ? 1 : 1));
  shadow(footRx, footRy, (1 - air) * (1 - liftR));
  ctx.restore();

  // ── skeleton ──
  function bone(a, b, w) {
    var pa = P(a.x, a.y), pb = P(b.x, b.y);
    ctx.strokeStyle = '#00FFE0'; ctx.lineWidth = w * SC; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(pa.x, pa.y); ctx.lineTo(pb.x, pb.y); ctx.stroke();
  }
  function joint(pt, r) {
    var pp = P(pt.x, pt.y);
    ctx.fillStyle = '#00FF00';
    ctx.beginPath(); ctx.arc(pp.x, pp.y, r * SC, 0, Math.PI * 2); ctx.fill();
  }

  ctx.save();
  ctx.shadowColor = 'rgba(0,255,224,0.5)';
  ctx.shadowBlur = 9 * SC;

  var LW = 6, AW = 5;
  // pelvis + torso + shoulders
  bone(hipL, hipR, LW);
  bone({ x: pelvisX, y: hipY }, { x: shMidX, y: shMidY }, LW);
  bone(shL, shR, LW);
  // legs
  bone(hipL, kneeL, LW); bone(kneeL, { x: footLx, y: footLy }, LW);
  bone(hipR, kneeR, LW); bone(kneeR, { x: footRx, y: footRy }, LW);
  // arms
  bone(shL, elbL, AW); bone(elbL, hndL, AW);
  bone(shR, elbR, AW); bone(elbR, hndR, AW);
  // neck + head
  bone({ x: shMidX, y: shMidY }, { x: head.x, y: head.y + HEADR * 0.9 }, LW - 1.5);
  var ph = P(head.x, head.y);
  ctx.strokeStyle = '#00FFE0'; ctx.lineWidth = (LW - 0.5) * SC;
  ctx.beginPath(); ctx.arc(ph.x, ph.y, HEADR * SC, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();

  // joints
  joint(hipL, 4.5); joint(hipR, 4.5);
  joint(kneeL, 5); joint(kneeR, 5);
  joint({ x: footLx, y: footLy }, 5); joint({ x: footRx, y: footRy }, 5);
  joint(shL, 4.5); joint(shR, 4.5);
  joint(hndL, 3.5); joint(hndR, 3.5);

  // ── equipment on top, with a soft purple glow ──
  if (DEMO.equip) {
    ctx.save();
    ctx.shadowColor = 'rgba(192,140,255,0.55)';
    ctx.shadowBlur = 8 * SC;
    if (DEMO.equip === 'band') eqBand(kneeL, kneeR);
    else if (DEMO.equip === 'goblet') eqGoblet({ x: (hndL.x + hndR.x) / 2, y: (hndL.y + hndR.y) / 2 });
    else if (DEMO.equip === 'dumbbell') eqDumbbell(hndR);
    ctx.restore();
  }
}

var t0 = null;
function frame(ts) {
  if (t0 == null) t0 = ts;
  var elapsed = (ts - t0) / 1000;
  p = (elapsed / DEMO.period) % 1;
  draw();
  requestAnimationFrame(frame);
}

resize();
requestAnimationFrame(frame);
</script>
</body>
</html>`;
}
