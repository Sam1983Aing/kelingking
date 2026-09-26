// The way down from the viewpoint platform to the sand, as one line with everything the
// carve, the geometry and the cameras need along it (v6).
//
// The line comes from layout.trail: the mapped steps and ridge path (geo.js), then the descent
// to the beach laid out on this model's slope (see layout.js for why it is not the mapped
// zigzag). It is smoothed, resampled every 25 cm, and given:
//   hd   the design height of the walking surface, from the ground under it (before carving),
//        smoothed and held to a steepest grade per section,
//   ht   the tread: hd turned into steps where it falls or climbs by a riser (the nosings sit
//        on hd, so a tread is at most one riser below it),
//   hg   where the ground is carved to under the path: just under the tread, or a riser and a
//        bit under the steps, so the steps' geometry stands on it,
//   w    the tread's width.
// Pure data in, typed arrays out, so it runs in the terrain worker and in node.

export const DS = 0.25;   // metres between samples

export function buildRoute(spec, heightAt) {
  // ---------------------------------------------------------------- the line
  // Sections end to end, each vertex carrying its section index (as a float, so smoothing
  // blends it across a join).
  let P = [];
  spec.sections.forEach((sec, k) => {
    sec.path.forEach((p, i) => {
      if (k > 0 && i === 0) return;   // shared with the end of the section before
      P.push([p[0], p[1], k]);
    });
  });
  // Corner cutting (Chaikin) rounds the hairpins to a metre or so, as a trodden path is.
  for (let it = 0; it < 3; it++) {
    const Q = [P[0]];
    for (let i = 0; i + 1 < P.length; i++) {
      const a = P[i], b = P[i + 1];
      Q.push([0.75 * a[0] + 0.25 * b[0], 0.75 * a[1] + 0.25 * b[1], 0.75 * a[2] + 0.25 * b[2]]);
      Q.push([0.25 * a[0] + 0.75 * b[0], 0.25 * a[1] + 0.75 * b[1], 0.25 * a[2] + 0.75 * b[2]]);
    }
    Q.push(P.at(-1));
    P = Q;
  }
  // Resampled evenly.
  const pts = [P[0]];
  let carry = 0;
  for (let i = 1; i < P.length; i++) {
    const a = P[i - 1], b = P[i];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let t = DS - carry;
    while (t <= L) {
      const u = t / L;
      pts.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u]);
      t += DS;
    }
    carry = L - (t - DS);
  }
  const n = pts.length;
  const x = new Float32Array(n), y = new Float32Array(n), s = new Float32Array(n), sec = new Uint8Array(n);
  const secF = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = pts[i][0]; y[i] = pts[i][1]; s[i] = i * DS;
    secF[i] = pts[i][2]; sec[i] = Math.round(pts[i][2]);
  }
  const S = spec.sections;
  const par = (name, i) => {
    const f = secF[i], k = Math.floor(f), u = f - k;
    const a = S[Math.min(k, S.length - 1)][name], b = S[Math.min(k + 1, S.length - 1)][name];
    return a + (b - a) * u;
  };

  // Direction along the line (averaged over a metre either side), and left of it.
  const tx = new Float32Array(n), ty = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 4), b = Math.min(n - 1, i + 4);
    const dx = x[b] - x[a], dy = y[b] - y[a], l = Math.hypot(dx, dy) || 1;
    tx[i] = dx / l; ty[i] = dy / l;
  }

  // ---------------------------------------------------------------- heights
  const h0 = new Float32Array(n);
  for (let i = 0; i < n; i++) h0[i] = heightAt(x[i], y[i]);
  // Smoothed along the line, then held to the section's steepest grade: the average of the
  // highest and the lowest profiles within that grade of the ground (each is as steep as the
  // grade at most, so their average is too, and where the ground is gentler both are it).
  let hd = gauss(h0, spec.smooth / DS);
  const g = Float32Array.from({ length: n }, (_, i) => par('grade', i) * DS);
  const up = Float32Array.from(hd), lo = Float32Array.from(hd);
  for (let i = 1; i < n; i++) { up[i] = Math.min(up[i], up[i - 1] + g[i]); lo[i] = Math.max(lo[i], lo[i - 1] - g[i]); }
  for (let i = n - 2; i >= 0; i--) { up[i] = Math.min(up[i], up[i + 1] + g[i]); lo[i] = Math.max(lo[i], lo[i + 1] - g[i]); }
  for (let i = 0; i < n; i++) hd[i] = 0.5 * (up[i] + lo[i]);
  hd = gauss(hd, 0.5 / DS);
  // The two ends sit on the ground: the platform, and the sand.
  hd[0] = h0[0]; hd[n - 1] = h0[n - 1];

  // Steps. Each tread is level and straddles the design line: it starts where the line is half
  // a riser above it and ends (its nosing) where the line is half a riser below, so the
  // treads never wander more than half a riser off the line. On gentle ground that makes long
  // treads with the odd step; where it is steep the treads shorten to `going` at the least
  // and the risers grow instead (the steep bottom of the descent is nearly a ladder).
  // Only where the line is steeper than the section's `flat` grade: a gentle dirt path just
  // follows the ground. (Walked in 1 cm steps between the samples, so the treads are not whole
  // numbers of them.) The treads come out as intervals of the line, each either level at T or
  // following the design line (T null).
  const ht = new Float32Array(n);
  const steps = [], treads = [];
  const hdAt = (q) => { const f = q / DS, i = Math.min(Math.floor(f), n - 2), u = f - i; return hd[i] + (hd[i + 1] - hd[i]) * u; };
  const grade = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = Math.max(0, i - 3), b = Math.min(n - 1, i + 3);
    grade[i] = Math.abs(hd[b] - hd[a]) / ((b - a) * DS);
  }
  // Stepped where steep, holding on over a metre either way so a flight is not broken up.
  const steep = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (grade[i] > par('flat', i)) for (let j = Math.max(0, i - 4); j <= Math.min(n - 1, i + 4); j++) steep[j] = 1;
  {
    let T = hd[0], last = 0, t0 = 0, level = steep[0] ? T : null;
    // Cut by hand, the dirt steps are uneven: each one's rise and going are the section's
    // times a random factor within +-jitter (0 for the concrete).
    let nk = 0, jr = 1, jg = 1;
    const next = (i) => { const j = par('jitter', i); jr = 1 + j * (2 * hash(++nk) - 1); jg = 1 + j * (2 * hash(nk + 7919) - 1); };
    next(0);
    const close = (q) => { treads.push({ s0: t0, s1: q, T: level }); t0 = q; };
    for (let q = 0.01; q < s[n - 1]; q += 0.01) {
      const i = Math.min(Math.round(q / DS), n - 1);
      const rise = par('rise', i) * jr, h = hdAt(q);
      if (!steep[i]) {
        // Following the ground. Coming off a flight, the last tread holds until the line comes
        // back to it, or a small last step brings it there.
        if (level !== null) {
          const d = h - T;
          if (Math.abs(d) < 0.01 || q - last >= par('going', i) * jg) {
            if (Math.abs(d) >= 0.03) steps.push({ i, s: q, from: T, to: h, sec: sec[i] });
            close(q); level = null; last = q;
          }
        }
        T = h;
        continue;
      }
      if (level === null) { close(q); level = T = h; last = q; }
      const d = h - T;
      if (Math.abs(d) >= rise / 2 && q - last >= par('going', i) * jg) {
        const to = T + Math.sign(d) * Math.max(rise, Math.abs(d));
        steps.push({ i, s: q, from: T, to, sec: sec[i] });
        close(q);
        level = T = to;
        last = q;
        next(i);
      }
    }
    close(s[n - 1]);
    let k = 0;
    for (let i = 0; i < n; i++) {
      while (k < treads.length - 1 && treads[k].s1 <= s[i]) k++;
      ht[i] = treads[k].T ?? hd[i];
    }
  }
  // The last couple of metres run out onto the sand: the tread eases into the design line so
  // the end sits on the ground.
  for (let i = Math.max(0, n - 9); i < n; i++) ht[i] = hd[i] + (ht[i] - hd[i]) * (n - 1 - i) / 8;

  // Where the ground is carved to: under the lowest tread nearby by a clearance, smoothly, so
  // the steps' blocks stand on it and the plain path hides it.
  const lowT = new Float32Array(n);
  const rr = Math.round(0.6 / DS);
  for (let i = 0; i < n; i++) {
    let m = Infinity;
    for (let j = Math.max(0, i - rr); j <= Math.min(n - 1, i + rr); j++) m = Math.min(m, ht[j], hd[j]);
    lowT[i] = m;
  }
  const hg = gauss(lowT, 0.25 / DS);
  for (let i = 0; i < n; i++) hg[i] = Math.min(hg[i], lowT[i]) - spec.clearance;

  const w = new Float32Array(n);
  for (let i = 0; i < n; i++) w[i] = par('width', i);

  // ---------------------------------------------------------------- queries
  // A hash of the samples in 2 m cells, for "what part of the path is near here".
  const cell = 2;
  const cells = new Map();
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (let i = 0; i < n; i++) {
    const key = Math.floor(x[i] / cell) * 65536 + Math.floor(y[i] / cell);
    if (!cells.has(key)) cells.set(key, []);
    cells.get(key).push(i);
    x0 = Math.min(x0, x[i]); x1 = Math.max(x1, x[i]); y0 = Math.min(y0, y[i]); y1 = Math.max(y1, y[i]);
  }
  // Every sample within r metres of (px, py): calls f(i, distance).
  function near(px, py, r, f) {
    const c0 = Math.floor((px - r) / cell), c1 = Math.floor((px + r) / cell);
    const d0 = Math.floor((py - r) / cell), d1 = Math.floor((py + r) / cell);
    const r2 = r * r;
    for (let ci = c0; ci <= c1; ci++) for (let cj = d0; cj <= d1; cj++) {
      const list = cells.get(ci * 65536 + cj);
      if (!list) continue;
      for (const i of list) {
        const d2 = (x[i] - px) ** 2 + (y[i] - py) ** 2;
        if (d2 <= r2) f(i, Math.sqrt(d2));
      }
    }
  }
  // The nearest point on the line (between samples), within r: { i, u, d, side } or null.
  function nearest(px, py, r = 6) {
    let best = -1, bd = Infinity;
    near(px, py, r, (i, d) => { if (d < bd) { bd = d; best = i; } });
    if (best < 0) return null;
    // Refine on the segments either side.
    let out = null;
    for (const a of [best - 1, best]) {
      if (a < 0 || a + 1 >= n) continue;
      const ex = x[a + 1] - x[a], ey = y[a + 1] - y[a];
      const u = Math.min(Math.max(((px - x[a]) * ex + (py - y[a]) * ey) / (ex * ex + ey * ey), 0), 1);
      const qx = x[a] + ex * u, qy = y[a] + ey * u, d = Math.hypot(px - qx, py - qy);
      if (!out || d < out.d) out = { i: a, u, d, side: Math.sign(ex * (py - y[a]) - ey * (px - x[a])) };
    }
    return out;
  }
  const lerpAt = (arr, q) => arr[q.i] + (arr[Math.min(q.i + 1, n - 1)] - arr[q.i]) * q.u;

  return { n, x, y, s, sec, secF, tx, ty, h0, hd, ht, hg, w, steps, treads, length: s[n - 1], hdAt,
    bbox: [x0, y0, x1, y1], near, nearest, lerpAt, spec };
}

