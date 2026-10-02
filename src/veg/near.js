// Plants near the camera as real geometry. Every frame the camera moves, the plants within
// reach are picked from a grid over the island, checked against the view, and written into
// one instanced mesh per species, variant and level of detail.
//
// Each instance carries a coverage interval (lo, hi): the full plant up close, a lighter
// one (fewer leaves, a little bigger) further off, and the impostor beyond that. The interval's
// width selects stable groups of complete leaves/blades. A narrow soft boundary avoids
// replacement pops without a translucent MSAA grid across the whole plant.
//
// A plant the lens is inside (or nearly: within LENS of its crown's ellipsoid, in crown radii)
// dissolves the same way, rather than filling the frame with a few leaves (v8: the scroll's
// camera walks under hanging scrub on the switchbacks). Still frames are not affected unless
// their camera stands in a plant.

import * as THREE from 'three';
import { plantMaterial } from './plant-material.js';
import { STRIDE } from './scatter.js';

const CELL = 8;
const LENS = [1.2, 1.4];

export function createNearPlants({ species, shared, leafTex }) {
  const group = new THREE.Group();
  // species[k] = { id, lod: { near, far, detail }, variants: [{ info, levels: [geometry, ...] }] }
  // detail: where each level hands over to the next (a 2 m band ending there).
  // Each level of each variant is two meshes: the plants fully in (no fade, and no
  // cut-out at all where the leaves are built to their outline, so the GPU can skip hidden
  // leaves before shading them), and the plants handing over (antialiased coverage).
  const part = (sp, v, geometry, level, solid) => {
    const cap = solid ? sp.capacity ?? 2048 : Math.ceil((sp.capacity ?? 2048) / 2);
    const g = new THREE.InstancedBufferGeometry();
    for (const [k, a] of Object.entries(geometry.attributes)) g.setAttribute(k, a);
    g.index = geometry.index;
    const posScale = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const yawTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPosScale', posScale);
    g.setAttribute('iYawTint', yawTint);
    g.instanceCount = 0;
    // Lit per vertex: the lightest level, and grass, whose blades are a few
    // millimetres wide.
    const vertexLight = (level > 0 && level === (sp.lod.detail?.length ?? 0)) || sp.id === 'grass';
    const mesh = new THREE.Mesh(g, plantMaterial(shared, v.info, leafTex, { vertexLight, solid, alpha: geometry.userData.alphaLeaves !== false }));
    mesh.frustumCulled = false;
    // Before the ground's colour pass (and after its depth pass), so the ground's shader
    // skips what the plants hide.
    mesh.renderOrder = -1;
    mesh.name = `near:${sp.id}:${v.info.variant ?? 0}:${level}${solid ? '' : ':fade'}`;
    group.add(mesh);
    return { mesh, g, posScale, yawTint, cap, n: 0 };
  };
  const make = (sp, v, geometry, level) => ({
    parts: [part(sp, v, geometry, level, true), part(sp, v, geometry, level, false)],
    radius: v.info.radius, height: v.info.height, crownC: v.info.crownC, crownR: v.info.crownR,
  });
  const meshes = species.map((sp) => sp.variants.map((v) => (v.levels ?? [v.geometry]).map((g, k) => make(sp, v, g, k))));

  let data = null, count = 0;
  // One grid per species, so each is searched only as far as it can be drawn in 3D (the
  // camera moves every frame in the scroll: the dense scrub within reach of the palms is
  // tens of thousands of plants).
  let grids = [];

  function setPlants(plants) {
    data = plants.data; count = plants.count;
    grids = species.map(() => new Map());
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      const g = grids[data[o + 5]];
      if (!g) continue;
      const key = cellKey(Math.floor(data[o] / CELL), Math.floor(data[o + 2] / CELL));
      let l = g.get(key);
      if (!l) g.set(key, (l = []));
      l.push(i);
    }
    last.x = NaN;
  }
  const cellKey = (i, j) => (i + 4096) * 8192 + (j + 4096);

  const frustum = new THREE.Frustum();
  const m4 = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const last = { x: NaN, y: 0, z: 0, q: new THREE.Quaternion(), fov: 0, lod: 1 };
  const stats = { picked: 0, checked: 0, levels: [] };
  // Picked this frame: which mesh, which plant, its band, its distance. Written out nearest
  // first, so the depth test turns away the hidden leaves behind (alpha to coverage and
  // discard keep the GPU from doing that itself).
  const picks = [];
  const put = (L, o, lo, hi, d) => {
    if (hi - lo <= 0.001) return; // Lens fade can empty the further detail level's interval.
    const M = L.parts[lo <= 0.001 && hi >= 0.999 ? 0 : 1];
    if (M.n < M.cap) { M.n++; picks.push({ M, o, lo, hi, d }); }
  };
  const allParts = () => meshes.flatMap((vs) => vs.flatMap((levels) => levels.flatMap((L) => L.parts)));
  function write() {
    picks.sort((a, b) => a.d - b.d);
    for (const m of allParts()) m.n = 0;
    for (const { M, o, lo, hi } of picks) {
      const a = M.posScale.array, b = M.yawTint.array, q = M.n * 4;
      a[q] = data[o]; a[q + 1] = data[o + 1]; a[q + 2] = data[o + 2]; a[q + 3] = data[o + 3];
      b[q] = data[o + 4]; b[q + 1] = data[o + 7] * 2 - 1; b[q + 2] = lo; b[q + 3] = hi;
      M.n++;
    }
    picks.length = 0;
  }

  // lodScale: how much further a plant counts as than it is (a narrow lens brings things close).
  function update(camera, lodScale = 1) {
    if (!data) return;
    const p = camera.position;
    const moved = Math.abs(p.x - last.x) + Math.abs(p.y - last.y) + Math.abs(p.z - last.z) > 0.05
      || camera.quaternion.angleTo(last.q) > 0.005 || camera.fov !== last.fov || lodScale !== last.lod;
    if (!moved) return;
    last.x = p.x; last.y = p.y; last.z = p.z; last.q.copy(camera.quaternion); last.fov = camera.fov; last.lod = lodScale;
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m4, THREE.WebGLCoordinateSystem, camera.reversedDepth);
    for (const m of allParts()) m.n = 0;
    stats.checked = 0; stats.levels = [];
    for (let sp0 = 0; sp0 < species.length; sp0++) {
    const grid = grids[sp0];
    if (!grid || !species[sp0].variants.length) continue;
    // (A plant's distance is taken to its middle, so allow for its height above its foot.)
    const R = species[sp0].lod.far / lodScale + 8;
    const far2 = (species[sp0].lod.far / lodScale) ** 2;
    const i0 = Math.floor((p.x - R) / CELL), i1 = Math.floor((p.x + R) / CELL);
    const j0 = Math.floor((p.z - R) / CELL), j1 = Math.floor((p.z + R) / CELL);
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l = grid.get(cellKey(i, j));
      if (!l) continue;
      for (const k of l) {
        const o = k * STRIDE;
        const sp = data[o + 5], va = data[o + 6];
        const S = species[sp];
        if (!S) continue;
        const levels = meshes[sp][va];
        if (!levels) continue;
        const M = levels[0];
        stats.checked++;
        const s = data[o + 3];
        const cy = data[o + 1] + M.height * s * 0.5;
        const dx = data[o] - p.x, dy = cy - p.y, dz = data[o + 2] - p.z;
        const d2 = dx * dx + dy * dy + dz * dz;
        if (d2 > far2) continue;
        const d = Math.sqrt(d2) * lodScale;
        sphere.center.set(data[o], cy, data[o + 2]);
        sphere.radius = Math.max(M.radius, M.height * 0.6) * s * 1.3;
        if (!frustum.intersectsSphere(sphere)) continue;
        // The impostor's coverage increases as the 3D plant's decreases.
        let top = 1 - smoothstep(S.lod.near, S.lod.far, d);
        // The lens in or at the crown: the plant dissolves (nobody keeps the rest of the band).
        if (M.crownC && d2 < (M.radius * s + 1) ** 2 * 4) {
          const yaw = data[o + 4], c = Math.cos(yaw), sn = Math.sin(yaw);
          const px = (p.x - data[o]) / s, py = (p.y - data[o + 1]) / s, pz = (p.z - data[o + 2]) / s;
          const lx = c * px - sn * pz, lz = sn * px + c * pz;
          const C = M.crownC, Rr = M.crownR;
          const e = Math.hypot((lx - C[0]) / Rr[0], (py - C[1]) / Rr[1], (lz - C[2]) / Rr[2]);
          top = Math.min(top, smoothstep(LENS[0], LENS[1], e));
          if (top <= 0.001) continue;
        }
        // The coverage intervals of the levels either side of a hand-over. Their widths
        // sum to top; the impostor takes the remaining weight.
        const D = S.lod.detail ?? [];
        let lv = 0;
        while (lv < D.length && d > D[lv]) lv++;
        const t = lv < D.length ? smoothstep(D[lv] - 2, D[lv], d) : 0;
        if (lv < levels.length) put(levels[lv], o, 0, Math.min(top, 1 - t), d);
        if (t > 0 && lv + 1 < levels.length) put(levels[lv + 1], o, 1 - t, top, d);
        stats.levels[lv] = (stats.levels[lv] ?? 0) + 1;
      }
    }
    }
    write();
    stats.picked = 0;
    for (const m of allParts()) {
      m.g.instanceCount = m.n;
      m.mesh.visible = m.n > 0;
      if (m.n) {
        m.posScale.clearUpdateRanges(); m.posScale.addUpdateRange(0, m.n * 4); m.posScale.needsUpdate = true;
        m.yawTint.clearUpdateRanges(); m.yawTint.addUpdateRange(0, m.n * 4); m.yawTint.needsUpdate = true;
      }
      stats.picked += m.n;
    }
  }

  return { group, setPlants, update, stats, meshes };
}

function smoothstep(a, b, x) { const t = Math.min(Math.max((x - a) / (b - a), 0), 1); return t * t * (3 - 2 * t); }
