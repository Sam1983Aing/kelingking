// The camera's way down (v8): from high over the bay to the clifftop, down the path, across the
// sand to the water's edge. Pure data and maths, no three.js, so node can check it
// (tools/descent.mjs).
//
// One parameter, tau, runs from 0 to 5 through the stops:
//   0 overview    straight down over the bay from 1.1 km (the hero frame)
//   1 viewpoint   the clifftop platform (the hero frame)
//   2 trailTop    on the ridge path, the head ahead (the hero frame's spot)
//   3 trailLow    low on the switchbacks, over the overhang (the hero frame's spot)
//   4 foot        the foot of the path, on the sand
//   5 edge        at the water's edge, the break by the rock at the south end (the swash frame)
// From 0 to 1 the camera flies: it circles and drops toward a point on the viewpoint's line of
// sight, so it arrives on the platform looking along it. From 1 on it walks the path at eye
// height (the walk line, src/trail/route.js), then crosses the sand.
//
// Where it looks while walking (v9): where it walks. The heading of the path, smoothed across
// each bend so the turn starts before the bend and ends after it, and pulled toward the view
// (the head, the beach) by up to `bias` degrees where that is natural, as a walker looks out
// over the drop on a straight. Where the view turns fast the scroll slows (`TURN_PACE`), so a
// hairpin takes its time. Pitch follows the path's grade ahead on top of keyframed values, and
// the lens is keyframed; all of it by distance walked. (v8 looked at the head all the way
// down, which walked the switchbacks' northward legs backwards.)
//
// Poses are in the shots' terms (src/shots.js): pos [east, north, height], yaw a compass
// heading, pitch up from level, fov vertical, all in degrees. Roll is always 0: the horizon
// stays level.

const R = Math.PI / 180;
export const STOPS = ['overview', 'viewpoint', 'trailTop', 'trailLow', 'foot', 'edge'];

// How much scroll each stretch gets, in screen heights: [screens, tau] knots, eased through
// with a monotone curve. The pairs close together in tau are beats: the camera slows almost
// to a stop there while the words come in.
export const PACE = [
  [0, 0],
  [1.0, 0.03],     // the title over the bay
  [4.3, 0.985],    // the flight down
  [5.4, 1.012],    // a pause at the viewpoint
  [8.0, 1.97],     // steps and ridge
  [8.5, 2.02],     // the head ahead
  [11.8, 2.97],    // the switchbacks (v9: more scroll, as the view now turns with the path)
  [12.2, 3.02],
  [15.5, 3.975],   // down to the sand
  [16.2, 4.03],    // on the sand
  [17.7, 4.992],   // to the water
  [18.8, 5],       // the end
];

// Look keyframes by metres walked (W, from the viewpoint): the view (east, north), how far the
// look may turn off the path toward it (`bias`, degrees on a landscape screen; 180 looks at the
// view whatever the path does), pitch on level ground, lens. Filled in by buildDescent once it
// knows where the stops are.
function lookKeys(W) {
  return [
    // The viewpoint's own line of sight, then the steps: the path, turned toward the head's
    // summit (the origin). Leaving the viewpoint it looks up a little: at the viewpoint's -25.6
    // the edge of the platform's concrete pad (v6) passes through the bottom of the frame.
    { W: 0, at: [32.4, 8.5], bias: 180, pitch: -25.6, fov: 57 },
    { W: 3, at: [16, 4], bias: 180, pitch: -18, fov: 56 },
    { W: W.stairs, at: [0, 0], bias: 30, pitch: -12, fov: 56 },
    { W: W.top - 35, at: [0, 0], bias: 30, pitch: -14, fov: 58 },
    { W: W.top, at: [0, 0], bias: 30, pitch: -17, fov: 60 },
    // Past the first hairpin the path runs north along the face above the beach: the beach and
    // the bay are down to the left.
    { W: W.top + 20, at: [0, 0], bias: 30, pitch: -17, fov: 60 },
    { W: W.top + 45, at: [115, 185], bias: 35, pitch: -16, fov: 60 },
    { W: W.low, at: [100, 150], bias: 35, pitch: -16, fov: 58 },
    { W: W.low + 30, at: [80, 130], bias: 35, pitch: -14, fov: 56 },
    // The break by the rock at the south end of the beach.
    { W: W.foot, at: [58.5, 119.8], bias: 40, pitch: -9, fov: 54 },
    { W: W.end - 8, at: [58.5, 119.8], bias: 180, pitch: -5, fov: 49 },
    { W: W.end, at: [58.5, 119.8], bias: 180, pitch: -3.6, fov: 47 },
  ];
}

