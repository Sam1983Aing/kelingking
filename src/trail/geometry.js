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
//   rope     the lashings.
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
    return { x: L(R.x), y: L(R.y), tx, ty, nx: -ty, ny: tx, w: L(R.w), hd: L(R.hd) };
  }

  // ---------------------------------------------------------------- treads
  const concrete = mesh(), dirt = mesh();
  const noise = makeNoise(seed + 3);
  // Where to sample a tread: its ends and every route sample between.
  const samplesIn = (a, b) => {
    const out = [a];
    for (let i = Math.ceil(a / DS + 1e-6); i * DS < b - 1e-6; i++) out.push(i * DS);
    out.push(b);
    return out;
  };
  for (let k = 0; k < R.treads.length; k++) {
    const tr = R.treads[k];
    if (tr.s1 - tr.s0 < 1e-4) continue;
    const sec = kindAt(0.5 * (tr.s0 + tr.s1));
    const isC = sec.kind === 'concrete';
    const M = isC ? concrete : dirt;
    const qs = samplesIn(tr.s0, tr.s1);
    const top = (q, f) => (tr.T ?? f.hd);
    // Across the tread: concrete flat, dirt a little dished where feet wear it, and lumpy.
    const across = isC ? [-1, -0.5, 0, 0.5, 1] : [-1, -0.6, -0.2, 0.2, 0.6, 1];
    const rows = qs.map((q) => {
      const f = frame(q), h = top(q, f), hw = f.w / 2;
      const verts = across.map((a) => {
        const px = f.x + f.nx * a * hw, py = f.y + f.ny * a * hw;
        let dh = 0;
        if (!isC) dh = -0.035 * (1 - a * a) + 0.02 * noise(px * 2.1, py * 2.1) + 0.01 * noise(px * 7.3 + 5, py * 7.3);
        return [px, h + dh, py, a];
      });
      return { q, f, h, hw, verts };
    });
    // Top surface.
    for (let r = 0; r + 1 < rows.length; r++) {
      const A = rows[r], B = rows[r + 1];
      for (let c = 0; c + 1 < across.length; c++) {
        M.quad(A.verts[c], B.verts[c], B.verts[c + 1], A.verts[c + 1], [0, A.q, 0], [0, B.q, 0]);
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
          if (side > 0) M.quad(ea, eb, [...wall[1], 1], [...wall[0], 1], [1, A.q, 0], [1, B.q, 0]);
          else M.quad(ea, [...wall[0], -1], [...wall[1], -1], eb, [1, A.q, 0], [1, B.q, 0]);
        } else {
          const out = (V, row) => {
            const ox = V[0] + row.f.nx * side * SKIRT, oy = V[2] + row.f.ny * side * SKIRT;
            return [ox, Math.min(heightAt(ox, oy), V[1]) - 0.07, oy, side * 1.3];
          };
          const oa = out(ea, A), ob = out(eb, B);
          if (side > 0) M.quad(ea, eb, ob, oa, [2, A.q, 0], [2, B.q, 0]);
          else M.quad(ea, oa, ob, eb, [2, A.q, 0], [2, B.q, 0]);
        }
      }
    }
    // The riser at the end of this tread, down (or up) to the next one.
    const next = R.treads[k + 1];
    if (next) {
      const f = frame(tr.s1);
      const hA = rows.at(-1).h, hB = next.T ?? f.hd;
      if (Math.abs(hA - hB) > 0.01) {
        const hi = Math.max(hA, hB), lo = Math.min(hA, hB) - (isC ? 0 : 0.03);
        const dir = hA > hB ? 1 : -1;   // which way the riser faces along the line
        const pts = across.map((a) => [f.x + f.nx * a * f.w / 2, f.y + f.ny * a * f.w / 2, a]);
        for (let c = 0; c + 1 < pts.length; c++) {
          const [ax, ay, aa] = pts[c], [bx, by, ba] = pts[c + 1];
          const va = [ax, hi, ay, aa], vb = [bx, hi, by, ba], vc = [bx, lo, by, ba], vd = [ax, lo, ay, aa];
          if (dir > 0) M.quad(va, vd, vc, vb, [3, tr.s1, 0], [3, tr.s1, 0]);
          else M.quad(va, vb, vc, vd, [3, tr.s1, 0], [3, tr.s1, 0]);
        }
        // The dirt skirts of the two treads meet the riser at different heights: close the gap.
        if (!isC) {
          for (const side of [-1, 1]) {
            const e = side < 0 ? pts[0] : pts.at(-1);
            const ox = e[0] + f.nx * side * SKIRT, oy = e[1] + f.ny * side * SKIRT;
            const og = Math.min(heightAt(ox, oy), lo) - 0.07;
            const t1 = [e[0], hi, e[1], e[2]], t2 = [e[0], lo, e[1], e[2]], t3 = [ox, og, oy, side * 1.3];
            M.tri(t1, t2, t3, [2, tr.s1, 0]);
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

  // ---------------------------------------------------------------- logs across the dirt risers
  const logs = instances();
  for (const st of R.steps) {
    const sec = spec.sections[st.sec];
    // Only some of the dirt risers are held by a log; the rest are bare earth and rock.
    if (sec.kind === 'concrete' || Math.abs(st.from - st.to) < 0.18 || rand() > 0.3) continue;
    const f = frame(st.s);
    const hi = Math.max(st.from, st.to), dir = st.from > st.to ? 1 : -1;
    const r = 0.045 + 0.03 * rand();
    const len = f.w + 0.3 + 0.2 * rand();
    const yaw = (rand() - 0.5) * 0.18, tilt = (rand() - 0.5) * 0.06;
    // Across the path, turned a little.
    const ax = f.nx * Math.cos(yaw) - f.ny * Math.sin(yaw), ay = f.nx * Math.sin(yaw) + f.ny * Math.cos(yaw);
    const cx = f.x + f.tx * dir * r * 0.45, cy = f.y + f.ty * dir * r * 0.45;
    logs.push(cylinderAlong([cx, hi + 0.012 - r, cy], [ax, tilt, ay], len, r), rand());
  }

  // ---------------------------------------------------------------- handrails
  const timberPosts = instances(), timberRails = instances(), bambooPosts = instances(), bambooRails = instances(), rope = instances();
  // Is (px, py) on or right beside another stretch of the path (a hairpin's other leg)?
  const clashes = (px, py, q) => {
    let hit = false;
    R.near(px, py, 1.6, (i, d) => { if (!hit && Math.abs(R.s[i] - q) > 3 && d < R.w[i] / 2 + 0.3) hit = true; });
    return hit;
  };
  for (const side of [-1, 1]) {
    let q = 0.4 + rand() * 0.5, prev = null;
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
      const height = (bamboo ? 0.95 + 0.12 * (rand() - 0.5) : 1.02);
      const topH = f.hd + height;
      const post = { q, x: px, y: py, top: topH, hd: f.hd, bamboo, lean: bamboo ? [(rand() - 0.5) * 0.06, (rand() - 0.5) * 0.06] : [0, 0], f };
      if (bamboo) {
        const r = 0.032 + 0.01 * rand();
        const bx = px + post.lean[0] * (topH - base), by = py + post.lean[1] * (topH - base);
        bambooPosts.push(cylinderBetween([px, base, py], [bx, topH, by], r), rand());
        post.r = r;
      } else {
        timberPosts.push(boxAlong([px, 0.5 * (base + topH), py], [f.tx, 0, f.ty], [0.1, topH - base, 0.1]), rand());
      }
      if (prev && Math.hypot(px - prev.x, py - prev.y) < 3.4) {
        // Rails from post to post on the inside faces, following the design line.
        const inX = -f.nx * side, inY = -f.ny * side;
        const heights = bamboo ? [0.42, 0.88] : [0.52, 0.95];
        heights.forEach((hr, k) => {
          if (bamboo && k === 0 && rand() < 0.12) return;   // the odd lower rail gone
          const inset = bamboo ? 0.055 : 0.065;
          const sag = bamboo ? (rand() - 0.5) * 0.08 : 0;
          const a = [prev.x + inX * inset, prev.hd + hr + sag, prev.y + inY * inset];
          const b = [px + inX * inset, f.hd + hr + sag, py + inY * inset];
          if (bamboo) {
            // Bamboo runs on a little past each post.
            const d = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], L = Math.hypot(...d);
            const ext = 0.12 / L;
            bambooRails.push(cylinderBetween([a[0] - d[0] * ext, a[1] - d[1] * ext, a[2] - d[2] * ext], [b[0] + d[0] * ext, b[1] + d[1] * ext, b[2] + d[2] * ext], 0.022 + 0.006 * rand()), rand());
            // Blue rope lashing it to the posts.
            for (const [p, pr] of [[a, prev], [b, post]]) rope.push(cylinderBetween([p[0] - inX * 0.03, p[1] - 0.035, p[2] - inY * 0.03], [p[0] - inX * 0.03, p[1] + 0.035, p[2] - inY * 0.03], (pr.r ?? 0.035) + 0.012), rand());
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

  return {
    concrete: concrete.done(), dirt: dirt.done(),
    logs: logs.done(), timberPosts: timberPosts.done(), timberRails: timberRails.done(),
    bambooPosts: bambooPosts.done(), bambooRails: bambooRails.done(), rope: rope.done(),
    ms: Math.round(performance.now() - t0),
  };
}

// ---------------------------------------------------------------- builders

// A triangle mesh with per-vertex aTrail = (across, along, face kind, 0): across -1..1 on the
// tread (beyond on a skirt), metres along the line, and what the face is (0 tread, 1 concrete
// side, 2 dirt skirt, 3 riser). Normals are worked out from the faces around each vertex.
function mesh() {
  const pos = [], trail = [], idx = [];
  const add = (v, t) => { pos.push(v[0], v[1], -v[2]); trail.push(v[3] ?? 0, t[1], t[0], 0); return pos.length / 3 - 1; };
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
