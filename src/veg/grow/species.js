// The plants of the headland, grown from a seed. Each species returns a PlantBuilder full
// of geometry plus what the renderer needs to know about it: its height, the crown's
// ellipsoid (for light through the crown), and how it moves in the wind.
//
// Nothing here is a scan. The species are the ones that grow on the limestone cliffs of Nusa
// Penida, drawn from how they grow rather than traced from photos:
//   scaevola  beach naupaka (Scaevola taccada): a mound of green stems ending in rosettes
//             of fleshy, spoon-shaped leaves; the bush in the foreground of the viewpoint
//             and stairs photos
//   grass     a tussock of long arching blades, green in the wet season with dry tips
//   (more in later passes: pandanus, the coconut palm, a broadleaf tree)

import { PlantBuilder, rng, growToTargets, crownPoints, add, sub, mul, norm, cross, dot, rotate, madd, lerp3, smooth, clamp01, len, perp } from './core.js';
import { LEAF } from './leaves.js';

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

// Linear albedo from an sRGB-ish triple, scaled.
const lin = (r, g, b) => [r, g, b].map((v) => Math.pow(v / 255, 2.2));
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const scalec = (a, s) => a.map((v) => v * s);

// ---------------------------------------------------------------- beach naupaka
// A mound wider than tall. Several stems rise from the base and fork, each fork ending in a
// rosette of leaves; the rosettes crowd the outside of the mound in two or three layers, so
// from outside you see leaves and hardly any stem.
export function scaevola(seed, o = {}) {
  const rand = rng(seed * 7 + 1);
  const H = o.height ?? rand.range(1.2, 2.1);
  const Wd = H * rand.range(0.75, 0.95);                       // half-width of the mound
  const crownC = [rand.range(-0.08, 0.08) * H, H * 0.5, rand.range(-0.08, 0.08) * H];
  const crownR = [Wd * rand.range(0.95, 1.05), H * 0.5, Wd * rand.range(0.85, 0.95)];
  const nTargets = Math.round((o.density ?? 1) * rand.range(150, 190) * (H / 1.6) ** 2);
  const targets = crownPoints(nTargets, crownC, crownR, rand, { bias: 5, floorY: H * 0.12, flatTop: 0.1 });

  // Stems from the base, one per sector of the mound.
  const nStems = Math.round(rand.range(6, 9));
  const bySector = Array.from({ length: nStems }, () => []);
  const a0 = rand() * Math.PI * 2;
  for (const t of targets) {
    const a = (Math.atan2(t[2] - crownC[2], t[0] - crownC[0]) - a0 + Math.PI * 4) % (Math.PI * 2);
    bySector[Math.floor(a / (Math.PI * 2) * nStems) % nStems].push(t);
  }
  const branches = [], tips = [];
  for (const group of bySector) {
    if (!group.length) continue;
    const c = group.reduce((a, t) => add(a, t), [0, 0, 0]).map((v) => v / group.length);
    const r0 = rand.range(0, 0.1) * H;
    const base = [c[0] / (len([c[0], 0, c[2]]) || 1) * r0, 0, c[2] / (len([c[0], 0, c[2]]) || 1) * r0];
    const g = growToTargets(group, {
      root: base, rootDir: norm([c[0] * 0.4, H, c[2] * 0.4]), trunk: 0, reach0: 0.45, reach: 0.42, twigAt: 1, maxLevel: 10,
      radius: 0.03 * H, tipRadius: 0.004, pipe: 2.2, bendUp: 0.3, sag: 0.2, crownC, crownR, lengthScale: H * 1.2, total: nTargets,
    }, rand);
    branches.push(...g.branches); tips.push(...g.tips);
  }

  const b = new PlantBuilder({ light: !!o.light });
  const bark = lin(142, 134, 112);
  const stemGreen = lin(118, 128, 88);
  for (const br of branches) {
    const n = br.pts.length;
    const young = smooth(2, 6, br.level);
    const color = [...mixc(bark, stemGreen, young), 0.2];
    const sides = br.r[0] > 0.012 ? 6 : br.r[0] > 0.006 ? 4 : 3;
    b.tube(br.pts, br.r, {
      color, sides,
      wind: br.pts.map((_, i) => [br.amp0 + (br.amp1 - br.amp0) * i / (n - 1), br.phase]),
      shade: br.pts.map((p) => shadeAt(p, crownC, crownR) * 0.85),
    });
  }

  // Leaves: a rosette at every twig end, young leaves upright in the middle, older ones
  // spreading below them, the oldest yellowing.
  // Real leaves are greyer than they look: about 0.05 red, 0.11 green, 0.04 blue.
  const green = o.green ?? lin(70, 96, 54);
  const deep = lin(54, 78, 44);
  const yellow = lin(140, 128, 70);
  const leafLen = o.leafLen ?? 0.15;
  let area = 0;
  for (const t of tips) {
    const axis = norm(add(mul(t.dir, 0.5), [0, 0.75, 0]));
    const n = Math.round(rand.range(11, 17));
    const rot0 = rand() * Math.PI * 2;
    const side0 = perp(axis);
    if (b.light) {
      // The lighter level: the rosette as three cards (grow/leaves.js paints it from above
      // and from the side), about as wide as the leaves reach.
      // (Size and colour matched to the full plant at 10 and 14 m: coverage and mean colour
      // of the frame, tools in PROCESS.md, v7.)
      const S = leafLen * 1.8;
      const tint = rand.range(-1, 1);
      const c = [...scalec(mixc(mixc(green, deep, clamp01(0.45 - 0.45 * tint)), lin(84, 108, 56), 0.2), 0.75), 0.3];
      const w = [t.amp, t.phase];
      const side1 = cross(axis, side0);
      const base = madd(t.p, axis, -0.03);
      // From above: square, across the axis, its middle on the stem.
      b.card(madd(base, side1, -S / 2), mul(side0, S / 2), mul(side1, S), {
        cell: LEAF.ROSETTE_TOP, vr: [0, 0.5], nb: axis, nt: axis, c0: c, c1: c, w0: w, w1: w, leafPhase: rand(), shade: t.shade, gloss: 0.75 });
      for (const sd of [side0, side1]) {
        const nrm = norm(add(cross(sd, axis), mul(axis, 0.6)));
        b.card(madd(base, axis, -0.02), mul(sd, S / 2), mul(axis, S), {
          cell: LEAF.ROSETTE_SIDE, vr: [0, 0.5], nb: nrm, nt: norm(add(nrm, mul(axis, 1.5))), c0: c, c1: c, w0: w, w1: w, leafPhase: rand(), shade: t.shade, gloss: 0.75 });
      }
      area += S * S * 0.5;
      continue;
    }
    for (let k = 0; k < n; k++) {
      const age = k / (n - 1);                   // 0 youngest (inner), 1 oldest (outer)
      const az = rot0 + k * GOLDEN;
      const around = rotate(side0, axis, az);
      // Angle from the axis: young ones upright, old ones spread nearly flat.
      const el = 0.3 + 1.0 * age + rand.range(-0.12, 0.12);
      const dir = norm(add(mul(axis, Math.cos(el)), mul(around, Math.sin(el))));
      // Older leaves sit a little lower down the stem.
      const base = madd(t.p, axis, -0.05 * age * age + 0.005);
      const L = leafLen * rand.range(0.8, 1.15) * (0.65 + 0.4 * Math.min(1, age * 1.6));
      const Wl = L * rand.range(0.38, 0.46);
      // Upper face up and toward the light, turned a little at random.
      const faceUp = norm(add(add(mul(axis, 0.8), [0, 0.6, 0]), [rand.gauss() * 0.15, 0, rand.gauss() * 0.15]));
      const old = age > 0.9 && rand() < 0.1;
      const tint = rand.range(-1, 1);
      let c = mixc(green, deep, clamp01(0.45 - 0.45 * tint));
      c = mixc(c, lin(84, 108, 56), (1 - age) * 0.4);      // young leaves are brighter
      if (old) c = mixc(c, yellow, rand.range(0.25, 0.6));
      b.leafBlade(madd(base, dir, 0.012), dir, faceUp, L, Wl, {
        color: [...c, 0.3], wind: [t.amp, t.phase], leafPhase: rand(), shade: t.shade * (0.8 + 0.2 * (1 - age)),
        cell: old ? LEAF.SPOON_OLD : LEAF.SPOON, gloss: 0.75, fold: rand.range(0.15, 0.4), droop: L * 0.15 * age, rows: 2,
      });
      area += L * Wl * 0.72;
    }
  }
  const volume = (4 / 3) * Math.PI * crownR[0] * crownR[1] * crownR[2] * 0.6;
  return {
    builder: b, height: H, radius: Math.max(crownR[0], crownR[2], H * 0.6), crownC, crownR,
    // Extinction in the crown per metre, for light passing through it: half the leaf area
    // per volume (leaves at random angles block about half their area), less for the
    // leaves being bunched in the outer shell.
    density: 0.5 * area / volume * 0.7,
    leafArea: area, trans: 0.3, gloss: 0.75,
    wind: { freq: 1.6, stiff: 0.08, branchAmp: 0.04, branchFreq: 3.6, leafAmp: 0.012, leafFreq: 11 },
  };
}

