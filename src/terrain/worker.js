// Runs the heightfield generator off the main thread and also derives the
// object-space normal map, so the page stays responsive while tuning.

import { generateHeightfield, signedDistance, blur } from './heightfield.js';
import { buildTerrainMesh, contourChains, resampleChain } from './mesh-builder.js';
import { scatterPlants, canopyCover } from '../veg/scatter.js';
import { buildTrailGeometry } from '../trail/geometry.js';

self.onmessage = (e) => {
  const { id, layout, N, M } = e.data;
  const hf = generateHeightfield(layout, N);
  const mesh = buildTerrainMesh(hf, layout, M);
  const normals = normalMap(hf.heights, N, hf.cell);
  const plants = scatterPlants(hf, layout, mesh.surfaceShift);
  const water = waterData(hf, N, canopyCover(plants, hf.extent, N));
  const shoreDir = shoreDirection(hf.shore, N);
  const coast = coastData(hf, mesh, layout, N);
  const breakers = breakerLines(hf, N);
  const trail = trailData(hf, layout);
  self.postMessage({ id, N, cell: hf.cell, extent: hf.extent, ms: hf.ms, heights: hf.heights, normals, water, shoreDir, coast: coast.data, coastMs: coast.ms, breakers, rockSites: coast.sites,
    plants: { data: plants.data, count: plants.count, shrubs: plants.shrubs, ms: plants.ms }, trail: trail?.data,
    mesh: { positions: mesh.positions, normals: mesh.normals, index: mesh.index, rock: mesh.rock, horizon: mesh.horizon, M, moved: mesh.moved, gridTris: mesh.gridTris, ms: mesh.ms } },
    [hf.heights.buffer, normals.buffer, water.buffer, shoreDir.buffer, coast.data.buffer, breakers.buffer, coast.sites.buffer, plants.data.buffer, ...(trail?.transfer ?? []), mesh.positions.buffer, mesh.normals.buffer, mesh.index.buffer, mesh.rock.buffer, mesh.horizon.buffer]);
};

// Half-float RGBA texture for the water shader:
//   R terrain height, G distance offshore from the waterline (m), B beach weight,
//   A how much sand hangs in the water (the milky plumes in the bays); on land, where there
//   is no water, minus how much of the ground the plants' crowns cover (v7, for the ground
//   under them: terrain-shader.js).
function waterData(hf, N, canopy) {
  const out = new Uint16Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    out[k * 4] = toHalf(hf.heights[k]);
    out[k * 4 + 1] = toHalf(-hf.shore[k]);
    out[k * 4 + 2] = toHalf(hf.sand[k]);
    out[k * 4 + 3] = toHalf(hf.heights[k] > 1 && canopy[k] > 0 ? -canopy[k] : hf.murk[k]);
  }
  return out;
}

