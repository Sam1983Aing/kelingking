// Builds the Kelingking heightfield from the OSM outlines (geo.js) and the hand-tuned
// shape (layout.js). Pure data in, typed arrays out, so it runs in the page or in node.
//
// How a land height is made:
//   1. A top surface: the island plateau, blended into a ridge along the spine of the finger.
//   2. Below each OSM cliff-top line the surface drops away over a zone-dependent width,
//      sheer on the head and the jaw, a steep slope where the trail comes down.
//   3. Whatever is left between the cliff foot and the water is beach.
//   4. Right at the waterline everything is pulled down to sea level.
//
// The inputs to those steps are all smooth fields (distances, the top surface, zone
// parameters), stored on the grid. The steps themselves are sharp, so the height is not:
// heightAt(x, y) samples the smooth fields and applies the steps at any point, which is
// what lets the mesh builder put vertices exactly on a cliff face instead of interpolating
// between grid samples that straddle it.

import { COAST, ISLANDS, CLIFFS, PEAKS } from './geo.js';
import { buildRoute } from '../trail/route.js';
import { buildCarve } from '../trail/carve.js';

const INF = 1e20;

export function generateHeightfield(layout, N = 2048) {
  const t0 = performance.now();
  const { x0, y0, size } = layout.extent;
  const cell = size / N;
  const X = (i) => x0 + (i + 0.5) * cell;
  const Y = (j) => y0 + (j + 0.5) * cell;

  // Land / sea, and high ground / low ground (inland of the cliff tops or not).
  const far = 50000;
  const coastRing = [...COAST, [COAST.at(-1)[0] + far, COAST.at(-1)[1]], [far, far], [-far, far], [-far, COAST[0][1]]];
  const cliffChain = CLIFFS[0].concat(CLIFFS[1].slice(1));
  const cliffRing = [...cliffChain, [cliffChain.at(-1)[0] + far, cliffChain.at(-1)[1]], [far, far], [-far, far], [-far, cliffChain[0][1]]];

  const land = fill([coastRing], N, x0, y0, cell);
  const isle = fill(ISLANDS, N, x0, y0, cell);
  for (let k = 0; k < land.length; k++) land[k] |= isle[k];
  const high = fill([cliffRing], N, x0, y0, cell);

  // Distances to a rasterised outline carry the pixel staircase with them. A light blur
  // takes it out, which matters where a sharp wave front or the swash edge follows them.
  const DC = blur(signedDistance(land, N, cell).sd, N, 2);
  // The same, blurred over about 5 m, for the rock faces: the mapped coast has sharp
  // corners, and a face dropped straight from a sharp corner is a sharp vertical edge (the
  // jaw's tip looked extruded). Blurring a distance field rounds its corners. Where the face
  // steps back from the water that leaves a little shelf at sea level, as real ones have.
  const DCR = blur(Float32Array.from(DC), N, Math.max(2, Math.round(6 / cell)));
  const cliff = signedDistance(high, N, cell);
  const DK = blur(cliff.sd, N, 2);
  const ISLE = new Float32Array(N * N);
  for (let k = 0; k < ISLE.length; k++) ISLE[k] = isle[k];

  const noise = makeNoise(layout.noise.seed);
  const spine = buildSpine(layout.spinePath, layout.spine);
  const spurs = layout.spurs.map((sp) => buildSpine(sp.path, sp.path.map((at, i) => ({ at, h: sp.h[i], w: sp.w, p: sp.p }))));
  const tRoot = spine.nearest(layout.root[0], layout.root[1], { d: 0, t: 0 }).t;
  const peaks = PEAKS.filter((p) => p.ele > 120);
  const { plateau, beach, defaults, zones, islets } = layout;
  const nz = layout.noise;
  const near = { d: 0, t: 0 };
  const probe = { d: 0, t: 0 };

  // Zone parameters on the grid.
  const F = { sand: new Float32Array(N * N), murk: new Float32Array(N * N), face: new Float32Array(N * N),
    pf: new Float32Array(N * N), D: new Float32Array(N * N), L: new Float32Array(N * N), btop: new Float32Array(N * N) };
  const zoneDefaults = { ...defaults, btop: beach.top };
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const z = blendZones(zones, zoneDefaults, X(i), Y(j));
      F.sand[k] = smooth(0, 0.7, z.sand);
      F.murk[k] = z.murk; F.face[k] = z.face; F.pf[k] = z.pf; F.D[k] = z.D; F.L[k] = z.L; F.btop[k] = z.btop;
    }
  }

  // The top surface (plateau blended into the finger ridges). It is needed a little way
  // out to sea too, so that sampling it between texels on the coast is not dragged to zero.
  const TOP = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const y = Y(j);
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (DC[k] < -40 || isle[k]) continue;
      const x = X(i);
      let top = plateau.base;
      for (const p of peaks) {
        const r2 = ((x - p.p[0]) ** 2 + (y - p.p[1]) ** 2) / plateau.sigma ** 2;
        top += (p.ele - plateau.base) * Math.exp(-r2);
      }
      top += fbm(noise, x / 160, y / 160, 3) * plateau.noise;
      for (const d of layout.dips) top += d.dh * Math.exp(-((x - d.at[0]) ** 2 + (y - d.at[1]) ** 2) / (d.r * d.r));
      top *= lerp(plateau.shoulder, 1, smooth(0, plateau.shoulderW, DK[k]));

      if (spine.inBox(x, y)) {
        spine.nearest(x, y, near);
        const s = spine.at(near.t);
        let ridge = s.h * (1 - Math.min(near.d / s.w, 1) ** s.p);
        for (const sp of spurs) {
          sp.nearest(x, y, probe);
          const q = sp.at(probe.t);
          ridge = Math.max(ridge, q.h * (1 - Math.min(probe.d / q.w, 1) ** q.p));
        }
        // The finger starts at the root. Next to the root the plateau carries on beside
        // it, so fade the ridge out sideways there, but not further along the finger.
        const along = smooth(tRoot - 30, tRoot + 10, near.t);
        const nearRoot = 1 - smooth(tRoot + 10, tRoot + 60, near.t);
        const lateral = 1 - smooth(s.w * 1.1, s.w * 1.8, near.d) * nearRoot;
        top = lerp(top, ridge, along * lateral);
      }
      TOP[k] = top + fbm(noise, x / 45 + 11, y / 45, 3) * nz.broad * 0.4 + fbm(noise, x / 9, y / 9 + 5, 3) * nz.fine;
    }
  }

  // Height of the cliff top that a beach wall hangs from: the top surface at the nearest
  // point on the cliff-top line. Nearest-point lookups jump between neighbours, so blur it.
  const EDGE = new Float32Array(N * N);
  for (let k = 0; k < EDGE.length; k++) EDGE[k] = DK[k] < 0 ? TOP[cliff.nearestIn[k]] || TOP[k] : TOP[k];
  blur(EDGE, N, 3);

  // The foot of the wall behind the beach, where the drone photo says it is (beach.back).
  const B = beachBack(layout.beach.back, N, x0, y0, cell);

  const fields = { N, cell, x0, y0, DC, DCR, DK, TOP, EDGE, ISLE, ...B, ...F };
  let heightAt = makeHeightAt(fields, layout, noise);
  // The path cut into it (src/trail/, v6): the route's design heights come from the ground as
  // it was, and the carve is added on top, so everything built from heightAt after this (the
  // grid, the faces, the plants) stands on the carved ground.
  let trail = null;
  if (layout.trail) {
    const natural = heightAt;
    const route = buildRoute(layout.trail, natural);
    const carve = buildCarve(route, natural, layout.trail.bank, layout.trail.pads);
    heightAt = (x, y) => natural(x, y) + carve.at(x, y);
    trail = { route, carve, natural };
  }

  const H = new Float32Array(N * N);
  const SHORE = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      H[k] = heightAt(X(i), Y(j));
      SHORE[k] = DC[k] + beach.shift * F.sand[k];
    }
  }

  // The face field: signed distance to the middle of every cliff face and steep slope
  // (where the ground is at half the height of the top it falls from), positive inland.
  // One field for rock and beach walls alike, so the mesh builder can cross every face at
  // right angles without switching between the coast and the cliff-top line.
  const mid = new Uint8Array(N * N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const ref = isle[k] ? nearestIslet(islets, X(i), Y(j)).h : TOP[k];
      mid[k] = H[k] > 0.5 * Math.max(ref, 16) ? 1 : 0;
    }
  }
  fields.PSI = blur(signedDistance(mid, N, cell).sd, N, 2);
  // The highest the face field gets within 45 m: on a ridge, how far its crest is from the
  // faces either side. The mesh builder stops short of it.
  fields.PSIMAX = blur(dilate(fields.PSI, N, Math.round(45 / cell)), N, Math.round(8 / cell));

  const ms = Math.round(performance.now() - t0);
  return { heights: H, shore: SHORE, sand: F.sand, murk: F.murk, fields, heightAt, trail, N, cell, extent: layout.extent, land, ms };
}

