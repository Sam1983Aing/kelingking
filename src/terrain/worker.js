// Runs the heightfield generator off the main thread and also derives the
// object-space normal map, so the page stays responsive while tuning.

import { generateHeightfield } from './heightfield.js';

self.onmessage = (e) => {
  const { id, layout, N } = e.data;
  const hf = generateHeightfield(layout, N);
  const normals = normalMap(hf.heights, N, hf.cell);
  self.postMessage({ id, N, cell: hf.cell, extent: hf.extent, ms: hf.ms, heights: hf.heights, normals }, [hf.heights.buffer, normals.buffer]);
};

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
