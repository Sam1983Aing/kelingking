// Terrain mesh for stage 1: plain clay so the shape can be judged on its own.
// Geometry comes from a grid sampled off the heightfield. Lighting detail comes from a
// full-resolution object-space normal map, so cliffs read crisply even where the grid is coarse.

import * as THREE from 'three';

export function createTerrain() {
  const material = new THREE.MeshStandardMaterial({
    color: 0xbdb7ac,
    roughness: 0.93,
    metalness: 0,
    normalMapType: THREE.ObjectSpaceNormalMap,
  });
  const uniforms = { uContours: { value: 0 }, uSandTint: { value: 1 } };
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvHeight = position.y;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vHeight;\nuniform float uContours;\nuniform float uSandTint;')
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        // Warm the sand and cool the seabed slightly so the beach reads in grey clay.
        float sandBand = smoothstep(7.0, 3.5, vHeight) * smoothstep(-0.5, 0.6, vHeight);
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.86, 0.80, 0.68), sandBand * uSandTint);
        diffuseColor.rgb *= mix(1.0, 0.8, smoothstep(0.0, -6.0, vHeight) * uSandTint);
        // Contour lines every 10 m, stronger every 50 m.
        float q = vHeight / 10.0;
        float line = 1.0 - min(abs(fract(q - 0.5) - 0.5) / max(fwidth(q), 1e-4), 1.0);
        float major = step(abs(mod(floor(q + 0.5), 5.0)), 0.5);
        diffuseColor.rgb *= 1.0 - uContours * line * mix(0.35, 0.7, major) * step(0.5, vHeight);`
      );
  };

  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.frustumCulled = false;

  let normalTex = null;

  function update(hf, gridMax = 1024) {
    const { N, heights: H, cell } = hf;
    const { x0, y0, size } = hf.extent;
    const M = Math.min(N, gridMax) + 1;
    const step = size / (M - 1);
    const pos = new Float32Array(M * M * 3);
    const uv = new Float32Array(M * M * 2);
    for (let j = 0; j < M; j++) {
      for (let i = 0; i < M; i++) {
        const x = x0 + i * step, y = y0 + j * step;
        const k = j * M + i;
        pos[k * 3] = x;
        pos[k * 3 + 1] = sample(H, N, cell, x0, y0, x, y);
        pos[k * 3 + 2] = -y;
        uv[k * 2] = i / (M - 1);
        uv[k * 2 + 1] = j / (M - 1);
      }
    }
    const idx = new Uint32Array((M - 1) * (M - 1) * 6);
    let n = 0;
    for (let j = 0; j < M - 1; j++) {
      for (let i = 0; i < M - 1; i++) {
        const a = j * M + i, b = a + 1, c = a + M, d = c + 1;
        idx[n++] = a; idx[n++] = b; idx[n++] = c;
        idx[n++] = b; idx[n++] = d; idx[n++] = c;
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeVertexNormals();
    mesh.geometry.dispose();
    mesh.geometry = g;

    normalTex?.dispose();
    normalTex = new THREE.DataTexture(hf.normals, N, N, THREE.RGBAFormat);
    normalTex.generateMipmaps = true;
    normalTex.minFilter = THREE.LinearMipmapLinearFilter;
    normalTex.magFilter = THREE.LinearFilter;
    normalTex.anisotropy = 8;
    normalTex.needsUpdate = true;
    material.normalMap = normalTex;
    material.needsUpdate = true;
  }

  return { mesh, material, uniforms, update };
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
