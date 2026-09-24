// The ground mesh and its material. Geometry comes from the worker (mesh-builder.js),
// already carrying normals from the smooth surface. The look comes from scanned textures
// (terrain-shader.js, surfaces.js), patched into three.js's standard material so it keeps
// its lighting: the sun as a directional light and the sky as a light probe, both from the
// atmosphere (src/sky/), and the haze with distance added on top.

import * as THREE from 'three';
import { TERRAIN_PARS, TERRAIN_COLOR, TERRAIN_NORMAL, TERRAIN_LABEL } from './terrain-shader.js';
import { SURFACES, surfaceGains } from './surfaces.js';
import { SKY_PARS, AERIAL_VERT, AERIAL_FRAG_PARS } from '../sky/atmosphere-glsl.js';

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const surfaceAlbedo = (id) => new THREE.Vector3(...SURFACES.find((s) => s.id === id).target.map(srgbToLinear));

export function createTerrain(atmosphereUniforms = {}, gradeUniforms = {}) {
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.9,
    metalness: 0,
    side: THREE.DoubleSide,
  });
  const uniforms = {
    uData: { value: null },
    uSunShadow: { value: null },
    uExtent: { value: new THREE.Vector3(-700, -700, 1600) },
    uSunDirW: atmosphereUniforms.uSunDir ?? { value: new THREE.Vector3(0, 1, 0) },
    uContours: { value: 0 },
    uClay: { value: 0 },
    uBeachTop: { value: 4.6 },
    uSurfColor: { value: null },
    uSurfNormal: { value: null },
    uSurfMask: { value: null },
    uGain: { value: surfaceGains().map((g) => new THREE.Vector3(...g)) },
    uTile: { value: SURFACES.map((s) => s.tile) },
    // Ground that bounces light up: sea (with the sky it reflects), and the sand and scrub
    // ground as the surfaces themselves are coloured (surfaces.js).
    uBounceAlb: { value: [new THREE.Vector3(0.03, 0.05, 0.07), surfaceAlbedo('aerial_beach_01'), surfaceAlbedo('aerial_grass_rock')] },
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphereUniforms, gradeUniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\n' + AERIAL_VERT)
      .replace('#include <project_vertex>', '#include <project_vertex>\naerialVertex(vWorldPos);')
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\n' + SKY_PARS + AERIAL_FRAG_PARS + TERRAIN_PARS)
      .replace('#include <color_fragment>', TERRAIN_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      // Drawn two-sided so the few folded facets on the cliffs are not holes. The bump
      // normal is built from the outward vertex normal, so it replaces three's flipped one.
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + TERRAIN_NORMAL)
      .replace('getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= tShadow;')
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse += tBounce * BRDF_Lambert(material.diffuseColor);\nreflectedLight.indirectDiffuse *= tAO;\nreflectedLight.directDiffuse *= mix(1.0, tAO, 0.4);')
      // The haze between the camera and the ground, in linear light before the tone curve.
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = gl_FragColor.rgb * vApT + vApIns;\n#include <tonemapping_fragment>')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + TERRAIN_LABEL);
  };

  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  // Depth-only pass first, so the expensive shader runs once per pixel, only for the ground
  // you actually see (cliffs hide a lot of plateau from most views).
  const prepass = new THREE.Mesh(mesh.geometry, new THREE.MeshBasicMaterial({ colorWrite: false, side: THREE.DoubleSide }));
  prepass.frustumCulled = false;
  prepass.renderOrder = -2;
  mesh.add(prepass);

  function update(hf) {
    const { positions, normals, index } = hf.mesh;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    mesh.geometry.dispose();
    mesh.geometry = g;
    prepass.geometry = g;
  }

  function setSurfaces(t) {
    uniforms.uSurfColor.value = t.color;
    uniforms.uSurfNormal.value = t.normal;
    uniforms.uSurfMask.value = t.mask;
  }

  function setData(texture, extent, beachTop) {
    uniforms.uData.value = texture;
    uniforms.uExtent.value.set(extent.x0, extent.y0, extent.size);
    uniforms.uBeachTop.value = beachTop;
  }

  return { mesh, material, uniforms, update, setData, setSurfaces };
}

// Bilinear height lookup in local metres (x east, y north).
export function sample(H, N, cell, x0, y0, x, y) {
  const fi = (x - x0) / cell - 0.5, fj = (y - y0) / cell - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(fi)));
  const j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
  const u = Math.min(Math.max(fi - i, 0), 1), v = Math.min(Math.max(fj - j, 0), 1);
  const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
}
