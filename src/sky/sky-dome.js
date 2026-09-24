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
uniform sampler2D uClouds;   // clouds at half resolution: rgb their light and haze, a what passes
uniform float uHasClouds;
varying vec3 vDir;
// The clouds are marched at half resolution; a bicubic B-spline read (four bilinear taps)
// hides the texel grid along their edges.
vec4 cloudsAt(vec2 uv) {
  vec2 size = vec2(textureSize(uClouds, 0));
  vec2 p = uv * size - 0.5;
  vec2 f = fract(p);
  vec2 i = floor(p);
  vec2 w0 = (1.0 - f) * (1.0 - f) * (1.0 - f) / 6.0;
  vec2 w1 = (4.0 - 6.0 * f * f + 3.0 * f * f * f) / 6.0;
  vec2 w3 = f * f * f / 6.0;
  vec2 w2 = 1.0 - w0 - w1 - w3;
  vec2 g0 = w0 + w1, g1 = w2 + w3;
  vec2 h0 = (w1 / g0 - 1.0 + i + 0.5) / size;
  vec2 h1 = (w3 / g1 + 1.0 + i + 0.5) / size;
  return g0.y * (g0.x * texture(uClouds, vec2(h0.x, h0.y)) + g1.x * texture(uClouds, vec2(h1.x, h0.y)))
       + g1.y * (g0.x * texture(uClouds, vec2(h0.x, h1.y)) + g1.x * texture(uClouds, vec2(h1.x, h1.y)));
}
void main() {
  vec3 d = normalize(vDir);
  vec3 col = skyRadiance(d);
  // The sun's disc, with limb darkening.
  float c = dot(d, uSunDir);
  if (c > uSunCosAngle) {
    float mu = sqrt(max(1.0 - (1.0 - c) / (1.0 - uSunCosAngle), 0.0));
    col += uSunRadiance * (1.0 - 0.6 * (1.0 - pow(mu, 0.8)));
  }
  if (uHasClouds > 0.5) {
    vec4 cl = cloudsAt(gl_FragCoord.xy / uResolution);
    col = col * cl.a + cl.rgb;
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
    uniforms: { ...atmosphere.uniforms, ...extraUniforms, uClouds: { value: null }, uHasClouds: { value: 0 } },
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