// Half-float RGBA for the white water at the rock (src/water/):
//   R  distance to the foot of the rock at sea level (m). Read off the carved mesh, where the
//      face strips cross the water, so it follows the notch and the arch rather than the
//      map's coastline (which the faces now stand back from in places).
//   G  how exposed that bit of rock is to the swell: facing it, and not in the lee of the
//      headland or the islet.
//   B  how open the sea here is to the swell (the lee of the headland is calmer).
//   A  1 where the nearest foot is rock, 0 where it is sand.
function coastData(hf, mesh, layout, N) {
  const t0 = performance.now();
  const { x0, y0, size } = hf.extent;
  const cell = size / N;
  const foot = new Uint8Array(N * N);
  const P = mesh.positions, I = mesh.index;
  const mark = (x, y) => {
    const i = Math.floor((x - x0) / cell), j = Math.floor((y - y0) / cell);
    if (i >= 0 && j >= 0 && i < N && j < N) foot[j * N + i] = 1;
  };
  // Every face triangle whose edges cross sea level marks where the water meets the rock.
  for (let t = mesh.gridTris * 3; t < I.length; t += 3) {
    for (let e = 0; e < 3; e++) {
      const a = I[t + e] * 3, b = I[t + (e + 1) % 3] * 3;
      const ha = P[a + 1], hb = P[b + 1];
      if ((ha > 0) === (hb > 0)) continue;
      const f = ha / (ha - hb);
      mark(P[a] + (P[b] - P[a]) * f, -(P[a + 2] + (P[b + 2] - P[a + 2]) * f));
    }
  }
  // Rock coast with no face strip (low shelves): the heightfield's own waterline, away
  // from the beaches.
  const H = hf.heights;
  for (let j = 1; j < N - 1; j++) for (let i = 1; i < N - 1; i++) {
    const k = j * N + i;
    if (H[k] <= 0 || hf.sand[k] > 0.3) continue;
    if (H[k - 1] <= 0 || H[k + 1] <= 0 || H[k - N] <= 0 || H[k + N] <= 0) {
      // Only if no face crossing is already close by (the carved foot wins).
      let near = false;
      const r = Math.ceil(3 / cell);
      for (let dj = -r; dj <= r && !near; dj++) for (let di = -r; di <= r; di++) {
        const q = (j + dj) * N + i + di;
        if (q >= 0 && q < N * N && foot[q] === 1) { near = true; break; }
      }
      if (!near) foot[k] = 2;
    }
  }
  const { sd, nearestIn } = signedDistance(foot.map((v) => (v ? 1 : 0)), N, cell);

  // Zones that ask for more surf at the rock (layout.js, `surf`).
  const surfZones = layout.zones.filter((z) => z.surf);
  const surfBoost = (x, y) => surfZones.reduce((a, z) => a + z.surf * Math.exp(-((x - z.at[0]) ** 2 + (y - z.at[1]) ** 2) / (z.r * z.r)), 0);
  // Swell shelter, on a coarse grid: the share of directions around the swell's (it comes
  // from the opposite way it travels) along which the water is open for 1.5 km.
  const Nc = 256, cc = size / Nc;
  const land = new Uint8Array(Nc * Nc);
  for (let j = 0; j < Nc; j++) for (let i = 0; i < Nc; i++) {
    const k = Math.floor((j + 0.5) * N / Nc) * N + Math.floor((i + 0.5) * N / Nc);
    land[j * Nc + i] = H[k] > 0.3 ? 1 : 0;
  }
  const sh = (layout.water?.swellHeading ?? 40) * Math.PI / 180;
  const dirs = [-24, -12, 0, 12, 24].map((d) => { const a = sh + Math.PI + d * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; });
  const open = new Float32Array(Nc * Nc);
  for (let j = 0; j < Nc; j++) for (let i = 0; i < Nc; i++) {
    let o = 0;
    for (const [dx, dy] of dirs) {
      let clear = 1;
      for (let t = 1.5; t < 1500 / cc; t += 1) {
        const ii = Math.round(i + dx * t), jj = Math.round(j + dy * t);
        if (ii < 0 || jj < 0 || ii >= Nc || jj >= Nc) break;
        if (land[jj * Nc + ii]) { clear = t * cc < 40 ? 0.25 : 0; break; }
      }
      o += clear;
    }
    open[j * Nc + i] = o / dirs.length;
  }
  blur(open, Nc, 2);   // waves bend round into the lee (diffraction), so soften it
  const openAt = (x, y) => {
    const u = Math.min(Math.max((x - x0) / cc - 0.5, 0), Nc - 1.001), v = Math.min(Math.max((y - y0) / cc - 0.5, 0), Nc - 1.001);
    const i = Math.floor(u), j = Math.floor(v), fx = u - i, fy = v - j;
    const a = open[j * Nc + i], b = open[j * Nc + i + 1], c = open[(j + 1) * Nc + i], d = open[(j + 1) * Nc + i + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  };
  // Exposure of each foot cell: facing the swell (the offshore direction there, from the
  // shore distance field) and open to it.
  const S = hf.shore;
  const sw = [Math.sin(sh), Math.cos(sh)];
  const out = new Uint16Array(N * N * 4);
  const expo = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) {
    if (!foot[k]) continue;
    const i = k % N, j = (k / N) | 0;
    const r = 3, im = Math.max(0, i - r), ip = Math.min(N - 1, i + r), jm = Math.max(0, j - r), jp = Math.min(N - 1, j + r);
    let gx = -(S[j * N + ip] - S[j * N + im]), gy = -(S[jp * N + i] - S[jm * N + i]);
    const gl = Math.hypot(gx, gy) || 1;
    const facing = (-(gx / gl) * sw[0] - (gy / gl) * sw[1]);
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
    // Probe the openness a little way out from the rock.
    const o = openAt(x + (gx / gl) * 12, y + (gy / gl) * 12);
    expo[k] = Math.min(1, Math.max(0, 0.15 + 0.85 * smooth01(-0.35, 0.7, facing))) * (0.2 + 0.8 * o);
    expo[k] = Math.min(1, expo[k] + surfBoost(x, y));
  }
  // Sites for the bursts of white water (src/water/spray.js): a foot cell in every 2.5 m
  // square, with the way out to sea and the exposure.
  const sites = [];
  const bucket = new Set();
  for (let k = 0; k < N * N; k++) {
    if (!foot[k] || hf.sand[k] > 0.3) continue;
    const i = k % N, j = (k / N) | 0;
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
    const key = Math.floor(x / 2.5) * 100000 + Math.floor(y / 2.5);
    if (bucket.has(key)) continue;
    bucket.add(key);
    const r = 3, im = Math.max(0, i - r), ip = Math.min(N - 1, i + r), jm = Math.max(0, j - r), jp = Math.min(N - 1, j + r);
    const gx = -(S[j * N + ip] - S[j * N + im]), gy = -(S[jp * N + i] - S[jm * N + i]);
    const gl = Math.hypot(gx, gy) || 1;
    sites.push(x, y, gx / gl, gy / gl, expo[k]);
  }
  for (let k = 0; k < N * N; k++) {
    const i = k % N, j = (k / N) | 0;
    const x = x0 + (i + 0.5) * cell, y = y0 + (j + 0.5) * cell;
    const n = foot[k] ? k : nearestIn[k];
    out[k * 4] = toHalf(foot[k] ? 0 : Math.min(-sd[k], 200));
    out[k * 4 + 1] = toHalf(n >= 0 ? expo[n] : 0);
    out[k * 4 + 2] = toHalf(openAt(x, y));
    out[k * 4 + 3] = toHalf(n >= 0 && hf.sand[n] < 0.5 ? 1 : 0);
  }
  return { data: out, sites: new Float32Array(sites), ms: Math.round(performance.now() - t0) };
}
// The beaches' waterlines, for the breaking waves (src/water/breaker.js): smooth polylines
// 0.5 m apart, as runs of (x, y, offshore x, offshore y, distance along), each run ended by
// a row of NaN. Only where the shore is sand, and only runs longer than 25 m.
function breakerLines(hf, N) {
  const { x0, y0, size } = hf.extent;
  const cell = size / N;
  const F = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) F[k] = -hf.shore[k];
  const sandAt = (x, y) => {
    const i = Math.min(N - 1, Math.max(0, Math.floor((x - x0) / cell))), j = Math.min(N - 1, Math.max(0, Math.floor((y - y0) / cell)));
    return hf.sand[j * N + i];
  };
  const out = [];
  for (const chain of contourChains(F, N, x0, y0, cell)) {
    // Split into runs on sand.
    let run = [];
    const flush = () => {
      if (run.length > 1) {
        let len = 0;
        for (let k = 1; k < run.length; k++) len += Math.hypot(run[k][0] - run[k - 1][0], run[k][1] - run[k - 1][1]);
        if (len > 25) {
          const pts = resampleChain(run, () => 0.5);
          // Offshore normals from the smoothed tangent, pointing to where the shore distance grows.
          let along = 0;
          for (let k = 0; k < pts.length; k++) {
            const a = pts[Math.max(0, k - 6)], b = pts[Math.min(pts.length - 1, k + 6)];
            let tx = b[0] - a[0], ty = b[1] - a[1];
            const tl = Math.hypot(tx, ty) || 1;
            tx /= tl; ty /= tl;
            let nx = ty, ny = -tx;
            const px = pts[k][0] + nx * 3, py = pts[k][1] + ny * 3;
            const i = Math.min(N - 1, Math.max(0, Math.floor((px - x0) / cell))), j = Math.min(N - 1, Math.max(0, Math.floor((py - y0) / cell)));
            if (F[j * N + i] < 0) { nx = -nx; ny = -ny; }
            if (k > 0) along += Math.hypot(pts[k][0] - pts[k - 1][0], pts[k][1] - pts[k - 1][1]);
            out.push(pts[k][0], pts[k][1], nx, ny, along);
          }
          out.push(NaN, NaN, NaN, NaN, NaN);
        }
      }
      run = [];
    };
    for (const q of chain) { if (sandAt(q[0], q[1]) > 0.6) run.push(q); else flush(); }
    flush();
  }
  return new Float32Array(out);
}