// How the look follows the path: the heading is smoothed across this many metres (a Gaussian's
// sigma) and taken this far ahead, so a hairpin's turn starts before the bend. Where the path
// turns one way and straight back (within 10 m either side, the degrees turned beyond the net
// turn passing ZIGZAG), the heading is smoothed across ZIGZAG_TURN metres instead, so the view
// swings only part of the way with each short leg.
const TURN = 2.5, LEAD = 1.5, ZIGZAG = 60, ZIGZAG_TURN = 6;
// How much of the path's grade (the slope over the next few metres) goes into the pitch.
const GRADE = 0.3;
// The scroll slows where the view turns: TURN_PACE degrees of turn take as much scroll as a
// metre walked (about 60 m or 110 degrees a screen on the switchbacks).
const TURN_PACE = 1.8;

// The heading straight down over the bay at the start (the overview frame has 9.1, north up).
const START_YAW = 140;

// How much the line walked is smoothed across (metres, a Gaussian's sigma), which rounds off
// the hairpins.
const HAIRPIN = 2;

// How much higher the eye is held on the switchbacks, and down the concrete steps (metres).
const LIFT = 0.4, STEPS_LIFT = 0.4;

// The walk across the sand: from the foot of the path to where the swash frame stands.
const SAND = [[124.5, 190.6], [114, 182], [104.5, 170], [99, 164]];