// Height at any point, from the smooth fields. Same steps as described at the top.
export function makeHeightAt(f, layout, noise) {
  const { N, cell, x0, y0 } = f;
  const { beach, islets } = layout;
  const nz = layout.noise;
  let i0 = 0, i1 = 0, i2 = 0, i3 = 0, w0 = 0, w1 = 0, w2 = 0, w3 = 0;
  const at = (a) => a[i0] * w0 + a[i1] * w1 + a[i2] * w2 + a[i3] * w3;

  return function heightAt(x, y) {
    const fi = (x - x0) / cell - 0.5, fj = (y - y0) / cell - 0.5;
    const i = Math.max(0, Math.min(N - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
    const u = Math.min(Math.max(fi - i, 0), 1), v = Math.min(Math.max(fj - j, 0), 1);
    i0 = j * N + i; i1 = i0 + 1; i2 = i0 + N; i3 = i2 + 1;
    w0 = (1 - u) * (1 - v); w1 = u * (1 - v); w2 = (1 - u) * v; w3 = u * v;

    const sandW = at(f.sand);
    const dc = at(f.DC) + beach.shift * sandW;
    const dcr = Math.min(at(f.DCR) + beach.shift * sandW, dc);

    if (dc <= 0) {
      // Seabed. Shallow shelves in the coves, a fast drop off the cliffs.
      const D = at(f.D), L = at(f.L);
      const depth = D * (1 - Math.exp(dc / L)) + Math.abs(noise(x * 0.02, y * 0.02)) * Math.min(1.5, -dc * 0.05);
      return -Math.max(depth, -dc * 0.03);
    }

    if (at(f.ISLE) > 0.5) {
      // A sheer foot and a rounded crown. How much of the height is sheer changes around the
      // islet (sheer on the side facing `sheerAz`, a steep wooded dome on the far side), and
      // the crown is lumpy rather than a flat lid.
      const islet = nearestIslet(islets, x, y);
      const az = Math.atan2(y - islet.near[1], x - islet.near[0]);
      const sheer = Math.min(Math.max(islet.sheer + islet.sheerVar * Math.cos(az - (islet.sheerAz * Math.PI) / 180)
        + 0.12 * noise(x / 25 + 5, y / 25), 0.1), 0.85);
      const u = Math.min(dc / islet.R, 1);
      const crown = (1 - (1 - u) ** 2) * (1 + 0.06 * noise(x / 18 + 2, y / 18 - 4));
      // The sheer part leans back a little and bends over into the crown (it rises over 14 m,
      // steepest at the bottom), so the top edge is rounded, not a rim.
      const rise = 1 - (1 - Math.min(dc / 14, 1)) ** 2;
      const h = islet.h * (sheer * rise + (1 - sheer) * crown);
      return h + noise(x * 0.05, y * 0.05) * 1.5 * smooth(0, 8, dc);
    }

    const top = at(f.TOP);
    const face = at(f.face) * (1 + noise(x / 30, y / 30 + 9) * nz.faceJitter);
    const pf = at(f.pf);
    const dk = at(f.DK) + noise(x / 15 + 3, y / 15) * nz.edgeJitter;
    const edge = at(f.EDGE);
    const btop = f.btop ? at(f.btop) : beach.top;
    // Behind the beach the wall comes down to the traced foot: its width is whatever lies
    // between the cliff-top line and that foot, and it stays steep to the bottom (the zones'
    // gentler profiles left a long toe that the sand ran up as a ramp).
    let faceC = face, pfC = pf;
    const wb = f.WB ? at(f.WB) * sandW : 0;
    if (wb > 0) {
      const db = at(f.DB) + noise(x / 9 + 7, y / 9 - 2) * 1.2;
      faceC = lerp(face, Math.max(-dk - db, 3), wb);
      pfC = lerp(pf, Math.min(pf, beach.backProfile), wb);
    }

    // The profile across the face, at a shift s along it. Rock: the drop happens right at
    // the waterline. Beach zones: below the OSM cliff-top line the face falls from the
    // height of the cliff top above, and whatever is left before the water is sand.
    const profile = (s) => {
      const vv = Math.min(Math.max((dcr + s) / face, 0), 1);
      const rock = top * (1 - (1 - vv) ** (1 / pf));
      let cove = top;
      if (dk + s < 0) cove = edge * (1 - Math.min(-(dk + s) / faceC, 1)) ** pfC;
      // The beach face: steep up to the berm (the highest the swash usually runs), then a
      // gentler rise behind it to the top of the beach.
      const hb = Math.min(beach.berm, btop), xs = Math.max(dc + s, 0);
      const sand = hb * (1 - Math.exp(-xs / beach.face)) + (btop - hb) * (1 - Math.exp(-xs / beach.spread));
      cove = Math.max(cove, sand);
      return Math.min(lerp(rock, cove, sandW), (dc + s) * 40); // meet the water
    };
    // Rims and the feet of the walls are creases in that profile. Averaged over a couple
    // of metres across the face they become rounded edges, which a mesh can follow without
    // cutting teeth into them.
    // Not across the waterline, where the seabed takes over: faded out there instead.
    const nearRim = dcr < face + 2.2 || (sandW > 0.01 && dk > -faceC - 2.2 && dk < 2.2);
    const h0 = profile(0);
    if (!nearRim || dc < 1.2) return h0;
    const d = 0.55;
    const avg = (profile(-2 * d) + 4 * profile(-d) + 6 * h0 + 4 * profile(d) + profile(2 * d)) / 16;
    return lerp(h0, avg, smooth(1.2, 2.3, dc));
  };
}

// ---------------------------------------------------------------- helpers

// Signed distance to the traced foot of the wall behind the beach (DB, positive on the sand
// side, which is to the right walking along the line), and how much it applies (WB: fading
// out over 15 m at each end of the line and from 45 to 70 m away from it). The line is
// smoothed first (Chaikin), so the foot does not have corners.
function beachBack(line, N, x0, y0, cell) {
  if (!line || line.length < 2) return {};
  let pts = line;
  for (let it = 0; it < 3; it++) {
    const q = [pts[0]];
    for (let k = 0; k + 1 < pts.length; k++) {
      const [a, b] = [pts[k], pts[k + 1]];
      q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1]], [0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1]]);
    }
    q.push(pts.at(-1));
    pts = q;
  }
  const seg = [];
  let total = 0;
  for (let k = 0; k + 1 < pts.length; k++) {
    const [ax, ay] = pts[k], [bx, by] = pts[k + 1];
    const len = Math.hypot(bx - ax, by - ay);
    seg.push({ ax, ay, dx: (bx - ax) / len, dy: (by - ay) / len, len, at: total });
    total += len;
  }
  const minX = Math.min(...pts.map((p) => p[0])) - 80, maxX = Math.max(...pts.map((p) => p[0])) + 80;
  const minY = Math.min(...pts.map((p) => p[1])) - 80, maxY = Math.max(...pts.map((p) => p[1])) + 80;
  const DB = new Float32Array(N * N), WB = new Float32Array(N * N);
  for (let j = 0; j < N; j++) {
    const y = y0 + (j + 0.5) * cell;
    if (y < minY || y > maxY) continue;
    for (let i = 0; i < N; i++) {
      const x = x0 + (i + 0.5) * cell;
      if (x < minX || x > maxX) continue;
      let best = Infinity, side = 0, along = 0;
      for (const g of seg) {
        const t = Math.min(Math.max((x - g.ax) * g.dx + (y - g.ay) * g.dy, 0), g.len);
        const px = x - (g.ax + g.dx * t), py = y - (g.ay + g.dy * t);
        const d = px * px + py * py;
        if (d < best) { best = d; side = g.dx * py - g.dy * px; along = g.at + t; }
      }
      const d = Math.sqrt(best);
      const k = j * N + i;
      DB[k] = side < 0 ? d : -d;
      WB[k] = smooth(0, 15, along) * smooth(0, 15, total - along) * (1 - smooth(45, 70, d));
    }
  }
  return { DB, WB };
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;

