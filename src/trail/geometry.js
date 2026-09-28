// The things along the path (v6), built in the terrain worker from the route (route.js) and
// the carved ground, as plain arrays for the page (trail.js):
//
//   treads   the walking surface, one mesh per material: concrete steps (level blocks with
//            risers and side walls down into the ground) and the dirt path (level treads on the
//            steep stretches, following the ground on the gentle ones, with a skirt at each edge
//            that tucks into the ground),
//   logs     a log laid across each dirt riser, the top of it at the upper tread,
//   posts and rails  the handrail on both sides: sawn timber (square posts, two plank rails)
//            on the concrete steps and the ridge, bamboo lashed with blue rope lower down,
//   lashings the cord lashings at every joint of the bamboo rails (v13),
//   stones   loose limestone on the treads and the verges (v10).
//
// (v10) Nothing laid by hand on a cliff path stays ruler straight: each tread sits a little
// high or low and tilts, its front edge wanders and is worn round, the odd one has broken
// away at a corner; the logs are knocked askew, broken or rotted, some pegged; the posts lean,
// the rails sag, a few are missing or hang from one end.
//
// Instances are 4x4 matrices (column-major, three.js order) on unit shapes: a box 1 m a side
// centred on the origin, a cylinder of radius 1 along y from -0.5 to 0.5. Each instance also
// gets a random number for its shading.
//
// World coordinates as three.js has them: x east, y up, z south.

import { DS } from './route.js';
import { padDistance } from './carve.js';

// How far the dirt runs out past the tread's edge, down to the ground: over the level shoulder
// the carve leaves (0.7 m), so the trodden verge is the path's own, not the ground shader's
// (a lookup of the carve's mask there cost 2 ms at the overview, v6).
const SKIRT = 0.8;

