// Runs the heightfield generator off the main thread and also derives the
// object-space normal map, so the page stays responsive while tuning.

import { generateHeightfield } from './heightfield.js';
import { buildTerrainMesh } from './mesh-builder.js';
import { scatterPlants } from '../veg/scatter.js';

self.onmessage = (e) => {
  const { id, layout, N, M } = e.data;
  const hf = generateHeightfield(layout, N);
  const mesh = buildTerrainMesh(hf, layout, M);
  const normals = normalMap(hf.heights, N, hf.cell);
  const water = waterData(hf, N);
  const shoreDir = shoreDirection(hf.shore, N);
  const plants = scatterPlants(hf, layout, [0, 1, 2]);
  self.postMessage({ id, N, cell: hf.cell, extent: hf.extent, ms: hf.ms, heights: hf.heights, normals, water, shoreDir,
    plants: { data: plants.data, count: plants.count, ms: plants.ms },
    mesh: { positions: mesh.positions, normals: mesh.normals, index: mesh.index, M, moved: mesh.moved, ms: mesh.ms } },
    [hf.heights.buffer, normals.buffer, water.buffer, shoreDir.buffer, plants.data.buffer, mesh.positions.buffer, mesh.normals.buffer, mesh.index.buffer]);
};

// Half-float RGBA texture for the water shader:
//   R terrain height, G distance offshore from the waterline (m), B beach weight,
//   A how much sand hangs in the water (the milky plumes in the bays).
function waterData(hf, N) {
  const out = new Uint16Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    out[k * 4] = toHalf(hf.heights[k]);
    out[k * 4 + 1] = toHalf(-hf.shore[k]);
    out[k * 4 + 2] = toHalf(hf.sand[k]);
    out[k * 4 + 3] = toHalf(hf.murk[k]);
  }
  return out;
}

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
