// Builds the terrain mesh from the heightfield: a ground grid plus a strip of mesh for every
// face, carved.
//
// A grid cannot draw these faces: it crosses a curved rim at an angle, and whatever it does
// with its vertices it leaves teeth along the rim. So:
//
// 1. The faces. The face field (PSI in heightfield.js, the distance to the middle of the
//    nearest face) is traced at zero into chains, resampled every 55 cm near the headland.
//    Each point is a column: a line across the face along the field's gradient, sampled from
//    heightAt, with vertices shared out evenly along it. Neighbouring columns are zipped
//    together into a strip.
// 2. The carving, which a heightfield cannot do: the wave-cut notch at the waterline, the
//    overhang at the back of the beach, buttresses, and the big beds of the limestone
//    standing out or cut back (strata.js). It moves points across the face only, never up or
//    down, so the ground keeps its height and can hang over itself.
// 3. The ground: a grid, denser over the headland (layout.mesh.focus). Where a strip covers
//    it, it is pushed back into the rock, or left out where the cover is complete, so the
//    strip is what shows. Cells wholly under the sea are left out: the water is opaque there.
// 4. For the shader, per strip vertex, worked out in the face's own vertical section: the
//    sky the rock overhead leaves, the sunlit ground in view past the drip line, the angle
//    above which rock hides the sun, and which way is out.

import { buildStrata, strataWarp, strataStrength, coarseAt } from './strata.js';
import { signedDistance } from './heightfield.js';

