// The sky behind everything: the atmosphere's sky view, the sun's disc, and (later) clouds.
// Drawn after the ground and plants at the far plane with the depth test on, so it only
// shades the pixels nothing else covers. The sea is drawn after it and covers the rest.

import * as THREE from 'three';
import { SKY_PARS } from './atmosphere-glsl.js';

const VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  // Unnormalised position: normalising per pixel gives the exact view direction, where
  // interpolated per-vertex directions leave bands on a coarse sphere.
  vDir = position;
  gl_Position = projectionMatrix * viewMatrix * vec4(position + cameraPosition, 1.0);
  // Push it to the far plane: depth 0 with a reversed depth buffer, 1 otherwise.
#ifdef USE_REVERSED_DEPTH_BUFFER
  gl_Position.z = 0.0;
#else
  gl_Position.z = gl_Position.w;
#endif
}
`;

const FRAG = /* glsl */ `
${SKY_PARS}
varying vec3 vDir;
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyRadiance(d);
  // The sun's disc, with limb darkening.
  float c = dot(d, uSunDir);
  if (c > uSunCosAngle) {
    float mu = sqrt(max(1.0 - (1.0 - c) / (1.0 - uSunCosAngle), 0.0));
    col += uSunRadiance * (1.0 - 0.6 * (1.0 - pow(mu, 0.8)));
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  // A little noise, so an 8-bit screen does not show the gradient as bands.
  gl_FragColor.rgb += (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  // Label: sky (1), and its elevation in quarter degrees.
  if (uLabel > 0.5) gl_FragColor = vec4(1.0 / 255.0, 0.0, clamp(asin(d.y) * 57.29578 * 4.0 / 255.0, 0.0, 1.0), 1.0);
}
`;

export function createSkyDome(atmosphere, extraUniforms = {}) {
  const material = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere.uniforms, ...extraUniforms },
    vertexShader: VERT,
    fragmentShader: FRAG,
    depthWrite: false,
    depthTest: true,
    side: THREE.BackSide,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  mesh.frustumCulled = false;
  // After the opaque ground and plants, before the sea (which is transparent).
  mesh.renderOrder = 10;
  return { mesh, material };
}