function nearestIslet(islets, x, y) {
  let best = islets[0], bd = Infinity;
  for (const s of islets) {
    const d = (x - s.near[0]) ** 2 + (y - s.near[1]) ** 2;
    if (d < bd) { bd = d; best = s; }
  }
  return best;
}

// Gaussian-weighted blend of zone parameters. Each field only blends among the zones
// that set it, and fades to the default away from them.
const FIELDS = ['sand', 'murk', 'face', 'pf', 'L', 'D', 'btop'];
const zoneW = new Float64Array(64);
const zoneOut = {};
function blendZones(zones, defaults, x, y) {
  for (let i = 0; i < zones.length; i++) {
    const z = zones[i];
    zoneW[i] = Math.exp(-((x - z.at[0]) ** 2 + (y - z.at[1]) ** 2) / (z.r * z.r));
  }
  for (const f of FIELDS) {
    let sw = 0, sv = 0;
    for (let i = 0; i < zones.length; i++) {
      const v = zones[i][f];
      if (v === undefined) continue;
      sw += zoneW[i]; sv += zoneW[i] * v;
    }
    const w0 = Math.max(0, 1 - sw);
    zoneOut[f] = (sv + w0 * defaults[f]) / (sw + w0);
  }
  return zoneOut;
}

// Even-odd scanline fill of polygons, sampled at cell centres.
function fill(rings, N, x0, y0, cell) {
  const mask = new Uint8Array(N * N);
  const xs = [];
  for (let j = 0; j < N; j++) {
    const y = y0 + (j + 0.5) * cell;
    xs.length = 0;
    for (const ring of rings) {
      for (let i = 0, n = ring.length; i < n; i++) {
        const a = ring[i], b = ring[(i + 1) % n];
        if (a[1] > y !== b[1] > y) xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let m = 0; m + 1 < xs.length; m += 2) {
      const i0 = Math.max(0, Math.ceil((xs[m] - x0) / cell - 0.5));
      const i1 = Math.min(N - 1, Math.floor((xs[m + 1] - x0) / cell - 0.5));
      for (let i = i0; i <= i1; i++) mask[j * N + i] = 1;
    }
  }
  return mask;
}

// Largest value within a square of radius r texels (separable running maximum).
export function dilate(src, N, r) {
  const out = new Float32Array(N * N), tmp = new Float32Array(N * N);
  const pass = (a, b, stride, step) => {
    const q = new Int32Array(N);
    for (let line = 0; line < N; line++) {
      const base = line * stride;
      let head = 0, tail = 0;
      for (let i = 0, j = 0; i < N; i++) {
        // Window [i - r, i + r]: push up to i + r, drop below i - r.
        for (; j <= Math.min(N - 1, i + r); j++) {
          const v = a[base + j * step];
          while (tail > head && a[base + q[tail - 1] * step] <= v) tail--;
          q[tail++] = j;
        }
        while (q[head] < i - r) head++;
        b[base + i * step] = a[base + q[head] * step];
      }
    }
  };
  pass(src, tmp, N, 1);
  pass(tmp, out, 1, N);
  return out;
}

// Two passes of a separable box blur of radius r texels (close to a Gaussian).
export function blur(f, N, r) {
  const tmp = new Float32Array(N);
  const w = 2 * r + 1;
  for (let pass = 0; pass < 2; pass++) {
    for (let j = 0; j < N; j++) {
      const row = j * N;
      let acc = 0;
      for (let i = -r; i <= r; i++) acc += f[row + Math.min(N - 1, Math.max(0, i))];
      for (let i = 0; i < N; i++) {
        tmp[i] = acc / w;
        acc += f[row + Math.min(N - 1, i + r + 1)] - f[row + Math.max(0, i - r)];
      }
      f.set(tmp, row);
    }
    for (let i = 0; i < N; i++) {
      let acc = 0;
      for (let j = -r; j <= r; j++) acc += f[Math.min(N - 1, Math.max(0, j)) * N + i];
      for (let j = 0; j < N; j++) {
        tmp[j] = acc / w;
        acc += f[Math.min(N - 1, j + r + 1) * N + i] - f[Math.max(0, j - r) * N + i];
      }
      for (let j = 0; j < N; j++) f[j * N + i] = tmp[j];
    }
  }
  return f;
}

// Signed distance in metres, positive inside the mask. Exact Euclidean transform
// (Felzenszwalb and Huttenlocher), run once for each side. For pixels outside the mask
// it also records the index of the nearest pixel inside it.
export function signedDistance(mask, N, cell) {
  const inside = new Float32Array(N * N);
  const outside = new Float32Array(N * N);
  for (let k = 0; k < mask.length; k++) {
    inside[k] = mask[k] ? INF : 0;
    outside[k] = mask[k] ? 0 : INF;
  }
  edt2d(inside, N, null);
  const nearestIn = new Int32Array(N * N);
  edt2d(outside, N, nearestIn);
  const sd = new Float32Array(N * N);
  for (let k = 0; k < mask.length; k++) {
    sd[k] = mask[k] ? (Math.sqrt(inside[k]) - 0.5) * cell : -(Math.sqrt(outside[k]) - 0.5) * cell;
  }
  return { sd, nearestIn };
}

function edt2d(g, N, nearest) {
  const f = new Float64Array(N), d = new Float64Array(N), v = new Int32Array(N), z = new Float64Array(N + 1), arg = new Int32Array(N);
  const rowOf = nearest ? new Int32Array(N * N) : null;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) f[j] = g[j * N + i];
    edt1d(f, d, v, z, N, arg);
    for (let j = 0; j < N; j++) { g[j * N + i] = d[j]; if (rowOf) rowOf[j * N + i] = arg[j]; }
  }
  for (let j = 0; j < N; j++) {
    const row = j * N;
    for (let i = 0; i < N; i++) f[i] = g[row + i];
    edt1d(f, d, v, z, N, arg);
    for (let i = 0; i < N; i++) { g[row + i] = d[i]; if (nearest) nearest[row + i] = rowOf[row + arg[i]] * N + arg[i]; }
  }
}