function shadeAt(p, c, R) {
  const r = len([(p[0] - c[0]) / R[0], (p[1] - c[1]) / R[1], (p[2] - c[2]) / R[2]]);
  const up = clamp01(0.5 + 0.5 * (p[1] - c[1]) / R[1]);
  return clamp01(smooth(0.15, 1.0, r) * (0.7 + 0.3 * up));
}

// ---------------------------------------------------------------- grass tussock
// A fountain of long blades from a tight base: the inner ones stand, the outer ones arch
// out and hang their tips; green at the base, some drying to straw from the tip down; a few
// seed stalks standing above.
export function grass(seed, o = {}) {
  const rand = rng(seed * 13 + 5);
  const H = o.height ?? rand.range(0.45, 0.85);
  const n = Math.round(o.blades ?? rand.range(110, 150) * (H / 0.65));
  const baseR = rand.range(0.05, 0.09) * (H / 0.65);
  const green = lin(70, 94, 48), green2 = lin(92, 104, 54), dry = lin(158, 138, 96), dead = lin(128, 112, 82), baseCol = lin(52, 58, 36);
  const dryShare = o.dry ?? rand.range(0.25, 0.45);
  const lean = [rand.gauss() * 0.1, 0, rand.gauss() * 0.1];   // the whole tuft leans a little
  const b = new PlantBuilder({ light: !!o.light });
  const blade = (base, out, L, el0, droop, w0, colAt, phase, segs = 4) => {
    const pts = [], widths = [], faces = [], colors = [], wind = [];
    let p = base;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      if (s > 0) {
        const el = el0 - droop * Math.pow(t, 1.3);
        const d = norm(add([out[0] * Math.cos(el), Math.sin(el), out[2] * Math.cos(el)], mul(lean, t)));
        p = madd(p, d, L / segs);
      }
      pts.push(p);
      widths.push(w0 * (1 - Math.pow(t, 1.8) * 0.97));
      // The blade's upper face looks up and in, toward the tuft's middle.
      faces.push(norm(add([0, 1, 0], mul(out, -0.5))));
      colors.push(colAt(t));
      wind.push([Math.pow(t, 1.4) * (L / H), phase]);
    }
    b.strap(pts, widths, faces, {
      colors, wind, leafPhase: rand(), shade: pts.map((_, s) => 0.3 + 0.7 * smooth(0, 0.7, s / segs)),
      gloss: 0.3, trans: 0.55, flat: true, cup: 0.45,
    });
  };
  if (b.light) {
    // The lighter level: three crossed cards with a painted tuft (grow/leaves.js).
    const Hc = H * 1.35, Wc = Hc * 0.5;
    const c0 = scalec(mixc(baseCol, green, 0.6), 0.55), c1 = scalec(mixc(mixc(green, green2, 0.5), dry, dryShare * 0.8), 0.55);
    for (let k = 0; k < 3; k++) {
      const a = (k / 3) * Math.PI + rand() * 0.3;
      const u = [Math.cos(a) * Wc / 2, 0, Math.sin(a) * Wc / 2];
      const f = [-Math.sin(a), 0, Math.cos(a)];
      b.card(add([0, 0, 0], mul(lean, 0)), u, add([0, Hc, 0], mul(lean, Hc)), {
        cell: dryShare > 0.35 ? LEAF.TUFT_DRY : LEAF.TUFT, vr: [0, 1], nb: norm(add(f, [0, 0.8, 0])), nt: norm(add(f, [0, 2.5, 0])),
        c0: [...c0, 0.55], c1: [...c1, 0.55], w0: [0, k / 3], w1: [1.2, k / 3 + 0.1], leafPhase: rand(), shade: 0.8, gloss: 0.3,
      });
    }
    return {
      builder: b, height: H * 1.3, radius: H * 1.1, crownC: [0, H * 0.4, 0], crownR: [H * 0.75, H * 0.5, H * 0.75], density: 3.0,
      wind: { freq: 2.1, stiff: 0.22, branchAmp: 0.07, branchFreq: 2.8, leafAmp: 0.006, leafFreq: 9 },
    };
  }
  for (let i = 0; i < n; i++) {
    const az = rand() * Math.PI * 2;
    const out = [Math.cos(az), 0, Math.sin(az)];
    const r0 = baseR * Math.sqrt(rand());
    const base = [out[0] * r0, 0, out[2] * r0];
    const outer = r0 / baseR;
    const L = H * rand.range(0.7, 1.3) * (1.1 - 0.3 * outer) * 1.3;
    const el0 = (84 - 40 * outer - rand() * 12) * Math.PI / 180;
    const droop = rand.range(0.6, 1.5) * (0.5 + 1.1 * outer);
    const w0 = rand.range(0.006, 0.01);
    const dryTip = rand() < dryShare ? rand.range(0.2, 0.75) : 0;
    const deadBlade = rand() < 0.08;
    const hue = rand();
    blade(base, out, L, el0, droop, w0, (t) => {
      let c = mixc(green, green2, hue);
      c = mixc(baseCol, c, smooth(0, 0.25, t));
      if (dryTip) c = mixc(c, dry, smooth(1 - dryTip, 1 - dryTip + 0.25, t));
      if (deadBlade) c = mixc(c, dead, 0.9);
      return c;
    }, i / n + rand.range(0, 0.1));
  }
  // Seed stalks.
  const stalks = Math.round(rand.range(2, 7));
  for (let i = 0; i < stalks; i++) {
    const az = rand() * Math.PI * 2;
    const out = [Math.cos(az), 0, Math.sin(az)];
    const L = H * rand.range(1.3, 1.8);
    blade([out[0] * baseR * 0.3, 0, out[2] * baseR * 0.3], out, L, (78 + rand() * 8) * Math.PI / 180, rand.range(0.15, 0.4), 0.004,
      (t) => mixc(mixc(green, dry, smooth(0.3, 0.8, t)), lin(170, 150, 110), smooth(0.8, 0.85, t)), rand(), 5);
  }
  return {
    builder: b, height: H * 1.3, radius: H * 1.1, crownC: [0, H * 0.4, 0], crownR: [H * 0.75, H * 0.5, H * 0.75], density: 3.0,
    wind: { freq: 2.1, stiff: 0.22, branchAmp: 0.07, branchFreq: 2.8, leafAmp: 0.006, leafFreq: 9 },
  };
}