const smooth01 = (a, b, x) => { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); };

// RGBA8: the unit direction pointing offshore (R, G, from -1..1 packed to 0..255), so the
// shader knows which way each bit of coast faces without sampling around it.
function shoreDirection(shore, N) {
  const out = new Uint8Array(N * N * 4);
  const r = 3;
  for (let j = 0; j < N; j++) {
    const jm = Math.max(0, j - r), jp = Math.min(N - 1, j + r);
    for (let i = 0; i < N; i++) {
      const im = Math.max(0, i - r), ip = Math.min(N - 1, i + r);
      // shore is positive on land, so offshore is down its gradient.
      const gx = -(shore[j * N + ip] - shore[j * N + im]);
      const gy = -(shore[jp * N + i] - shore[jm * N + i]);
      const l = Math.hypot(gx, gy) || 1;
      const k = (j * N + i) * 4;
      out[k] = Math.round((gx / l) * 127.5 + 127.5);
      out[k + 1] = Math.round((gy / l) * 127.5 + 127.5);
      out[k + 3] = 255;
    }
  }
  return out;
}

const f32 = new Float32Array(1);
const u32 = new Uint32Array(f32.buffer);
function toHalf(v) {
  f32[0] = v;
  const x = u32[0];
  const sign = (x >>> 16) & 0x8000;
  const exp = ((x >>> 23) & 0xff) - 112;
  const mant = x & 0x7fffff;
  if (exp <= 0) return sign;
  if (exp >= 31) return sign | 0x7bff;
  return sign | ((exp << 10) + ((mant + 0x1000) >> 13));
}

