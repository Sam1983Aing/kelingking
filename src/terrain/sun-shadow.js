// Baked sun shadow for a heightfield.
//
// For every map column (x, y) there is one height S above which a point in that column
// sees the sun and below which it does not: S = max over t > 0 of H(p + d t) - t tan(el),
// marching toward the sun. That is exact for a heightfield, cliff faces included, and it
// only changes when the sun moves. So it is baked once per sun change on the GPU, and the
// ground and sea shaders each do a single texture read instead of marching per pixel.
//
//   R = S, the shadow height (m)
//   G = how far away the occluder is (m), which sets how soft the shadow edge is

import * as THREE from 'three';

export function createSunShadow(renderer) {
  let target = null;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uData: { value: null },
      uExtent: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: /* glsl */ `
      precision highp float;
      uniform sampler2D uData;
      uniform vec3 uExtent;
      uniform vec3 uSunDir;
      varying vec2 vUv;
      float heightAt(vec2 g) {
        vec2 uv = (g - uExtent.xy) / uExtent.z;
        if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return -50.0;
        return texture2D(uData, uv).r;
      }
      void main() {
        vec2 g = uExtent.xy + vUv * uExtent.z;
        // Sun direction on the map (x east, y north) and its rise per metre travelled.
        vec2 d = vec2(uSunDir.x, -uSunDir.z);
        float horiz = max(length(d), 1e-4);
        d /= horiz;
        float rise = uSunDir.y / horiz;
        float S = -1e4, far = 0.0;
        float t = 0.5;
        for (int i = 0; i < 96; i++) {
          float s = heightAt(g + d * t) - t * rise;
          if (s > S) { S = s; far = t; }
          // Nothing on the island is higher than about 220 m.
          if (220.0 - t * rise < S) break;
          t = t * 1.045 + 0.5;
        }
        gl_FragColor = vec4(S, far, 0.0, 1.0);
      }`,
    depthTest: false,
    depthWrite: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  const scene = new THREE.Scene();
  scene.add(quad);
  const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

  return {
    get texture() { return target?.texture ?? null; },
    bake(dataTexture, extent, sunDir, size) {
      if (!target || target.width !== size) {
        target?.dispose();
        target = new THREE.WebGLRenderTarget(size, size, {
          type: THREE.HalfFloatType, format: THREE.RGBAFormat,
          minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
        });
      }
      material.uniforms.uData.value = dataTexture;
      material.uniforms.uExtent.value.set(extent.x0, extent.y0, extent.size);
      material.uniforms.uSunDir.value.copy(sunDir);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, camera);
      renderer.setRenderTarget(prev);
      return target.texture;
    },
  };
}

// GLSL for reading it: how much sun a point at world position P gets.
export const SUN_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uSunShadow;
float bakedShadow(vec3 P, float lift) {
  vec2 g = vec2(P.x, -P.z);
  vec2 uv = (g - uExtent.xy) / uExtent.z;
  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) return 1.0;
  vec2 s = texture2D(uSunShadow, uv).rg;
  float soft = 0.35 + 0.012 * s.g;             // farther occluder, softer edge
  return smoothstep(s.r - soft, s.r + soft, P.y + lift);
}
`;