export function buildTerrainMesh(hf, layout, M) {
  const t0 = performance.now();
  const { fields: f, heightAt } = hf;
  const { x0, y0, size } = hf.extent;
  const cfg = layout.mesh;
  const fc = cfg.focus;
  const sample = makeSampler(f);
  const carve = makeCarver(hf, layout, sample);
  // No carving of the rock across the path (v6): it is cut into the ground as a level bench
  // (src/trail/carve.js), and the buttresses and beds would push that sideways off its line.
  const onTrail = hf.trail ? hf.trail.carve.near : null;
  const keep = (x, y) => (onTrail ? 1 - onTrail(x, y) : 1);
  const route = hf.trail?.route ?? null;
  const pathMargin = layout.trail ? layout.trail.bank.shoulder + 0.8 : 0;
  // Finer faces when the whole mesh is finer (the page runs 1025 or 2049 vertices a side).
  const q = (M - 1) / 2048;

  // ---------------------------------------------------------------- the faces
  const chains = contourChains(f.PSI, f.N, f.x0, f.y0, f.cell);
  const inFocus = (x, y) => smooth(fc.x[0] - fc.soft, fc.x[0], x) * (1 - smooth(fc.x[1], fc.x[1] + fc.soft, x))
    * smooth(fc.y[0] - fc.soft, fc.y[0], y) * (1 - smooth(fc.y[1], fc.y[1] + fc.soft, y));
  // Finest where the camera comes close (the beach and the trail down to it), then the rest
  // of the headland, then everything else. Small triangles are what the faces cost.
  const dt = cfg.detail;
  const near = (x, y) => 1 - smooth(dt.r - 40, dt.r, Math.hypot(x - dt.at[0], y - dt.at[1]));
  const across = (x, y) => lerp(lerp(cfg.faceStep[1], cfg.faceStep[0], inFocus(x, y)), dt.step, near(x, y)) / q;
  const bands = { pos: [], nrm: [], idx: [], rock: [], lit: [], hor: [], tuck: [], strips: [], hash: new Map() };
  let nCols = 0;
  for (const chain of chains) {
    const pts = resampleChain(chain, (x, y) => across(x, y) * cfg.faceStepAlong);
    if (pts.length < 4) continue;
    const cols = pts.map(([x, y], k) => {
      let gx = (sample(f.PSI, x + f.cell, y) - sample(f.PSI, x - f.cell, y));
      let gy = (sample(f.PSI, x, y + f.cell) - sample(f.PSI, x, y - f.cell));
      const gl = Math.hypot(gx, gy) || 1;
      return { x, y, gx: gx / gl, gy: gy / gl, k };
    });
    // Directions vary smoothly along the face.
    for (let it = 0; it < 3; it++) {
      for (let k = 1; k < cols.length - 1; k++) {
        const a = cols[k - 1], b = cols[k], c = cols[k + 1];
        const gx = a.gx + 2 * b.gx + c.gx, gy = a.gy + 2 * b.gy + c.gy, gl = Math.hypot(gx, gy) || 1;
        b.ngx = gx / gl; b.ngy = gy / gl;
      }
      for (let k = 1; k < cols.length - 1; k++) { cols[k].gx = cols[k].ngx; cols[k].gy = cols[k].ngy; }
    }
    // Walk the face with the land on the left, so every strip winds the same way.
    const mid = cols[cols.length >> 1], nx = cols[Math.min(cols.length - 1, (cols.length >> 1) + 1)];
    if ((nx.x - mid.x) * mid.gy - (nx.y - mid.y) * mid.gx < 0) cols.reverse();
    // Each column's window, then the windows smoothed along the face (where one stops
    // short and its neighbour does not, the rows of the two would not line up), then one
    // profile per column. Runs of columns with a profile become strips.
    for (const col of cols) col.w = windowAlong(col.x, col.y, col.gx, col.gy);
    // On the beach, stop each line across the face short of where it would cross its
    // neighbour's: round a concave wall the lines converge going out over the sand, and past
    // their crossing the strip folds over itself (the dark specks on the sand in trailLow, v5).
    for (let k = 0; k < cols.length; k++) {
      const c = cols[k];
      if (!c.w?.sand) continue;
      for (const n of [cols[k - 1], cols[k + 1]]) {
        if (!n) continue;
        // c + t g = n + s h, for t and s.
        const det = c.gx * -n.gy - c.gy * -n.gx;
        if (Math.abs(det) < 1e-6) continue;
        const dx = n.x - c.x, dy = n.y - c.y;
        const t = (dx * -n.gy - dy * -n.gx) / det;
        const s2 = (c.gx * dy - c.gy * dx) / det;
        if (t < 0 && s2 < 0) c.w.a = Math.max(c.w.a, Math.min(0.7 * t, -2));
      }
    }
    smoothWindows(cols);
    let run = [];
    const flush = () => { if (run.length >= 3) buildStrip(run); run = []; };
    for (const col of cols) {
      col.P = col.w ? profileAlong(col.x, col.y, col.gx, col.gy, col.w.a, col.w.b) : null;
      if (col.P) run.push(col); else flush();
    }
    flush();
  }

  // One strip of face: columns along it, each a line of vertices up its profile, evenly
  // spaced along the carved surface. Neighbouring columns can have a row more or less; they
  // are zipped together by how far up the profile each vertex is.
  function buildStrip(cols) {
    const n = cols.length;
    bands.strips.push(cols);
    // Carving fades out over the last few metres of a strip, where the plain ground takes over.
    let run = 0;
    const along = cols.map((c, k) => (run += k ? Math.hypot(c.x - cols[k - 1].x, c.y - cols[k - 1].y) : 0));
    // The limit on carving: the lowest within 4 m, averaged over 4 m, so it cannot leave a
    // lone fin.
    const lim = cols.map((c) => c.P.feat.maxIn);
    const lo = lim.map((_, k) => {
      let m = lim[k];
      for (let j = k - 1; j >= 0 && along[k] - along[j] <= 4; j--) m = Math.min(m, lim[j]);
      for (let j = k + 1; j < n && along[j] - along[k] <= 4; j++) m = Math.min(m, lim[j]);
      return Math.min(m, 1e6);
    });
    for (let k = 0; k < n; k++) {
      let acc = 0, cnt = 0;
      for (let j = k; j >= 0 && along[k] - along[j] <= 4; j--) { acc += lo[j]; cnt++; }
      for (let j = k + 1; j < n && along[j] - along[k] <= 4; j++) { acc += lo[j]; cnt++; }
      cols[k].P.feat = { ...cols[k].P.feat, maxIn: acc / cnt };
    }
    const total = along[n - 1];
    for (let k = 0; k < n; k++) {
      const col = cols[k], P = col.P;
      col.fade = smooth(0, 6, along[k]) * smooth(0, 6, total - along[k]);
      const S = P.S[P.S.length - 1];
      const du = across(col.x, col.y);
      const R = Math.min(900, Math.max(4, Math.ceil(S / du) + 1));
      col.first = bands.pos.length / 3;
      col.R = R;
      for (let r = 0; r < R; r++) {
        const s = (r / (R - 1)) * S;
        let lo = 0, hi = P.S.length - 1;
        while (hi - lo > 1) { const m = (lo + hi) >> 1; if (P.S[m] <= s) lo = m; else hi = m; }
        const u = (s - P.S[lo]) / Math.max(P.S[hi] - P.S[lo], 1e-9);
        const t = P.t[lo] + (P.t[hi] - P.t[lo]) * u;
        const sl = P.sl[lo] + (P.sl[hi] - P.sl[lo]) * u;
        const bx = col.x + t * col.gx, by = col.y + t * col.gy;
        let h = heightAt(bx, by);
        const c = carve.offset(col.x, col.y, t, h, P.feat, P.a, P.b, sl) * col.fade * keep(bx, by);
        // At both ends of the profile the strip tucks half a metre under the ground, so
        // where it meets the plain ground there is a clean crossing, not two surfaces
        // fighting.
        const tuck = 1 - smooth(0, 2.5, Math.min(t - P.a, P.b - t));
        h -= 0.5 * tuck;
        bands.tuck.push(tuck);
        bands.pos.push(bx + c * col.gx, h, -(by + c * col.gy));
        // Sand runs on in under an overhang, where the ground texture cannot know it.
        const F = P.feat;
        const sand = F.onSand * (1 - smooth(F.hFoot + 0.4, F.hFoot + 1.6, h)) * smooth(0.5, 2, c);
        bands.rock.push(sand, 1, Math.max(c, 0));
        bands.lit.push(1);
        bands.hor.push(1);
      }
      nCols++;
      const key = hashKey(col.x, col.y);
      if (!bands.hash.has(key)) bands.hash.set(key, []);
      bands.hash.get(key).push(col);
    }
    // Triangles, zipped column to column by fraction up the profile.
    for (let k = 0; k < n - 1; k++) {
      const A = cols[k], B = cols[k + 1];
      let i = 0, j = 0;
      while (i < A.R - 1 || j < B.R - 1) {
        const fa = (i + 1) / (A.R - 1), fb = (j + 1) / (B.R - 1);
        if (j >= B.R - 1 || (i < A.R - 1 && fa <= fb)) {
          bands.idx.push(A.first + i, B.first + j, A.first + i + 1); i++;
        } else {
          bands.idx.push(A.first + i, B.first + j, B.first + j + 1); j++;
        }
      }
    }
    // Normals: up the column, and across to the neighbouring columns at the same fraction.
    const at = (col, fr, out) => {
      const x = fr * (col.R - 1), r = Math.min(Math.floor(x), col.R - 2), u = x - r;
      for (let d = 0; d < 3; d++) out[d] = bands.pos[(col.first + r) * 3 + d] * (1 - u) + bands.pos[(col.first + r + 1) * 3 + d] * u;
    };
    const pa = [0, 0, 0], pb = [0, 0, 0];
    for (let k = 0; k < n; k++) {
      const col = cols[k], L = cols[Math.max(0, k - 1)], Rt = cols[Math.min(n - 1, k + 1)];
      for (let r = 0; r < col.R; r++) {
        const v0 = (col.first + Math.max(0, r - 1)) * 3, v1 = (col.first + Math.min(col.R - 1, r + 1)) * 3;
        const cx = bands.pos[v1] - bands.pos[v0], cy = bands.pos[v1 + 1] - bands.pos[v0 + 1], cz = bands.pos[v1 + 2] - bands.pos[v0 + 2];
        const fr = r / (col.R - 1);
        at(L, fr, pa); at(Rt, fr, pb);
        const ax = pb[0] - pa[0], ay = pb[1] - pa[1], az = pb[2] - pa[2];
        // along x up-the-profile (three.js axes), outward for a strip walked land-left.
        let nx = ay * cz - az * cy, ny = az * cx - ax * cz, nz = ax * cy - ay * cx;
        const l = Math.hypot(nx, ny, nz) || 1;
        bands.nrm.push(nx / l, ny / l, nz / l);
      }
    }
    // How much sky each point sees past the rock that hangs over it, in the plane of its
    // column (overhangs only: a wall standing behind open ground is left to the sky light,
    // so the strip and the plain ground beside it agree). The lowest angle, from the
    // outward horizon, at which rock above and further out blocks the sky; then the
    // cosine-weighted share of the sky arc below it.
    for (const col of cols) {
      const o = (v) => -(bands.pos[v * 3] * col.gx - bands.pos[v * 3 + 2] * col.gy);   // outward
      // Furthest out anything above reaches, to skip the points nothing hangs over.
      const above = new Float32Array(col.R + 1).fill(-1e9);
      for (let r = col.R - 1; r >= 0; r--) above[r] = Math.max(above[r + 1], o(col.first + r));
      for (let r = 0; r < col.R; r++) {
        const v = col.first + r;
        const or0 = o(v), h0 = bands.pos[v * 3 + 1];
        if (above[r + 1] <= or0 + 0.05) continue;
        let lowest = Math.PI;
        for (let r2 = r + 1; r2 < col.R; r2++) {
          const v2 = col.first + r2;
          const dout = o(v2) - or0, dh = bands.pos[v2 * 3 + 1] - h0;
          if (dout > 0.05 && dh > 0) lowest = Math.min(lowest, Math.atan2(dh, dout));
        }
        if (lowest >= Math.PI) continue;
        const n = v * 3;
        const nOut = -(bands.nrm[n] * col.gx - bands.nrm[n + 2] * col.gy), nUp = bands.nrm[n + 1];
        const nu = Math.atan2(nUp, nOut);
        const arc = (A, B) => {
          const a = Math.max(A, nu - Math.PI / 2), b = Math.min(B, nu + Math.PI / 2);
          return b > a ? Math.sin(b - nu) - Math.sin(a - nu) : 0;
        };
        const full = arc(0, Math.PI);
        bands.rock[n + 1] = full > 1e-3 ? Math.min(1, arc(0, lowest) / full) : 0.2;
        // The sunlit ground it can see: only out past the drip line (the furthest out the
        // rock above it reaches), below the horizon. Half the cosine-weighted arc, so an
        // open wall comes out at 0.5 and an open ceiling at 1, as for open ground.
        const beta = Math.atan2(Math.max(h0 - col.P.feat.hFoot, 0.3), above[r + 1] - or0);
        bands.lit[v] = 0.5 * arc(-beta, 0);
        // And the angle itself, for the sun: rock overhead hides everything from `lowest`
        // (measured up from straight out) over to straight in.
        bands.hor[v] = lowest / Math.PI;
      }
    }
  }

  // The profile along a line across a face, from its foot on the middle of the face (F)
  // in the direction g (inland). t is the distance along the line, which for a distance
  // field is also the field's value.
  function windowAlong(Fx, Fy, gx, gy) {
    const face = Math.max(sample(f.face, Fx, Fy), 5);
    // Stop short of the crest of a ridge (PSIMAX, the face field's highest value nearby).
    let a = -0.5 * face - cfg.below;
    let b = Math.min(0.5 * face + cfg.above, sample(f.PSIMAX, Fx, Fy) - 4);
    if (b < 4) return null;
    // The window also stops where the line runs into another face's field (across the
    // middle of a cove, or a channel to the islet): there the field stops growing along the
    // line. Where exactly is interpolated, so it moves smoothly from one line to the next.
    const off = (tk) => Math.abs(sample(f.PSI, Fx + tk * gx, Fy + tk * gy) - tk) - 2;
    if (off(0) > 0) return null;
    const edgeOf = (end) => {
      const n = 24;
      let prev = 0, pv = off(0);
      for (let k = 1; k <= n; k++) {
        const tk = (end * k) / n, v = off(tk);
        if (v > 0) return prev + ((tk - prev) * -pv) / Math.max(v - pv, 1e-6);
        prev = tk; pv = v;
      }
      return end;
    };
    const ea = edgeOf(a), eb = edgeOf(b);
    if (ea > a) a = Math.min(ea + 3, -2);
    if (eb < b) b = Math.max(eb - 3, 2);
    // The path (v6) runs on the plain ground grid, not on a strip: the strips' rows are zipped
    // column to column by how far up the face they are, and a shelf running across the face
    // puts them at different heights, so the triangles between two columns cut over the tread
    // (up to 0.7 m). Stop the window a few metres short of the path, where the strip tucks
    // under and the grid takes over; no column at all whose middle is on it.
    if (route) {
      const clear = (t) => { const q = route.nearest(Fx + t * gx, Fy + t * gy, 8); return !q || q.d > route.lerpAt(route.w, q) / 2 + pathMargin; };
      if (!clear(0)) return null;
      for (let t = -0.5; t >= a; t -= 0.5) if (!clear(t)) { a = Math.min(t + 3, -2); break; }
      for (let t = 0.5; t <= b; t += 0.5) if (!clear(t)) { b = Math.max(t - 3, 2); break; }
    }
    // A wall standing on the beach: stop a few metres out past its foot (more under an
    // overhang, whose cave runs in behind it). Further out the lines across a curved wall
    // converge and cross, and the strip folds over itself on the flat sand.
    const foot = carve.footAlong(Fx, Fy, gx, gy, a);
    const sand = !!(foot && foot.onSand > 0.5);
    if (sand) a = Math.max(a, Math.min(foot.t - foot.reach, -2));
    return { a, b, sand };
  }

  // Along a face, each window end becomes the lowest within 4 m of it, then the average over
  // 4 m of that: smooth, and never further out than any column allowed.
  function smoothWindows(cols) {
    const n = cols.length;
    const along = [0];
    for (let k = 1; k < n; k++) along.push(along[k - 1] + Math.hypot(cols[k].x - cols[k - 1].x, cols[k].y - cols[k - 1].y));
    const R = 4;
    for (const [key, sign] of [['a', -1], ['b', 1]]) {
      const raw = cols.map((c) => (c.w ? sign * c.w[key] : null));
      const lo = raw.map((_, k) => {
        if (raw[k] === null) return null;
        let m = raw[k];
        for (let j = k - 1; j >= 0 && along[k] - along[j] <= R && raw[j] !== null; j--) m = Math.min(m, raw[j]);
        for (let j = k + 1; j < n && along[j] - along[k] <= R && raw[j] !== null; j++) m = Math.min(m, raw[j]);
        return m;
      });
      for (let k = 0; k < n; k++) {
        if (lo[k] === null) continue;
        let acc = 0, cnt = 0;
        for (let j = k; j >= 0 && along[k] - along[j] <= R && lo[j] !== null; j--) { acc += lo[j]; cnt++; }
        for (let j = k + 1; j < n && along[j] - along[k] <= R && lo[j] !== null; j++) { acc += lo[j]; cnt++; }
        cols[k].w[key] = sign * (acc / cnt);
      }
    }
    for (const c of cols) if (c.w && c.w.b - c.w.a < 6) c.w = null;
  }

  function profileAlong(Fx, Fy, gx, gy, a, b) {
    const face = Math.max(sample(f.face, Fx, Fy), 5);
    const K0 = 48;
    const t = [], h = [];
    for (let k = 0; k < K0; k++) {
      const tk = a + ((b - a) * k) / (K0 - 1);
      t.push(tk);
      h.push(heightAt(Fx + tk * gx, Fy + tk * gy));
    }
    // Finer where the ground is steep: at most 0.7 m between samples over the ground.
    const hAt = (tm) => heightAt(Fx + tm * gx, Fy + tm * gy);
    refine(t, h, (i) => Math.hypot(t[i + 1] - t[i], h[i + 1] - h[i]) > 0.7, hAt);

    // Rows are shared out along the profile before carving: the carving only moves them
    // sideways, so a little more or less of it from one column to the next does not shift
    // every row above it (which zips neighbouring columns together crooked).
    const feat = carve.features(t, h, face, Fx, Fy, gx, gy);
    const slopeAt = (i) => {
      const i0 = Math.max(0, i - 1), i1 = Math.min(t.length - 1, i + 1);
      return Math.abs(h[i1] - h[i0]) / Math.max(t[i1] - t[i0], 1e-6);
    };
    const S = new Float64Array(t.length);
    const sl = new Float32Array(t.length);
    let cmax = 0;
    for (let i = 0; i < t.length; i++) {
      sl[i] = slopeAt(i);
      cmax = Math.max(cmax, carve.offset(Fx, Fy, t[i], h[i], feat, a, b, sl[i]));
    }
    // The overhang is shared out along the profile as carved (it changes smoothly from one
    // column to the next, unlike the notch and the beds), so its ceiling gets rows too.
    const ov = t.map((tk, i) => carve.overhangAt(Fx, Fy, tk, h[i], feat));
    for (let i = 1; i < t.length; i++) S[i] = S[i - 1] + Math.hypot(t[i] + ov[i] - t[i - 1] - ov[i - 1], cfg.weight * (h[i] - h[i - 1]));
    return { t, S, sl, a, b, feat, cmax };
  }

  // ---------------------------------------------------------------- the ground
  // A plain grid over everything, denser over the headland. Where a strip of face covers it,
  // it is pushed back into the rock (in by the deepest carving there, down a little), so the
  // strip is what shows; at the strip's edges the push fades out as the strip tucks under.
  const xs = axisCoords(x0, size, M, fc.x, fc.density, fc.soft);
  const ys = axisCoords(y0, size, M, fc.y, fc.density, fc.soft);
  const pos = new Float32Array(M * M * 3);
  const cover = new Float32Array(M * M);   // how fully a face strip covers each grid vertex
  let pushed = 0;
  const e = f.cell;
  for (let j = 0; j < M; j++) {
    const y = ys[j];
    for (let i = 0; i < M; i++) {
      const x = xs[i];
      const v = j * M + i;
      let px = x, py = y, h = heightAt(x, y);
      const psi = sample(f.PSI, x, y);
      if (psi > -60 && psi < 60 && i > 0 && j > 0 && i < M - 1 && j < M - 1) {
        let gx = (sample(f.PSI, x + e, y) - sample(f.PSI, x - e, y));
        let gy = (sample(f.PSI, x, y + e) - sample(f.PSI, x, y - e));
        const gl = Math.hypot(gx, gy) / (2 * e);
        if (gl > 0.3) {
          gx /= gl * 2 * e; gy /= gl * 2 * e;
          const Fx = x - psi * gx, Fy = y - psi * gy;
          const col = nearestColumn(Fx, Fy);
          if (col && psi > col.P.a && psi < col.P.b) {
            // (Beside the path the strips are cut back and the grid carries the ground (v6):
            // not pushed in right beside it, and never left out within 10 m of it, where a
            // strip's neighbour could claim cover the cut-back strip does not give.)
            const w = smooth(0, 3, Math.min(psi - col.P.a, col.P.b - psi)) * smooth(2.5, 0.5, col.dist) * keep(x, y);
            // In by the deepest carving within 2.5 m above or below this spot (the grid's
            // big triangles would otherwise cut across the bend of a cave's ceiling), never
            // out, plus a margin; and down a little, but only on flat ground: under a ceiling
            // down is out into the cave.
            const sl = Math.abs(heightAt(x + 1.2 * gx, y + 1.2 * gy) - heightAt(x - 1.2 * gx, y - 1.2 * gy)) / 2.4;
            const cAt = (hh) => carve.offset(col.x, col.y, psi, hh, col.P.feat, col.P.a, col.P.b, sl);
            const cl = Math.max(0, cAt(h - 2.5), cAt(h), cAt(h + 2.5)) * col.fade * keep(x, y);
            const inward = (cl + 1.2) * w;
            cover[v] = route && route.nearest(x, y, 10) ? Math.min(w, 0.9) : w;
            px += inward * gx; py += inward * gy;
            h -= 1.2 * w * smooth(1.5, 0.4, sl);
            if (w > 0) pushed++;
          }
        }
      }
      pos[v * 3] = px;
      pos[v * 3 + 1] = h;
      pos[v * 3 + 2] = -py;
    }
  }
  function nearestColumn(x, y) {
    const ci = Math.floor(x / 2), cj = Math.floor(y / 2);
    let best = null, bd = Infinity;
    for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
      const list = bands.hash.get((ci + di) * 65536 + (cj + dj));
      if (!list) continue;
      for (const c of list) { const d = (c.x - x) ** 2 + (c.y - y) ** 2; if (d < bd) { bd = d; best = c; } }
    }
    if (best) best.dist = Math.sqrt(bd);
    return best;
  }

  // Where the carved face is, for things placed on the heightfield (the plants): how far a
  // point at (x, y, h) on the face was moved in (positive) or out, and which way is in.
  function surfaceShift(x, y, h) {
    const psi = sample(f.PSI, x, y);
    if (!(psi > -60 && psi < 60)) return null;
    let gx = sample(f.PSI, x + e, y) - sample(f.PSI, x - e, y), gy = sample(f.PSI, x, y + e) - sample(f.PSI, x, y - e);
    const gl = Math.hypot(gx, gy);
    if (gl / (2 * e) < 0.3) return null;
    gx /= gl; gy /= gl;
    const col = nearestColumn(x - psi * gx, y - psi * gy);
    if (!col || col.dist > 2.5 || psi <= col.P.a || psi >= col.P.b) return null;
    const sl = Math.abs(heightAt(x + 1.2 * gx, y + 1.2 * gy) - heightAt(x - 1.2 * gx, y - 1.2 * gy)) / 2.4;
    return { c: carve.offset(col.x, col.y, psi, h, col.P.feat, col.P.a, col.P.b, sl) * col.fade * keep(x, y), gx, gy };
  }

  const gridIdx = gridIndex(M, pos, cfg.cull, cover);
  const gridNrm = gridNormals(pos, M);

  // Both into one mesh: the grid first, the strips after it.
  const nb = bands.pos.length / 3;
  const positions = new Float32Array(pos.length + bands.pos.length);
  positions.set(pos); positions.set(bands.pos, pos.length);
  const normals = new Float32Array(positions.length);
  normals.set(gridNrm); normals.set(bands.nrm, gridNrm.length);
  // Per vertex, for the shader: sand under an overhang, sky seen past the overhang, how far
  // the face is carved in (m / 32), and the sunlit ground seen from under an overhang (1 =
  // nothing overhead, use the open-ground bounce). The plain ground: none, all, none, 1.
  const rock = new Uint8Array((positions.length / 3) * 4);
  // And for overhangs: the elevation above which rock overhead hides the sky (/ pi, from
  // straight out; 1 = nothing overhead), and which way is out (x and z, packed to 0..1), which
  // a floor's own normal cannot say.
  const horizon = new Uint8Array((positions.length / 3) * 4);
  for (let v = 0; v < M * M; v++) { horizon[v * 4] = 255; horizon[v * 4 + 1] = horizon[v * 4 + 2] = 128; }
  // The fourth channel, every vertex (v5): how far it is from the foot of a wall standing on
  // the beach (0 to 8 m), for the band of stained sand and the debris along the foot. Measured
  // from the carved faces themselves (their steep vertices low down), so the foot at the back
  // of a cave under an overhang is where the rock really meets the sand.
  {
    const foot = new Uint8Array(f.N * f.N);
    for (let v = M * M; v < positions.length / 3; v++) {
      const x = positions[v * 3], y = -positions[v * 3 + 2], h = positions[v * 3 + 1], ny = normals[v * 3 + 1];
      // (Not where a strip tucks under the ground at its ends: that is steep too.)
      if (ny > 0.45 || ny < -0.3 || h < 0.2 || bands.tuck[v - M * M] > 0.02) continue;
      const bt = sample(f.btop ?? f.sand, x, y);
      if (h > (f.btop ? bt : layout.beach.top) + 2.5 || sample(f.sand, x, y) < 0.3) continue;
      const i = Math.floor((x - f.x0) / f.cell), j = Math.floor((y - f.y0) / f.cell);
      if (i >= 0 && j >= 0 && i < f.N && j < f.N) foot[j * f.N + i] = 1;
    }
    const DF = signedDistance(foot, f.N, f.cell).sd;
    const nv = positions.length / 3;
    for (let v = 0; v < nv; v++) {
      const d = Math.max(-sample(DF, positions[v * 3], -positions[v * 3 + 2]), 0);
      horizon[v * 4 + 3] = Math.round(255 * Math.min(d / 8, 1));
    }
  }
  for (const cols of bands.strips) for (const col of cols) for (let r = 0; r < col.R; r++) {
    const v = col.first + r, o = (M * M + v) * 4;
    horizon[o] = Math.round(255 * Math.min(Math.max(bands.hor[v], 0), 1));
    horizon[o + 1] = Math.round(127.5 - 127.5 * col.gx);
    horizon[o + 2] = Math.round(127.5 + 127.5 * col.gy);
  }
  for (let v = 0; v < M * M; v++) { rock[v * 4 + 1] = 255; rock[v * 4 + 3] = 255; }
  for (let v = 0; v < nb; v++) {
    const o = (M * M + v) * 4;
    rock[o] = Math.round(255 * Math.min(Math.max(bands.rock[v * 3], 0), 1));
    rock[o + 1] = Math.round(255 * Math.min(Math.max(bands.rock[v * 3 + 1], 0), 1));
    rock[o + 2] = Math.round(255 * Math.min(bands.rock[v * 3 + 2] / 32, 1));
    rock[o + 3] = Math.round(255 * Math.min(Math.max(bands.lit[v], 0), 1));
  }
  const bandIdx = [];
  const base = M * M;
  for (let t = 0; t < bands.idx.length; t += 3) {
    const a = bands.idx[t], b = bands.idx[t + 1], c = bands.idx[t + 2];
    if (Math.max(bands.pos[a * 3 + 1], bands.pos[b * 3 + 1], bands.pos[c * 3 + 1]) < cfg.cull) continue;
    bandIdx.push(a + base, b + base, c + base);
  }
  const index = new Uint32Array(gridIdx.length + bandIdx.length);
  index.set(gridIdx); index.set(bandIdx, gridIdx.length);
  // (strips and bandPos are for inspecting the faces from node, see PROCESS.md.)
  return { positions, normals, index, rock, horizon, M, moved: nb, columns: nCols, pushed, surfaceShift, strips: bands.strips, bandPos: bands.pos,
    gridTris: gridIdx.length / 3, faceTris: bandIdx.length / 3, ms: Math.round(performance.now() - t0) };
}

