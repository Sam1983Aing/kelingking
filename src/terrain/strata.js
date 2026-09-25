// The limestone's bedding. One table, used twice: the mesh builder carves the big beds into
// the faces as real relief, and the ground shader reads the same beds for the fine layers,
// their colour and the shadows the ledges cast. Because both read one table, a ledge in the
// geometry and its band of colour always line up.
//
// A point's place in the stack is its height plus a gentle warp across the island (the beds
// dip and bend a little, they are not perfectly level): bedCoord = h + strataWarp(x, y).
// Everything is a function of bedCoord, sampled every 1/16 m.
//
// What the shader gets (terrain-mesh.js packs it, one texel per 1/16 m of bedCoord): the
// fine relief (m, outward) and its slope, each bed's brightness and warmth, the coarse
// relief (the part the mesh carries), hardness, the partings between beds (0 inside a bed,
// 1 in the slot between two), how much of the sky the ledges above leave (1 on a plain
// wall, down to about 0.2 deep under a lip), and the shadow of the ledges above for 16 sun
// steepnesses (shadowK below).

export const STRATA = { z0: -24, span: 256, n: 4096, seed: 5 };
export const SHADOW_ROWS = 16;
// Sun steepness against the face (tan of the sun's angle above the face's horizon,
// times the relief strength) per shadow row, on a log scale from grazing-high to low.
export const shadowK = (row) => 0.25 * Math.pow(2, row * 0.62);

// Gentle dip and warp of the beds, in metres added to the height. Written with sines only so
// that the shader's float maths gives the same answer as this.
export function strataWarp(x, y) {
  return 0.016 * x - 0.009 * y + 2.2 * Math.sin(x / 190 + 0.7) * Math.sin(y / 240 + 1.9) + 1.1 * Math.sin((x + y) / 97);
}

// How strongly the beds stand out at a place on the island (0.2 to 1): some stretches of
// face are sharply layered, some smoother. Also sines only, shared with the shader.
export function strataStrength(x, y) {
  const a = Math.sin(x / 23.7 + 1.3 * Math.sin(y / 31.1)) * Math.sin(y / 19.3 + 0.9 * Math.sin(x / 27.9));
  const b = Math.sin(x / 71.3 + y / 53.9 + 0.4);
  return Math.min(1, Math.max(0.2, 0.62 + 0.28 * a + 0.22 * b));
}