// ---------------------------------------------------------------- broadleaf tree
// The trees of the plateau and the hollows: a short trunk that forks low into a few limbs
// and a broad, rounded crown of leaf clusters, darker and denser than the naupaka.
export function tree(seed, o = {}) {
  const rand = rng(seed * 31 + 7);
  const H = o.height ?? rand.range(4.5, 7);
  const trunkH = H * rand.range(0.22, 0.32);
  const crownC = [rand.range(-0.1, 0.1) * H, H * 0.62, rand.range(-0.1, 0.1) * H];
  const crownR = [H * rand.range(0.5, 0.62), H * 0.38, H * rand.range(0.48, 0.58)];
  const nTargets = Math.round(rand.range(300, 380));
  const targets = crownPoints(nTargets, crownC, crownR, rand, { bias: 4.5, floorY: trunkH + H * 0.1 });
  const { branches, tips } = growToTargets(targets, {
    root: [0, 0, 0], rootDir: norm([rand.gauss() * 0.08, 1, rand.gauss() * 0.08]), trunk: trunkH, reach: 0.45, twigAt: 1, maxLevel: 10,
    radius: 0.05 * H, tipRadius: 0.006, pipe: 2.3, bendUp: 0.3, sag: 0.2, crownC, crownR, lengthScale: H,
  }, rand);
  const b = new PlantBuilder({ light: !!o.light });
  const bark = lin(138, 128, 114), young = lin(124, 118, 94);
  for (const br of branches) {
    const n = br.pts.length;
    const sides = br.r[0] > 0.04 ? 8 : br.r[0] > 0.015 ? 5 : 3;
    b.tube(br.pts, br.r, {
      color: [...mixc(bark, young, smooth(3, 7, br.level)), 0.2], sides,
      wind: br.pts.map((_, i) => [br.amp0 + (br.amp1 - br.amp0) * i / (n - 1), br.phase]),
      shade: br.pts.map((p) => shadeAt(p, crownC, crownR) * 0.8),
    });
  }
  const green = lin(60, 86, 46), deep = lin(44, 68, 38), light = lin(76, 100, 52);
  let area = 0;
  // Sprays of leaves (leaves.js) at every twig end, turned every way around it.
  for (const t of tips) {
    const axis = norm(add(mul(t.dir, 0.6), [0, 0.45, 0]));
    const n = Math.round(rand.range(4, 6));
    const side0 = perp(axis);
    const rot0 = rand() * Math.PI * 2;
    for (let k = 0; k < n; k++) {
      const around = rotate(side0, axis, rot0 + k * (Math.PI * 2 / n) + rand.range(-0.3, 0.3));
      const el = rand.range(0.5, 1.2);
      const dir = norm(add(mul(axis, Math.cos(el)), mul(around, Math.sin(el))));
      const L = rand.range(0.45, 0.62);
      // Leaves face every way in a crown, up more often than not.
      const faceUp = norm(add([rand.gauss() * 0.45, 1, rand.gauss() * 0.45], mul(around, 0.6)));
      const tint = rand.range(-1, 1);
      let c = mixc(green, tint > 0 ? light : deep, Math.abs(tint) * 0.8);
      b.leafBlade(madd(t.p, axis, -0.05), dir, faceUp, L, L * 0.5, {
        color: [...c, 0.3], wind: [t.amp, t.phase], leafPhase: rand(), shade: t.shade, cell: LEAF.SPRAY,
        gloss: 0.5, fold: 0.1, droop: L * 0.15, cup: 0.35, arch: 0.35,
      });
      area += L * L * 0.5 * 0.5;
    }
  }
  const volume = (4 / 3) * Math.PI * crownR[0] * crownR[1] * crownR[2];
  return {
    builder: b, height: H, radius: Math.max(crownR[0], crownR[2]) * 1.1, crownC, crownR,
    density: 0.5 * area / volume * 0.7, leafArea: area, trans: 0.3, gloss: 0.55,
    wind: { freq: 0.9, stiff: 0.035, branchAmp: 0.08, branchFreq: 2.2, leafAmp: 0.015, leafFreq: 9 },
  };
}