const hashKey = (x, y) => Math.floor(x / 2) * 65536 + Math.floor(y / 2);

// ---------------------------------------------------------------- the middle of the faces

// Contour lines of a field at 0 (marching squares), linked into chains of points.
export function contourChains(F, N, x0, y0, cell) {
  const X = (i) => x0 + (i + 0.5) * cell, Y = (j) => y0 + (j + 0.5) * cell;
  const H = (i, j) => 2 * (j * N + i), V = (i, j) => 2 * (j * N + i) + 1;
  const pt = new Map(), links = new Map();
  const cross = (id, xa, ya, va, xb, yb, vb) => {
    if (!pt.has(id)) { const u = va / (va - vb); pt.set(id, [xa + (xb - xa) * u, ya + (yb - ya) * u]); }
    return id;
  };
  const link = (a, b) => {
    if (!links.has(a)) links.set(a, []);
    if (!links.has(b)) links.set(b, []);
    links.get(a).push(b); links.get(b).push(a);
  };
  for (let j = 0; j < N - 1; j++) {
    for (let i = 0; i < N - 1; i++) {
      const v0 = F[j * N + i], v1 = F[j * N + i + 1], v2 = F[(j + 1) * N + i + 1], v3 = F[(j + 1) * N + i];
      const code = (v0 > 0 ? 1 : 0) | (v1 > 0 ? 2 : 0) | (v2 > 0 ? 4 : 0) | (v3 > 0 ? 8 : 0);
      if (code === 0 || code === 15) continue;
      const E = [
        () => cross(H(i, j), X(i), Y(j), v0, X(i + 1), Y(j), v1),
        () => cross(V(i + 1, j), X(i + 1), Y(j), v1, X(i + 1), Y(j + 1), v2),
        () => cross(H(i, j + 1), X(i), Y(j + 1), v3, X(i + 1), Y(j + 1), v2),
        () => cross(V(i, j), X(i), Y(j), v0, X(i), Y(j + 1), v3),
      ];
      const c = (v0 + v1 + v2 + v3) / 4;
      const segs = {
        1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 6: [[0, 2]], 7: [[3, 2]], 8: [[2, 3]],
        9: [[0, 2]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[3, 0]],
        5: c > 0 ? [[0, 1], [2, 3]] : [[3, 0], [1, 2]],
        10: c > 0 ? [[3, 0], [1, 2]] : [[0, 1], [2, 3]],
      }[code];
      for (const [p, r] of segs) link(E[p](), E[r]());
    }
  }
  // Walk the links into chains: open ones first (they start at an end), then loops.
  const used = new Set(), chains = [];
  const walk = (start) => {
    const out = [pt.get(start)];
    used.add(start);
    let prev = -1, cur = start;
    for (;;) {
      const next = links.get(cur).find((id) => id !== prev && !used.has(id));
      if (next === undefined) break;
      used.add(next); out.push(pt.get(next));
      prev = cur; cur = next;
    }
    return out;
  };
  for (const [id, l] of links) if (l.length === 1 && !used.has(id)) chains.push(walk(id));
  for (const id of links.keys()) if (!used.has(id)) { const c = walk(id); c.push(c[0]); chains.push(c); }
  return chains.filter((c) => c.length > 8);
}