export function buildTrailGeometry(route, heightAt, spec, seed = 5) {
  const t0 = performance.now();
  const R = route, n = R.n;
  const rand = mulberry32(seed);
  const kindAt = (q) => spec.sections[R.sec[Math.min(Math.max(Math.round(q / DS), 0), n - 1)]];

  // The line at any distance along it.
  function frame(q) {
    const f = Math.min(Math.max(q / DS, 0), n - 1.0001), i = Math.floor(f), u = f - i;
    const L = (a) => a[i] + (a[i + 1] - a[i]) * u;
    let tx = L(R.tx), ty = L(R.ty);
    const tl = Math.hypot(tx, ty) || 1;
    tx /= tl; ty /= tl;
    return { x: L(R.x), y: L(R.y), tx, ty, nx: -ty, ny: tx, w: L(R.w), hd: L(R.hd), ht: L(R.ht) };
  }

  // ---------------------------------------------------------------- treads
  // (v13: the dirt is smooth-shaded across its shared positions, see mesh().)
  const concrete = mesh(), dirt = mesh(true);
  const noise = makeNoise(seed + 3);
  // Where to sample a tread: its ends and every route sample between.
  const samplesIn = (a, b) => {
    const out = [a];
    for (let i = Math.ceil(a / DS + 1e-6); i * DS < b - 1e-6; i++) out.push(i * DS);
    out.push(b);
    return out;
  };
  const hash = (k, salt) => { let x = (k * 374761393 + salt * 668265263 + seed * 144665) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967295; };
  const bump = (t) => { t = Math.abs(t); return t >= 1 ? 0 : (1 - t * t) * (1 - t * t); };
  const TR = R.treads, NT = TR.length;
  const isConcrete = (k) => kindAt(0.5 * (TR[k].s0 + TR[k].s1)).kind === 'concrete';
  // Each level tread a little high or low, and tilted across (m at its edge).
  const jit = TR.map((tr, k) => (tr.T === undefined || tr.T === null ? { dh: 0, tilt: 0 }
    : isConcrete(k) ? { dh: (hash(k, 1) - 0.5) * 0.012, tilt: (hash(k, 2) - 0.5) * 0.014 }
    : { dh: (hash(k, 1) - 0.5) * 0.04, tilt: (hash(k, 2) - 0.5) * 0.07 }));
  const levelAt = (k, q) => (TR[k].T ?? frame(q).hd) + jit[k].dh;
  // Each boundary k (between tread k and k + 1): which tread is the upper one, and how high the
  // riser between them is.
  const bnd = TR.slice(0, -1).map((tr, k) => {
    const hA = levelAt(k, tr.s1), hB = levelAt(k + 1, tr.s1);
    return { upper: hA >= hB ? k : k + 1, rise: Math.abs(hA - hB), isC: isConcrete(k) };
  });
  // The edge's wobble along the line (m), and how much of the upper tread's edge has worn or
  // broken away (m down).
  const edgeOff = (k, a) => (bnd[k].isC ? 0.012 * noise(k * 3.7, a * 2.1)
    : 0.05 * noise(k * 3.7 + 11, a * 1.4) + 0.02 * noise(k * 5.1 + 9, a * 4.3));
  const edgeDrop = (k, a) => {
    const { rise, isC } = bnd[k];
    if (rise < 0.03) return 0;
    const r = hash(k, 3);
    if (isC) {
      const worn = 0.006;
      if (r > 0.2) return worn;
      const c = (hash(k, 4) * 2 - 1) * 0.85, w = 0.1 + 0.12 * hash(k, 5);
      return worn + Math.min(0.06, rise * 0.4) * bump((a - c) / w);
    }
    const worn = Math.min(rise * 0.25, 0.012 + 0.014 * hash(k, 7));
    if (r > 0.16) return worn;
    // Broken away at one corner, a hand's depth down to half the riser.
    const c = (hash(k, 4) > 0.5 ? 1 : -1) * (0.45 + 0.5 * hash(k, 6)), w = 0.35 + 0.5 * hash(k, 5);
    return worn + rise * (0.3 + 0.4 * hash(k, 8)) * bump((a - c) / w);
  };
  // A vertex of tread k at q, across a (-1..1): on its first or last row the edge's wobble and,
  // on the upper tread of a riser, its worn edge.
  const vertAt = (k, q, a, role) => {
    const tr = TR[k], f = frame(q), hw = f.w / 2, isC = isConcrete(k);
    let along = 0, drop = 0;
    const b = role === 'first' ? k - 1 : role === 'last' ? k : -1;
    if (b >= 0 && b < NT - 1) { along = edgeOff(b, a); if (bnd[b].upper === k) drop = edgeDrop(b, a); }
    const px = f.x + f.nx * a * hw + f.tx * along, py = f.y + f.ny * a * hw + f.ty * along;
    let dh = jit[k].tilt * a;
    // Dirt: a little dished where feet wear it, and lumpy.
    if (!isC) dh += -0.035 * (1 - a * a) + 0.02 * noise(px * 2.1, py * 2.1) + 0.01 * noise(px * 7.3 + 5, py * 7.3);
    return [px, levelAt(k, q) + dh - drop, py, a];
  };
  // How far a point of tread k is from its back edge, the foot of the riser above it (m; 9 where
  // there is none), for the dirt and grime that collect there.
  const backDist = (k, q) => {
    const tr = TR[k];
    let d = 9;
    if (k > 0 && bnd[k - 1].upper === k - 1 && bnd[k - 1].rise > 0.03) d = Math.min(d, q - tr.s0);
    if (k < NT - 1 && bnd[k].upper === k + 1 && bnd[k].rise > 0.03) d = Math.min(d, tr.s1 - q);
    return d;
  };
  // And from its front edge, the nosing over the riser below it (m, at most 0.45): packed into
  // the face kind's fraction for the shader (kind + distance, kind 0 for a tread).
  const frontDist = (k, q) => {
    const tr = TR[k];
    let d = 0.45;
    if (k > 0 && bnd[k - 1].upper === k && bnd[k - 1].rise > 0.03) d = Math.min(d, q - tr.s0);
    if (k < NT - 1 && bnd[k].upper === k && bnd[k].rise > 0.03) d = Math.min(d, tr.s1 - q);
    return d;
  };
  // ---- (v13) The dirt treads, finer. Each was five or six big flat quads with a razor edge and a
  // flat riser, which read as polygons (Sam: "too polygon"). Now rows every few centimetres
  // toward each edge and columns 6 cm apart; the front edge rolled over (the nosing), soil
  // heaped against the foot of each riser, the riser itself hollowed and lumpy, and the side
  // banks easing into the ground instead of running down in one plane.
  const ACROSS_D = Array.from({ length: 11 }, (_, i) => -1 + (2 * i) / 10);
  const smooth = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };
  const hasLog = new Array(NT).fill(false);
  const bevel = (b, a, d) => {
    const rise = bnd[b].rise;
    if (rise < 0.05) return 0;
    // (Where a log lies along the edge the soil comes up to it, and there is little to round.)
    const rb = Math.min(0.052, rise * 0.32) * (hasLog[b] ? 0.25 : 1) * (0.75 + 0.25 * noise(b * 3.1 + 5, a * 2.3));
    if (d >= rb) return 0;
    const u = Math.min(Math.max((rb - d) / rb, 0), 1);
    return rb * (1 - Math.sqrt(1 - u * u));
  };
  const fillet = (b, a, d) => {
    const rise = bnd[b].rise;
    if (rise < 0.05 || d >= 0.13) return 0;
    const hMax = Math.min(0.036, rise * 0.15) * (0.7 + 0.3 * noise(b * 2.7 + 8, a * 1.9)) * (hasLog[b] ? 1.3 : 1);
    const u = 1 - d / 0.13;
    return hMax * u * u;
  };
  const vertAtDirt = (k, q, a) => {
    const tr = TR[k], f = frame(q), hw = f.w / 2;
    const dF = q - tr.s0, dL = tr.s1 - q;
    // (Only the nearer boundary counts, so a short tread's two ends never meet in its middle.)
    const b = dF <= dL ? k - 1 : k, d = Math.min(dF, dL);
    let along = 0, drop = 0, heap = 0;
    if (b >= 0 && b < NT - 1) {
      const w = 1 - smooth(0, 0.14, d);
      along = edgeOff(b, a) * w;
      if (bnd[b].upper === k) drop = edgeDrop(b, a) * w + bevel(b, a, d);
      else heap = fillet(b, a, d);
    }
    const px = f.x + f.nx * a * hw + f.tx * along, py = f.y + f.ny * a * hw + f.ty * along;
    const dh = jit[k].tilt * a - 0.035 * (1 - a * a) + 0.02 * noise(px * 2.1, py * 2.1) + 0.01 * noise(px * 7.3 + 5, py * 7.3)
      + 0.007 * noise(px * 11 + 3, py * 11 + 9);
    return [px, levelAt(k, q) + dh - drop + heap, py, a];
  };
  // Rows of a dirt tread: the route's samples, and closer together toward both ends.
  const denseRows = (a, b) => {
    // (The route's samples are 25 cm apart: kept only every second one in the middle of a tread.)
    const all = samplesIn(a, b), keep = all.filter((v, i) => i === 0 || i === all.length - 1 || i % 2 === 0);
    const set = new Set(keep.map((v) => +v.toFixed(5)));
    for (const d of [0.03, 0.075, 0.14]) {
      if (d < (b - a) / 2 - 0.01) { set.add(+(a + d).toFixed(5)); set.add(+(b - d).toFixed(5)); }
    }
    return [...set].sort((x, y) => x - y);
  };
  // From a tread's edge vertex V out to the ground, in two steps that roll off the edge and
  // then run with the ground (it was a straight ramp).
  const skirtPts = (V, f, side) => {
    const out = [V];
    for (const t of [0.4, 1]) {
      const ox = V[0] + f.nx * side * SKIRT * t, oy = V[2] + f.ny * side * SKIRT * t;
      const g = Math.min(heightAt(ox, oy), V[1]) - 0.07 * t;
      const e = t * t * (3 - 2 * t);
      out.push([ox, V[1] + (g - V[1]) * (0.35 * t + 0.65 * e) + 0.012 * noise(ox * 3.1 + 3, oy * 3.1) * 4 * t * (1 - t), oy, side * (1 + 0.3 * t)]);
    }
    return out;
  };
  const logs = instances();
  for (let k = 0; k < NT; k++) {
    const tr = TR[k];
    if (tr.s1 - tr.s0 < 1e-4) continue;
    const isC = isConcrete(k);
    // (v13) Whether a log lies along the riser at the end of this tread, worked out first (the
    // nosing depends on it): the same draw, at the same place in the sequence, as before.
    const logHere = !isC && k < NT - 1 && bnd[k].rise >= 0.12 && rand() < 0.55;
    hasLog[k] = logHere;
    const M = isC ? concrete : dirt;
    const qs = isC ? samplesIn(tr.s0, tr.s1) : denseRows(tr.s0, tr.s1);
    // Across the tread: concrete flat, dirt a little dished where feet wear it, and lumpy.
    const across = isC ? [-1, -0.5, 0, 0.5, 1] : ACROSS_D;
    const rows = qs.map((q, qi) => {
      const f = frame(q), role = qi === 0 ? 'first' : qi === qs.length - 1 ? 'last' : 'mid';
      return { q, f, back: backDist(k, q), front: frontDist(k, q), verts: across.map((a) => (isC ? vertAt(k, q, a, role) : vertAtDirt(k, q, a))) };
    });
    // Top surface.
    for (let r = 0; r + 1 < rows.length; r++) {
      const A = rows[r], B = rows[r + 1];
      for (let c = 0; c + 1 < across.length; c++) {
        M.quad(A.verts[c], B.verts[c], B.verts[c + 1], A.verts[c + 1], [A.front, A.q, A.back], [B.front, B.q, B.back]);
      }
    }
    // The edges: concrete stands as a block with vertical sides down into the ground; the dirt
    // gets a skirt out to the ground 25 cm beyond its edge.
    for (const side of [-1, 1]) {
      const ci = side < 0 ? 0 : across.length - 1;
      for (let r = 0; r + 1 < rows.length; r++) {
        const A = rows[r], B = rows[r + 1];
        const ea = A.verts[ci], eb = B.verts[ci];
        if (isC) {
          const ga = Math.min(heightAt(ea[0], ea[2]), ea[1]) - 0.3, gb = Math.min(heightAt(eb[0], eb[2]), eb[1]) - 0.3;
          const wall = [[ea[0], ga, ea[2]], [eb[0], gb, eb[2]]];
          if (side > 0) M.quad(ea, eb, [...wall[1], 1], [...wall[0], 1], [1, A.q, 9], [1, B.q, 9]);
          else M.quad(ea, [...wall[0], -1], [...wall[1], -1], eb, [1, A.q, 9], [1, B.q, 9]);
        } else {
          const sa = skirtPts(ea, A.f, side), sb = skirtPts(eb, B.f, side);
          for (let j = 0; j + 1 < sa.length; j++) {
            if (side > 0) M.quad(sa[j], sb[j], sb[j + 1], sa[j + 1], [2, A.q, 9], [2, B.q, 9]);
            else M.quad(sa[j], sa[j + 1], sb[j + 1], sb[j], [2, A.q, 9], [2, B.q, 9]);
          }
        }
      }
    }
    // The riser at the end of this tread, down (or up) to the next one: between this tread's
    // last row and the next one's first, so it follows both edges.
    if (k < NT - 1 && bnd[k].rise > 0.01) {
      const f = frame(tr.s1);
      const up = bnd[k].upper, lo = up === k ? k + 1 : k;
      const dir = up === k ? 1 : -1;   // which way the riser faces along the line
      const tops = across.map((a) => (isC ? vertAt(up, tr.s1, a, up === k ? 'last' : 'first') : vertAtDirt(up, tr.s1, a)));
      const bots = across.map((a) => { const v = isC ? vertAt(lo, tr.s1, a, lo === k ? 'last' : 'first') : vertAtDirt(lo, tr.s1, a); return [v[0], v[1] - (isC ? 0 : 0), v[2], a]; });   // (v13: the dirt riser's foot is the tread's own edge exactly, it was 1 cm under, and the bank's seam showed as a hairline)
      if (isC) {
        for (let c = 0; c + 1 < across.length; c++) {
          const va = tops[c], vb = tops[c + 1], vc = bots[c + 1], vd = bots[c];
          if (dir > 0) M.quad(va, vd, vc, vb, [3, tr.s1, 9], [3, tr.s1, 9]);
          else M.quad(va, vb, vc, vd, [3, tr.s1, 9], [3, tr.s1, 9]);
        }
      } else {
        // The dirt riser: six rows down, hollowed a little under the nosing and lumpy, from the
        // rolled edge to the heaped foot.
        const RR = 4, rr = [];
        for (let i = 0; i <= RR; i++) {
          const t = i / RR, w = Math.sin(Math.PI * t);
          rr.push(tops.map((tp, c) => {
            const bt = bots[c], a = across[c];
            const off = dir * (-0.016 * w + 0.016 * w * noise(a * 4.3 + k * 9.1, t * 2.7 + 3));
            return [tp[0] + (bt[0] - tp[0]) * t + f.tx * off, tp[1] + (bt[1] - tp[1]) * t, tp[2] + (bt[2] - tp[2]) * t + f.ty * off, a];
          }));
        }
        for (let i = 0; i < RR; i++) {
          for (let c = 0; c + 1 < across.length; c++) {
            const va = rr[i][c], vb = rr[i][c + 1], vc = rr[i + 1][c + 1], vd = rr[i + 1][c];
            if (dir > 0) M.quad(va, vd, vc, vb, [3, tr.s1, 9], [3, tr.s1, 9]);
            else M.quad(va, vb, vc, vd, [3, tr.s1, 9], [3, tr.s1, 9]);
          }
        }
        // The dirt skirts of the two treads meet the riser at different heights: close the gap,
        // along the same four steps as the skirts, from every row of the riser's own edge (which
        // bows in and out, so a fill hung from its two ends left a hairline).
        for (const side of [-1, 1]) {
          const ci = side < 0 ? 0 : across.length - 1;
          for (let i = 0; i < RR; i++) {
            const sa = skirtPts(rr[i][ci], f, side), sb = skirtPts(rr[i + 1][ci], f, side);
            for (let j = 0; j + 1 < sa.length; j++) {
              // (Facing out of the bank, whichever way round the two treads are.)
              const q4 = [sa[j], sa[j + 1], sb[j + 1], sb[j]];
              const A0 = q4[0], A1 = q4[1], B0 = q4[3];
              const u = [A1[0] - A0[0], A1[1] - A0[1], -(A1[2] - A0[2])], v = [B0[0] - A0[0], B0[1] - A0[1], -(B0[2] - A0[2])];
              const cr = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]];
              const outward = cr[0] * f.nx * side + cr[2] * -f.ny * side + cr[1] * 0.3;
              if (outward > 0) M.quad(q4[0], q4[1], q4[2], q4[3], [2, tr.s1, 9], [2, tr.s1, 9]);
              else M.quad(q4[0], q4[3], q4[2], q4[1], [2, tr.s1, 9], [2, tr.s1, 9]);
            }
          }
        }
      }
      // A log holds about half of the dirt risers: knocked askew, broken or rotted now and then,
      // some pegged at the ends.
      const rise = bnd[k].rise;
      if (logHere) {
        // (v13) It rests on the highest point of the edge across the tread: the tread is dished, so
        // its edges stand a few centimetres above the middle, and a log set to the middle was buried
        // at both ends and came out a wedge.
        const hi = Math.max(...tops.map((t) => t[1])) + 0.006;
        const along0 = edgeOff(k, 0);
        const r = 0.045 + 0.03 * rand();
        const kind = rand();
        let yaw = (rand() - 0.5) * 0.18, tilt = (rand() - 0.5) * 0.06, shift = 0, len = f.w + 0.3 + 0.2 * rand();
        if (kind < 0.2) { yaw = (rand() - 0.5) * 0.6; shift = (rand() - 0.5) * 0.4; tilt = (rand() - 0.5) * 0.12; }
        const ax = f.nx * Math.cos(yaw) - f.ny * Math.sin(yaw), ay = f.nx * Math.sin(yaw) + f.ny * Math.cos(yaw);
        const cx = f.x + f.tx * (along0 + dir * r * 0.45) + f.nx * shift, cy = f.y + f.ty * (along0 + dir * r * 0.45) + f.ny * shift;
        const shade = rand();
        const piece = (o, L, rr, dz, tl) => logs.push(cylinderAlong([cx + ax * o, hi - rr + dz, cy + ay * o], [ax, tl, ay], L, rr), shade);
        if (kind > 0.8 && kind < 0.9) {
          // Broken in two, the pieces settled at different heights.
          const g = 0.08 + 0.15 * rand(), L1 = (len - g) * (0.35 + 0.3 * rand()), L2 = len - g - L1;
          piece(-len / 2 + L1 / 2, L1, r, 0, tilt);
          piece(len / 2 - L2 / 2, L2, r * 0.95, -0.02 - 0.04 * rand(), tilt + (rand() - 0.5) * 0.25);
        } else if (kind >= 0.9) {
          // Rotted away but for a stub at one side.
          const L1 = len * (0.35 + 0.25 * rand()), sgn = rand() < 0.5 ? -1 : 1;
          piece(sgn * (len / 2 - L1 / 2), L1, r * 0.8, -0.03, tilt);
        } else piece(0, len, r, 0, tilt);
        // Pegs at the ends, on the downhill side.
        if (kind < 0.8 && rand() < 0.5) {
          for (const e of [-1, 1]) {
            const o = e * (len / 2 - 0.12);
            const px = cx + ax * o + f.tx * dir * (r + 0.03), py = cy + ay * o + f.ty * dir * (r + 0.03);
            const lean = [(rand() - 0.5) * 0.08, (rand() - 0.5) * 0.08];
            logs.push(cylinderBetween([px, hi - 0.25, py], [px + lean[0], hi + 0.02 + 0.05 * rand(), py + lean[1]], 0.018 + 0.01 * rand()), shade);
          }
        }
      }
    }
  }

  // ---------------------------------------------------------------- pads
  // A level concrete slab (the viewpoint platform), its edge rounded, its sides running down
  // into the ground.
  for (const q of spec.pads ?? []) {
    const a = (q.heading * Math.PI) / 180, ux = Math.sin(a), uy = Math.cos(a), vx = -uy, vy = ux;
    // The outline: round the corners every 15 degrees.
    const ring = [];
    const cu = q.half[0] - q.round, cv = q.half[1] - q.round;
    for (const [su, sv, a0] of [[1, 1, 0], [-1, 1, 90], [-1, -1, 180], [1, -1, 270]]) {
      for (let k = 0; k <= 6; k++) {
        const t = ((a0 + k * 15) * Math.PI) / 180;
        const pu = su * cu + q.round * Math.cos(t), pv = sv * cv + q.round * Math.sin(t);
        ring.push([q.at[0] + ux * pu + vx * pv, q.at[1] + uy * pu + vy * pv]);
      }
    }
    // Top: a fan of rings from the middle, so the edge band can darken (across = 1 at the edge).
    const rings = [0, 0.55, 0.8, 0.93, 1];
    const pt = (k, f) => [q.at[0] + (ring[k][0] - q.at[0]) * f, q.h, q.at[1] + (ring[k][1] - q.at[1]) * f, f];
    for (let r = 0; r + 1 < rings.length; r++) {
      for (let k = 0; k < ring.length; k++) {
        const k2 = (k + 1) % ring.length;
        concrete.quad(pt(k, rings[r]), pt(k, rings[r + 1]), pt(k2, rings[r + 1]), pt(k2, rings[r]), [0, 0, 0], [0, 0, 0]);
      }
    }
    for (let k = 0; k < ring.length; k++) {
      const k2 = (k + 1) % ring.length;
      const [x1, y1] = ring[k], [x2, y2] = ring[k2];
      const g1 = Math.min(heightAt(x1, y1), q.h) - 0.3, g2 = Math.min(heightAt(x2, y2), q.h) - 0.3;
      concrete.quad([x1, q.h, y1, 1], [x1, g1, y1, 1], [x2, g2, y2, 1], [x2, q.h, y2, 1], [1, 0, 0], [1, 0, 0]);
    }
  }
  const onPad = (x, y, m) => (spec.pads ?? []).some((q) => padDistance(q, x, y) < m);

  // ---------------------------------------------------------------- handrails
  const timberPosts = instances(), timberRails = instances(), bambooPosts = instances(), bambooRails = instances();
  // (v13) The cord lashings, in two parts (trail.js): turns round the post, above and below the
  // rail, with the knot and the loose ends, and turns round the rail either side of the post.
  // Three variants of each, so they are not all the same.
  const lashPost = [instances(), instances(), instances()], lashRail = [instances(), instances(), instances()];
  // Is (px, py) on or right beside another stretch of the path (a hairpin's other leg)?
  const clashes = (px, py, q) => {
    let hit = false;
    R.near(px, py, 1.6, (i, d) => { if (!hit && Math.abs(R.s[i] - q) > 3 && d < R.w[i] / 2 + 0.3) hit = true; });
    return hit;
  };
  for (const side of [-1, 1]) {
    let q = 0.4 + rand() * 0.5, prev = null, span = 0;
    while (q < R.length - 1.2) {
      const sec = kindAt(q), bamboo = sec.rails === 'bamboo';
      const f = frame(q);
      const off = f.w / 2 + (bamboo ? 0.12 : 0.1);
      const px = f.x + f.nx * side * off, py = f.y + f.ny * side * off;
      const step = bamboo ? 1.45 + 0.6 * rand() : 2.0 + 0.2 * rand();
      // (No handrail across another stretch of the path, or on the platform.)
      if (clashes(px, py, q) || onPad(px, py, 0.4)) { prev = null; q += step; continue; }
      if (prev && prev.bamboo !== bamboo) prev = null;
      const ground = heightAt(px, py);
      const base = Math.min(ground, f.hd) - 0.35;
      // (v10) Heights and leans vary; now and then a post has snapped off low.
      const broken = rand() < (bamboo ? 0.03 : 0.04);
      const height = broken ? 0.45 + 0.25 * rand() : (bamboo ? 0.95 + 0.12 * (rand() - 0.5) : 1.02 + 0.06 * (rand() - 0.5));
      const topH = f.hd + height;
      const post = { span: span++, q, x: px, y: py, base, top: topH, hd: f.hd, bamboo, broken, height, lean: bamboo ? [(rand() - 0.5) * 0.09, (rand() - 0.5) * 0.09] : [(rand() - 0.5) * 0.05, (rand() - 0.5) * 0.05], f };
      if (bamboo) {
        const r = 0.032 + 0.01 * rand();
        const bx = px + post.lean[0] * (topH - base), by = py + post.lean[1] * (topH - base);
        bambooPosts.push(cylinderBetween([px, base, py], [bx, topH, by], r), rand());
        post.r = r;
      } else {
        const bx = px + post.lean[0] * (topH - base), by = py + post.lean[1] * (topH - base);
        timberPosts.push(boxBetween([px, base, py], [bx, topH, by], [f.tx, f.ty], 0.1, 0.1), rand());
      }
      if (prev && Math.hypot(px - prev.x, py - prev.y) < 3.4) {
        // Rails from post to post on the inside faces, following the design line.
        const inX = -f.nx * side, inY = -f.ny * side;
        const heights = bamboo ? [0.42, 0.88] : [0.52, 0.95];
        heights.forEach((hr, k) => {
          if (bamboo && k === 0 && rand() < 0.12) return;   // the odd lower rail gone
          if (!bamboo && rand() < 0.05) return;             // (v10) and the odd timber one
          // Nothing to hold it above a post that has snapped off.
          if ((prev.broken && hr > prev.height - 0.05) || (post.broken && hr > post.height - 0.05)) return;
          // (v10) Timber rails sag a little and sit unevenly; the odd one hangs from one end.
          const hang = rand() < 0.03 ? -(0.25 + 0.2 * rand()) : 0;
          const endA = bamboo ? 0 : (rand() - 0.5) * 0.04, endB = bamboo ? 0 : (rand() - 0.5) * 0.04 + (rand() < 0.5 ? hang : 0);
          // (v13) Where two rails meet at a post they run on past it side by side (they were on the
          // same line, one through the other): alternate spans lie a rail's width further in.
          const lane = bamboo ? post.span % 2 : 0;
          const inset = bamboo ? 0.055 + 0.054 * lane : 0.065;
          const sag = bamboo ? (rand() - 0.5) * 0.08 : 0;
          // (v13: drawn here, at the same place in the sequence, so the lashings can be sized to it.)
          const railR = bamboo ? 0.022 + 0.006 * rand() : 0;
          const a = [prev.x + prev.lean[0] * (hr + 0.35) + inX * inset, prev.hd + hr + sag + endA, prev.y + prev.lean[1] * (hr + 0.35) + inY * inset];
          const b = [px + post.lean[0] * (hr + 0.35) + inX * inset, f.hd + hr + sag + endB, py + post.lean[1] * (hr + 0.35) + inY * inset];
          if (bamboo) {
            // Bamboo runs on a little past each post.
            const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
            const ext = 0.12 / L;
            bambooRails.push(cylinderBetween([a[0] - d[0] * ext, a[1] - d[1] * ext, a[2] - d[2] * ext], [b[0] + d[0] * ext, b[1] + d[1] * ext, b[2] + d[2] * ext], railR), rand());
            // Blue cord lashing it to the posts (v13: turns of thin cord round the joint, a knot and
            // two loose ends, as in trail-mid-descent-b.jpg. It was a smooth blue collar).
            for (const [p, pr] of [[a, prev], [b, post]]) {
              const rr = rand(), variant = Math.min(2, Math.floor(rr * 3));
              const [mp, mr] = lashingMatrices(p, [inX, inY], pr, [b[0] - a[0], b[1] - a[1], b[2] - a[2]], inset, railR);
              // (The turns round the post only for the rail next to it.)
              if (lane === 0) lashPost[variant].push(mp, rr * 3 - variant);
              lashRail[variant].push(mr, rr * 3 - variant);
            }
          } else {
            const mid = [0.5 * (a[0] + b[0]), 0.5 * (a[1] + b[1]), 0.5 * (a[2] + b[2])];
            const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
            timberRails.push(boxAlong(mid, d, [Math.hypot(...d) + 0.12, 0.1, 0.032]), rand());
          }
        });
      }
      prev = post;
      q += step;
    }
  }

  // ---------------------------------------------------------------- stones (v10)
  // Loose limestone: along the verges, more of it lower down where the path is steep and dirt,
  // the odd one on a tread, a little debris on the concrete. Mostly small, half buried.
  const stones = instances();
  for (let q = 0.3; q < R.length - 0.3; q += 0.2) {
    const sec = kindAt(q), f = frame(q);
    const many = sec.kind === 'descent' ? 1 : sec.kind === 'ridge' ? 0.7 : 0.2;
    const put = (a, size) => {
      const along = (rand() - 0.5) * 0.2;
      const px = f.x + f.nx * a * f.w / 2 + f.tx * along, py = f.y + f.ny * a * f.w / 2 + f.ty * along;
      if (onPad(px, py, 0.3)) return;
      const ground = Math.abs(a) < 0.95 ? f.ht - (sec.kind === 'concrete' ? 0 : 0.035 * (1 - a * a)) : Math.min(heightAt(px, py), f.ht);
      const sy = size * (0.45 + 0.4 * rand());
      stones.push(stoneMatrix([px, ground - sy * (0.25 + 0.3 * rand()), py], rand() * Math.PI * 2, (rand() - 0.5) * 0.5,
        [size * (0.8 + 0.5 * rand()), sy, size * (0.8 + 0.5 * rand())]), rand());
    };
    for (const side of [-1, 1]) {
      if (rand() < 0.5 * many) put(side * (0.85 + 0.6 * rand()), 0.04 + 0.26 * Math.pow(rand(), 2.2));
    }
    if (rand() < 0.08 * many) put((rand() * 2 - 1) * 0.7, 0.03 + 0.07 * rand());
  }

  return {
    concrete: concrete.done(), dirt: dirt.done(),
    logs: logs.done(), stones: stones.done(), timberPosts: timberPosts.done(), timberRails: timberRails.done(),
    bambooPosts: bambooPosts.done(), bambooRails: bambooRails.done(),
    lashPost0: lashPost[0].done(), lashPost1: lashPost[1].done(), lashPost2: lashPost[2].done(),
    lashRail0: lashRail[0].done(), lashRail1: lashRail[1].done(), lashRail2: lashRail[2].done(),
    ms: Math.round(performance.now() - t0),
  };
}

