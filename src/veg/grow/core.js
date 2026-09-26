// The parts every plant is built from: a seeded random source, small vector helpers, and a
// geometry builder that packs each vertex the way the plant shader reads it.
//
// Plant space: metres, y up, the plant's foot at the origin.
//
// Per vertex (plant-material.js):
//   position   float x 3
//   normal     int8 x 3 (normalised), for strap leaves and blades the side the leaf faces
//   uv         float x 2: across and along a leaf or blade (0..1), round and along bark (m)
//   aColor     uint8 x 4: albedo (stored as its square root, for precision in the darks),
//              and alpha = how much light a leaf lets through
//   aWind      uint8 x 4: branch sway (0..1, grows out along a branch), its phase, leaf
//              flutter (0..1, grows out along the leaf), its phase
//   aLeaf      uint8 x 4: kind (0 bark, 1 textured leaf, 2 strap leaf or blade), shade (how
//              deep in the crown: 1 on the outside), the leaf texture cell, gloss

import * as THREE from 'three';
import { leafOutline } from './leaves.js';

export function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.range = (lo, hi) => lo + (hi - lo) * next();
  next.pick = (arr) => arr[Math.floor(next() * arr.length) % arr.length];
  // Roughly normal, mean 0, spread 1.
  next.gauss = () => (next() + next() + next() + next() - 2) * 1.73;
  return next;
}

// ---------------------------------------------------------------- vectors (plain arrays)
export const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
export const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const len = (a) => Math.hypot(a[0], a[1], a[2]);
export const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
export const lerp3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
export const madd = (a, b, s) => [a[0] + b[0] * s, a[1] + b[1] * s, a[2] + b[2] * s];
// Any unit vector at right angles to d.
export const perp = (d) => norm(Math.abs(d[1]) < 0.9 ? cross(d, [0, 1, 0]) : cross(d, [1, 0, 0]));
// Rotate v about unit axis k by angle a (Rodrigues).
export function rotate(v, k, a) {
  const c = Math.cos(a), s = Math.sin(a), kv = cross(k, v), kd = dot(k, v) * (1 - c);
  return [v[0] * c + kv[0] * s + k[0] * kd, v[1] * c + kv[1] * s + k[1] * kd, v[2] * c + kv[2] * s + k[2] * kd];
}
export const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
export const clamp01 = (x) => Math.min(Math.max(x, 0), 1);

// sRGB 0..255 to linear 0..1.
export const srgb = (r, g, b) => [r, g, b].map((v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });

// LEAF: a leaf cut out by its texture's alpha; CUT: a leaf whose outline is the geometry (its
// texture gives only its markings: no cut-out, which is costly on tile-based GPUs).
export const KIND = { BARK: 0, LEAF: 1, STRAP: 2, CUT: 3 };

// lod: the level of detail, 0 the full plant. Every level is built from the same calls (so
// the plant has the same shape). From 1 up, fewer sides on the stems and the thinnest twigs
// left out here; the growers choose how each level draws its leaves (built to their outline,
// cut out by the texture, or as cards with painted sprites: card(), grow/leaves.js).
export class PlantBuilder {
  constructor({ lod = 0 } = {}) {
    this.pos = []; this.nrm = []; this.uv = []; this.col = []; this.wind = []; this.leaf = []; this.idx = [];
    this.count = 0;
    this.tris = 0;
    this.lod = lod;
    this.alphaLeaves = false;   // whether any leaf needs its texture's alpha
  }
  // w: [branchAmp, branchPhase, leafAmp, leafPhase] (0..1); l: [kind, shade, cell, gloss]; c: [r, g, b, trans]
  vertex(p, n, uv, c, w, l) {
    this.pos.push(p[0], p[1], p[2]);
    const nn = norm(n);
    this.nrm.push(nn[0], nn[1], nn[2]);
    this.uv.push(uv[0], uv[1]);
    this.col.push(c[0], c[1], c[2], c[3] ?? 0.5);
    this.wind.push(w[0], w[1], w[2], w[3]);
    this.leaf.push(l[0], l[1], l[2], l[3]);
    return this.count++;
  }
  tri(a, b, c) { this.idx.push(a, b, c); this.tris++; }
  quad(a, b, c, d) { this.idx.push(a, b, c, a, c, d); this.tris += 2; }

