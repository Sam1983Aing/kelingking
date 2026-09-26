// Where the plants go. Runs in the terrain worker, on the same height function as the mesh,
// so every plant sits on the surface. Plants grow on anything short of a sheer face, none on
// the sand or at the foot of the cliffs (salt spray), the odd bush on the ledges of the faces.
// Dense low scrub on the finger, broken by grassy openings; bigger trees further out on the
// plateau.
//
// Output: one Float32Array, STRIDE floats per plant:
//   x, height, z (world), scale, yaw, species, variant, tint (0..1, colour variation)
// Grass tussocks come in the same list (species GRASS). They are drawn only near the camera,
// so they are scattered only along the path, where the camera goes.

import { makeNoise, fbm } from '../terrain/heightfield.js';
import { padDistance } from '../trail/carve.js';

export const STRIDE = 8;

// The species, their variants' heights at scale 1 (src/veg/grow/species.js grows each to
// these), and whether they have an impostor (drawn far off) or are drawn only up close.
export const SPECIES = [
  { id: 'scaevola', heights: [1.3, 1.6, 1.95], impostor: true },
  { id: 'grass', heights: [0.5, 0.65, 0.8], impostor: false },
];
export const SP = { SCAEVOLA: 0, GRASS: 1, TREE: 2 };

