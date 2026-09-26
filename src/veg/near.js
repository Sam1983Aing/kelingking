// Plants near the camera as real geometry. Every frame the camera moves, the plants within
// reach are picked from a grid over the island, checked against the view, and written into
// one instanced mesh per species and variant. Each carries a fade: fully there up close,
// stippled out across the hand-over band, where the impostor stipples in (impostors.js
// works out the same fade from the same numbers).

import * as THREE from 'three';
import { plantMaterial } from './plant-material.js';
import { STRIDE } from './scatter.js';

const CELL = 8;

export function createNearPlants({ species, shared, leafTex }) {
  const group = new THREE.Group();
  // species[k] = { id, lod: { near, far }, variants: [{ info, geometry }] }
  const meshes = species.map((sp) => sp.variants.map((v) => {
    const cap = sp.capacity ?? 2048;
    const g = new THREE.InstancedBufferGeometry();
    for (const [k, a] of Object.entries(v.geometry.attributes)) g.setAttribute(k, a);
    g.index = v.geometry.index;
    const posScale = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    const yawTint = new THREE.InstancedBufferAttribute(new Float32Array(cap * 4), 4).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPosScale', posScale);
    g.setAttribute('iYawTint', yawTint);
    g.instanceCount = 0;
    const mesh = new THREE.Mesh(g, plantMaterial(shared, v.info, leafTex));
    mesh.frustumCulled = false;
    // Before the ground's colour pass (and after its depth pass), so the ground's shader
    // skips what the plants hide.
    mesh.renderOrder = -1;
    mesh.name = `near:${sp.id}:${v.info.variant ?? 0}`;
    group.add(mesh);
    return { mesh, g, posScale, yawTint, cap, n: 0, radius: v.info.radius, height: v.info.height };
  }));

  let data = null, count = 0;
  let grid = new Map();
  const lists = [];   // per species: which plant indices are in which cell

  function setPlants(plants) {
    data = plants.data; count = plants.count;
    grid = new Map();
    for (let i = 0; i < count; i++) {
      const o = i * STRIDE;
      const key = cellKey(Math.floor(data[o] / CELL), Math.floor(data[o + 2] / CELL));
      let l = grid.get(key);
      if (!l) grid.set(key, (l = []));
      l.push(i);
    }
    last.x = NaN;
  }
  const cellKey = (i, j) => (i + 4096) * 8192 + (j + 4096);

  const frustum = new THREE.Frustum();
  const m4 = new THREE.Matrix4();
  const sphere = new THREE.Sphere();
  const last = { x: NaN, y: 0, z: 0, q: new THREE.Quaternion(), fov: 0, lod: 1 };
  const reach = Math.max(...species.map((s) => s.lod.far)) * 1.6;
  const stats = { picked: 0, checked: 0 };

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
    for (const vs of meshes) for (const m of vs) m.n = 0;
    const R = reach / lodScale;
    const i0 = Math.floor((p.x - R) / CELL), i1 = Math.floor((p.x + R) / CELL);
    const j0 = Math.floor((p.z - R) / CELL), j1 = Math.floor((p.z + R) / CELL);
    stats.checked = 0;
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const l = grid.get(cellKey(i, j));
      if (!l) continue;
      for (const k of l) {
        const o = k * STRIDE;
        const sp = data[o + 5], va = data[o + 6];
        const S = species[sp];
        if (!S) continue;
        const M = meshes[sp][va];
        if (!M) continue;
        stats.checked++;
        const s = data[o + 3];
        const cy = data[o + 1] + M.height * s * 0.5;
        const d = Math.hypot(data[o] - p.x, cy - p.y, data[o + 2] - p.z) * lodScale;
        if (d > S.lod.far) continue;
        sphere.center.set(data[o], cy, data[o + 2]);
        sphere.radius = Math.max(M.radius, M.height * 0.6) * s * 1.3;
        if (!frustum.intersectsSphere(sphere)) continue;
        if (M.n >= M.cap) continue;
        const fade = 1 - smoothstep(S.lod.near, S.lod.far, d);
        const a = M.posScale.array, b = M.yawTint.array, q = M.n * 4;
        a[q] = data[o]; a[q + 1] = data[o + 1]; a[q + 2] = data[o + 2]; a[q + 3] = s;
        b[q] = data[o + 4]; b[q + 1] = data[o + 7] * 2 - 1; b[q + 2] = fade; b[q + 3] = (k * 0.618034) % 1;
        M.n++;
      }
    }
    stats.picked = 0;
    for (const vs of meshes) for (const m of vs) {
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