  // A tapered tube along a polyline. pts: points, r: radius at each, c: colour, wind: per
  // point [branchAmp, phase], shade: per point, sides: ring vertices.
  tube(pts, r, { color, wind, shade, sides = 5, capEnd = true }) {
    const n = pts.length;
    if (n < 2) return;
    if (this.lod >= 1) {
      if (r[0] < 0.005) return;
      sides = Math.max(3, sides - 2);
    }
    // Parallel transport frames down the line.
    const T = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      T.push(norm(sub(b, a)));
    }
    let N = perp(T[0]);
    const rings = [];
    let along = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) {
        // Carry the frame from the last tangent to this one.
        const ax = cross(T[i - 1], T[i]);
        const s = len(ax);
        if (s > 1e-6) N = rotate(N, mul(ax, 1 / s), Math.asin(Math.min(1, s)));
        along += len(sub(pts[i], pts[i - 1]));
      }
      const B = cross(T[i], N);
      const ring = [];
      for (let k = 0; k <= sides; k++) {
        const a = (k / sides) * Math.PI * 2;
        const dir = add(mul(N, Math.cos(a)), mul(B, Math.sin(a)));
        const p = madd(pts[i], dir, r[i]);
        const w = wind[i];
        ring.push(this.vertex(p, dir, [k / sides * r[i] * 2 * Math.PI, along], color, [w[0], w[1], 0, 0], [KIND.BARK, shade[i], 0, 0.1]));
      }
      rings.push(ring);
    }
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < sides; k++) {
      this.quad(rings[i][k], rings[i + 1][k], rings[i + 1][k + 1], rings[i][k + 1]);
    }
    if (capEnd && r[n - 1] > 0.004) {
      const tip = this.vertex(madd(pts[n - 1], T[n - 1], r[n - 1] * 0.5), T[n - 1], [0, along], color, [wind[n - 1][0], wind[n - 1][1], 0, 0], [KIND.BARK, shade[n - 1], 0, 0.1]);
      for (let k = 0; k < sides; k++) this.tri(rings[n - 1][k], tip, rings[n - 1][k + 1]);
    }
  }

  // A leaf blade on a texture cell: base at p, running along dir, its upper face toward up
  // (made square to dir), length l, width w, folded along the midrib by fold (radians, edges
  // raised), and curling down along its length by droop (metres at the tip).
  // rows: points along the length (2 = one flat panel each side).
  // cup and arch tilt the normals further than the shape does (across the leaf and along
  // it), so the light runs over each leaf as over a curved one, without the vertices.
  // cut: build the leaf to its outline (leaves.js) with rows along it at ts, instead of a
  // rectangle cut out by the texture.
  leafBlade(p, dir, up, l, w, { color, wind, leafPhase, shade, cell, gloss = 0.5, fold = 0.35, droop = 0, rows = 2, twist = 0, cup = 0.55, arch = 0.35, cut = false }) {
    const outline = cut ? leafOutline(cell) : null;
    const ts = outline ? [0, 0.36, 0.7, 0.9, 1] : null;
    if (outline) rows = ts.length; else this.alphaLeaves = true;
    const d = norm(dir);
    let side = norm(cross(d, up));
    let u = cross(side, d);
    const verts = [];
    for (let j = 0; j < rows; j++) {
      const t = ts ? ts[j] : j / (rows - 1);
      // Along the leaf, bending down toward the tip.
      const c = madd(madd(p, d, l * t), [0, -1, 0], droop * t * t);
      // Local tangent for the normal of the bent leaf.
      const tan = norm(madd(d, [0, -1, 0], 2 * droop * t / Math.max(l, 1e-3)));
      const tw = twist * t;
      const s = norm(add(mul(side, Math.cos(tw)), mul(u, Math.sin(tw))));
      const uu = norm(cross(s, tan));
      const hw = outline ? Math.max(outline(t), 0.02) : 1;   // share of the width here
      const half = w * 0.5 * hw;
      const lift = Math.sin(fold) * half;
      const inward = Math.cos(fold) * half;
      const left = madd(madd(c, s, -inward), uu, lift);
      const right = madd(madd(c, s, inward), uu, lift);
      // Normals of the two panels, tilted outward by the fold and the cup, and along the leaf
      // by the arch (up at the base, over toward the tip).
      const nm = norm(madd(uu, tan, arch * (t * 2 - 1)));
      const nl = norm(madd(nm, s, Math.sin(fold + cup)));
      const nr = norm(madd(nm, s, -Math.sin(fold + cup)));
      const la = [wind[0], wind[1], t, leafPhase];
      const L = [outline ? KIND.CUT : KIND.LEAF, shade, cell, gloss];
      const u0 = 0.5 - 0.5 * hw, u1 = 0.5 + 0.5 * hw;
      verts.push([
        this.vertex(left, nl, [u0, t], color, la, L),
        this.vertex(c, nm, [0.5, t], color, la, L),
        this.vertex(right, nr, [u1, t], color, la, L),
      ]);
    }
    for (let j = 0; j < rows - 1; j++) {
      const a = verts[j], b = verts[j + 1];
      this.quad(a[0], b[0], b[1], a[1]);
      this.quad(a[1], b[1], b[2], a[2]);
    }
  }

  // A strap leaf or a grass blade: a ribbon along a curve (pts), width tapering by widths,
  // keeled (folded) by fold, its upper face toward the side `face` at each point.
  // flat: two vertices across instead of three (grass blades), the normals tilted apart by
  // cup so the blade still shades as a rounded one.
  strap(pts, widths, faces, { colors, wind, leafPhase, shade, gloss = 0.3, fold = 0.3, trans = 0.5, flat = false, cup = 0.5 }) {
    const n = pts.length;
    const verts = [];
    let along = 0;
    for (let i = 0; i < n; i++) {
      if (i > 0) along += len(sub(pts[i], pts[i - 1]));
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const T = norm(sub(b, a));
      const s = norm(cross(T, faces[i]));
      const uu = norm(cross(s, T));
      const half = widths[i] * 0.5;
      const lift = Math.sin(fold) * half, inward = Math.cos(fold) * half;
      const t = i / (n - 1);
      const col = colors[i];
      const la = [wind[i][0], wind[i][1], t, leafPhase];
      const L = [KIND.STRAP, shade[i] ?? shade, 0, gloss];
      const nl = norm(madd(uu, s, Math.sin(fold))), nr = norm(madd(uu, s, -Math.sin(fold)));
      if (flat) {
        const ca = [col[0], col[1], col[2], trans];
        if (half < 1e-4) { const v = this.vertex(pts[i], uu, [0.5, t], ca, la, L); verts.push([v, v]); continue; }
        verts.push([
          this.vertex(madd(pts[i], s, -half), norm(madd(uu, s, -Math.sin(cup))), [0, t], ca, la, L),
          this.vertex(madd(pts[i], s, half), norm(madd(uu, s, Math.sin(cup))), [1, t], ca, la, L),
        ]);
      } else if (half < 1e-4) {
        const v = this.vertex(pts[i], uu, [0.5, t], [col[0], col[1], col[2], trans], la, L);
        verts.push([v, v, v]);
      } else {
        verts.push([
          this.vertex(madd(madd(pts[i], s, -inward), uu, lift), nl, [0, t], [col[0], col[1], col[2], trans], la, L),
          this.vertex(pts[i], uu, [0.5, t], [col[0], col[1], col[2], trans], la, L),
          this.vertex(madd(madd(pts[i], s, inward), uu, lift), nr, [1, t], [col[0], col[1], col[2], trans], la, L),
        ]);
      }
    }
    for (let i = 0; i < n - 1; i++) {
      const a = verts[i], b = verts[i + 1];
      if (flat) {
        if (b[0] === b[1]) this.tri(a[0], b[0], a[1]); else this.quad(a[0], b[0], b[1], a[1]);
        continue;
      }
      if (b[0] === b[1]) { this.tri(a[0], b[1], a[1]); this.tri(a[1], b[1], a[2]); continue; }
      this.quad(a[0], b[0], b[1], a[1]);
      this.quad(a[1], b[1], b[2], a[2]);
    }
  }

  // A card with a sprite from the leaf atlas (a rosette, a tuft): base at p, u the half-width
  // across (a vector), v the height (a vector), the sprite from vr[0] to vr[1] of its cell's
  // height. nb, nt: the normals at the bottom and the top (bent, so a flat card shades as a
  // rounded clump). c0, c1: colours at the bottom and the top. w0, w1: [branch amp, phase]
  // at the bottom and the top.
  card(p, u, v, { cell, vr = [0, 1], nb, nt, c0, c1, w0, w1, leafPhase, shade, gloss = 0.5 }) {
    this.alphaLeaves = true;
    const L = [KIND.LEAF, shade, cell, gloss];
    const ids = [
      this.vertex(madd(p, u, -1), nb, [0, vr[0]], c0, [w0[0], w0[1], 0, leafPhase], L),
      this.vertex(madd(p, u, 1), nb, [1, vr[0]], c0, [w0[0], w0[1], 0, leafPhase], L),
      this.vertex(add(madd(p, u, 1), v), nt, [1, vr[1]], c1, [w1[0], w1[1], 0.6, leafPhase], L),
      this.vertex(add(madd(p, u, -1), v), nt, [0, vr[1]], c1, [w1[0], w1[1], 0.6, leafPhase], L),
    ];
    this.quad(ids[0], ids[1], ids[2], ids[3]);
  }

  // Pack into a three.js geometry.
  geometry() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(this.pos), 3));
    const n8 = new Int8Array(this.nrm.length);
    for (let i = 0; i < n8.length; i++) n8[i] = Math.round(Math.max(-1, Math.min(1, this.nrm[i])) * 127);
    g.setAttribute('normal', new THREE.BufferAttribute(n8, 3, true));
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(this.uv), 2));
    const u8 = (arr) => { const o = new Uint8Array(arr.length); for (let i = 0; i < o.length; i++) o[i] = Math.round(clamp01(arr[i]) * 255); return o; };
    g.setAttribute('aColor', new THREE.BufferAttribute(u8(this.col.map((v, i) => (i % 4 === 3 ? v : Math.sqrt(v)))), 4, true));
    g.setAttribute('aWind', new THREE.BufferAttribute(u8(this.wind), 4, true));
    // kind and cell are small integers: stored as value / 255 (read back * 255 in the shader).
    g.setAttribute('aLeaf', new THREE.BufferAttribute(u8(this.leaf.map((v, i) => (i % 4 === 0 || i % 4 === 2 ? v / 255 : v))), 4, true));
    const I = this.count > 65535 ? new Uint32Array(this.idx) : new Uint16Array(this.idx);
    g.setIndex(new THREE.BufferAttribute(I, 1));
    g.computeBoundingSphere();
    g.computeBoundingBox();
    g.userData.alphaLeaves = this.alphaLeaves;
    return g;
  }
}