function edt1d(f, d, v, z, n, arg) {
  let k = 0;
  v[0] = 0; z[0] = -INF; z[1] = INF;
  for (let q = 1; q < n; q++) {
    let s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    while (s <= z[k]) {
      k--;
      s = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
    }
    k++; v[k] = q; z[k] = s; z[k + 1] = INF;
  }
  k = 0;
  for (let q = 0; q < n; q++) {
    while (z[k + 1] < q) k++;
    d[q] = (q - v[k]) ** 2 + f[v[k]];
    arg[q] = v[k];
  }
}

// Spine: the path resampled every 4 m and smoothed, with heights and cross-section
// parameters interpolated by arc length between the control points.
function buildSpine(path, controls) {
  let pts = resample(path, 4);
  for (let it = 0; it < 6; it++) pts = pts.map((p, i) => (i === 0 || i === pts.length - 1 ? p : [(pts[i - 1][0] + 2 * p[0] + pts[i + 1][0]) / 4, (pts[i - 1][1] + 2 * p[1] + pts[i + 1][1]) / 4]));
  const len = [0];
  for (let i = 1; i < pts.length; i++) len.push(len[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));

  const probe = { d: 0, t: 0 };
  const nearest = (x, y, out) => {
    let bd = Infinity, bt = 0;
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const ex = b[0] - a[0], ey = b[1] - a[1];
      const l2 = ex * ex + ey * ey;
      const u = Math.min(Math.max(((x - a[0]) * ex + (y - a[1]) * ey) / l2, 0), 1);
      const dx = x - (a[0] + u * ex), dy = y - (a[1] + u * ey);
      const d2 = dx * dx + dy * dy;
      if (d2 < bd) { bd = d2; bt = len[i - 1] + u * (len[i] - len[i - 1]); }
    }
    out.d = Math.sqrt(bd); out.t = bt;
    return out;
  };
  const ctl = controls.map((c) => ({ ...c, t: nearest(c.at[0], c.at[1], probe).t })).sort((a, b) => a.t - b.t);
  const at = (t) => {
    if (t <= ctl[0].t) return ctl[0];
    for (let i = 1; i < ctl.length; i++) {
      if (t <= ctl[i].t) {
        const a = ctl[i - 1], b = ctl[i];
        const u = smooth(0, 1, (t - a.t) / (b.t - a.t));
        return { h: lerp(a.h, b.h, u), w: lerp(a.w, b.w, u), p: lerp(a.p, b.p, u) };
      }
    }
    return ctl.at(-1);
  };
  const pad = 150;
  const bx0 = Math.min(...pts.map((p) => p[0])) - pad, bx1 = Math.max(...pts.map((p) => p[0])) + pad;
  const by0 = Math.min(...pts.map((p) => p[1])) - pad, by1 = Math.max(...pts.map((p) => p[1])) + pad;
  const inBox = (x, y) => x > bx0 && x < bx1 && y > by0 && y < by1;
  return { nearest, at, inBox, pts, length: len.at(-1) };
}