export function buildStrata() {
  const { z0, span, n, seed } = STRATA;
  const dz = span / n;
  const rand = mulberry32(seed);

  // Beds in packages of 3 to 14 m, each package of one character: massive hard limestone
  // that stands out in thick beds, or thin-bedded softer rock that weathers back. Between
  // two beds a parting of softer, marly rock a few centimetres to a few decimetres thick,
  // which the weather cuts back into a dark slot under the bed above: from a distance those
  // slots are the lines you see across the faces.
  const beds = [];
  let z = z0, pkg = 0;
  while (z < z0 + span) {
    const top = z + 3 + rand() * 11;
    const hard = rand();
    const thin = hard < 0.4;
    const tone = 0.88 + rand() * 0.22;
    const warm = rand();
    while (z < top) {
      const th = thin ? 0.2 + rand() * 0.5 : 0.6 + rand() * rand() * 2.6;
      const parting = (thin ? 0.05 : 0.08) + rand() * rand() * 0.28;
      beds.push({ z0: z, z1: z + th, pz: parting, pkg, pkgHard: hard, hard: clamp01(hard + (rand() - 0.5) * 0.5),
        cut: (0.08 + 0.3 * rand()) * (1.2 - 0.6 * hard),
        tone: tone * (0.93 + rand() * 0.14), warm: clamp01(warm + (rand() - 0.5) * 0.3) });
      z += th + parting;
    }
    pkg++;
  }

  const fine = new Float32Array(n), coarse = new Float32Array(n);
  const tone = new Float32Array(n), warm = new Float32Array(n), hard = new Float32Array(n);
  const part = new Float32Array(n);
  const pkgRelief = new Float32Array(n);
  let b = 0;
  for (let k = 0; k < n; k++) {
    const zz = z0 + (k + 0.5) * dz;
    while (b < beds.length - 1 && beds[b].z1 + beds[b].pz <= zz) b++;
    const bed = beds[b];
    const th = bed.z1 - bed.z0;
    // Inside the bed: a rounded nose, fullest a little above the middle. In the parting
    // above it: cut back, most in the middle of the parting, with a rounded lip on the bed
    // above and the bed below.
    let r, seam;
    if (zz < bed.z1) {
      const q = (zz - bed.z0) / th;
      const nose = Math.pow(Math.max(Math.sin(Math.PI * Math.pow(q, 0.8)), 0), 0.35);
      r = ((bed.hard - 0.5) * 0.2 + 0.05) * nose;
      seam = 0;
    } else {
      const q = (zz - bed.z1) / bed.pz;
      const next = beds[Math.min(b + 1, beds.length - 1)];
      const slot = Math.pow(Math.sin(Math.PI * q), 0.6);
      r = -Math.max(bed.cut, next.cut * 0.7) * slot;
      seam = slot;
    }
    fine[k] = r;
    part[k] = seam;
    tone[k] = bed.tone;
    warm[k] = bed.warm;
    hard[k] = bed.hard;
    // The package as a whole stands out or is cut back by up to about 0.9 m.
    pkgRelief[k] = (bed.pkgHard - 0.5) * 1.8;
  }
  // The mesh carries the packages, blurred to what 1 m triangles can draw. The shader
  // carries the rest.
  gaussian(pkgRelief, coarse, 0.9 / dz);
  const fineMean = new Float32Array(n);
  gaussian(fine, fineMean, 1.2 / dz);
  for (let k = 0; k < n; k++) fine[k] -= fineMean[k];

  // Shadow from the ledges above: for a point at bedCoord z and a sun steepness K, how far
  // (in metres, positive = shadowed) the highest ledge within 6 m above pokes through the
  // line to the sun. Only the fine relief casts it here: the coarse relief is carved into the
  // mesh, whose own shadows the mesh builder works out (the horizon per vertex). The shader
  // turns the margin into a soft edge.
  const total = fine;
  const shadow = new Float32Array(n * SHADOW_ROWS);
  const reach = Math.round(6 / dz);
  for (let row = 0; row < SHADOW_ROWS; row++) {
    const K = shadowK(row);
    for (let k = 0; k < n; k++) {
      let m = -1;
      for (let s = 1; s <= reach && k + s < n; s++) m = Math.max(m, total[k + s] - total[k] - (s * dz) / K);
      shadow[row * n + k] = m;
    }
  }

  // How much of the sky above each point sees past the ledges over it, in the vertical plane
  // (the beds run on sideways, so that plane is what matters): the lowest elevation at which
  // a ledge within 3 m above blocks it, as the cosine-weighted share of the upper sky.
  const occl = new Float32Array(n);
  const reachUp = Math.round(3 / dz);
  for (let k = 0; k < n; k++) {
    let e0 = Math.PI / 2;
    for (let s2 = 1; s2 <= reachUp && k + s2 < n; s2++) {
      const d = total[k + s2] - total[k];
      if (d > 0.005) e0 = Math.min(e0, Math.atan2(s2 * dz, d));
    }
    occl[k] = Math.sin(e0);
  }

  const slope = new Float32Array(n);
  for (let k = 0; k < n; k++) slope[k] = (fine[Math.min(n - 1, k + 1)] - fine[Math.max(0, k - 1)]) / (2 * dz);
  return { beds, fine, coarse, slope, tone, warm, hard, part, occl, shadow, dz };
}

// Coarse relief at a bedCoord, linearly interpolated (for the mesh builder).
export function coarseAt(S, bc) {
  const f = (bc - STRATA.z0) / S.dz - 0.5;
  const i = Math.max(0, Math.min(STRATA.n - 2, Math.floor(f)));
  const u = Math.min(Math.max(f - i, 0), 1);
  return S.coarse[i] * (1 - u) + S.coarse[i + 1] * u;
}

function gaussian(src, dst, sigma) {
  const r = Math.ceil(sigma * 3), w = [];
  let sum = 0;
  for (let i = -r; i <= r; i++) { const v = Math.exp(-(i * i) / (2 * sigma * sigma)); w.push(v); sum += v; }
  for (let k = 0; k < src.length; k++) {
    let acc = 0;
    for (let i = -r; i <= r; i++) acc += w[i + r] * src[Math.min(src.length - 1, Math.max(0, k + i))];
    dst[k] = acc / sum;
  }
}

const clamp01 = (v) => Math.min(1, Math.max(0, v));
const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
