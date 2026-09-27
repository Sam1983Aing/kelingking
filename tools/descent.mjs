// Checks on the scroll's camera path (v8, src/scroll/path.js), worked out in node from the same
// heightfield the page makes.
//   node tools/descent.mjs                  per stretch: speed, turn and tilt rates per screen of
//                                           scroll, and the least clearance over the ground
//   node tools/descent.mjs --cams=16        also print 16 cameras evenly spread over the scroll,
//                                           as JSON for __app.contactSheet (capture.mjs --eval)
//   node tools/descent.mjs --taus=0,0.5,1   cameras at these values of tau instead
//   node tools/descent.mjs --q=2048         the heightfield's resolution (default 1024, as the page)
//
// A turn rate is in degrees per screen height of scroll: how far the view swings while the
// page moves by one screen. The flight's first stretch turns a lot, but straight down, where a
// turn is the picture rotating about its middle.

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHeightfield } from '../src/terrain/heightfield.js';
import { defaultLayout } from '../src/terrain/layout.js';
import { walkLine } from '../src/trail/route.js';
import { SHOTS } from '../src/shots.js';
import { buildDescent, makePace, PACE, STOPS } from '../src/scroll/path.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};

const layout = defaultLayout();
const hf = generateHeightfield(layout, +flag('q', 1024));
const groundAt = (x, y) => sample(hf.heights, hf.N, hf.cell, hf.extent.x0, hf.extent.y0, x, y);
const walk = pageWalk(hf, layout);
const D = buildDescent({ walk, groundAt, shots: SHOTS });
const pace = makePace();

console.log(`walk ${D.W.end.toFixed(1)} m (stairs ${D.W.stairs.toFixed(1)}, trailTop ${D.W.top.toFixed(1)}, trailLow ${D.W.low.toFixed(1)}, foot ${D.W.foot.toFixed(1)}), scroll ${pace.screens} screens`);
const wrap = (a) => ((a % 360) + 540) % 360 - 180;
const step = 0.01;
const rows = [];
for (let k = 0; k < PACE.length - 1; k++) {
  const [a, ta] = PACE[k], [b, tb] = PACE[k + 1];
  let maxYaw = 0, maxPitch = 0, maxSpeed = 0, maxFov = 0, minClear = Infinity, where = 0;
  let prev = D.poseAt(pace.tauAt(a));
  for (let x = a + step; x <= b + 1e-9; x += step) {
    const p = D.poseAt(pace.tauAt(x));
    // Straight down, a turn is a rotation of the picture, not a pan.
    const down = Math.max(0, (-p.pitch - 60) / 30);
    maxYaw = Math.max(maxYaw, Math.abs(wrap(p.yaw - prev.yaw)) * (1 - down) / step);
    maxPitch = Math.max(maxPitch, Math.abs(p.pitch - prev.pitch) / step);
    maxFov = Math.max(maxFov, Math.abs(p.fov - prev.fov) / step);
    maxSpeed = Math.max(maxSpeed, Math.hypot(p.pos[0] - prev.pos[0], p.pos[1] - prev.pos[1], p.pos[2] - prev.pos[2]) / step);
    const c = p.pos[2] - groundAt(p.pos[0], p.pos[1]);
    if (c < minClear) { minClear = c; where = x; }
    prev = p;
  }
  rows.push({ from: `${a}-${b}`, tau: `${ta}-${tb}`, 'm/screen': +maxSpeed.toFixed(1), 'yaw deg/screen': +maxYaw.toFixed(1), 'pitch deg/screen': +maxPitch.toFixed(1), 'fov deg/screen': +maxFov.toFixed(1), 'least clearance m': +minClear.toFixed(2), at: +where.toFixed(2) });
}
console.table(rows);

// Stops and their poses.
for (let t = 0; t <= 5; t++) {
  const p = D.poseAt(t);
  console.log(`${STOPS[t].padEnd(10)} tau ${t}  screen ${pace.screensAt(t).toFixed(2).padStart(5)}  pos ${p.pos.map((v) => v.toFixed(1)).join(', ')}  yaw ${p.yaw.toFixed(1)} pitch ${p.pitch.toFixed(1)} fov ${p.fov.toFixed(1)}`);
}

const cam = (tau, label) => { const p = D.poseAt(tau); return { pos: p.pos.map((v) => +v.toFixed(2)), yaw: +p.yaw.toFixed(2), pitch: +p.pitch.toFixed(2), fov: +p.fov.toFixed(2), roll: 0, label }; };
let cams = null;
if (flag('cams')) {
  const N = +flag('cams');
  cams = Array.from({ length: N }, (_, i) => { const x = (pace.screens * i) / (N - 1); const t = pace.tauAt(x); return cam(t, `${x.toFixed(1)} scr, tau ${t.toFixed(2)}`); });
}
if (flag('taus')) cams = String(flag('taus')).split(',').map(Number).map((t) => cam(t, `tau ${t}`));
if (cams) {
  const out = join(root, 'captures', 'descent-cams.json');
  writeFileSync(out, JSON.stringify(cams));
  console.log(`${cams.length} cameras in captures/descent-cams.json`);
}

// The walk line as the page makes it (src/scroll/scroll.js does the same with the worker's line).
function pageWalk(h, lay) {
  const route = h.trail.route;
  const pad = lay.trail.pads[0];
  let join0 = 0;
  for (let i = 0; i < route.n; i++) if (route.ht[i] <= pad.h + 0.05) { join0 = route.s[i]; break; }
  return walkLine(route, { from: [SHOTS.viewpoint.pos[0], SHOTS.viewpoint.pos[1]], fromH: pad.h, join: join0 });
}

function sample(H, N, cell, x0, y0, x, y) {
  const fi = (x - x0) / cell - 0.5, fj = (y - y0) / cell - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(fi)));
  const j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
  const u = Math.min(Math.max(fi - i, 0), 1), v = Math.min(Math.max(fj - j, 0), 1);
  const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