// Smooth a chain a little and resample it evenly, `spacing(x, y)` metres apart.
export function resampleChain(pts, spacing) {
  let p = pts.map((q) => [q[0], q[1]]);
  for (let it = 0; it < 4; it++) {
    const s = p.map((q) => [q[0], q[1]]);
    for (let k = 1; k < p.length - 1; k++) {
      s[k][0] = (p[k - 1][0] + 2 * p[k][0] + p[k + 1][0]) / 4;
      s[k][1] = (p[k - 1][1] + 2 * p[k][1] + p[k + 1][1]) / 4;
    }
    p = s;
  }
  const out = [p[0]];
  let need = spacing(p[0][0], p[0][1]), acc = 0;
  for (let k = 1; k < p.length; k++) {
    let [ax, ay] = p[k - 1];
    const [bx, by] = p[k];
    let seg = Math.hypot(bx - ax, by - ay);
    while (acc + seg >= need) {
      const u = (need - acc) / seg;
      ax += (bx - ax) * u; ay += (by - ay) * u;
      out.push([ax, ay]);
      seg = Math.hypot(bx - ax, by - ay);
      acc = 0;
      need = spacing(ax, ay);
    }
    acc += seg;
  }
  return out;
}

// Split segments that fail a test until none do (at most ten times over: a sheer face can
// fall 100 m within one of the first samples). New samples get their height from hAt, and,
// when a carving function is given, their carving too.
function refine(t, h, tooLong, hAt, c = null, cOf = null) {
  let added = 0;
  for (let pass = 0; pass < 10; pass++) {
    let any = false;
    for (let i = 0; i < t.length - 1; i++) {
      if (!tooLong(i)) continue;
      const tm = 0.5 * (t[i] + t[i + 1]);
      const hm = hAt(tm);
      t.splice(i + 1, 0, tm);
      h.splice(i + 1, 0, hm);
      if (c) c.splice(i + 1, 0, cOf(tm, hm));
      i++;
      any = true;
      added++;
    }
    if (!any) break;
  }
  return added;
}