function resample(path, step) {
  const out = [path[0]];
  let carry = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let s = step - carry;
    while (s <= L) {
      out.push([a[0] + ((b[0] - a[0]) * s) / L, a[1] + ((b[1] - a[1]) * s) / L]);
      s += step;
    }
    carry = L - (s - step);
  }
  out.push(path.at(-1));
  return out;
}

// 2D gradient noise in [-1, 1] and a small fbm on top of it.
export function makeNoise(seed) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256).map((_, i) => i);
  let s = seed * 2654435761 >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const r = s % (i + 1);
    [p[i], p[r]] = [p[r], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const G = [[1, 1], [-1, 1], [1, -1], [-1, -1], [1, 0], [-1, 0], [0, 1], [0, -1]];
  const grad = (h, x, y) => { const g = G[h & 7]; return g[0] * x + g[1] * y; };
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const X = xi & 255, Y = yi & 255;
    const aa = perm[perm[X] + Y], ab = perm[perm[X] + Y + 1], ba = perm[perm[X + 1] + Y], bb = perm[perm[X + 1] + Y + 1];
    const u = fade(xf), v = fade(yf);
    const x1 = lerp(grad(aa, xf, yf), grad(ba, xf - 1, yf), u);
    const x2 = lerp(grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v) * 1.4;
  };
}

export function fbm(noise, x, y, octaves) {
  let sum = 0, amp = 0.5, f = 1;
  for (let o = 0; o < octaves; o++) {
    sum += amp * noise(x * f, y * f);
    f *= 2.03; amp *= 0.5;
  }
  return sum;
}