// ---------------------------------------------------------------- builders

// A triangle mesh with per-vertex aTrail = (across, along, face kind, back): across -1..1 on the
// tread (beyond on a skirt), metres along the line, what the face is (0 tread, 1 concrete
// side, 2 dirt skirt, 3 riser), and on a tread how far it is from the foot of the riser behind
// it (v10; 9 for none). Normals are worked out from the faces around each vertex.
function mesh(smooth = false) {
  const pos = [], trail = [], idx = [];
  const add = (v, t) => { pos.push(v[0], v[1], -v[2]); trail.push(v[3] ?? 0, t[1], t[0], t[2] ?? 9); return pos.length / 3 - 1; };
  return {
    // Corners a, b, c, d counterclockwise seen from the outside; ta for a and d, tb for b and c.
    quad(a, b, c, d, ta, tb) {
      const i = add(a, ta), j = add(b, tb), k = add(c, tb), l = add(d, ta);
      idx.push(i, j, k, i, k, l);
    },
    tri(a, b, c, t) { const i = add(a, t), j = add(b, t), k = add(c, t); idx.push(i, j, k); },
    done() {
      const P = new Float32Array(pos), I = new Uint32Array(idx), N = new Float32Array(P.length);
      for (let t = 0; t < I.length; t += 3) {
        const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
        const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2];
        const vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
        const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
        for (const o of [a, b, c]) { N[o] += nx; N[o + 1] += ny; N[o + 2] += nz; }
      }
      // (v13) Smooth: every vertex at the same place (to 2 mm) takes the normal of all the faces
      // there, whatever piece they belong to, so a rounded nosing shades round, and the tread
      // runs into its riser and its bank without a crease. Every quad has its own vertices, so
      // without this each is flat shaded. (The concrete keeps its crisp edges.)
      if (smooth) {
        const sum = new Map(), key = (o) => Math.round(P[o] * 500) + ',' + Math.round(P[o + 1] * 500) + ',' + Math.round(P[o + 2] * 500);
        for (let o = 0; o < N.length; o += 3) {
          const k = key(o);
          let e = sum.get(k);
          if (!e) sum.set(k, e = [0, 0, 0]);
          e[0] += N[o]; e[1] += N[o + 1]; e[2] += N[o + 2];
        }
        for (let o = 0; o < N.length; o += 3) { const e = sum.get(key(o)); N[o] = e[0]; N[o + 1] = e[1]; N[o + 2] = e[2]; }
      }
      for (let o = 0; o < N.length; o += 3) {
        const l = Math.hypot(N[o], N[o + 1], N[o + 2]);
        // (A vertex of degenerate triangles only, at a tight hairpin: straight up.)
        if (l < 1e-9) { N[o] = 0; N[o + 1] = 1; N[o + 2] = 0; continue; }
        N[o] /= l; N[o + 1] /= l; N[o + 2] /= l;
      }
      return { position: P, normal: N, trail: new Float32Array(trail), index: I };
    },
  };
}