// ---------------------------------------------------------------- carving

// Horizontal offsets into the rock (positive = inland) for points on a profile.
export function makeCarver(hf, layout, sample) {
  const f = hf.fields;
  const heightAt = hf.heightAt;
  const strata = buildStrata();
  const n3 = makeNoise3(layout.noise.seed + 17);
  const notch = layout.notch;
  const fcfg = layout.faces;
  const zones = layout.overhangs;

  // What kind of face a profile crosses. Everything here changes smoothly from one profile
  // to the next (a yes/no decision would tear the mesh where it flips):
  //   wall    how much it is a wall (steep, and more than a few metres high)
  //   onSand  how much it stands on the beach rather than in the sea: the ground 3 m out
  //           from where the profile first climbs past the top of the beach
  //   tFoot, hFoot  that foot; hRim the top of the profile
  function features(t, h, face, Fx, Fy, gx, gy) {
    let hMax = -1e9, hMin = 1e9;
    for (const v of h) { hMax = Math.max(hMax, v); hMin = Math.min(hMin, v); }
    const at = (tt) => {
      let i = 1;
      while (i < t.length - 1 && t[i] < tt) i++;
      const u = Math.min(Math.max((tt - t[i - 1]) / Math.max(t[i] - t[i - 1], 1e-6), 0), 1);
      return h[i - 1] + (h[i] - h[i - 1]) * u;
    };
    // Average slope across the middle of the face.
    const q = Math.max(0.5 * face, 3);
    const wall = smooth(1.1, 2.2, (at(q) - at(-q)) / (2 * q)) * smooth(6, 14, hMax - Math.max(hMin, 0));
    // The carving must stay well short of the middle of the rock, or a thin ridge (the jaw,
    // the neck) could be cut through from both sides: PSIMAX is how far that middle is.
    // And round a headland the lines across the faces converge going in, so the carving
    // must stop well short of where they meet (the Laplacian of a distance field is the
    // curvature of its contours; noisy, so smoothed along the face in buildStrip).
    const e = 6;
    const lap = (sample(f.PSI, Fx + e, Fy) + sample(f.PSI, Fx - e, Fy) + sample(f.PSI, Fx, Fy + e) + sample(f.PSI, Fx, Fy - e) - 4 * sample(f.PSI, Fx, Fy)) / (e * e);
    const maxIn = Math.min(0.7 * Math.max(sample(f.PSIMAX, Fx, Fy), 4), lap < 0 ? 0.4 / -lap : 1e9);
    const level = (f.btop ? sample(f.btop, Fx, Fy) : layout.beach.top) + 2;   // (the local beach top, v5)
    let k = h.findIndex((v) => v >= level);
    if (k < 1) k = 1;
    const tW = t[k - 1] + ((t[k] - t[k - 1]) * (level - h[k - 1])) / Math.max(h[k] - h[k - 1], 1e-6);
    const tFoot = tW - 1;
    const hFoot = at(tFoot);
    const onSand = sandOut(Fx + (tW - 3) * gx, Fy + (tW - 3) * gy, at(tW - 3));
    // The top of the wall itself (the mapped cliff top), which on the beach is well below
    // the top of the profile: the ridge carries on up behind it as a slope.
    const hEdge = Math.min(sample(f.EDGE, Fx, Fy), hMax);
    return { wall, onSand, tFoot, hFoot, hRim: hMax, hEdge, maxIn };
  }

  // Whether the ground 3 m out from a wall's foot is beach: the zones say sand and it is above
  // the water. (v5 lowered the south end of the beach to about a metre, so its height alone
  // no longer says; until then this was the height, 0.8 to 2.4 m.)
  function sandOut(x, y, hOut) {
    return smooth(0.3, 0.8, sample(f.sand, x, y)) * smooth(-0.3, 0.5, hOut);
  }

  // Where a line across a face (from the middle of the face, going out) reaches its foot on
  // the beach, how much that is sand, and how far out past it the strip must reach: the
  // undercut's floor fades over 5 m, an overhang's cave floor further.
  function footAlong(Fx, Fy, gx, gy, a) {
    const level = (f.btop ? sample(f.btop, Fx, Fy) : layout.beach.top) + 2;   // (the local beach top, v5)
    let prev = heightAt(Fx, Fy);
    if (prev < level) return null;
    for (let tt = -0.5; tt >= a; tt -= 0.5) {
      const hv = heightAt(Fx + tt * gx, Fy + tt * gy);
      if (hv < level) {
        const tW = tt + 0.5 * (level - hv) / Math.max(prev - hv, 1e-6);
        const out = heightAt(Fx + (tW - 3) * gx, Fy + (tW - 3) * gy);
        const z = zoneAt(Fx, Fy);
        const ov = (z.cave + z.bulge) * 0.6 + 4 * Math.min(z.w, 1);
        return { t: tW - 1, onSand: sandOut(Fx + (tW - 3) * gx, Fy + (tW - 3) * gy, out), reach: 6 + ov };
      }
      prev = hv;
    }
    return null;
  }

  // Overhang and notch settings at a place, blended between the zones (layout.overhangs).
  // Bulge and cave fade out with the zone's weight; the heights are weighted averages.
  function zoneAt(x, y) {
    const out = { bulge: 0, lipH: 0, cave: 0, caveH: 0, notch: 0, notchTop: 0, w: 0, wn: 0 };
    for (const z of zones) {
      const w = Math.exp(-((x - z.at[0]) ** 2 + (y - z.at[1]) ** 2) / (z.r * z.r));
      if (w < 1e-3) continue;
      if (z.bulge !== undefined) {
        out.bulge += w * z.bulge; out.cave += w * z.cave; out.lipH += w * z.lipH; out.caveH += w * z.caveH; out.w += w;
      }
      if (z.notch !== undefined) { out.notch += w * z.notch; out.notchTop += w * z.notchTop; out.wn += w; }
    }
    if (out.w > 0) { out.lipH /= out.w; out.caveH /= out.w; }
    return out;
  }

  // The overhang at the back of the beach, in section: from the rim the face bulges out
  // over the sand, most at the lip, lipH metres up; under the lip a ceiling runs back and
  // down into a cave `cave` metres in behind the line of the wall, whose back wall is caveH
  // high; the sand runs in to the back. Positive is in, as for offset().
  function overhang(z, t, h, F) {
    if (z.w < 1e-3 || F.onSand <= 0) return 0;
    const zz = t < F.tFoot ? 0 : Math.max(h - F.hFoot, 0);
    const H = Math.max(F.hEdge - F.hFoot, z.lipH + 5);
    let c;
    if (zz >= z.lipH) c = -z.bulge * Math.pow(1 - Math.min((zz - z.lipH) / (H - z.lipH), 1), 1.3);
    else c = lerp(z.cave, -z.bulge, Math.pow(smooth(z.caveH, z.lipH, zz), 0.8));
    if (t < F.tFoot) c = lerp(0, c, smooth(F.tFoot - (z.cave + z.bulge) * 0.6 - 4, F.tFoot, t));
    return c * F.wall * F.onSand;
  }

  function offset(Fx, Fy, t, h, F, a, b, slopeHere) {
    // Everything fades out towards the ends of the window, so the carved profile joins the
    // untouched ground.
    const taper = smooth(a, a + 5, t) * smooth(b, b - 8, t);
    if (taper <= 0) return 0;
    const slope = smooth(1.2, 3.5, slopeHere);
    const z = zoneAt(Fx, Fy);
    let c = 0;

    if (F.wall * (1 - F.onSand) > 0) {
      // The wave-cut notch: a groove a few metres deep just above the water, deepest a
      // little above sea level, varying along the coast.
      const nv = n3(Fx / 26, Fy / 26, 3.1);
      const depth = lerp(notch.depth * (0.45 + 1.1 * nv), z.notch / Math.max(z.wn, 1e-6), Math.min(z.wn, 1));
      const top = lerp(notch.top * (0.8 + 0.6 * n3(Fx / 41, Fy / 41, 7.7)), z.notchTop / Math.max(z.wn, 1e-6), Math.min(z.wn, 1));
      const q = h / top;
      c += depth * bump(q, -0.3, 0.28, 1) * F.wall * (1 - F.onSand);
    }

    if (F.wall * F.onSand > 0) {
      // Walls standing on the beach are undercut: a low cut all along, and in the overhang
      // zones a deep cave under a scooped wall that leans out over the sand.
      const nv = n3(Fx / 19, Fy / 19, 11.3);
      const under = fcfg.undercut.depth * (0.4 + 1.2 * nv);
      const underH = fcfg.undercut.height * (0.7 + 0.6 * n3(Fx / 33, Fy / 33, 5.5));
      // Below the foot, the sand runs on in under the overhang.
      const zz = t < F.tFoot ? 0 : Math.max(h - F.hFoot, 0);
      let cw = under * (1 - smooth(underH, underH + 2.5, zz)) * (1 - Math.min(z.w, 1));
      if (t < F.tFoot) cw *= smooth(F.tFoot - 3.5, F.tFoot, t);
      c += cw * F.wall * F.onSand + overhang(z, t, h, F);
    }

    if (F.wall > 0) {
      // Buttresses and bays: the face stands out or falls back by a couple of metres over
      // tens of metres along it, changing with height, so walls are not extruded.
      const bt = (n3(Fx / 17, Fy / 17, h / 26) - 0.5) * 2;
      const rimFade = 1 - 0.65 * smooth(F.hRim - 8, F.hRim, h);
      c -= fcfg.buttress * bt * slope * rimFade * F.wall;
      // The big beds of the limestone (strata.js): harder packages stand out.
      const bc = h + strataWarp(Fx, Fy);
      c -= fcfg.beds * coarseAt(strata, bc) * strataStrength(Fx, Fy) * slope * smooth(0.5, 3, h) * F.wall;
    }
    return Math.min(c, F.maxIn) * taper;
  }

  return { features, offset, strata, footAlong, overhangAt: (Fx, Fy, t, h, F) => overhang(zoneAt(Fx, Fy), t, h, F) };
}

