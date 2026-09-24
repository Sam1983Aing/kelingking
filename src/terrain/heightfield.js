// Builds the Kelingking heightfield from the OSM outlines (geo.js) and the hand-tuned
// shape (layout.js). Pure data in, Float32Array out, so it runs in the page or in node.
//
// How a land height is made:
//   1. A top surface: the island plateau, blended into a ridge along the spine of the finger.
//   2. Below each OSM cliff-top line the surface drops away over a zone-dependent width,
//      sheer on the head and the jaw, a steep slope where the trail comes down.
//   3. Whatever is left between the cliff foot and the water is beach.
//   4. Right at the waterline everything is pulled down to sea level.

import { COAST, ISLANDS, CLIFFS, PEAKS } from './geo.js';

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

  const dCoast = signedDistance(land, N, cell).sd;
  const cliff = signedDistance(high, N, cell);
  const dCliff = cliff.sd;

  const noise = makeNoise(layout.noise.seed);
  const spine = buildSpine(layout.spinePath, layout.spine);
  const spurs = layout.spurs.map((sp) => buildSpine(sp.path, sp.path.map((at, i) => ({ at, h: sp.h[i], w: sp.w, p: sp.p }))));
  const tRoot = spine.nearest(layout.root[0], layout.root[1], { d: 0, t: 0 }).t;
  const peaks = PEAKS.filter((p) => p.ele > 120);
  const { plateau, beach, defaults, zones, islets } = layout;
  const nz = layout.noise;

  const H = new Float32Array(N * N);
  const TOP = new Float32Array(N * N);
  const near = { d: 0, t: 0 };
  const probe = { d: 0, t: 0 };

  // Pass 1: the top surface (plateau blended into the finger ridges) for every land pixel.
  for (let j = 0; j < N; j++) {
    const y = Y(j);
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      if (!land[k] || isle[k]) continue;
      const x = X(i);
      let top = plateau.base;
      for (const p of peaks) {
        const r2 = ((x - p.p[0]) ** 2 + (y - p.p[1]) ** 2) / plateau.sigma ** 2;
        top += (p.ele - plateau.base) * Math.exp(-r2);
      }
      top += fbm(noise, x / 160, y / 160, 3) * plateau.noise;
      for (const d of layout.dips) top += d.dh * Math.exp(-((x - d.at[0]) ** 2 + (y - d.at[1]) ** 2) / (d.r * d.r));
      const dk0 = dCliff[k];
      top *= lerp(plateau.shoulder, 1, smooth(0, plateau.shoulderW, dk0));

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

  // Pass 2: cliffs, beaches, seabed.
  for (let j = 0; j < N; j++) {
    const y = Y(j);
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const x = X(i);
      const z = blendZones(zones, defaults, x, y);
      // In beach zones the sand runs a little past the mapped waterline.
      const sandW = smooth(0, 0.7, z.sand);
      const dc = dCoast[k] + beach.shift * sandW;

      if (dc <= 0) {
        // Seabed. Shallow shelves in the coves, a fast drop off the cliffs.
        const depth = z.D * (1 - Math.exp(dc / z.L)) + Math.abs(noise(x * 0.02, y * 0.02)) * Math.min(1.5, -dc * 0.05);
        H[k] = -Math.max(depth, 0.5 * smooth(0, 3, -dc) + 0.05);
        continue;
      }

      if (isle[k]) {
        const islet = nearestIslet(islets, x, y);
        const dome = 1 - (1 - Math.min(dc / 26, 1)) ** 2;
        const h = islet.h * (0.74 * smooth(0, 5, dc) + 0.26 * dome);
        H[k] = h + noise(x * 0.05, y * 0.05) * 1.5 * smooth(0, 8, dc);
        continue;
      }

      const top = TOP[k];
      const face = z.face * (1 + noise(x / 30, y / 30 + 9) * nz.faceJitter);

      // Rock: the drop happens right at the waterline.
      const v = Math.min(dc / face, 1);
      const rock = top * (1 - (1 - v) ** (1 / z.pf));

      // Beach zones: below the OSM cliff-top line the face falls from the height of the
      // nearest cliff-top point, and whatever is left before the water is sand.
      let cove = top;
      const dk = dCliff[k] + noise(x / 15 + 3, y / 15) * nz.edgeJitter;
      if (dk < 0) {
        const edge = TOP[cliff.nearestIn[k]] || top;
        cove = edge * (1 - Math.min(-dk / face, 1)) ** z.pf;
      }
      const sand = 0.3 + beach.top * (1 - Math.exp(-dc / beach.spread));
      cove = Math.max(cove, sand);

      let h = lerp(rock, cove, sandW);
      h = Math.min(h, 0.3 + dc * 40); // meet the water
      H[k] = h;
    }
  }

  const ms = Math.round(performance.now() - t0);
  return { heights: H, N, cell, extent: layout.extent, land, ms };
}

// ---------------------------------------------------------------- helpers

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
const FIELDS = ['sand', 'face', 'pf', 'L', 'D'];
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

// Signed distance in metres, positive inside the mask. Exact Euclidean transform
// (Felzenszwalb and Huttenlocher), run once for each side. For pixels outside the mask
// it also records the index of the nearest pixel inside it.
function signedDistance(mask, N, cell) {
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
