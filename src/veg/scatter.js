// Where the plants go. Runs in the terrain worker, on the same height function as the mesh,
// so every plant sits on the surface. The rules follow the ground shader's scrub mask:
// plants on anything short of a sheer face, none on the sand or at the foot of the cliffs
// (salt spray), the odd bush on the ledges of the faces. Dense low scrub on the finger,
// sparser and bigger trees further out on the plateau.
//
// Output: one Float32Array, STRIDE floats per plant:
//   x, height, z (world), scale, yaw, species, tint (0..1, colour variation)

import { makeNoise, fbm } from '../terrain/heightfield.js';

export const STRIDE = 7;

export function scatterPlants(hf, layout, species) {
  const t0 = performance.now();
  const { heightAt, fields: f } = hf;
  const { x0, y0, size } = hf.extent;
  const cfg = layout.plants;
  const noise = makeNoise(cfg.seed);
  const rand = mulberry32(cfg.seed * 7919);
  const out = [];
  const sample = (a, x, y) => {
    const fi = (x - f.x0) / f.cell - 0.5, fj = (y - f.y0) / f.cell - 0.5;
    const i = Math.max(0, Math.min(f.N - 2, Math.floor(fi))), j = Math.max(0, Math.min(f.N - 2, Math.floor(fj)));
    const u = fi - i, v = fj - j, k = j * f.N + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + f.N] * (1 - u) + a[k + f.N + 1] * u) * v;
  };

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
      const h = heightAt(px, py);
      if (h < 4) continue;
      const e = 0.8;
      const hx = (heightAt(px + e, py) - heightAt(px - e, py)) / (2 * e);
      const hy = (heightAt(px, py + e) - heightAt(px, py - e)) / (2 * e);
      const up = 1 / Math.hypot(hx, 1, hy);
      const n1 = fbm(noise, px * 0.07, py * 0.07, 3) + 0.5;
      let veg = smooth(0.3, 0.46, up + (n1 - 0.5) * 0.25);
      // The odd bush clinging to the faces, higher up.
      if (veg < 0.5 && h > 15 && rand() < cfg.ledgeChance * smooth(15, 45, h)) veg = 1;
      veg *= smooth(6, 12, h + (n1 - 0.5) * 6);
      veg *= 1 - smooth(0.2, 0.5, sample(f.sand, px, py)) * (h < 12 ? 1 : 0.3);
      // Clearings, so the cover is not a uniform carpet.
      const clearing = smooth(0.62, 0.72, fbm(noise, px * 0.02 + 40, py * 0.02, 3) + 0.5);
      veg *= 1 - clearing * 0.85;
      if (rand() > veg * cfg.density) continue;

      // Species and size: bushes near the finger, trees further out and in the hollows.
      const sp = Math.floor(rand() * species.length);
      const base = lerp(cfg.nearScale, cfg.farScale, far) * (0.7 + 0.6 * rand());
      const scale = base * (0.85 + 0.3 * up);
      out.push(px, h - 0.15 * scale, -py, scale, rand() * Math.PI * 2, sp, rand());
    }
    y += rowStep;
  }
  const data = new Float32Array(out);
  return { data, count: data.length / STRIDE, ms: Math.round(performance.now() - t0) };
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