// A bump that is 0 below lo, rises to 1 at peak and falls back to 0 at hi.
function bump(q, lo, peak, hi) {
  if (q <= lo || q >= hi) return 0;
  return q < peak ? smooth(lo, peak, q) : 1 - smooth(peak, hi, q);
}

// ---------------------------------------------------------------- grid

// Coordinates of M rows (or columns) from lo to lo + size, spaced so that inside the focus
// range [f0, f1] they are `density` times closer than outside, with soft edges.
function axisCoords(lo, size, M, focus, density, soft) {
  const S = 8192;
  const cdf = new Float64Array(S + 1);
  for (let k = 0; k < S; k++) {
    const x = lo + ((k + 0.5) / S) * size;
    const w = smooth(focus[0] - soft, focus[0] + soft, x) * (1 - smooth(focus[1] - soft, focus[1] + soft, x));
    cdf[k + 1] = cdf[k] + 1 + (density - 1) * w;
  }
  const out = new Float64Array(M);
  let k = 0;
  for (let m = 0; m < M; m++) {
    const target = (m / (M - 1)) * cdf[S];
    while (k < S - 1 && cdf[k + 1] < target) k++;
    const u = (target - cdf[k]) / Math.max(cdf[k + 1] - cdf[k], 1e-12);
    out[m] = lo + ((k + Math.min(Math.max(u, 0), 1)) / S) * size;
  }
  out[0] = lo; out[M - 1] = lo + size;
  return out;
}

