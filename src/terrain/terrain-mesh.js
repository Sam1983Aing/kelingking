// The ground mesh and its material. Geometry comes from the worker (mesh-builder.js),
// already carrying normals from the smooth surface. The look comes from scanned textures
// (terrain-shader.js, surfaces.js), patched into three.js's standard material so it keeps
// its lighting: the sun as a directional light and the sky as a light probe, both from the
// atmosphere (src/sky/), and the haze with distance added on top.

import * as THREE from 'three';
import { TERRAIN_PARS, TERRAIN_COLOR, TERRAIN_NORMAL, TERRAIN_LABEL, TERRAIN_BOUNCE } from './terrain-shader.js';
import { SURFACES, surfaceGains, WET_SAND } from './surfaces.js';
import { STRATA, SHADOW_ROWS, buildStrata } from './strata.js';
import { SKY_PARS, AERIAL_VERT_PACKED, AERIAL_FRAG_PACKED } from '../sky/atmosphere-glsl.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';

// String replace that must match exactly once.
function patch(src, find, repl) {
  const n = src.split(find).length - 1;
  if (n !== 1) throw new Error(`terrain shader patch matched ${n} times: ${find.slice(0, 60)}`);
  return src.replace(find, () => repl);
}
// Runs a chain of .replace(find, repl) calls on a string, each checked with patch().
function patchAll(src, chain) {
  const wrap = (s) => ({ replace: (f, r) => wrap(patch(s, f, r)), toString: () => s });
  return String(chain(wrap(src)));
}

const srgbToLinear = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const surfaceAlbedo = (id) => new THREE.Vector3(...SURFACES.find((s) => s.id === id).target.map(srgbToLinear));

// Three small float textures from the bedding table, one texel per 1/16 m up the stack, with
// their mip levels made here (averaged along the stack only, so distant faces get the
// average of the beds instead of flicker):
//   uStrataA  fine relief (m), its slope, bed brightness, bed warmth
//   uStrataB  coarse relief, hardness, seam, sky past the ledges above
//   uStrataC  shadow of the ledges above, one row per sun steepness (strata.js)
function strataTextures() {
  const S = buildStrata();
  const n = STRATA.n;
  const half = THREE.DataUtils.toHalfFloat;
  const make = (rows, channels, fill, format) => {
    const levels = [];
    let w = n, h = rows;
    let cur = new Float32Array(w * h * channels);
    fill(cur);
    for (;;) {
      const data = new Uint16Array(cur.length);
      for (let i = 0; i < cur.length; i++) data[i] = half(cur[i]);
      levels.push({ data, width: w, height: h });
      if (w === 1 && h === 1) break;
      const w2 = Math.max(1, w >> 1), h2 = Math.max(1, h >> 1);
      const next = new Float32Array(w2 * h2 * channels);
      for (let y = 0; y < h2; y++) for (let x = 0; x < w2; x++) for (let c = 0; c < channels; c++) {
        let acc = 0, cnt = 0;
        for (let dy = 0; dy < (h > 1 ? 2 : 1); dy++) for (let dx = 0; dx < (w > 1 ? 2 : 1); dx++) {
          acc += cur[((y * (h > 1 ? 2 : 1) + dy) * w + x * (w > 1 ? 2 : 1) + dx) * channels + c]; cnt++;
        }
        next[(y * w2 + x) * channels + c] = acc / cnt;
      }
      cur = next; w = w2; h = h2;
    }
    const tex = new THREE.DataTexture(levels[0].data, n, rows, format, THREE.HalfFloatType);
    tex.mipmaps = levels;
    tex.generateMipmaps = false;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    return tex;
  };
  const A = make(1, 4, (d) => { for (let k = 0; k < n; k++) d.set([S.fine[k], S.slope[k], S.tone[k], S.warm[k]], k * 4); }, THREE.RGBAFormat);
  const B = make(1, 4, (d) => { for (let k = 0; k < n; k++) d.set([S.coarse[k], S.hard[k], S.part[k], S.occl[k]], k * 4); }, THREE.RGBAFormat);
  const C = make(SHADOW_ROWS, 1, (d) => d.set(S.shadow), THREE.RedFormat);
  return { uStrataA: { value: A }, uStrataB: { value: B }, uStrataC: { value: C } };
}

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
    uSandAlb: { value: surfaceAlbedo('aerial_beach_01') },
    uWetTint: { value: new THREE.Vector3(...WET_SAND) },
    // The swash's clock and settings come from the sea (main.js shares its uniforms).
    uTime: { value: 0 },
    uPeriod: { value: 9 },
    uRunup: { value: 0.95 },
    uSwashT: { value: 2.6 },
    uSurfColor: { value: null },
    uSurfNormal: { value: null },
    uSurfMask: { value: null },
    uGain: { value: surfaceGains().map((g) => new THREE.Vector3(...g)) },
    uTile: { value: SURFACES.map((s) => s.tile) },
    // Ground that bounces light up: sea (with the sky it reflects), and the sand and scrub
    // ground as the surfaces themselves are coloured (surfaces.js).
    uBounceAlb: { value: [new THREE.Vector3(0.03, 0.05, 0.07), surfaceAlbedo('aerial_beach_01'), surfaceAlbedo('aerial_grass_rock'), surfaceAlbedo('marble_cliff_05')] },
    // The limestone's bedding (strata.js), the same table the mesh builder carved with.
    ...strataTextures(),
  };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, atmosphereUniforms, gradeUniforms, uniforms);
    // Every patch must find its place (patch() throws if not), or the shader silently loses
    // a feature: that is how the ground went without cast shadows until v3.
    shader.vertexShader = patchAll(shader.vertexShader, (s) => s
      .replace('#include <common>', '#include <common>\nvarying vec3 vWorldPos;\nvarying vec3 vWorldNormal;\nattribute vec4 aRock;\nvarying vec4 vRock;\nattribute vec4 aHorizon;\nvarying vec3 vHorizon;\n' + AERIAL_VERT_PACKED)
      // The haze per vertex. The mesh covers the whole island, so vertices well outside the
      // view skip it (the ground's triangles are small, so none spans the margin; and near
      // the camera, where one could, the haze is nothing anyway).
      .replace('#include <project_vertex>', `#include <project_vertex>
        vAp = vec4(0.0, 0.0, 0.0, 1.0);
        if (gl_Position.w > 0.0 && all(lessThan(abs(gl_Position.xy), vec2(1.3 * gl_Position.w)))) aerialVertex(vWorldPos);`)
      .replace('#include <beginnormal_vertex>', '#include <beginnormal_vertex>\nvWorldNormal = normalize(mat3(modelMatrix) * objectNormal);')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWorldPos = (modelMatrix * vec4(transformed, 1.0)).xyz;\nvRock = aRock;\nvHorizon = vec3(aHorizon.x, aHorizon.yz * 2.0 - 1.0);'));
    shader.fragmentShader = patchAll(shader.fragmentShader, (s) => s
      .replace('#include <common>', '#include <common>\n' + SKY_PARS + AERIAL_FRAG_PACKED + CLOUD_SHADOW_GLSL + TERRAIN_PARS)
      .replace('#include <color_fragment>', TERRAIN_COLOR)
      .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = tRough;')
      // Drawn two-sided so the few folded facets on the cliffs are not holes. The bump
      // normal is built from the outward vertex normal, so it replaces three's flipped one.
      .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\n' + TERRAIN_NORMAL)
      // The sun's shadow. The light loop sits inside an include, which is only expanded after
      // this hook runs, so it is expanded here to patch it (until v3 this replace matched
      // nothing and the ground had no cast shadows at all).
      .replace('#include <lights_fragment_begin>', patch(THREE.ShaderChunk.lights_fragment_begin,
        'getDirectionalLightInfo( directionalLight, directLight );', 'getDirectionalLightInfo( directionalLight, directLight );\n\t\tdirectLight.color *= tShadow;'))
      // The sky light is cut by rock hanging overhead (the mesh builder's sky share, vRock.y);
      // the light bounced up from the ground below comes in under it.
      .replace('#include <aomap_fragment>', '#include <aomap_fragment>\nreflectedLight.indirectDiffuse *= tAO * vRock.y * tLedgeSky;\n' + TERRAIN_BOUNCE + '\nreflectedLight.directDiffuse *= mix(1.0, tAO, 0.4);')
      // The haze between the camera and the ground, in linear light before the tone curve.
      .replace('#include <tonemapping_fragment>', 'gl_FragColor.rgb = gl_FragColor.rgb * vAp.a + vAp.rgb;\n#include <tonemapping_fragment>')
      .replace('#include <dithering_fragment>', '#include <dithering_fragment>\n' + TERRAIN_LABEL));
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
    const { positions, normals, index, rock, horizon } = hf.mesh;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(normals, 3));
    g.setAttribute('aRock', new THREE.BufferAttribute(rock, 4, true));
    g.setAttribute('aHorizon', new THREE.BufferAttribute(horizon, 4, true));
    g.setIndex(new THREE.BufferAttribute(index, 1));
    g.userData.gridTris = hf.mesh.gridTris;   // the ground grid's triangles come first, then the faces
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
