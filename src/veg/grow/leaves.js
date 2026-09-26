// Leaf textures, painted once at load into one small atlas: the outline of each kind of leaf
// (alpha), and its markings (the pale midrib, the side veins, a darker rim) as a colour
// multiplier around 1, stored halved (0.5 = unchanged). The plant's own colour comes from
// the geometry, so one leaf texture serves every shade of green.
//
// Cells are CELL_W x CELL_H, the leaf's base at the bottom of the cell (v = 0) and its tip at
// the top (v = 1), filling the cell's width where it is widest.

import * as THREE from 'three';

export const CELL_W = 128, CELL_H = 256, COLS = 4, ROWS = 3;
// ROSETTE_TOP and ROSETTE_SIDE: a naupaka rosette seen from above (in the lower half of its
// cell, square) and from the side, TUFT: a tuft of grass blades; for the lighter level of
// detail, which draws them as cards (grow/core.js).
export const LEAF = { SPOON: 0, ELLIPTIC: 1, OVATE: 2, LANCE: 3, SPOON_OLD: 4, ROUND: 5, SPRAY: 6, SPRAY_SMALL: 7,
  ROSETTE_TOP: 8, ROSETTE_SIDE: 9, TUFT: 10, TUFT_DRY: 11 };

// Half-width along the leaf, t from base (0) to tip (1), peaking at 1.
const shapes = {
  // Scaevola: narrow wedge at the base, broad rounded tip.
  [LEAF.SPOON]: { a: 1.35, b: 0.5, veins: 5, rib: 0.9 },
  [LEAF.SPOON_OLD]: { a: 1.35, b: 0.5, veins: 5, rib: 0.9, old: 1 },
  // A broad tree leaf, widest in the middle, pointed.
  [LEAF.ELLIPTIC]: { a: 0.85, b: 0.95, veins: 7, rib: 1, tipPoint: 0.25 },
  // A small shrub leaf, widest below the middle, toothed.
  [LEAF.OVATE]: { a: 0.6, b: 1.05, veins: 5, rib: 0.9, teeth: 11, tipPoint: 0.3 },
  [LEAF.LANCE]: { a: 0.75, b: 1.2, veins: 8, rib: 1, tipPoint: 0.4 },
  [LEAF.ROUND]: { a: 0.8, b: 0.6, veins: 5, rib: 0.9 },
};

// The outline of a leaf cell (0..1 of the cell's half-width at t along the leaf), for
// leaves built to their shape in geometry (grow/core.js leafBlade cut), or null for a cell
// that is not one leaf.
export function leafOutline(cell) {
  const s = shapes[cell];
  return s ? (t) => halfWidth(s, t) * 0.96 : null;
}

function halfWidth(s, t) {
  if (t <= 0 || t >= 1) return 0;
  const tp = s.a / (s.a + s.b);
  const peak = Math.pow(tp, s.a) * Math.pow(1 - tp, s.b);
  let w = Math.pow(t, s.a) * Math.pow(1 - t, s.b) / peak;
  // A drawn-out point at the tip.
  if (s.tipPoint) w *= 1 - s.tipPoint * Math.pow(Math.max(0, (t - 0.8) / 0.2), 1.5) * 0.6;
  if (s.teeth) w *= 1 - 0.06 * Math.abs(Math.sin(t * s.teeth * Math.PI)) * Math.sin(t * Math.PI);
  return Math.min(1, w);
}

// Sprays: a twig up the middle of the cell with leaves along it, for crowns too big to build
// leaf by leaf. Each leaf its own shade, as leaves turned different ways to the light are.
const sprays = {
  [LEAF.SPRAY]: { shape: LEAF.ELLIPTIC, n: 17, len: 0.56, aspect: 0.44, angle: 1.0, seed: 3 },
  [LEAF.SPRAY_SMALL]: { shape: LEAF.OVATE, n: 26, len: 0.42, aspect: 0.5, angle: 1.1, seed: 9 },
};

