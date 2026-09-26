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

  const b = new PlantBuilder();
  const bark = lin(120, 112, 94);
  const stemGreen = lin(104, 116, 78);
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
  const yellow = lin(150, 132, 62);
  const leafLen = o.leafLen ?? 0.15;
  let area = 0;
  for (const t of tips) {
    const axis = norm(add(mul(t.dir, 0.5), [0, 0.75, 0]));
    const n = Math.round(rand.range(11, 17));
    const rot0 = rand() * Math.PI * 2;
    const side0 = perp(axis);
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
      const old = age > 0.88 && rand() < 0.18;
      const tint = rand.range(-1, 1);
      let c = mixc(green, deep, clamp01(0.45 - 0.45 * tint));
      c = mixc(c, lin(84, 108, 56), (1 - age) * 0.4);      // young leaves are brighter
      if (old) c = mixc(c, yellow, rand.range(0.3, 0.75));
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
    leafArea: area,
    wind: { freq: 1.6, stiff: 0.08, branchAmp: 0.04, branchFreq: 3.6, leafAmp: 0.012, leafFreq: 11 },
  };
}

function shadeAt(p, c, R) {
  const r = len([(p[0] - c[0]) / R[0], (p[1] - c[1]) / R[1], (p[2] - c[2]) / R[2]]);
  const up = clamp01(0.5 + 0.5 * (p[1] - c[1]) / R[1]);
  return clamp01(smooth(0.15, 1.0, r) * (0.7 + 0.3 * up));
}

// ---------------------------------------------------------------- grass tussock
export function grass(seed, o = {}) {
  const rand = rng(seed * 13 + 5);
  const H = o.height ?? rand.range(0.45, 0.85);
  const n = Math.round(o.blades ?? rand.range(60, 90));
  const baseR = rand.range(0.03, 0.07);
  const green = lin(72, 96, 50), green2 = lin(92, 106, 56), dry = lin(150, 130, 92), baseCol = lin(56, 60, 38);
  const dryShare = o.dry ?? rand.range(0.1, 0.35);
  const lean = [rand.gauss() * 0.12, 0, rand.gauss() * 0.12];   // the whole tuft leans a little
  const b = new PlantBuilder();
  for (let i = 0; i < n; i++) {
    const az = rand() * Math.PI * 2;
    const out = [Math.cos(az), 0, Math.sin(az)];
    const r0 = baseR * Math.sqrt(rand());
    const base = [out[0] * r0, 0, out[2] * r0];
    // Inner blades stand up, outer ones arch out and over.
    const outer = r0 / baseR;
    const L = H * rand.range(0.65, 1.25) * (1.05 - 0.25 * outer) * 1.25;
    const el0 = (82 - 38 * outer - rand() * 14) * Math.PI / 180;   // start angle above horizontal
    const droop = rand.range(0.9, 1.9) * (0.6 + 0.8 * outer);      // how much it bends over by the tip
    const segs = 5;
    const pts = [], widths = [], faces = [], colors = [], wind = [];
    const w0 = rand.range(0.006, 0.011);
    const dryTip = rand() < dryShare ? rand.range(0.25, 0.8) : rand.range(0, 0.1);
    const deadBlade = rand() < 0.06;
    const hue = rand();
    let p = base;
    for (let s = 0; s <= segs; s++) {
      const t = s / segs;
      if (s > 0) {
        const el = el0 - droop * Math.pow(t, 1.4) * 0.9;
        const d = norm(add([out[0] * Math.cos(el), Math.sin(el), out[2] * Math.cos(el)], mul(lean, t)));
        p = madd(p, d, L / segs);
      }
      pts.push(p);
      widths.push(w0 * (1 - Math.pow(t, 1.6) * 0.95));
      // The blade's upper face looks up and in, toward the tuft's middle.
      faces.push(norm(add([0, 1, 0], mul(out, -0.6))));
      let c = mixc(green, green2, hue);
      c = mixc(baseCol, c, smooth(0, 0.18, t));
      c = mixc(c, dry, smooth(1 - dryTip, 1 - dryTip + 0.2, t) * (dryTip > 0.15 ? 1 : 0.4));
      if (deadBlade) c = mixc(c, dry, 0.85);
      colors.push(c);
      wind.push([Math.pow(t, 1.5), rand.range(0, 0.15) + i / n]);
    }
    b.strap(pts, widths, faces, {
      colors, wind, leafPhase: rand(), shade: pts.map((q, s) => 0.45 + 0.55 * smooth(0, 0.6, s / segs)),
      gloss: 0.35, fold: 0.5, trans: 0.55,
    });
  }
  return {
    builder: b, height: H * 1.1, radius: H * 1.0, crownC: [0, H * 0.45, 0], crownR: [H * 0.7, H * 0.55, H * 0.7], density: 1.2,
    wind: { freq: 2.2, stiff: 0.22, branchAmp: 0.06, branchFreq: 3.1, leafAmp: 0.006, leafFreq: 9 },
  };
}

export const GROWERS = { scaevola, grass };