// ---------------------------------------------------------------- coconut palm
// A slender ringed trunk leaning and curving up, a crown of arching fronds, each a midrib
// with narrow leaflets down both sides that hang from it, and a cluster of nuts.
export function palm(seed, o = {}) {
  const rand = rng(seed * 41 + 3);
  const H = o.height ?? rand.range(9, 14);
  const trunkH = H - 1.5;
  const lean = rand.range(0.08, 0.2), leanAz = rand() * Math.PI * 2;
  const b = new PlantBuilder({ light: !!o.light });
  // Trunk: leaning at the foot, curving back up.
  const tp = [], tr = [];
  const segs = 14;
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    const off = trunkH * lean * (t - 0.45 * t * t) ;
    tp.push([Math.cos(leanAz) * off, t * trunkH, Math.sin(leanAz) * off]);
    tr.push((0.2 - 0.07 * t) * (1 + 0.35 * Math.pow(1 - t, 6)) * (H / 12));
  }
  b.tube(tp, tr, { color: [...lin(156, 146, 128), 0.1], sides: 9,
    wind: tp.map((_, i) => [Math.pow(i / segs, 2) * 0.4, 0.2]), shade: tp.map(() => 0.85) });
  const top = tp[segs];
  // Nuts.
  for (let i = 0; i < 9; i++) {
    const a = rand() * Math.PI * 2;
    const c = add(top, [Math.cos(a) * 0.28, -0.35 - rand() * 0.3, Math.sin(a) * 0.28]);
    const pts = [madd(c, [0, 1, 0], -0.12), madd(c, [0, 1, 0], 0.12)];
    b.tube(pts, [0.12, 0.12], { color: [...lin(110, 104, 50), 0.1], sides: 6, wind: [[0.3, 0.2], [0.3, 0.2]], shade: [0.5, 0.5] });
  }
  const green = lin(84, 100, 50), dry = lin(146, 124, 80);
  const nF = Math.round(rand.range(22, 28));
  let area = 0;
  for (let f = 0; f < nF; f++) {
    const az = f * GOLDEN * 1.0 + rand() * 0.2;
    const out = [Math.cos(az), 0, Math.sin(az)];
    const age = rand();                               // young fronds stand up, old ones droop
    const el0 = (70 - 80 * age + rand.range(-8, 8)) * Math.PI / 180;
    const L = rand.range(4.8, 5.8) * (H / 12) * (0.75 + 0.3 * (1 - Math.abs(age - 0.5)));
    const droop = rand.range(1.0, 1.6) * (0.6 + 0.8 * age);
    const n = 12;
    const rach = [];
    let p = add(top, [0, 0.1, 0]);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      if (i > 0) {
        const el = el0 - droop * t * t;
        p = madd(p, [out[0] * Math.cos(el), Math.sin(el), out[2] * Math.cos(el)], L / n);
      }
      rach.push(p);
    }
    const phase = rand();
    const wAt = (t) => [0.3 + 0.7 * t, phase];
    b.tube(rach, rach.map((_, i) => 0.035 * (1 - 0.8 * i / n) * (H / 12)), {
      color: [...lin(120, 116, 70), 0.3], sides: 3, wind: rach.map((_, i) => wAt(i / n)), shade: rach.map(() => 0.8),
    });
    const col = age > 0.85 ? mixc(green, dry, 0.8) : mixc(mixc(green, lin(96, 106, 52), rand()), dry, age * 0.25);
    // Leaflets: pairs along the midrib, longest in the middle, hanging down and forward in a
    // V from the midrib.
    const pairs = 44;
    for (let k = 1; k < pairs; k++) {
      const t = k / pairs;
      const i = Math.min(n - 1, Math.floor(t * n)), u = t * n - i;
      const at = lerp3(rach[i], rach[i + 1], u);
      const T = norm(sub(rach[i + 1], rach[i]));
      const side = norm(cross(T, [0, 1, 0]));
      const ll = (0.45 + 0.55 * Math.sin(Math.PI * Math.min(1, t * 1.15))) * 1.1 * (H / 12);
      for (const sgn of [-1, 1]) {
        const dir = norm(add(add(mul(side, sgn * 0.8), mul(T, 0.4)), [0, -0.75 - 0.4 * t, 0]));
        const pts = [at, madd(madd(at, dir, ll * 0.5), [0, -1, 0], 0.03), madd(madd(at, dir, ll), [0, -1, 0], ll * 0.15)];
        const face = norm(add(cross(dir, T), [0, 0.5, 0]));
        b.strap(pts, [0.04, 0.034, 0.004], [face, face, face], {
          colors: [col, col, mixc(col, dry, 0.15)], wind: pts.map(() => wAt(t)), leafPhase: rand(), shade: 0.9, gloss: 0.6, trans: 0.45, flat: true, cup: 0.3,
        });
        area += ll * 0.03;
      }
    }
  }
  const crownC = [top[0], top[1] - 0.8, top[2]], crownR = [4.2 * H / 12, 2.2 * H / 12, 4.2 * H / 12];
  return {
    builder: b, height: H, radius: Math.max(5 * H / 12, H * 0.55), crownC, crownR, density: 0.4, leafArea: area, trans: 0.45, gloss: 0.6,
    wind: { freq: 0.7, stiff: 0.02, branchAmp: 0.25, branchFreq: 1.6, leafAmp: 0.05, leafFreq: 7 },
  };
}

// ---------------------------------------------------------------- pandanus
// Screw pine: a trunk on stilt roots, forking into a few crooked branches, each ending in a
// spiral tuft of long, keeled strap leaves that arch and droop.
export function pandanus(seed, o = {}) {
  const rand = rng(seed * 53 + 11);
  const H = o.height ?? rand.range(3, 5);
  const b = new PlantBuilder({ light: !!o.light });
  const bark = lin(146, 134, 112);
  // Stilt roots.
  const nRoots = Math.round(rand.range(4, 7));
  for (let i = 0; i < nRoots; i++) {
    const a = rand() * Math.PI * 2, r = rand.range(0.35, 0.6), top = rand.range(0.5, 0.9);
    const pts = [[Math.cos(a) * r, -0.05, Math.sin(a) * r], [Math.cos(a) * r * 0.45, top * 0.6, Math.sin(a) * r * 0.45], [0, top, 0]];
    b.tube(pts, [0.035, 0.04, 0.05], { color: [...bark, 0.1], sides: 5, wind: pts.map(() => [0, 0]), shade: pts.map(() => 0.6) });
  }
  // Trunk and forks.
  const ends = [];
  const grow = (p, d, L, r, depth) => {
    const segs = 4, pts = [p], rs = [r];
    let q = p, dir = d;
    for (let i = 1; i <= segs; i++) {
      dir = norm(add(dir, [rand.gauss() * 0.12, 0.05, rand.gauss() * 0.12]));
      q = madd(q, dir, L / segs);
      pts.push(q); rs.push(r * (1 - 0.25 * i / segs));
    }
    b.tube(pts, rs, { color: [...bark, 0.1], sides: 6, wind: pts.map((_, i) => [0.15 * depth + 0.1 * i / segs, 0.4 + depth * 0.1]), shade: pts.map(() => 0.75) });
    if (depth >= 3 || (depth >= 1 && rand() < 0.25)) { ends.push({ p: q, dir, depth }); return; }
    const k = rand() < 0.5 ? 2 : 3;
    for (let i = 0; i < k; i++) {
      const a = rand() * Math.PI * 2, spread = rand.range(0.45, 0.8);
      grow(q, norm([Math.cos(a) * spread, 1, Math.sin(a) * spread]), L * rand.range(0.55, 0.8), r * 0.72, depth + 1);
    }
  };
  grow([0, 0.8, 0], [rand.gauss() * 0.1, 1, rand.gauss() * 0.1], H * 0.3, 0.1, 0);
  const green = lin(76, 98, 52), dark = lin(58, 80, 44), dry = lin(146, 124, 82);
  let area = 0;
  for (const e of ends) {
    const nL = Math.round(rand.range(40, 54));
    const phase = rand();
    for (let k = 0; k < nL; k++) {
      const u = k / (nL - 1);                           // 0 youngest (upright) .. 1 oldest (hanging)
      const az = k * (2 * Math.PI / 3 + 0.08);         // three-ranked spiral, the "screw"
      const out = [Math.cos(az), 0, Math.sin(az)];
      const L = rand.range(0.9, 1.4) * (H / 4) * (0.8 + 0.3 * u);
      const el0 = (78 - 80 * u + rand.range(-8, 8)) * Math.PI / 180;
      const droop = rand.range(0.5, 1.0) * (0.4 + 1.1 * u);
      const pts = [];
      let p = madd(e.p, [0, 1, 0], -0.06 * u);
      const segs = 5;
      for (let i = 0; i <= segs; i++) {
        const t = i / segs;
        if (i > 0) {
          const el = el0 - droop * t * t * 1.6;
          p = madd(p, [out[0] * Math.cos(el), Math.sin(el), out[2] * Math.cos(el)], L / segs);
        }
        pts.push(p);
      }
      const w = rand.range(0.065, 0.09);
      const col = u > 0.9 && rand() < 0.4 ? mixc(green, dry, 0.8) : mixc(green, dark, rand());
      b.strap(pts, pts.map((_, i) => w * (1 - Math.pow(i / segs, 2.2) * 0.95)), pts.map(() => norm(add([0, 1, 0], mul(out, -0.3)))), {
        colors: pts.map((_, i) => mixc(col, mixc(col, dry, 0.25), i / segs)), wind: pts.map((_, i) => [0.3 + 0.7 * i / segs, phase]),
        leafPhase: rand(), shade: pts.map(() => 0.6 + 0.4 * (1 - u)), gloss: 0.55, fold: 0.45, trans: 0.3,
      });
      area += L * w * 0.6;
    }
  }
  const crownC = [0, H * 0.72, 0], crownR = [H * 0.5, H * 0.3, H * 0.5];
  return {
    builder: b, height: H, radius: H * 0.6, crownC, crownR, density: 0.6, leafArea: area, trans: 0.3, gloss: 0.55,
    wind: { freq: 1.1, stiff: 0.03, branchAmp: 0.12, branchFreq: 2.0, leafAmp: 0.03, leafFreq: 6 },
  };
}

