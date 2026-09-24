// Builds the terrain mesh from the heightfield, with vertices pulled onto the cliffs.
//
// A plain grid gives a 100 m cliff that is 7 m wide on the map only a handful of samples,
// and the grid crosses the face at an angle, so it renders as vertical stripes and teeth.
// Here every vertex near a cliff slides along the slope direction (the gradient of the
// distance field that shapes that cliff) so that, along that line, vertices end up evenly
// spaced by distance over the ground instead of on the map. The flats beside a cliff give
// up vertices and the face gets them. The mapping is monotone and zero at the window edges,
// so along each line nothing can cross, and it joins the untouched grid seamlessly.
//
// After that, a wave-cut notch is carved into the foot of the rock faces, which makes the
// mesh overhang there. That is fine, it is no longer a heightfield.

export function buildTerrainMesh(hf, layout, M) {
  const t0 = performance.now();
  const { fields: f, heightAt } = hf;
  const { x0, y0, size } = hf.extent;
  const step = size / (M - 1);
  const shift = layout.beach.shift;
  const mesh = layout.mesh;

  const pos = new Float32Array(M * M * 3);
  const DX = new Float32Array(M * M), DY = new Float32Array(M * M);
  const sample = makeSampler(f);
  const K = mesh.samples;
  const ts = new Float64Array(K), hs = new Float64Array(K), ss = new Float64Array(K);
  let moved = 0;

  for (let j = 0; j < M; j++) {
    for (let i = 0; i < M; i++) {
      const x = x0 + i * step, y = y0 + j * step;
      const edge = i === 0 || j === 0 || i === M - 1 || j === M - 1;

      if (!edge) {
        const sandW = sample(f.sand, x, y);
        const isle = sample(f.ISLE, x, y);
        const face = sample(f.face, x, y);
        // Which distance field shapes the cliff here, and the window along it that the
        // vertices are redistributed over. On rock and islets it is the waterline, in beach
        // zones it is the mapped cliff-top line with the wall below it.
        let fld, phi0, a, b, wZone;
        if (sandW < 0.5 || isle > 0.5) {
          fld = 'DC';
          phi0 = sample(f.DC, x, y) + shift * sandW;
          a = -mesh.below; b = face + mesh.above;
          wZone = isle > 0.5 ? 1 : 1 - smooth(0.2, 0.45, sandW);
        } else {
          fld = 'DK';
          phi0 = sample(f.DK, x, y);
          a = -face - mesh.below - 10; b = mesh.above;
          wZone = smooth(0.55, 0.8, sandW);
        }

        if (wZone > 0 && phi0 > a && phi0 < b) {
          // Direction of the slope: the gradient of the field, which for a distance field
          // has length 1 except near its ridges (where two coasts are equally close).
          const e = hf.cell;
          let gx = (sample(f[fld], x + e, y) - sample(f[fld], x - e, y)) / (2 * e);
          let gy = (sample(f[fld], x, y + e) - sample(f[fld], x, y - e)) / (2 * e);
          const gl = Math.hypot(gx, gy);
          const conf = smooth(0.55, 0.85, gl) * wZone;
          if (conf > 0) {
            gx /= gl; gy /= gl;
            // Profile along the line through this vertex, and its length over the ground.
            let S = 0;
            for (let k = 0; k < K; k++) {
              const t = a + ((b - a) * k) / (K - 1);
              ts[k] = t;
              hs[k] = heightAt(x + (t - phi0) * gx, y + (t - phi0) * gy);
              if (k > 0) S += Math.hypot(ts[k] - ts[k - 1], mesh.weight * (hs[k] - hs[k - 1]));
              ss[k] = S;
            }
            // Where this vertex's share of the window falls along that length.
            const target = ((phi0 - a) / (b - a)) * S;
            let k = 1;
            while (k < K - 1 && ss[k] < target) k++;
            const u = (target - ss[k - 1]) / Math.max(ss[k] - ss[k - 1], 1e-9);
            const t1 = ts[k - 1] + (ts[k] - ts[k - 1]) * Math.min(Math.max(u, 0), 1);
            const d = (t1 - phi0) * conf;
            DX[j * M + i] = d * gx; DY[j * M + i] = d * gy;
            if (Math.abs(d) > 0.01) moved++;
          }
        }
      }
    }
  }

  // A few triangles still cross over where neighbouring lines map slightly differently
  // (the face is so compressed that a few centimetres is enough). On a vertical face that
  // is just a tiny overhanging facet, so they are left alone and the terrain is drawn
  // two-sided. Nudging them back one vertex at a time was tried: it cascades along the
  // face and leaves combs of fins along the cliff tops.
  const index = gridIndex(M);
  function gx0(v) { return x0 + (v % M) * step; }
  function gy0(v) { return y0 + Math.floor(v / M) * step; }

  for (let v = 0; v < M * M; v++) {
    const x = gx0(v) + DX[v], y = gy0(v) + DY[v];
    pos[v * 3] = x;
    pos[v * 3 + 1] = heightAt(x, y);
    pos[v * 3 + 2] = -y;
  }

  const notched = carveNotch(pos, M, f, sample, layout);

  // Triangle normals follow the triangulation, which still zigzags across a cliff rim
  // (neighbouring vertices land either side of it). The surface itself is smooth, so where
  // it is steep, take the normal from heightAt around the vertex instead.
  const normals = vertexNormals(pos, index);
  const e = 0.3;
  for (let v = 0; v < M * M; v++) {
    if (normals[v * 3 + 1] > 0.92 && DX[v] === 0 && DY[v] === 0) continue;
    const x = pos[v * 3], y = -pos[v * 3 + 2];
    const hx = (heightAt(x + e, y) - heightAt(x - e, y)) / (2 * e);
    const hy = (heightAt(x, y + e) - heightAt(x, y - e)) / (2 * e);
    const l = Math.hypot(hx, 1, hy);
    // three.js space: x east, y up, z south. Surface (x, h, -y) has normal (-hx, 1, hy).
    let nx = -hx / l, ny = 1 / l, nz = hy / l;
    const w = notched[v];
    if (w > 0) {
      nx = nx * (1 - w) + normals[v * 3] * w; ny = ny * (1 - w) + normals[v * 3 + 1] * w; nz = nz * (1 - w) + normals[v * 3 + 2] * w;
      const k = Math.hypot(nx, ny, nz) || 1; nx /= k; ny /= k; nz /= k;
    }
    normals[v * 3] = nx; normals[v * 3 + 1] = ny; normals[v * 3 + 2] = nz;
  }
  return { positions: pos, normals, index, M, moved, ms: Math.round(performance.now() - t0) };
}