// walk: the walk line (route.js walkLine: { s, path, pos }), eye height included.
// groundAt(east, north): the ground's height. shots: src/shots.js.
// view: the screen's { aspect, fov } at the start, and the terrain's extent (layout.js): the
// flight starts as high as it can without the picture reaching past the modelled ground.
export function buildDescent({ walk, groundAt, shots, eye = 1.6, view = { aspect: 16 / 9, fov: 57 }, extent = { x0: -700, y0: -700, size: 1600 } }) {
  // ---------------------------------------------------------------- the line walked
  // The walk line, then the sand, resampled every 25 cm.
  const DW = 0.25;
  const ctrl = walk.map((p) => [p.pos[0], p.pos[1], p.pos[2]]);
  const foot = ctrl.at(-1);
  // A centripetal Catmull-Rom from the foot through the sand points, heights from the ground.
  const sandPts = catmull([ctrl.at(-2), foot, ...SAND, extend(SAND.at(-2), SAND.at(-1))], 24);
  const line = [...ctrl];
  for (const q of sandPts.slice(1)) line.push([q[0], q[1], null]);
  const cum = [0];
  for (let i = 1; i < line.length; i++) cum.push(cum[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]));
  const total = cum.at(-1);
  const n = Math.floor(total / DW) + 1;
  const X = new Float64Array(n), Y = new Float64Array(n), Z = new Float64Array(n);
  let j = 0;
  for (let i = 0; i < n; i++) {
    const w = i * DW;
    while (j < line.length - 2 && cum[j + 1] < w) j++;
    const u = Math.min(1, (w - cum[j]) / Math.max(cum[j + 1] - cum[j], 1e-6));
    const a = line[j], b = line[j + 1];
    X[i] = a[0] + (b[0] - a[0]) * u;
    Y[i] = a[1] + (b[1] - a[1]) * u;
    const za = a[2] ?? groundAt(a[0], a[1]) + eye, zb = b[2] ?? groundAt(b[0], b[1]) + eye;
    Z[i] = za + (zb - za) * u;
  }
  // Where the stops are, in metres walked.
  const atPath = (s) => { for (const p of walk) if (p.path !== null && p.path >= s) return p.s; return walk.at(-1).s; };
  // Hairpins rounded off: the camera cuts inside each bend a little, as a gimbal would, rather
  // than swinging round a 1.2 m turn with the steps and bushes half a metre away (the look
  // does not follow the bends anyway). And the sand's bumps taken out of the eye's height.
  const Xs = gauss(X, HAIRPIN / DW), Ys = gauss(Y, HAIRPIN / DW);
  const footW = cum[ctrl.length - 1];
  const Zs = gauss(Z, 1.5 / DW);
  // Blend the smoothed height in only on the sand, where the walk line has not smoothed it.
  for (let i = 0; i < n; i++) {
    const t = smooth01((i * DW - (footW - 4)) / 8);
    Z[i] = Z[i] + (Zs[i] - Z[i]) * t;
  }
  // Held higher where the verge is tall, as if the camera were held up over the leaves: on the
  // switchbacks, where it looks across the path rather than along it, and down the concrete
  // steps, where v7 grows low leafy scrub on both sides (and at the viewpoint's 1.6 m the
  // side of the platform's pad passes right under the lens).
  const topW = atPath(shots.trailTop.s), stairsW = atPath(shots.stairs.s);
  for (let i = 0; i < n; i++) {
    const w = i * DW;
    Z[i] += LIFT * smooth01((w - topW - 10) / 25) * (1 - smooth01((w - (footW - 22)) / 18));
    Z[i] += STEPS_LIFT * smooth01((w - 0.3) / 3) * (1 - smooth01((w - stairsW - 20) / 20));
  }
  // The viewpoint stays exactly where its frame stands.
  const hold = Math.round(1 / DW);
  for (let i = 0; i < hold; i++) { const t = smooth01(i / hold); Xs[i] = X[i] + (Xs[i] - X[i]) * t; Ys[i] = Y[i] + (Ys[i] - Y[i]) * t; }

  const W = { stairs: atPath(shots.stairs.s), top: atPath(shots.trailTop.s), low: atPath(shots.trailLow.s), foot: footW, end: (n - 1) * DW };

  // ---------------------------------------------------------------- where it looks
  const keys = lookKeys(W);
  // The heading walked, unwrapped (so smoothing never averages across north), then smoothed
  // across the bends and read a little ahead.
  const head = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(i - 2, 0), b = Math.min(i + 2, n - 1);
    const h = Math.atan2(Xs[b] - Xs[a], Ys[b] - Ys[a]) / R;
    head[i] = i ? head[i - 1] + wrap(h - head[i - 1]) : h;
  }
  const turned = new Float64Array(n);
  for (let i = 1; i < n; i++) turned[i] = turned[i - 1] + Math.abs(head[i] - head[i - 1]);
  const win = Math.round(10 / DW);
  const zig = gauss(turned.map((_, i) => {
    const a = Math.max(i - win, 0), b = Math.min(i + win, n - 1);
    return smooth01((turned[b] - turned[a] - Math.abs(head[b] - head[a]) - ZIGZAG) / 80);
  }), 3 / DW);
  const narrow = gauss(head, TURN / DW), wide = gauss(head, ZIGZAG_TURN / DW);
  const lead = Math.round(LEAD / DW);
  const fwd = narrow.map((_, i) => { const j = Math.min(i + lead, n - 1); return narrow[j] + (wide[j] - narrow[j]) * zig[j]; });
  // The grade ahead: the slope of the eye's line over the next 4 m, in degrees.
  const ahead = Math.round(4 / DW);
  const grade = gauss(Z.map((z, i) => Math.atan2(Z[Math.min(i + ahead, n - 1)] - z, ahead * DW) / R), 1.5 / DW);
  // How far the look may lean toward the view, for this screen: the path ahead has to stay in
  // the frame, so on a tall screen (a narrow view across) it leans less.
  const halfAcross = Math.atan(Math.tan((view.fov * R) / 2) * view.aspect) / R;
  const lean = Math.min(1, Math.max(0.35, halfAcross / 45));
  const yawRaw = new Float64Array(n), pitchRaw = new Float64Array(n), fovRaw = new Float64Array(n);
  let k = 0;
  for (let i = 0; i < n; i++) {
    const w = i * DW;
    while (k < keys.length - 2 && keys[k + 1].W < w) k++;
    const A = keys[k], B = keys[k + 1];
    const u = smooth01((w - A.W) / (B.W - A.W));
    const tx = A.at[0] + (B.at[0] - A.at[0]) * u, ty = A.at[1] + (B.at[1] - A.at[1]) * u;
    const toView = Math.atan2(tx - Xs[i], ty - Ys[i]) / R;
    // The view's pull: up to the bias either side, and none when the view is straight behind
    // (so the look cannot flip from one side to the other).
    const d = wrap(toView - fwd[i]);
    const bias = A.bias + (B.bias - A.bias) * u;
    const most = bias >= 180 ? 180 : bias * lean + (180 - bias * lean) * Math.max(0, (bias - 90) / 90);
    const pull = Math.sign(d) * Math.min(Math.abs(d), most) * (most >= 180 ? 1 : 1 - smooth01((Math.abs(d) - 120) / 60));
    yawRaw[i] = fwd[i] + pull;
    const full = Math.max(0, (bias - 90) / 90);   // looking at the view only: no grade in the pitch
    pitchRaw[i] = A.pitch + (B.pitch - A.pitch) * u + GRADE * grade[i] * (1 - full);
    fovRaw[i] = A.fov + (B.fov - A.fov) * u;
  }
  // (The yaw unwrapped again: fwd + pull can cross north between samples.)
  for (let i = 1; i < n; i++) yawRaw[i] = yawRaw[i - 1] + wrap(yawRaw[i] - yawRaw[i - 1]);
  const yawS = gauss(yawRaw, 2 / DW), pitchS = gauss(pitchRaw, 3 / DW), fovS = gauss(fovRaw, 3 / DW);
  // The viewpoint's frame exactly at the start (smoothing pulls it toward what comes next).
  const vp = shots.viewpoint;
  const vpYaw = yawS[0] + wrap(vp.yaw - yawS[0]);
  for (let i = 0; i < hold * 1.5; i++) {
    const t = smooth01(i / (hold * 1.5));
    yawS[i] = vpYaw + (yawS[i] - vpYaw) * t;
    pitchS[i] = vp.pitch + (pitchS[i] - vp.pitch) * t;
    fovS[i] = vp.fov + (fovS[i] - vp.fov) * t;
  }

  function walkPose(w) {
    const f = Math.min(Math.max(w / DW, 0), n - 1.0001), i = Math.floor(f), u = f - i;
    const L = (A) => A[i] + (A[i + 1] - A[i]) * u;
    return { pos: [L(Xs), L(Ys), L(Z)], yaw: ((L(yawS) % 360) + 360) % 360, pitch: L(pitchS), fov: L(fovS), roll: 0 };
  }

  // ---------------------------------------------------------------- the flight
  // Circling a moving point: the camera at distance D from it, at compass bearing az and
  // elevation el, looking straight at it. It starts as the overview frame (straight down) and
  // ends as the viewpoint frame (D1 back along its line of sight).
  // It starts over the bay (a little south-west of the overview frame's middle), turned with
  // south-east up rather than the overview's north-up: the head sits right of the title on a
  // wide screen, and there is a quarter turn less to make. The ground is modelled 1.6 km
  // across, so the height is what keeps the frame's corners on it: about 650 m on a 16:9
  // screen, up to the overview's 1.1 km on a tall one.
  const ov = shots.overview;
  const T0 = [130, 165, 0];
  const D0 = startHeight(T0, view, extent, ov.pos[2]), D1 = 250;
  const az0 = START_YAW - 180, el1 = -vp.pitch;
  let az1 = vp.yaw - 180;
  az1 = az0 + (((az1 - az0) % 360) + 540) % 360 - 180;   // the shorter way round
  const dir = (az, el) => [Math.cos(el * R) * Math.sin(az * R), Math.cos(el * R) * Math.cos(az * R), Math.sin(el * R)];
  const d1 = dir(az1, el1);
  const T1 = [vp.pos[0] - D1 * d1[0], vp.pos[1] - D1 * d1[1], vp.pos[2] - D1 * d1[2]];
  function airPose(t) {
    // It turns while still looking nearly straight down (the picture turns about its middle),
    // then tilts up to the horizon.
    const az = az0 + (az1 - az0) * smoother01(t / 0.5);
    const el = 90 - (90 - el1) * smoother01((t - 0.3) / 0.7);
    const e = smoother01(t);
    const D = Math.exp(Math.log(D0) + (Math.log(D1) - Math.log(D0)) * e);
    const T = [T0[0] + (T1[0] - T0[0]) * e, T0[1] + (T1[1] - T0[1]) * e, T0[2] + (T1[2] - T0[2]) * e];
    const d = dir(az, el);
    return { pos: [T[0] + D * d[0], T[1] + D * d[1], T[2] + D * d[2]], yaw: ((az + 180) % 360 + 360) % 360, pitch: -el, fov: vp.fov, roll: 0 };
  }

  // ---------------------------------------------------------------- tau
  // Between two stops tau runs evenly not in metres but in "cost": a metre plus the degrees
  // the view turns over it, so the camera slows through the bends and walks the straights.
  const cost = new Float64Array(n);
  for (let i = 1; i < n; i++) {
    const turn = Math.abs(yawS[i] - yawS[i - 1]) + 0.5 * Math.abs(pitchS[i] - pitchS[i - 1]);
    cost[i] = cost[i - 1] + DW + turn / TURN_PACE;
  }
  const costAt = (w) => { const f = Math.min(Math.max(w / DW, 0), n - 1.0001), i = Math.floor(f); return cost[i] + (cost[i + 1] - cost[i]) * (f - i); };
  const wAtCost = (c) => {
    let a = 0, b = n - 1;
    while (b - a > 1) { const m = (a + b) >> 1; if (cost[m] < c) a = m; else b = m; }
    return (a + Math.min(Math.max((c - cost[a]) / Math.max(cost[b] - cost[a], 1e-9), 0), 1)) * DW;
  };
  const bounds = [0, W.top, W.low, W.foot, W.end];   // metres walked at tau 1, 2, 3, 4, 5
  const cBounds = bounds.map(costAt);
  function wAt(tau) {
    const k = Math.min(Math.max(Math.floor(tau) - 1, 0), 3), u = Math.min(Math.max(tau - 1 - k, 0), 1);
    return wAtCost(cBounds[k] + (cBounds[k + 1] - cBounds[k]) * u);
  }
  function poseAt(tau) {
    if (tau <= 1) return airPose(Math.max(tau, 0));
    return walkPose(wAt(tau));
  }
  // tau for a distance walked (the inverse of wAt).
  function tauAtW(w) {
    for (let k = 0; k < 4; k++) if (w <= bounds[k + 1]) return 1 + k + (costAt(w) - cBounds[k]) / (cBounds[k + 1] - cBounds[k]);
    return 5;
  }
  return { poseAt, wAt, tauAtW, W, total: W.end, stairsTau: tauAtW(W.stairs), startHeight: D0 };
}