function makeSampler(f) {
  const { N, cell, x0, y0 } = f;
  return (a, x, y) => {
    const fi = (x - x0) / cell - 0.5, fj = (y - y0) / cell - 0.5;
    const i = Math.max(0, Math.min(N - 2, Math.floor(fi)));
    const j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
    const u = Math.min(Math.max(fi - i, 0), 1), v = Math.min(Math.max(fj - j, 0), 1);
    const k = j * N + i;
    return (a[k] * (1 - u) + a[k + 1] * u) * (1 - v) + (a[k + N] * (1 - u) + a[k + N + 1] * u) * v;
  };
}

// Two triangles per grid cell, leaving out cells entirely below `cull` (under the opaque sea)
// and cells a face strip fully covers (all four corners pushed back with full weight): there
// the strip is the surface, and the grid would only poke through it here and there.
function gridIndex(M, pos, cull, cover) {
  const idx = new Uint32Array((M - 1) * (M - 1) * 6);
  let n = 0;
  const hy = (v) => pos[v * 3 + 1];
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < M - 1; i++) {
      const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
      if (Math.max(hy(a), hy(b), hy(c), hy(d)) < cull) continue;
      if (Math.min(cover[a], cover[b], cover[c], cover[d]) > 0.98) continue;
      idx[n++] = a; idx[n++] = b; idx[n++] = c;
      idx[n++] = b; idx[n++] = d; idx[n++] = c;
    }
  }
  return idx.slice(0, n);
}