// ---------------------------------------------------------------- growing toward targets
//
// Woody plants are grown from the outside in: points are scattered through the crown's
// volume (where the leaf clusters will be), and the branches are the tree that joins them to
// the foot. Each node takes a group of targets, grows part of the way toward their middle,
// then splits them into two or three groups along their widest spread and does the same for
// each. A small group becomes twigs, one to each target, with a cluster of leaves at the
// end. Radii follow the pipe model: a branch carries the leaves above it.
//
// Returns the branch segments ({ pts, r, level, phase, amp }) and the twig ends
// ({ p, dir, amp, phase, shade }).
export function growToTargets(targets, opts, rand) {
  const { root = [0, 0, 0], rootDir = [0, 1, 0], trunk = 0, reach = 0.45, reach0 = reach, twigAt = 3, maxLevel = 7,
    radius = 0.012, tipRadius = 0.003, pipe = 2.3, bendUp = 0.25, sag = 0.15, crownC, crownR, lengthScale = 1,
    total = targets.length } = opts;
  const branches = [];
  const tips = [];
  const leavesUnder = (n) => radius * Math.pow(n / total, 1 / pipe);
  // Branch amplitude for wind: grows with how far out along the plant the point is.
  const ampAt = (p) => Math.min(1, len(sub(p, root)) / (lengthScale || 1));

  function curve(a, b, dirIn, level) {
    // A soft curve from a leaving along dirIn toward b, rising toward the light, sagging
    // with length.
    const L = len(sub(b, a));
    const segs = Math.max(2, Math.min(6, Math.round(L / 0.25)));
    const pts = [a];
    const mid = madd(lerp3(a, b, 0.5), norm(dirIn), L * 0.18);
    const lift = [0, L * (bendUp - sag * level / maxLevel) * 0.2, 0];
    for (let i = 1; i <= segs; i++) {
      const t = i / segs;
      // Quadratic through the pulled midpoint.
      const q = add(add(mul(a, (1 - t) * (1 - t)), mul(mid, 2 * t * (1 - t))), mul(b, t * t));
      pts.push(madd(madd(q, lift, 4 * t * (1 - t)), [rand.gauss() * 0.02 * L, rand.gauss() * 0.02 * L, rand.gauss() * 0.02 * L], t * (1 - t)));
    }
    return pts;
  }

  function node(p, dir, group, level, phase) {
    const n = group.length;
    if (n <= twigAt || level >= maxLevel) {
      for (const t of group) {
        const pts = curve(p, t, dir, level + 1);
        const r0 = Math.max(tipRadius, leavesUnder(1));
        branches.push({ pts, r: pts.map((_, i) => r0 * (1 - 0.5 * i / (pts.length - 1))), level: level + 1, phase: rand(), amp0: ampAt(p), amp1: ampAt(t) });
        const dEnd = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
        const cr = crownC ? len([(t[0] - crownC[0]) / crownR[0], (t[1] - crownC[1]) / crownR[1], (t[2] - crownC[2]) / crownR[2]]) : 1;
        tips.push({ p: pts[pts.length - 1], dir: dEnd, amp: ampAt(t), phase: branches[branches.length - 1].phase, shade: smooth(0.2, 1.0, cr), level: level + 1 });
      }
      return;
    }
    // Middle of the group, and how far toward it this branch grows.
    const c = group.reduce((a, t) => add(a, t), [0, 0, 0]).map((v) => v / n);
    const f = level === 0 && trunk > 0 ? 0 : (level === 0 ? reach0 : reach) * (0.8 + 0.4 * rand());
    let end = level === 0 && trunk > 0 ? madd(p, norm(rootDir), trunk) : lerp3(p, c, f);
    if (len(sub(end, p)) < 0.02) end = madd(p, norm(sub(c, p)), 0.02);
    const pts = curve(p, end, dir, level);
    const r0 = leavesUnder(n);
    const r1 = r0 * 0.93;
    branches.push({ pts, r: pts.map((_, i) => r0 + (r1 - r0) * i / (pts.length - 1)), level, phase: level < 2 ? phase : rand(), amp0: ampAt(p), amp1: ampAt(end) });
    const dEnd = norm(sub(pts[pts.length - 1], pts[pts.length - 2]));
    // Split along the widest spread of the group.
    let ax = [0, 0, 0], best = -1;
    for (const a of [[1, 0, 0], [0, 1, 0], [0, 0, 1], norm([1, 0, 1]), norm([1, 0, -1])]) {
      let lo = Infinity, hi = -Infinity;
      for (const t of group) { const v = dot(t, a); lo = Math.min(lo, v); hi = Math.max(hi, v); }
      if (hi - lo > best) { best = hi - lo; ax = a; }
    }
    const sorted = group.slice().sort((a, b) => dot(a, ax) - dot(b, ax));
    const k = n > 12 && rand() < 0.35 ? 3 : 2;
    for (let i = 0; i < k; i++) {
      const sub_ = sorted.slice(Math.floor(i * n / k), Math.floor((i + 1) * n / k));
      if (sub_.length) node(end, dEnd, sub_, level + 1, rand());
    }
  }
  node(root, rootDir, targets, 0, rand());
  return { branches, tips };
}

// Points spread through an ellipsoid (centre c, radii R), more of them toward its surface
// (bias > 1), only its part above y = floorY.
export function crownPoints(n, c, R, rand, { bias = 2.2, floorY = -Infinity, flatTop = 0 } = {}) {
  const out = [];
  let guard = 0;
  while (out.length < n && guard++ < n * 50) {
    const d = norm([rand.gauss(), rand.gauss(), rand.gauss()]);
    const r = Math.pow(rand(), 1 / bias);
    let p = [c[0] + d[0] * R[0] * r, c[1] + d[1] * R[1] * r, c[2] + d[2] * R[2] * r];
    if (flatTop > 0 && p[1] > c[1]) p[1] = c[1] + (p[1] - c[1]) * (1 - flatTop);
    if (p[1] < floorY) continue;
    out.push(p);
  }
  return out;
}