export function scatterPlants(hf, layout, surfaceShift = null) {
  const t0 = performance.now();
  const { heightAt, fields: f } = hf;
  const { x0, y0, size } = hf.extent;
  const cfg = layout.plants;
  const noise = makeNoise(cfg.seed);
  const rand = mulberry32(cfg.seed * 7919);
  const out = [];
  const route = hf.trail?.route;
  const pads = layout.trail?.pads ?? [];
  const sample = (a, x, y) => {
    const fi = (x - f.x0) / f.cell - 0.5, fj = (y - f.y0) / f.cell - 0.5;
    const i = Math.max(0, Math.min(f.N - 2, Math.floor(fi))), j = Math.max(0, Math.min(f.N - 2, Math.floor(fj)));
    const u = fi - i, v = fj - j, k = j * f.N + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + f.N] * (1 - u) + a[k + f.N + 1] * u) * v;
  };
  const slopeAt = (px, py) => {
    const e = 0.8;
    const hx = (heightAt(px + e, py) - heightAt(px - e, py)) / (2 * e);
    const hy = (heightAt(px, py + e) - heightAt(px, py - e)) / (2 * e);
    return 1 / Math.hypot(hx, 1, hy);
  };
  // How much ground cover a place carries (0..1), before clearings: the same rules as the
  // ground shader's scrub mask.
  const coverAt = (px, py, h, up, n1) => {
    let veg = smooth(0.3, 0.46, up + (n1 - 0.5) * 0.25);
    veg *= smooth(6, 12, h + (n1 - 0.5) * 6);
    veg *= 1 - smooth(0.2, 0.5, sample(f.sand, px, py)) * (h < 12 ? 1 : 0.3);
    return veg;
  };
  // Scrub or grass: patches some tens of metres across where the bushes close up, and open
  // grassy ground between them.
  const scrubAt = (px, py) => smooth(0.4, 0.62, fbm(noise, px * 0.035 + 11, py * 0.035 - 4, 3) + 0.5);

  // ---------------------------------------------------------------- shrubs and trees
  // Near the finger the plants are small and packed, further out they are trees on a
  // coarser grid. Spacing blends between the two with distance from the summit.
  for (let y = y0 + 1; y < y0 + size - 1; ) {
    const rowNear = Math.hypot(0, y - cfg.focus[1]);
    let x = x0 + 1;
    const rowStep = lerp(cfg.nearSpacing, cfg.farSpacing, smooth(cfg.nearRadius, cfg.farRadius, rowNear));
    while (x < x0 + size - 1) {
      const dist = Math.hypot(x - cfg.focus[0], y - cfg.focus[1]);
      const far = smooth(cfg.nearRadius, cfg.farRadius, dist);
      const spacing = lerp(cfg.nearSpacing, cfg.farSpacing, far);
      const px = x + (rand() - 0.5) * spacing, py = y + (rand() - 0.5) * rowStep;
      x += spacing;

      if (sample(f.DC, px, py) < 2) continue;                 // sea
      // Keep the path clear (v6: the real corridor, src/trail/): nothing on the tread, and no
      // canopy over it or the handrail. The biggest a plant here can be sets how far off it
      // stands (trailClear metres per unit of scale, beyond the handrail).
      if (pads.some((p) => padDistance(p, px, py) < 0.8)) continue;   // nor on the platform
      if (route) {
        const q = route.nearest(px, py, 8);
        const most = lerp(cfg.nearScale, cfg.farScale, far) * 1.5;
        if (q && q.d < route.lerpAt(route.w, q) / 2 + 0.3 + cfg.trailClear * most) continue;
      }
      const h = heightAt(px, py);
      if (h < 4) continue;
      const up = slopeAt(px, py);
      const n1 = fbm(noise, px * 0.07, py * 0.07, 3) + 0.5;
      let veg = coverAt(px, py, h, up, n1);
      // The odd bush clinging to the faces, higher up.
      if (veg < 0.5 && h > 15 && rand() < cfg.ledgeChance * smooth(15, 45, h)) veg = 1;
      // Clearings, so the cover is not a uniform carpet.
      const clearing = smooth(0.62, 0.72, fbm(noise, px * 0.02 + 40, py * 0.02, 3) + 0.5);
      veg *= 1 - clearing * 0.85;
      // Scrub patches close up, the grassy ground between them carries the odd bush.
      const scrub = scrubAt(px, py);
      veg *= lerp(1, 0.18 + 0.82 * scrub, 1 - far);
      if (rand() > veg * cfg.density) continue;

      // Species and size: the naupaka on the finger, trees further out and in the hollows.
      const tree = far > 0.2 && rand() < 0.55 + 0.4 * far;
      const sp = tree ? SP.TREE : SP.SCAEVOLA;
      const variant = Math.floor(rand() * 3);
      const nominal = tree ? 4.2 : SPECIES[SP.SCAEVOLA].heights[variant];
      const base = tree ? lerp(0.6, 1.0, far) * (0.7 + 0.6 * rand()) : 0.55 + 0.55 * rand() * rand() + 0.2 * scrub;
      let scale = base * (0.85 + 0.3 * up);
      // Views from the path stay open (v6): a plant's top stays under the eye line of someone on
      // the tread, falling away at about 12 degrees past 6 m, or is scrub (1.6 m) beside the
      // path. In the photos the slopes beside the steps and along the ridge are scrub and dry
      // grass, and the views from the steps down to the beach are open.
      if (route) {
        const q = route.nearest(px, py, 26);
        if (q) {
          const eye = route.lerpAt(route.ht, q) + 0.9 - 0.21 * Math.max(0, q.d - 6);
          const top = Math.max(eye, h + 1.6 + 4 * smooth(9, 14, q.d));
          scale = Math.min(scale, (top - h) / nominal + 10 * smooth(20, 26, q.d));
        }
      }
      if (scale < 0.25) continue;
      // The mesh carves the faces (the notch, overhangs, buttresses, beds): follow the face
      // in or out, and nothing grows in under an overhang.
      let qx = px, qy = py;
      if (surfaceShift) {
        const s = surfaceShift(px, py, h);
        if (s) {
          if (s.c > 2.5) continue;
          qx += s.c * s.gx; qy += s.c * s.gy;
        }
      }
      out.push(qx, h - 0.1 * scale, -qy, scale, rand() * Math.PI * 2, sp, variant, rand());
    }
    y += rowStep;
  }
  const shrubs = out.length / STRIDE;

  // ---------------------------------------------------------------- grass along the path
  // Tussocks on a finer grid within reach of the path and the platform: thick in the open
  // ground between the scrub patches, thinner under the bushes. Right up to the verge, where
  // they lean out over the tread.
  if (route) {
    const R = cfg.grass.reach;
    const [bx0, by0, bx1, by1] = route.bbox;
    const gs = cfg.grass.spacing;
    for (let y = by0 - R; y < by1 + R; y += gs) {
      for (let x = bx0 - R; x < bx1 + R; x += gs) {
        const px = x + (rand() - 0.5) * gs, py = y + (rand() - 0.5) * gs;
        const q = route.nearest(px, py, R);
        const nearPad = pads.some((p) => padDistance(p, px, py) < R * 0.6);
        if (!q && !nearPad) continue;
        if (pads.some((p) => padDistance(p, px, py) < 0.3)) continue;
        const edge = q ? route.lerpAt(route.w, q) / 2 + 0.12 : Infinity;
        if (q && q.d < edge) continue;
        const h = heightAt(px, py);
        if (h < 3) continue;
        const up = slopeAt(px, py);
        const n1 = fbm(noise, px * 0.07, py * 0.07, 3) + 0.5;
        let g = coverAt(px, py, h, up, n1);
        if (g < 0.05) continue;
        // Open ground carries most of it; the tussocks get sparse away from the path.
        const scrub = scrubAt(px, py);
        g *= 0.35 + 0.65 * (1 - scrub * 0.7);
        const d = q ? q.d - edge : 3;
        g *= 1 - 0.5 * smooth(6, R, d);
        // Patchy at a few metres, so it grows in drifts.
        g *= 0.45 + 0.8 * smooth(0.35, 0.65, fbm(noise, px * 0.25 + 3.3, py * 0.25 + 9.1, 2) + 0.5);
        if (rand() > g * cfg.grass.density) continue;
        let qx = px, qy = py;
        if (surfaceShift) {
          const s = surfaceShift(px, py, h);
          if (s) { if (s.c > 1.5) continue; qx += s.c * s.gx; qy += s.c * s.gy; }
        }
        const variant = Math.floor(rand() * 3);
        // Taller in the open, low right beside the tread (trodden and cut back).
        const scale = (0.75 + 0.5 * rand()) * (0.55 + 0.45 * smooth(0, 1.5, d));
        out.push(qx, h - 0.04, -qy, scale, rand() * Math.PI * 2, SP.GRASS, variant, rand());
      }
    }
  }
  const data = new Float32Array(out);
  return { data, count: data.length / STRIDE, shrubs, ms: Math.round(performance.now() - t0) };
}

// How much of the ground the crowns cover, on the heightfield's grid (0..1): each shrub or
// tree a soft disc the width of its crown, overlapping ones adding up as layers do.
export function canopyCover(plants, extent, N) {
  const { x0, y0, size } = extent;
  const cell = size / N;
  const cover = new Float32Array(N * N);
  const d = plants.data;
  for (let i = 0; i < plants.count; i++) {
    const o = i * STRIDE;
    const sp = SPECIES[d[o + 5]];
    if (sp && !sp.impostor) continue;          // grass: the ground under it is the grass
    const h = sp ? sp.heights[d[o + 6]] : 4.2;
    const r = (sp ? 0.85 : 0.65) * h * d[o + 3];
    const x = d[o], y = -d[o + 2];
    const ci = (x - x0) / cell - 0.5, cj = (y - y0) / cell - 0.5;
    const rr = r / cell;
    for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(N - 1, Math.ceil(cj + rr)); j++) {
      for (let k = Math.max(0, Math.floor(ci - rr)); k <= Math.min(N - 1, Math.ceil(ci + rr)); k++) {
        const t = Math.hypot(k - ci, j - cj) / Math.max(rr, 1e-3);
        if (t >= 1) continue;
        const w = 0.85 * (1 - smooth(0.55, 1, t));
        const q = j * N + k;
        cover[q] = 1 - (1 - cover[q]) * (1 - w);
      }
    }
  }
  return cover;
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