// The greatest height (up to `most`) from which a picture straight down, turned to START_YAW,
// keeps its corners 40 m inside the terrain's extent.
function startHeight(T, { aspect, fov }, ext, most) {
  const hh = Math.tan((fov * R) / 2), hw = hh * aspect;
  const up = [Math.sin(START_YAW * R), Math.cos(START_YAW * R)], right = [Math.sin((START_YAW + 90) * R), Math.cos((START_YAW + 90) * R)];
  let D = most;
  for (const [a, b] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const c = [up[0] * hh * a + right[0] * hw * b, up[1] * hh * a + right[1] * hw * b];
    for (let k = 0; k < 2; k++) {
      const lo = (k ? ext.y0 : ext.x0) + 40, hi = (k ? ext.y0 : ext.x0) + ext.size - 40;
      if (c[k] > 0) D = Math.min(D, (hi - T[k]) / c[k]);
      if (c[k] < 0) D = Math.min(D, (lo - T[k]) / c[k]);
    }
  }
  return Math.max(D, 300);
}

// ---------------------------------------------------------------- scroll to tau

// A monotone cubic through the PACE knots (Fritsch-Carlson): no overshoot, so the camera
// never backs up, and it slows smoothly into each beat.
export function makePace(knots = PACE) {
  const xs = knots.map((k) => k[0]), ys = knots.map((k) => k[1]);
  const len = xs.at(-1);
  const m = xs.length;
  const d = [], s = [];
  for (let i = 0; i < m - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  s.push(d[0]);
  for (let i = 1; i < m - 1; i++) s.push(d[i - 1] * d[i] <= 0 ? 0 : (3 * (d[i - 1] + d[i])) / ((2 * d[i] + d[i - 1]) / d[i - 1] + (d[i] + 2 * d[i - 1]) / d[i]));
  s.push(d.at(-1));
  // Flat at both ends: the page starts and ends at rest.
  s[0] = 0; s[m - 1] = 0;
  function tauAt(screens) {
    const x = Math.min(Math.max(screens, 0), len);
    let i = 0;
    while (i < m - 2 && xs[i + 1] < x) i++;
    const h = xs[i + 1] - xs[i], t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * s[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * s[i + 1];
  }
  // The scroll (in screens) at which tau is reached, by bisection.
  function screensAt(tau) {
    let a = 0, b = len;
    for (let k = 0; k < 40; k++) { const c = (a + b) / 2; if (tauAt(c) < tau) a = c; else b = c; }
    return (a + b) / 2;
  }
  return { tauAt, screensAt, screens: len };
}

// ---------------------------------------------------------------- helpers

const smooth01 = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * (3 - 2 * t); };
const smoother01 = (t) => { t = Math.min(Math.max(t, 0), 1); return t * t * t * (t * (6 * t - 15) + 10); };
const extend = (a, b) => [2 * b[0] - a[0], 2 * b[1] - a[1]];
const wrap = (a) => (((a % 360) + 540) % 360) - 180;

// Gaussian smoothing of an array, sigma in samples, edges held.
function gauss(A, sigma) {
  const r = Math.ceil(sigma * 3), w = [];
  for (let i = -r; i <= r; i++) w.push(Math.exp(-(i * i) / (2 * sigma * sigma)));
  const out = new Float64Array(A.length);
  for (let i = 0; i < A.length; i++) {
    let s = 0, ws = 0;
    for (let k = -r; k <= r; k++) {
      const j = Math.min(A.length - 1, Math.max(0, i + k));
      s += A[j] * w[k + r]; ws += w[k + r];
    }
    out[i] = s / ws;
  }
  return out;
}

// Centripetal Catmull-Rom through P[1..n-2] (P[0] and P[n-1] only shape the ends), `per`
// points per span.
function catmull(P, per) {
  const out = [];
  for (let i = 1; i < P.length - 2; i++) {
    const [p0, p1, p2, p3] = [P[i - 1], P[i], P[i + 1], P[i + 2]];
    const d = (a, b) => Math.max(Math.hypot(b[0] - a[0], b[1] - a[1]) ** 0.5, 1e-4);
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    for (let k = 0; k < per; k++) {
      const t = t1 + ((t2 - t1) * k) / per;
      const L = (a, b, ta, tb) => [0, 1].map((c) => ((tb - t) * a[c] + (t - ta) * b[c]) / (tb - ta));
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  out.push(P.at(-2).slice(0, 2));
  return out;
}