// ---------------------------------------------------------------- hanging scrub
// What clings to the ledges and the rims of the faces: stems that grow out over the edge and
// trail down the rock in curtains of small leaves. Plant space: +x is out from the rock (the
// scatter turns it to face out), and most of it hangs below its foot.
export function creeper(seed, o = {}) {
  const rand = rng(seed * 67 + 13);
  const H = o.height ?? rand.range(2, 3.2);
  // A curtain out and down the face, and a small mound on the ledge itself.
  const crownC = [0.42 * H, -0.3 * H, 0], crownR = [0.4 * H, 0.55 * H, 0.65 * H];
  const hang = crownPoints(Math.round(rand.range(190, 240)), crownC, crownR, rand, { bias: 3 })
    .filter((p) => p[0] > 0.1 + 0.25 * Math.max(0, p[1]) / H)
    .map((p) => [p[0], p[1], p[2]]);
  const mound = crownPoints(Math.round(rand.range(35, 50)), [0.15 * H, 0.12 * H, 0], [0.3 * H, 0.16 * H, 0.45 * H], rand, { bias: 2.5, floorY: 0.02 });
  const targets = hang.concat(mound);
  const { branches, tips } = growToTargets(targets, {
    root: [0, 0.05, 0], rootDir: [1, 0.25, 0], trunk: 0, reach: 0.4, twigAt: 1, maxLevel: 9,
    radius: 0.025, tipRadius: 0.003, pipe: 2.3, bendUp: -0.25, sag: 0.9, crownC, crownR, lengthScale: H,
  }, rand);
  const b = new PlantBuilder({ light: !!o.light });
  const bark = lin(128, 118, 96);
  for (const br of branches) {
    const n = br.pts.length;
    b.tube(br.pts, br.r, {
      color: [...bark, 0.2], sides: br.r[0] > 0.01 ? 4 : 3,
      wind: br.pts.map((_, i) => [br.amp0 + (br.amp1 - br.amp0) * i / (n - 1), br.phase]),
      shade: br.pts.map((p) => shadeAt(p, crownC, crownR) * 0.8),
    });
  }
  const green = lin(64, 90, 46), deep = lin(48, 72, 40), light = lin(80, 102, 52);
  let area = 0;
  for (const t of tips) {
    // Sprays hang: out from the tip, turned down.
    const n = Math.round(rand.range(4, 6));
    const side0 = perp(t.dir);
    for (let k = 0; k < n; k++) {
      const around = rotate(side0, t.dir, rand() * Math.PI * 2);
      const dir = norm(add(add(mul(t.dir, 0.5), mul(around, 0.6)), [0.25, -0.55, 0]));
      const L = rand.range(0.28, 0.42);
      const faceUp = norm(add([0.7, 0.6, 0], mul(around, 0.3)));
      const tint = rand.range(-1, 1);
      const c = mixc(green, tint > 0 ? light : deep, Math.abs(tint) * 0.8);
      b.leafBlade(t.p, dir, faceUp, L, L * 0.5, {
        color: [...c, 0.35], wind: [t.amp, t.phase], leafPhase: rand(), shade: t.shade, cell: LEAF.SPRAY_SMALL,
        gloss: 0.45, fold: 0.1, droop: L * 0.25, cup: 0.35, arch: 0.3,
      });
      area += L * L * 0.25;
    }
  }
  const volume = (4 / 3) * Math.PI * crownR[0] * crownR[1] * crownR[2];
  return {
    builder: b, height: H, radius: H * 0.75, crownC, crownR,
    density: 0.5 * area / volume * 0.7, leafArea: area, trans: 0.35, gloss: 0.45,
    wind: { freq: 1.3, stiff: 0.0, branchAmp: 0.08, branchFreq: 2.4, leafAmp: 0.015, leafFreq: 8 },
  };
}

export const GROWERS = { scaevola, grass, tree, palm, pandanus, creeper };