function instances() {
  const m = [], r = [];
  return {
    push(mat, rnd) { m.push(...mat); r.push(rnd); },
    done() { return { matrices: new Float32Array(m), rand: new Float32Array(r), count: r.length }; },
  };
}

// Map coordinates (east, height, north) to three.js, and matrices for the unit shapes.
// A box centred at c (map x, h, y), its local x along d (map), local y up (as near vertical as
// d allows), size [sx, sy, sz].
function boxAlong(c, d, size) {
  let ex = [d[0], d[1] ?? 0, -d[2]];
  const el = Math.hypot(...ex) || 1;
  ex = ex.map((v) => v / el);
  let ey = [0, 1, 0];
  const dot = ex[1];
  ey = [ey[0] - ex[0] * dot, ey[1] - ex[1] * dot, ey[2] - ex[2] * dot];
  const yl = Math.hypot(...ey) || 1;
  ey = ey.map((v) => v / yl);
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  return compose(ex, ey, ez, size, [c[0], c[1], -c[2]]);
}
// A box from a to b (map x, h, y; its local y along them), sx by sz across, its local x turned
// toward t (map x, y).
function boxBetween(a, b, t, sx, sz) {
  const A = [a[0], a[1], -a[2]], B = [b[0], b[1], -b[2]];
  let ey = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L = Math.hypot(...ey) || 1e-6;
  ey = ey.map((v) => v / L);
  let ex = [t[0], 0, -t[1]];
  const d = ex[0] * ey[0] + ex[1] * ey[1] + ex[2] * ey[2];
  ex = [ex[0] - ey[0] * d, ex[1] - ey[1] * d, ex[2] - ey[2] * d];
  const xl = Math.hypot(...ex) || 1;
  ex = ex.map((v) => v / xl);
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  return compose(ex, ey, ez, [sx, L, sz], [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]);
}
// The two frames of a cord lashing (v13, the shapes are in trail.js). p is where the rail meets the
// post (map x, h, y), inn the way in (map x, y), d the rail's direction, inset how far the rail's
// axis is off the post's.
//   post: origin on the post's axis at the rail's height, y up the post (stretched by 1 / cos of
//         the rail's slope, so the turns above and below the rail clear it on a steep flight),
//         x horizontal along the rail, z out toward the inside of the path.
//   rail: origin on the rail's axis at the post, x along the rail, y across it (up), z toward
//         the inside of the path.
function lashingMatrices(p, inn, post, d, inset, railR) {
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = (v) => { const l = Math.hypot(...v) || 1; return v.map((x) => x / l); };
  const inward = [inn[0], 0, -inn[1]];
  const facing = (ez) => ez[0] * inward[0] + ez[2] * inward[2] >= 0;
  const ey = norm([post.lean[0], 1, -post.lean[1]]);
  const dir = norm([d[0], d[1], -d[2]]);
  // Post frame.
  const dp = dir[0] * ey[0] + dir[1] * ey[1] + dir[2] * ey[2];
  let ex = norm([dir[0] - ey[0] * dp, dir[1] - ey[1] * dp, dir[2] - ey[2] * dp]);
  let ez = cross(ex, ey);
  if (!facing(ez)) { ex = ex.map((v) => -v); ez = cross(ex, ey); }
  const cosA = Math.max(Math.sqrt(1 - dp * dp), 0.55);
  // Sized to this post at this height (the pole tapers, trail.js) and to this rail.
  const hy = Math.min(Math.max((p[1] - post.base) / (post.top - post.base), 0), 1);
  const sp = ((post.r ?? 0.036) * (1.1 - 0.2 * hy) + 0.0045) / 0.0435;
  const sy = (railR + 0.0055) / (0.0335 * cosA);
  const c = [p[0] - inn[0] * inset, p[1], -(p[2] - inn[1] * inset)];
  const matP = compose(ex, ey, ez, [sp, sy, sp], c);
  // Rail frame.
  let rx = dir;
  const ry0 = [ey[0] - rx[0] * dp, ey[1] - rx[1] * dp, ey[2] - rx[2] * dp];
  const ry = norm(ry0);
  let rz = cross(rx, ry);
  if (!facing(rz)) { rx = rx.map((v) => -v); rz = cross(rx, ry); }
  const sr = (railR + 0.0038) / 0.0287;
  const matR = compose(rx, ry, rz, [sr, sr, sr], [p[0], p[1], -p[2]]);
  return [matP, matR];
}
// A stone at c (map x, h, y): turned by yaw about the vertical, tipped by tilt, sized s.
function stoneMatrix(c, yaw, tilt, s) {
  const cy = Math.cos(yaw), sy = Math.sin(yaw), ct = Math.cos(tilt), st = Math.sin(tilt);
  const ex = [cy, 0, -sy];
  const ey = [sy * st, ct, cy * st];
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  return compose(ex, ey, ez, s, [c[0], c[1], -c[2]]);
}
// A cylinder (unit, along y) from a to b (map x, h, y), radius r.
function cylinderBetween(a, b, r) {
  const A = [a[0], a[1], -a[2]], B = [b[0], b[1], -b[2]];
  let ey = [B[0] - A[0], B[1] - A[1], B[2] - A[2]];
  const L = Math.hypot(...ey) || 1e-6;
  ey = ey.map((v) => v / L);
  const ref = Math.abs(ey[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  let ex = [ref[1] * ey[2] - ref[2] * ey[1], ref[2] * ey[0] - ref[0] * ey[2], ref[0] * ey[1] - ref[1] * ey[0]];
  const xl = Math.hypot(...ex);
  ex = ex.map((v) => v / xl);
  const ez = [ex[1] * ey[2] - ex[2] * ey[1], ex[2] * ey[0] - ex[0] * ey[2], ex[0] * ey[1] - ex[1] * ey[0]];
  return compose(ex, ey, ez, [r, L, r], [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2, (A[2] + B[2]) / 2]);
}
// A cylinder centred at c along direction d (map x, up, y), length L, radius r.
function cylinderAlong(c, d, L, r) {
  const l = Math.hypot(d[0], d[1], d[2]);
  const h = [d[0] / l * L / 2, d[1] / l * L / 2, d[2] / l * L / 2];
  return cylinderBetween([c[0] - h[0], c[1] - h[1], c[2] - h[2]], [c[0] + h[0], c[1] + h[1], c[2] + h[2]], r);
}
function compose(ex, ey, ez, s, t) {
  return [ex[0] * s[0], ex[1] * s[0], ex[2] * s[0], 0, ey[0] * s[1], ey[1] * s[1], ey[2] * s[1], 0,
    ez[0] * s[2], ez[1] * s[2], ez[2] * s[2], 0, t[0], t[1], t[2], 1];
}

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
// Value noise in [-1, 1].
function makeNoise(seed) {
  const h = (i, j) => { let x = (i * 374761393 + j * 668265263 + seed * 144665) | 0; x = Math.imul(x ^ (x >>> 13), 1274126177); return ((x ^ (x >>> 16)) >>> 0) / 4294967295; };
  return (x, y) => {
    const i = Math.floor(x), j = Math.floor(y), u = x - i, v = y - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const a = h(i, j), b = h(i + 1, j), c = h(i, j + 1), d = h(i + 1, j + 1);
    return 2 * ((a + (b - a) * su) * (1 - sv) + (c + (d - c) * su) * sv) - 1;
  };
}
