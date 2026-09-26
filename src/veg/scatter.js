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
import { buildStrata, strataWarp, coarseAt } from '../terrain/strata.js';

export const STRIDE = 8;

// The species, their variants' heights at scale 1 (src/veg/grow/species.js grows each to
// these), and whether they have an impostor (drawn far off) or are drawn only up close.
// crown: the radius of the crown as a share of the height, and how much of the light it
// stops (for the ground under it, canopyCover).
export const SPECIES = [
  { id: 'scaevola', heights: [1.3, 1.6, 1.95], impostor: true, crown: [0.85, 0.85] },
  { id: 'grass', heights: [0.5, 0.65, 0.8], impostor: false },
  { id: 'tree', heights: [4.5, 5.5, 6.5], impostor: true, crown: [0.55, 0.8] },
  { id: 'palm', heights: [10, 12.5], impostor: true, crown: [0.36, 0.45] },
  { id: 'pandanus', heights: [3.2, 4.2], impostor: true, crown: [0.5, 0.6] },
  { id: 'creeper', heights: [2.6, 3.8], impostor: true, crown: [0.3, 0.6] },
];
export const SP = { SCAEVOLA: 0, GRASS: 1, TREE: 2, PALM: 3, PANDANUS: 4, CREEPER: 5 };

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
  const scrubAt = (px, py) => smooth(0.3, 0.55, fbm(noise, px * 0.035 + 11, py * 0.035 - 4, 3) + 0.5);
  // Ledges on the faces: the tops of the hard packages of beds, where the rock steps back
  // going up (strata.js, the same table the mesh is carved with). Metres of shelf.
  const strata = buildStrata();
  const ledgeAt = (x, y, h) => {
    const bc = h + strataWarp(x, y);
    return Math.max(0, coarseAt(strata, bc - 0.6) - coarseAt(strata, bc + 0.6));
  };
  // Coconut palms stand in groves on the plateau, away from the cliff edge.
  const groveAt = (px, py) => smooth(0.6, 0.72, fbm(noise, px * 0.012 - 7, py * 0.012 + 21, 3) + 0.5);

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
      let px = x + (rand() - 0.5) * spacing, py = y + (rand() - 0.5) * rowStep;
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
      let h = heightAt(px, py);
      if (h < 4) continue;
      let up = slopeAt(px, py);
      const n1 = fbm(noise, px * 0.07, py * 0.07, 3) + 0.5;
      // Plants hold on to steeper ground than the ground cover does (to about 70 degrees,
      // v3's note: the islet's east side and the head's flanks are green there).
      let veg = Math.max(coverAt(px, py, h, up, n1), smooth(0.22, 0.36, up + (n1 - 0.5) * 0.2) * smooth(8, 14, h) * 0.8);
      // Scrub down the sheer faces, in patches (beach-white-sand-cliff.jpg: a whole stretch of
      // the wall green from the rim nearly to the sand, bare white rock either side). A grid
      // point on a face stands for a tall strip of it (the face is steep, so a metre across
      // the map is metres up the face): walk down the fall line and fill the strip, a clump
      // every faceStep metres up, where the patch noise says.
      if (up < 0.3 && h > 12 && cfg.face) {
        const e = 0.8;
        let gx = heightAt(px + e, py) - heightAt(px - e, py), gy = heightAt(px, py + e) - heightAt(px, py - e);
        const G = Math.hypot(gx, gy) / (2 * e);
        const gl = Math.hypot(gx, gy) || 1;
        gx /= gl; gy /= gl;
        const outA = Math.atan2(-gy, -gx);
        const n = Math.min(24, Math.round((spacing * G) / cfg.face.step));
        for (let k = 0; k < n; k++) {
          const d = ((k + rand()) / n - 0.5) * spacing;
          const x2 = px + gx * d, y2 = py + gy * d, h2 = heightAt(x2, y2);
          if (h2 < 12) continue;
          // Patches longer down the face than across it, their edges ragged at a few metres.
          const fp = smooth(0.5, 0.66, fbm(noise, x2 * 0.035 + h2 * 0.008, y2 * 0.035 - h2 * 0.007 + 31, 3) + 0.5
            + 0.12 * (fbm(noise, x2 * 0.2 + h2 * 0.15, y2 * 0.2 - h2 * 0.1 - 9, 2)));
          if (rand() > fp * cfg.face.density * smooth(12, 22, h2)) continue;
          let qx2 = x2, qy2 = y2;
          if (surfaceShift) {
            const s2 = surfaceShift(x2, y2, h2);
            if (s2) { if (s2.c > 2.5) continue; qx2 += s2.c * s2.gx; qy2 += s2.c * s2.gy; }
          }
          // A little out from the rock, where the roots hold.
          qx2 += Math.cos(outA) * 0.3; qy2 += Math.sin(outA) * 0.3;
          const sp2 = rand() < 0.75 ? SP.CREEPER : SP.SCAEVOLA;
          const sc2 = sp2 === SP.CREEPER ? 0.7 + 0.7 * rand() : 0.5 + 0.4 * rand();
          out.push(qx2, h2 - 0.1 * sc2, -qy2, sc2, sp2 === SP.CREEPER ? outA + (rand() - 0.5) * 0.6 : rand() * Math.PI * 2, sp2,
            Math.floor(rand() * SPECIES[sp2].heights.length), rand());
        }
      }
      // Clumps on the ledges of the sheer faces: slide down the fall line to the nearest shelf.
      let onLedge = false, outYaw = 0;
      if (veg < 0.5 && h > 12) {
        const e = 0.8;
        let gx = heightAt(px + e, py) - heightAt(px - e, py), gy = heightAt(px, py + e) - heightAt(px, py - e);
        const gl = Math.hypot(gx, gy) || 1;
        gx /= gl; gy /= gl;
        // Plant space +x out from the rock: downhill (rotY in the shaders turns +x to
        // (cos yaw, -sin yaw) in world x, z, which is (east, north)).
        outYaw = Math.atan2(-gy, -gx);
        let best = 0, bx = px, by = py, bh = h;
        for (let t = -3; t <= 3; t += 0.25) {
          const x2 = px + gx * t, y2 = py + gy * t, h2 = heightAt(x2, y2);
          if (h2 < 12) continue;
          const L = ledgeAt(x2, y2, h2);
          if (L > best) { best = L; bx = x2; by = y2; bh = h2; }
        }
        // Patches across the face: some stretches carry scrub, others are bare. Taller than
        // they are wide (the noise changes four times slower up the face than along it), so
        // the scrub on one ledge carries on down the next, as it does where water seeps.
        const patch = smooth(0.42, 0.62, fbm(noise, px * 0.05 + h * 0.009, py * 0.05 - h * 0.008 + 17, 3) + 0.5);
        // Just under the rim, where the ground above levels off: scrub spills over the edge.
        const rim = h > 20 && slopeAt(px + gx * 3, py + gy * 3) > 0.5 && rand() < 0.5 * patch + 0.15;
        if (rim) { best = Math.max(best, 0.3); bx = px; by = py; bh = h; }
        if (best > 0.08 && rand() < cfg.ledgeChance * smooth(0.08, 0.3, best) * smooth(12, 30, bh) * (0.15 + 1.4 * patch)) {
          veg = 1; onLedge = true;
          px = bx; py = by; h = bh; up = slopeAt(px, py);
          // A run along the ledge: more hanging scrub either side, along the face's contour,
          // longer where the ledge is broad and in stretches the clump noise favours.
          const run = Math.floor(smooth(0.35, 0.7, fbm(noise, px * 0.05 + 5, py * 0.05 - 3, 2) + 0.5) * 3.5 * smooth(0.08, 0.35, best) * patch);
          for (let k = 1; k <= run; k++) {
            for (const sgn of [-1, 1]) {
              if (rand() < 0.35) continue;
              const along = sgn * k * (1.6 + rand() * 1.2);
              let x3 = px - gy * along, y3 = py + gx * along;
              // Back onto the ledge: the same bed height, found by sliding in or out.
              let bb = Infinity, bx3 = x3, by3 = y3, bh3 = 0;
              for (let t = -2; t <= 2; t += 0.25) {
                const x4 = x3 + gx * t, y4 = y3 + gy * t, h4 = heightAt(x4, y4);
                const dz = Math.abs(h4 + strataWarp(x4, y4) - (h + strataWarp(px, py)));
                if (dz < bb) { bb = dz; bx3 = x4; by3 = y4; bh3 = h4; }
              }
              if (bb > 0.8 || bh3 < 10) continue;
              let qx3 = bx3, qy3 = by3;
              if (surfaceShift) {
                const s3 = surfaceShift(bx3, by3, bh3);
                if (s3) { if (s3.c > 2.5) continue; qx3 += s3.c * s3.gx; qy3 += s3.c * s3.gy; }
              }
              const sp3 = rand() < 0.8 ? SP.CREEPER : SP.SCAEVOLA;
              // Out to the lip of the ledge: the hard bed under it stands out further.
              qx3 -= gx * 0.9; qy3 -= gy * 0.9;
              const sc3 = sp3 === SP.CREEPER ? 0.8 + 0.7 * rand() : 0.6 + 0.4 * rand();
              out.push(qx3, bh3 - 0.1 * sc3, -qy3, sc3, outYaw + (rand() - 0.5) * 0.6, sp3, Math.floor(rand() * SPECIES[sp3].heights.length), rand());
            }
          }
        }
      }
      // Clearings, so the cover is not a uniform carpet.
      const clearing = smooth(0.62, 0.72, fbm(noise, px * 0.02 + 40, py * 0.02, 3) + 0.5);
      veg *= 1 - clearing * 0.85;
      // Scrub patches close up, the grassy ground between them carries the odd bush.
      const scrub = scrubAt(px, py);
      veg *= lerp(1, 0.45 + 0.55 * scrub, 1 - far);
      if (rand() > veg * cfg.density) continue;

      // Species and size: the naupaka on the finger, the odd screw pine on the slopes and the
      // ledges, trees further out and in the hollows, coconut palms in groves on the plateau.
      const r = rand();
      let sp;
      if (onLedge) sp = r < 0.7 ? SP.CREEPER : r < 0.8 ? SP.PANDANUS : SP.SCAEVOLA;
      else if (far < 0.2) sp = r < 0.035 ? SP.PANDANUS : r < 0.06 && up > 0.7 ? SP.TREE : SP.SCAEVOLA;
      else {
        // Palms about 8 m apart in a grove (one in five of the 3.6 m slots), scrub and the odd
        // tree under and between them.
        const grove = groveAt(px, py) * smooth(0.2, 0.6, far);
        sp = r < grove * 0.2 ? SP.PALM : r < (0.55 + 0.35 * far) * (1 - 0.6 * grove) ? SP.TREE : r < 0.95 ? SP.SCAEVOLA : SP.PANDANUS;
      }
      const tree = sp === SP.TREE;
      const variant = Math.floor(rand() * SPECIES[sp].heights.length);
      const nominal = SPECIES[sp].heights[variant];
      const base = tree ? lerp(0.6, 1.0, far) * (0.7 + 0.6 * rand())
        : sp === SP.PALM ? 0.8 + 0.4 * rand()
        : sp === SP.PANDANUS ? 0.7 + 0.5 * rand()
        : sp === SP.CREEPER ? 0.9 + 0.7 * rand()
        : (0.5 + 0.5 * rand() * rand() + 0.2 * scrub) * (onLedge ? 0.8 : 1);
      let scale = base * (onLedge ? 1 : 0.85 + 0.3 * up);
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
      const yaw = sp === SP.CREEPER ? outYaw + (rand() - 0.5) * 0.5 : rand() * Math.PI * 2;
      if (onLedge) { qx += Math.cos(outYaw) * 0.9; qy += Math.sin(outYaw) * 0.9; }
      out.push(qx, h - 0.1 * scale, -qy, scale, yaw, sp, variant, rand());
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
        g = Math.min(1, g * 1.6) * (0.6 + 0.4 * (1 - scrub * 0.6));
        const d = q ? q.d - edge : 3;
        g *= 1 - 0.35 * smooth(8, R, d);
        // Patchy at a few metres, so it grows in drifts.
        g *= 0.6 + 0.6 * smooth(0.3, 0.6, fbm(noise, px * 0.25 + 3.3, py * 0.25 + 9.1, 2) + 0.5);
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
    if (!sp?.crown) continue;          // grass: the ground under it is the grass
    const h = sp.heights[d[o + 6]];
    const r = sp.crown[0] * h * d[o + 3];
    const x = d[o], y = -d[o + 2];
    const ci = (x - x0) / cell - 0.5, cj = (y - y0) / cell - 0.5;
    const rr = r / cell;
    for (let j = Math.max(0, Math.floor(cj - rr)); j <= Math.min(N - 1, Math.ceil(cj + rr)); j++) {
      for (let k = Math.max(0, Math.floor(ci - rr)); k <= Math.min(N - 1, Math.ceil(ci + rr)); k++) {
        const t = Math.hypot(k - ci, j - cj) / Math.max(rr, 1e-3);
        if (t >= 1) continue;
        const w = sp.crown[1] * (1 - smooth(0.55, 1, t));
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
