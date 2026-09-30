// The sky behind everything: the atmosphere's sky view, the sun's disc, and the clouds.
// Drawn last, at the far plane with the depth test on, so it only shades the pixels nothing
// else covers (the sea writes depth, so the sky is not shaded under it and then painted
// over).

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
uniform sampler2D uClouds;   // clouds at three-quarter resolution: rgb their light and haze, a what passes
uniform float uHasClouds;
varying vec3 vDir;
// The clouds are marched at three-quarter resolution; a Catmull-Rom read (five bilinear taps, the
// corners left out) keeps their edges crisp without showing the texel grid (v9; a B-spline
// before, which blurred them by about two pixels). Clamped, so it cannot ring past the edge.
vec4 cloudsAt(vec2 uv) {
  vec2 size = vec2(textureSize(uClouds, 0));
  vec2 p = uv * size;
  vec2 c = floor(p - 0.5) + 0.5;
  vec2 f = p - c;
  vec2 w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  vec2 w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  vec2 w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  vec2 w3 = f * f * (-0.5 + 0.5 * f);
  vec2 w12 = w1 + w2;
  vec2 t0 = (c - 1.0) / size, t3 = (c + 2.0) / size, t12 = (c + w2 / w12) / size;
  vec4 r = texture(uClouds, vec2(t12.x, t0.y)) * w12.x * w0.y
         + texture(uClouds, vec2(t0.x, t12.y)) * w0.x * w12.y
         + texture(uClouds, vec2(t12.x, t12.y)) * w12.x * w12.y
         + texture(uClouds, vec2(t3.x, t12.y)) * w3.x * w12.y
         + texture(uClouds, vec2(t12.x, t3.y)) * w12.x * w3.y;
  float wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  r /= wsum;
  return vec4(max(r.rgb, 0.0), clamp(r.a, 0.0, 1.0));
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
    vec2 uv = gl_FragCoord.xy / uResolution;
    vec4 cl = cloudsAt(uv);
    float opacity = 1.0 - cl.a;
    if (opacity > 0.25) {
      // Tiny isolated opaque fragments cannot resolve as cloud volumes. Fade those
      // flecks by their surrounding support; a connected lobe or a thin wide cloud
      // keeps its opacity. Cirrus and translucent fringes retain their soft detail.
      vec2 reach = 5.0 / vec2(textureSize(uClouds, 0));
      float support = 1.0 - 0.25 * (
        texture(uClouds, uv + vec2(reach.x, 0.0)).a + texture(uClouds, uv - vec2(reach.x, 0.0)).a
        + texture(uClouds, uv + vec2(0.0, reach.y)).a + texture(uClouds, uv - vec2(0.0, reach.y)).a);
      float retain = mix(1.0, smoothstep(0.04, 0.16, support), smoothstep(0.25, 0.50, opacity));
      cl.rgb *= retain;
      cl.a = 1.0 - opacity * retain;
    }
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
    // In the transparent pass so it comes after the sea, but it covers what it draws.
    transparent: true,
    blending: THREE.NoBlending,
  });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(1000, 32, 16), material);
  mesh.frustumCulled = false;
  // After everything, the sea included (renderOrder 1).
  mesh.renderOrder = 10;
  return { mesh, material };
}