let cached = null;
export function leafAtlas() {
  if (cached) return cached;
  const W = CELL_W * COLS, H = CELL_H * ROWS;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d');
  const img = g.createImageData(W, H);
  const px = img.data;
  // A cheap hash for speckle.
  const hash = (x, y) => { let h = (x * 374761393 + y * 668265263) >>> 0; h = ((h ^ (h >>> 13)) * 1274126177) >>> 0; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  for (const [key, s] of Object.entries(shapes)) {
    const cell = +key;
    const cx0 = (cell % COLS) * CELL_W, cy0 = Math.floor(cell / COLS) * CELL_H;
    const SS = 4;   // supersampling for the edge
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) {
      let cover = 0;
      let r = 0, gg = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const u = ((x + (sx + 0.5) / SS) / CELL_W) * 2 - 1;          // -1..1 across
        const t = 1 - (y + (sy + 0.5) / SS) / CELL_H;                 // 0 at the base (bottom row), 1 at the tip
        const hw = halfWidth(s, t) * 0.96;
        if (Math.abs(u) > hw) continue;
        cover++;
        const au = Math.abs(u) / Math.max(hw, 1e-3);                 // 0 at the midrib, 1 at the rim
        // Base tone: a little lighter toward the tip and the middle.
        let m = [1, 1, 1];
        // Midrib: pale and yellower, narrowing to the tip.
        const ribW = 0.035 * s.rib * (1 - 0.7 * t) + 0.006;
        const rib = Math.max(0, 1 - Math.abs(u) / ribW);
        m = m.map((v, i) => v * (1 + rib * [0.32, 0.36, 0.12][i]));
        // Side veins: curving forward from the midrib to near the rim.
        if (s.veins) {
          const phase = (t - 0.55 * Math.pow(Math.abs(u), 1.3)) * s.veins;
          const f = phase - Math.floor(phase);
          const vein = Math.max(0, 1 - Math.abs(f - 0.5) / 0.07) * (1 - smooth(0.75, 0.95, au)) * smooth(0.05, 0.25, au + 0.2) * (0.3 + 0.7 * (1 - t));
          m = m.map((v, i) => v * (1 + vein * [0.1, 0.12, 0.03][i]));
        }
        // Darker toward the rim, a slightly different green between the veins.
        const rim = smooth(0.8, 1.0, au);
        m = m.map((v, i) => v * (1 - rim * [0.1, 0.08, 0.02][i]));
        // Lighter toward the base of the blade on the underside... (both faces share it).
        m = m.map((v) => v * (0.94 + 0.08 * t));
        if (s.old) {
          // Yellowing from the rim inward, with brown spots.
          const y2 = smooth(0.3, 1.0, au) * 0.8 + 0.2;
          m = [m[0] * (1 + 0.9 * y2), m[1] * (1 + 0.35 * y2), m[2] * (1 - 0.3 * y2)];
        }
        // Speckle.
        const sp = 1 + (hash(x + cx0, y + cy0) - 0.5) * 0.06;
        r += m[0] * sp; gg += m[1] * sp; b += m[2] * sp;
      }
      const k = ((cy0 + y) * W + cx0 + x) * 4;
      if (cover) {
        px[k] = Math.min(255, Math.round((r / cover) * 0.5 * 255));
        px[k + 1] = Math.min(255, Math.round((gg / cover) * 0.5 * 255));
        px[k + 2] = Math.min(255, Math.round((b / cover) * 0.5 * 255));
      } else {
        px[k] = px[k + 1] = px[k + 2] = 128;   // unchanged colour outside, so mips do not darken the rim
      }
      px[k + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  // Sprays.
  for (const [key, sp] of Object.entries(sprays)) {
    const cell = +key;
    const cx0 = (cell % COLS) * CELL_W, cy0 = Math.floor(cell / COLS) * CELL_H;
    const s = shapes[sp.shape];
    let seed = sp.seed * 9301 + 49297;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    // Leaves in cell units (x across 0..1, y up 0..1, the cell twice as tall as wide).
    const leaves = [];
    for (let k = 0; k < sp.n; k++) {
      const t = 0.12 + 0.8 * (k / (sp.n - 1));                    // along the twig
      const sideS = k % 2 ? 1 : -1;
      const a = sideS * sp.angle * (1 - 0.35 * t) * (0.7 + 0.5 * rnd()) + (rnd() - 0.5) * 0.25;   // from straight up
      const L = sp.len * (0.75 + 0.35 * rnd()) * (1 - 0.4 * t);
      leaves.push({ x: 0.5 + (rnd() - 0.5) * 0.04, y: t * 0.92, a, L, W: L * sp.aspect, shade: 0.72 + 0.5 * rnd() });
    }
    // The tip leaf.
    leaves.push({ x: 0.5, y: 0.9, a: (rnd() - 0.5) * 0.2, L: sp.len * 0.7, W: sp.len * 0.7 * sp.aspect, shade: 1.05 });
    const SS = 3;
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) {
      let cover = 0, r = 0, gg = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px_ = (x + (sx + 0.5) / SS) / CELL_W;                   // 0..1 across
        const py_ = (1 - (y + (sy + 0.5) / SS) / CELL_H) * 2;          // 0..2 up (cell is 2 wide units tall)
        let hit = null;
        // Later leaves are drawn over earlier ones.
        for (let k = leaves.length - 1; k >= 0 && !hit; k--) {
          const l = leaves[k];
          const dx = px_ - l.x, dy = py_ - l.y * 2;
          const ca = Math.cos(l.a), sa = Math.sin(l.a);
          const along = dx * sa + dy * ca, across = dx * ca - dy * sa;
          const t = along / l.L;
          if (t <= 0 || t >= 1) continue;
          const hw = halfWidth(s, t) * l.W * 0.5;
          if (Math.abs(across) > hw) continue;
          const au = Math.abs(across) / Math.max(hw, 1e-4);
          let m = l.shade * (0.93 + 0.1 * t);
          const rib = Math.max(0, 1 - Math.abs(across) / (l.W * 0.03 + 0.002));
          hit = [m * (1 + rib * 0.25) * (1 - 0.08 * smooth(0.75, 1, au)), m * (1 + rib * 0.28) * (1 - 0.06 * smooth(0.75, 1, au)), m * (1 + rib * 0.1)];
        }
        // The twig.
        if (!hit && Math.abs(px_ - 0.5) < 0.012 && py_ > 0 && py_ < 1.85) hit = [1.1, 0.8, 0.75];
        if (!hit) continue;
        cover++; r += hit[0]; gg += hit[1]; b += hit[2];
      }
      const k = ((cy0 + y) * W + cx0 + x) * 4;
      if (cover) {
        px[k] = Math.min(255, Math.round((r / cover) * 0.5 * 255));
        px[k + 1] = Math.min(255, Math.round((gg / cover) * 0.5 * 255));
        px[k + 2] = Math.min(255, Math.round((b / cover) * 0.5 * 255));
      } else {
        px[k] = px[k + 1] = px[k + 2] = 128;
      }
      px[k + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  }
  // Rosettes and tufts: drawn as lists of shapes in the cell, later ones over earlier ones.
  // Each shape is a leaf (base x, y and angle, in cell units with y up and the cell 1 wide and
  // 2 tall) with its own shade.
  const paint = (cell, leavesAt, shapeKey, blade = false) => {
    const cx0 = (cell % COLS) * CELL_W, cy0 = Math.floor(cell / COLS) * CELL_H;
    const sh = shapes[shapeKey];
    const SS = 3;
    for (let y = 0; y < CELL_H; y++) for (let x = 0; x < CELL_W; x++) {
      let cover = 0, r = 0, gg = 0, b = 0;
      for (let sy = 0; sy < SS; sy++) for (let sx = 0; sx < SS; sx++) {
        const px_ = (x + (sx + 0.5) / SS) / CELL_W;
        const py_ = (1 - (y + (sy + 0.5) / SS) / CELL_H) * 2;
        let hit = null;
        for (let k = leavesAt.length - 1; k >= 0 && !hit; k--) {
          const l = leavesAt[k];
          let dx = px_ - l.x, dy = py_ - l.y;
          if (blade) {
            // A blade bending over: its centre line is an arc; distance along and across it.
            const ca = Math.cos(l.a), sa = Math.sin(l.a);
            let along = dx * sa + dy * ca, across = dx * ca - dy * sa;
            const t = along / l.L;
            if (t <= 0 || t >= 1) continue;
            across -= l.bend * t * t * l.L;
            const hw = l.W * 0.5 * (1 - Math.pow(t, 1.6) * 0.95);
            if (Math.abs(across) > hw) continue;
            const m = l.shade * (0.8 + 0.25 * t);
            const dry = l.dry > 0 ? smooth(1 - l.dry, 1 - l.dry + 0.2, t) : 0;
            hit = [m * (1 + 0.9 * dry), m * (1 + 0.35 * dry), m * (1 - 0.2 * dry)];
            continue;
          }
          const ca = Math.cos(l.a), sa = Math.sin(l.a);
          const along = (dx * sa + dy * ca) / l.fore, across = dx * ca - dy * sa;
          const t = along / l.L;
          if (t <= 0 || t >= 1) continue;
          const hw = halfWidth(sh, t) * l.W * 0.5;
          if (Math.abs(across) > hw) continue;
          const au = Math.abs(across) / Math.max(hw, 1e-4);
          const rib = Math.max(0, 1 - Math.abs(across) / (l.W * 0.04 + 0.002));
          const m = l.shade * (0.9 + 0.12 * t);
          hit = [m * (1 + rib * 0.25) * (1 - 0.08 * smooth(0.75, 1, au)), m * (1 + rib * 0.28) * (1 - 0.06 * smooth(0.75, 1, au)), m * (1 + rib * 0.1)];
        }
        if (!hit) continue;
        cover++; r += hit[0]; gg += hit[1]; b += hit[2];
      }
      const k = ((cy0 + y) * W + cx0 + x) * 4;
      if (cover) {
        px[k] = Math.min(255, Math.round((r / cover) * 0.5 * 255));
        px[k + 1] = Math.min(255, Math.round((gg / cover) * 0.5 * 255));
        px[k + 2] = Math.min(255, Math.round((b / cover) * 0.5 * 255));
      } else {
        px[k] = px[k + 1] = px[k + 2] = 128;
      }
      px[k + 3] = Math.round((cover / (SS * SS)) * 255);
    }
  };
  {
    let seed = 7;
    const rnd = () => { seed = (seed * 9301 + 49297) % 233280; return seed / 233280; };
    // From above: leaves radiating from the middle of the lower half (0.5, 0.5), the old ones
    // long and spread, the young ones short in the middle, drawn outside in.
    const top = [];
    for (let k = 13; k >= 0; k--) {
      const age = k / 13;
      const a = k * 2.39996 + rnd() * 0.2;
      top.push({ x: 0.5, y: 0.5, a, L: 0.2 + 0.28 * age, W: (0.2 + 0.28 * age) * 0.42, fore: 1, shade: 0.8 + 0.35 * (1 - age) + (rnd() - 0.5) * 0.2 });
    }
    paint(LEAF.ROSETTE_TOP, top, LEAF.SPOON);
    // From the side: a fan, the old leaves spread low and wide, the young ones upright; seen
    // foreshortened.
    const side = [];
    for (let k = 13; k >= 0; k--) {
      const age = k / 13;
      const sgn = k % 2 ? 1 : -1;
      const a = sgn * (0.15 + 1.25 * age) + (rnd() - 0.5) * 0.3;
      const L = (0.3 + 0.35 * age) * (0.8 + 0.4 * rnd());
      side.push({ x: 0.5 + (rnd() - 0.5) * 0.05, y: 0.12 + 0.1 * (1 - age), a, L, W: L * 0.42, fore: 1, shade: 0.75 + 0.4 * (1 - age) + (rnd() - 0.5) * 0.2 });
    }
    paint(LEAF.ROSETTE_SIDE, side, LEAF.SPOON);
    // A tuft of grass from the side: blades from a narrow base, the outer ones arching over.
    for (const [cell, dryShare] of [[LEAF.TUFT, 0.2], [LEAF.TUFT_DRY, 0.7]]) {
      const tuft = [];
      for (let k = 0; k < 70; k++) {
        const out = rnd() * 2 - 1;
        const a = out * 0.55 + (rnd() - 0.5) * 0.25;
        tuft.push({ x: 0.5 + out * 0.07, y: 0.02, a, L: (1.2 + 0.7 * rnd()) * (1 - 0.35 * Math.abs(out)), W: 0.035 + 0.02 * rnd(),
          bend: Math.sign(out || 1) * (0.2 + 0.5 * Math.abs(out)) * (0.6 + 0.8 * rnd()), shade: 0.7 + 0.5 * rnd(),
          dry: rnd() < dryShare ? 0.2 + 0.6 * rnd() : 0 });
      }
      paint(cell, tuft, null, true);
    }
  }
  g.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.NoColorSpace;
  tex.flipY = false;   // row 0 (the tip of the first row of cells) is v = 0 in the texture
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.anisotropy = 4;
  tex.premultiplyAlpha = false;
  cached = tex;
  return tex;
}

// Where a leaf's (u, v) lands in the atlas for a cell. With flipY off, texture v runs down the
// canvas rows, so the base (canvas bottom of the cell) is at the cell's larger v.
export const ATLAS_GLSL = /* glsl */ `
vec2 leafAtlasUv(vec2 uv, float cell) {
  float col = mod(cell, ${COLS}.0), row = floor(cell / ${COLS}.0);
  return vec2((col + uv.x) / ${COLS}.0, (row + 1.0 - uv.y) / ${ROWS}.0);
}
`;

function smooth(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }
