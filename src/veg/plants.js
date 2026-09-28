// All the plants: grown from their seeds at load (grow/species.js), drawn as real geometry
// near the camera (near.js) and as impostors further off (impostors.js), sharing the wind
// and the light.

import * as THREE from 'three';
import { createImpostors } from './impostors.js';
import { bakeImpostor } from './impostor-bake-rt.js';
import { createNearPlants } from './near.js';
import { GROWERS } from './grow/species.js';
import { leafAtlas } from './grow/leaves.js';
import { SPECIES, SP } from './scatter.js';

// Where each species hands over from 3D to its impostor (metres, at the default lens).
// detail: where each level of detail has handed over to the next (grow/core.js). The full
// naupaka's leaves are built to their outline, ten triangles each: fine up close, but a
// few pixels further off, where tiny triangles cost more than the pixels they cover (v7).
const LOD = {
  scaevola: { near: 10, far: 15, detail: [5] },
  grass: { near: 11, far: 15, detail: [6] },
  tree: { near: 22, far: 32 },
  palm: { near: 30, far: 44 },
  pandanus: { near: 15, far: 22 },
  creeper: { near: 14, far: 20 },
  faceScrub: { near: 10, far: 15 },
};

// detailScale scales the full plants' reach (0: the lighter level everywhere, for looking at
// it; main.js vegDetail=).
// hideParts: plant meshes left out, by the start of their names (near:grass, impostor:0, ...;
// main.js vegHide=), for timing one against the other with tools/ab.mjs --a=self.
export async function createVegetation(renderer, lightUniforms, { wind = {}, detailScale = 1, hideParts = [] } = {}) {
  // (v11) Growing takes about 2 s of JavaScript. Let the page start its downloads and the
  // terrain first, and grow a variant at a time, handing back between them so the loader's
  // counter keeps moving.
  const breathe = () => new Promise((r) => setTimeout(r, 0));
  await breathe();
  const t0 = performance.now();
  for (const l of Object.values(LOD)) if (l.detail) l.detail = l.detail.map((d) => Math.max(2.01, d * detailScale));
  const shared = {
    ...lightUniforms,
    uExtent: { value: new THREE.Vector3() },
    uSunShadow: { value: null },
    uWindTime: { value: 0 },
    // Toward the west-north-west, as the sea's gusts drift (water.js gustDrift).
    uWind: { value: new THREE.Vector4(...(wind.dir ?? [-0.894, -0.447]), wind.strength ?? 0.55, wind.gust ?? 0.8) },
  };
  const leafTex = leafAtlas();

  // Grow every variant of every species that has a 3D form.
  const species = [];
  for (const sp of SPECIES) {
    const grow = GROWERS[sp.id];
    if (!grow) { species.push(null); continue; }
    const variants = [];
    for (let v = 0; v < sp.heights.length; v++) {
      await breathe();
      const h = sp.heights[v];
      const info = grow(1000 + v * 17, { height: h });
      info.variant = v;
      const geometry = info.builder.geometry();
      info.tris = info.builder.tris;
      info.verts = info.builder.count;
      // The lighter levels.
      const levels = [geometry];
      info.levelTris = [info.tris];
      for (let k = 1; k <= (LOD[sp.id]?.detail?.length ?? 0); k++) {
        const li = grow(1000 + v * 17, { height: h, lod: k });
        levels.push(li.builder.geometry());
        info.levelTris.push(li.builder.tris);
      }
      variants.push({ info, geometry, levels });
    }
    species.push({ id: sp.id, lod: LOD[sp.id], variants, capacity: sp.id === 'grass' ? 6000 : 3000 });
  }
  const near = createNearPlants({ species: species.map((s) => s ?? { id: 'none', lod: { near: 0, far: 0 }, variants: [] }), shared, leafTex });
  const growMs = Math.round(performance.now() - t0);

  // The impostors, baked from the same plants.
  const imp = createImpostors(shared);
  const t1 = performance.now();
  species.forEach((sp, k) => {
    if (!sp || !SPECIES[k].impostor) return;
    sp.variants.forEach((v, j) => {
      // (The naupaka's impostor takes over from 13 m, so it gets the most texels.)
      const bake = bakeImpostor(renderer, v.geometry, leafTex, { grid: 8, frame: sp.id === 'grass' ? 128 : 192 });
      v.bake = bake;
      imp.addKind(`${k}:${j}`, bake, { ...v.info, trans: v.info.trans ?? 0.3, gloss: v.info.gloss ?? 0.6 }, sp.lod);
    });
  });
  const bakeMs = Math.round(performance.now() - t1);
  // Species without a grower of their own yet are drawn with one that has.
  const pick = (sp, v) => (SPECIES[sp]?.impostor ? { key: `${sp}:${v}`, scale: 1, near: true } : null);

  const group = new THREE.Group();
  group.add(imp.group, near.group);
  return {
    group,
    uniforms: shared,
    near,
    impostors: imp,
    species,
    growMs,
    bakeMs,
    setInstances(plants) {
      imp.setInstances(plants, pick);
      near.setPlants(plants);
    },
    update(extent, camera, time) {
      if (extent) shared.uExtent.value.set(extent.x0, extent.y0, extent.size);
      shared.uWindTime.value = time;
      const lodScale = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / Math.tan(THREE.MathUtils.degToRad(28.5));
      imp.setLodScale(lodScale);
      near.update(camera, lodScale);
      if (hideParts.length) group.traverse((o) => { if (o.isMesh && hideParts.some((h) => o.name.startsWith(h))) o.visible = false; });
    },
  };
}
