// Leaf textures, painted once at load into one small atlas: the outline of each kind of leaf
// (alpha), and its markings (the pale midrib, the side veins, a darker rim) as a colour
// multiplier around 1, stored halved (0.5 = unchanged). The plant's own colour comes from
// the geometry, so one leaf texture serves every shade of green.
//
// Cells are CELL_W x CELL_H, the leaf's base at the bottom of the cell (v = 0) and its tip at
// the top (v = 1), filling the cell's width where it is widest.

import * as THREE from 'three';

export const CELL_W = 128, CELL_H = 256, COLS = 4, ROWS = 2;
export const LEAF = { SPOON: 0, ELLIPTIC: 1, OVATE: 2, LANCE: 3, SPOON_OLD: 4, ROUND: 5 };

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