// A repeatable random number in [0, 1) for an integer.
function hash(k) {
  let x = Math.imul(k ^ 0x9e3779b9, 0x85ebca6b);
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35);
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

// Gaussian smoothing of a sampled profile, sigma in samples, ends held.
function gauss(a, sigma) {
  const n = a.length, r = Math.ceil(sigma * 2.5);
  const k = Array.from({ length: 2 * r + 1 }, (_, j) => Math.exp(-((j - r) ** 2) / (2 * sigma * sigma)));
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    let acc = 0, wsum = 0;
    for (let j = -r; j <= r; j++) {
      const q = i + j;
      if (q < 0 || q >= n) continue;
      acc += a[q] * k[j + r]; wsum += k[j + r];
    }
    out[i] = acc / wsum;
  }
  return out;
}

// The line at eye height for walking it (v8's scroll): every `step` metres, the position
// (east, north, height) and the heading (compass degrees) and grade looking ahead, with the
// ups and downs of the steps smoothed out of it.
export function walkLine(route, { eye = 1.6, step = 0.5, look = 4 } = {}) {
  const { n, x, y, ht } = route;
  const hs = gauss(ht, 0.6 / DS);
  const out = [];
  const every = Math.max(1, Math.round(step / DS)), ahead = Math.round(look / DS);
  for (let i = 0; i < n; i += every) {
    const j = Math.min(n - 1, i + ahead), a = Math.max(0, i - ahead);
    const dx = x[j] - x[a], dy = y[j] - y[a];
    const heading = ((Math.atan2(dx, dy) * 180) / Math.PI + 360) % 360;
    const grade = (hs[j] - hs[a]) / Math.max(Math.hypot(dx, dy), 1e-3);
    out.push({ s: +(i * DS).toFixed(2), pos: [+x[i].toFixed(2), +y[i].toFixed(2), +(hs[i] + eye).toFixed(2)], heading: +heading.toFixed(1), grade: +grade.toFixed(3) });
  }
  return out;
}