// Normals by central differences across the grid.
function gridNormals(pos, M) {
  const nrm = new Float32Array(pos.length);
  const P = (i, j, k) => pos[(Math.min(Math.max(j, 0), M - 1) * M + Math.min(Math.max(i, 0), M - 1)) * 3 + k];
  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const ux = P(i + 1, j, 0) - P(i - 1, j, 0), uy = P(i + 1, j, 1) - P(i - 1, j, 1), uz = P(i + 1, j, 2) - P(i - 1, j, 2);
      const vx = P(i, j + 1, 0) - P(i, j - 1, 0), vy = P(i, j + 1, 1) - P(i, j - 1, 1), vz = P(i, j + 1, 2) - P(i, j - 1, 2);
      // Columns run east (+x) and rows north (three.js -z), so u x v points up on flat ground.
      const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
      const l = Math.hypot(nx, ny, nz) || 1;
      const o = (j * M + i) * 3;
      nrm[o] = nx / l; nrm[o + 1] = ny / l; nrm[o + 2] = nz / l;
    }
  }
  return nrm;
}

// 3D value noise in [0, 1], smooth, for the buttresses.
function makeNoise3(seed) {
  const perm = new Uint8Array(512);
  const p = new Uint8Array(256).map((_, i) => i);
  let s = (seed * 2654435761) >>> 0;
  for (let i = 255; i > 0; i--) {
    s = (s * 1664525 + 1013904223) >>> 0;
    const r = s % (i + 1);
    [p[i], p[r]] = [p[r], p[i]];
  }
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const val = (i, j, k) => perm[perm[perm[i & 255] + (j & 255)] + (k & 255)] / 255;
  const fade = (t) => t * t * (3 - 2 * t);
  return (x, y, z) => {
    const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
    const u = fade(x - xi), v = fade(y - yi), w = fade(z - zi);
    const c = (a, b, c2) => val(xi + a, yi + b, zi + c2);
    const l = (a, b, t2) => a + (b - a) * t2;
    return l(l(l(c(0, 0, 0), c(1, 0, 0), u), l(c(0, 1, 0), c(1, 1, 0), u), v),
      l(l(c(0, 0, 1), c(1, 0, 1), u), l(c(0, 1, 1), c(1, 1, 1), u), v), w);
  };
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
const lerp = (a, b, t) => a + (b - a) * t;