// The sea cuts a notch a few metres deep into the foot of the limestone, which leaves a
// dark overhanging lip all round the head and the islet. Push rock-face vertices near sea
// level inland, most at about 2 m up.
function carveNotch(pos, M, f, sample, layout) {
  const notched = new Float32Array(M * M);
  const n = layout.notch;
  if (!n || n.depth <= 0) return notched;
  const e = f.cell;
  for (let v = 0; v < M * M; v++) {
    const x = pos[v * 3], h = pos[v * 3 + 1], y = -pos[v * 3 + 2];
    if (h < 0 || h > n.top + 1) continue;
    const sandW = sample(f.sand, x, y);
    if (sandW > 0.4) continue;
    const dc = sample(f.DC, x, y);
    if (dc < -2 || dc > 12) continue;
    let gx = (sample(f.DC, x + e, y) - sample(f.DC, x - e, y)) / (2 * e);
    let gy = (sample(f.DC, x, y + e) - sample(f.DC, x, y - e)) / (2 * e);
    const gl = Math.hypot(gx, gy);
    if (gl < 0.6) continue;
    gx /= gl; gy /= gl;
    // Deepest at mid-height, closing at sea level and at the top of the notch.
    const bell = Math.sin(Math.PI * Math.min(Math.max(h / n.top, 0), 1));
    const d = n.depth * bell * (1 - sandW / 0.4) * smooth(0.6, 0.9, gl) * smooth(12, 4, dc);
    pos[v * 3] += gx * d;
    pos[v * 3 + 2] -= gy * d;
    notched[v] = Math.min(1, d / 0.5);
  }
  return notched;
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

function gridIndex(M) {
  const idx = new Uint32Array((M - 1) * (M - 1) * 6);
  let n = 0;
  for (let j = 0; j < M - 1; j++) {
    for (let i = 0; i < M - 1; i++) {
      const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
      idx[n++] = a; idx[n++] = b; idx[n++] = c;
      idx[n++] = b; idx[n++] = d; idx[n++] = c;
    }
  }
  return idx;
}

// Area-weighted vertex normals.
function vertexNormals(pos, idx) {
  const nrm = new Float32Array(pos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3, b = idx[t + 1] * 3, c = idx[t + 2] * 3;
    const ux = pos[b] - pos[a], uy = pos[b + 1] - pos[a + 1], uz = pos[b + 2] - pos[a + 2];
    const vx = pos[c] - pos[a], vy = pos[c + 1] - pos[a + 1], vz = pos[c + 2] - pos[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    for (const p of [a, b, c]) { nrm[p] += nx; nrm[p + 1] += ny; nrm[p + 2] += nz; }
  }
  for (let p = 0; p < nrm.length; p += 3) {
    const l = Math.hypot(nrm[p], nrm[p + 1], nrm[p + 2]) || 1;
    nrm[p] /= l; nrm[p + 1] /= l; nrm[p + 2] /= l;
  }
  return nrm;
}

const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
