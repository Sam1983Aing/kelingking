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
// detail: where the full plant has handed over to its lighter version (grow/core.js).
const LOD = {
  scaevola: { near: 22, far: 32, detail: 11 },
  grass: { near: 16, far: 24, detail: 7 },
  tree: { near: 40, far: 55 },
  palm: { near: 50, far: 70 },
  pandanus: { near: 30, far: 42 },
  creeper: { near: 26, far: 36 },
};

export async function createVegetation(renderer, lightUniforms, { wind = {} } = {}) {
  const t0 = performance.now();
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
  const species = SPECIES.map((sp) => {
    const grow = GROWERS[sp.id];
    if (!grow) return null;
    const variants = sp.heights.map((h, v) => {
      const info = grow(1000 + v * 17, { height: h });
      info.variant = v;
      const geometry = info.builder.geometry();
      info.tris = info.builder.tris;
      info.verts = info.builder.count;
      let light = null;
      if (LOD[sp.id]?.detail) {
        const li = grow(1000 + v * 17, { height: h, light: true });
        light = li.builder.geometry();
        info.lightTris = li.builder.tris;
      }
      return { info, geometry, light };
    });
    return { id: sp.id, lod: LOD[sp.id], variants, capacity: sp.id === 'grass' ? 6000 : 3000 };
  });
  const near = createNearPlants({ species: species.map((s) => s ?? { id: 'none', lod: { near: 0, far: 0 }, variants: [] }), shared, leafTex });
  const growMs = Math.round(performance.now() - t0);

  // The impostors, baked from the same plants.
  const imp = createImpostors(shared);
  const t1 = performance.now();
  species.forEach((sp, k) => {
    if (!sp || !SPECIES[k].impostor) return;
    sp.variants.forEach((v, j) => {
      const bake = bakeImpostor(renderer, v.geometry, leafTex, { grid: 8, frame: sp.id === 'palm' || sp.id === 'tree' ? 192 : 128 });
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
    },
  };
}