// Normals in three.js space (x east, y up, z south). For a surface (x, h(x, y), -y) the
// normal is (-dh/dx, 1, dh/dy).
function normalMap(H, N, cell) {
  const out = new Uint8Array(N * N * 4);
  for (let j = 0; j < N; j++) {
    const jm = Math.max(0, j - 1), jp = Math.min(N - 1, j + 1);
    for (let i = 0; i < N; i++) {
      const im = Math.max(0, i - 1), ip = Math.min(N - 1, i + 1);
      const hx = (H[j * N + ip] - H[j * N + im]) / ((ip - im) * cell);
      const hy = (H[jp * N + i] - H[jm * N + i]) / ((jp - jm) * cell);
      const l = Math.hypot(hx, 1, hy);
      const k = (j * N + i) * 4;
      out[k] = ((-hx / l) * 0.5 + 0.5) * 255;
      out[k + 1] = ((1 / l) * 0.5 + 0.5) * 255;
      out[k + 2] = ((hy / l) * 0.5 + 0.5) * 255;
      out[k + 3] = 255;
    }
  }
  return out;
}

// The path (src/trail/, v6): its line, the carve's mask for the ground's shader, and the
// geometry along it, as arrays the page can take over without copying.
function trailData(hf, layout) {
  if (!hf.trail) return null;
  const { route: r, carve: c } = hf.trail;
  const geo = buildTrailGeometry(r, hf.heightAt, layout.trail);
  const transfer = [];
  const take = (a) => { transfer.push(a.buffer); return a; };
  const meshes = {};
  for (const k of ['concrete', 'dirt']) meshes[k] = { position: take(geo[k].position), normal: take(geo[k].normal), trail: take(geo[k].trail), index: take(geo[k].index) };
  const inst = {};
  for (const k of ['logs', 'stones', 'timberPosts', 'timberRails', 'bambooPosts', 'bambooRails', 'rope']) inst[k] = { matrices: take(geo[k].matrices), rand: take(geo[k].rand), count: geo[k].count };
  const line = {};
  for (const k of ['x', 'y', 's', 'hd', 'ht', 'w']) line[k] = Float32Array.from(r[k]);
  for (const k in line) take(line[k]);
  const mask = Uint8Array.from(c.mask);
  take(mask);
  return { transfer, data: { line, meshes, inst, mask: { data: mask, nx: c.nx, ny: c.ny, x0: c.x0, y0: c.y0, cell: c.cell },
    steps: r.steps.length, length: r.length, ms: { carve: c.ms, geometry: geo.ms },
    sectionEnds: [1, 2].map((k) => r.s[Math.max(0, r.sec.indexOf(k))]) } };
}
