// The material for plants drawn as real geometry (near the camera): bark, leaves on the leaf
// atlas, and strap leaves and grass blades coloured per vertex. Instanced: each instance is
// a plant at a world position with a size, a heading, a colour shift and a fade (for the
// hand-over to the impostors further off, and between levels of detail).
//
// It moves in the wind in three layers: the whole plant leans and sways with the push of the
// wind where it stands (gusts included), each branch sways on its own, and leaves flutter.
// Light passing through the crown to a leaf is cut by the leaves in front of it: the crown
// is an ellipsoid, and the path from each vertex out of it toward the sun sets how much
// sunlight gets there.

import * as THREE from 'three';
import { SKY_PARS, AERIAL_VERT_PACKED, AERIAL_FRAG_PACKED } from '../sky/atmosphere-glsl.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';
import { WIND_GLSL, FOLIAGE_LIGHT_GLSL } from './foliage-glsl.js';
import { ATLAS_GLSL } from './grow/leaves.js';

const VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aWind;
attribute vec4 aLeaf;
attribute vec4 iPosScale;    // world x, y, z of the foot, scale
attribute vec4 iYawTint;     // heading, colour shift (-1..1), fade (0..1), seed (0..1)
uniform float uHeight;       // the plant's height at scale 1
uniform vec3 uCrownC;        // the crown's ellipsoid, plant space
uniform vec3 uCrownR;
uniform float uDensity;      // extinction in the crown, per metre
uniform vec4 uWindShape;     // sway frequency, stiffness, branch amplitude (m), branch frequency
uniform vec2 uLeafWind;      // leaf flutter amplitude (m), frequency
uniform vec3 uSunDir;
${WIND_GLSL}
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying vec4 vCol;
varying vec4 vLeaf;
varying float vFade;
varying float vSelf;         // sunlight left after the crown
varying float vTint;
${AERIAL_VERT_PACKED}
#include <common>

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }

void main() {
  float s = iPosScale.w, yaw = iYawTint.x, seed = iYawTint.w;
  vec3 P = rotY(position * s, yaw);
  vec3 Nw = rotY(normal, yaw);
  float H = uHeight * s;

  // Light through the crown: distance from this point out of the ellipsoid toward the sun.
  {
    vec3 sunL = rotY(uSunDir, -yaw);
    vec3 R = uCrownR, c = uCrownC;
    vec3 p = (position - c) / R, d = sunL / R;
    float a = dot(d, d), b = dot(p, d), cc = dot(p, p) - 1.0;
    float disc = b * b - a * cc;
    float t = disc > 0.0 ? max((-b + sqrt(disc)) / a, 0.0) : 0.0;
    vSelf = exp(-uDensity * t * s);
  }

  // Wind, in world space.
  vec2 wd = uWind.xy;
  float push = windPush(iPosScale.xz);
  float t = uWindTime;
  float sway = sin(t * uWindShape.x + seed * 6.2832) * 0.6 + sin(t * uWindShape.x * 2.13 + seed * 17.0) * 0.25;
  float bend = push * uWindShape.y * (0.7 + 0.5 * sway);
  float hf = clamp(P.y / max(H, 0.05), 0.0, 1.6);
  vec2 lean = wd * bend * hf * hf * H;
  P.xz += lean;
  P.y -= dot(lean, lean) / max(H, 0.05) * 0.5;
  // Each branch on its own, across and along the wind.
  float bp = aWind.y * 6.2832 + seed * 3.0;
  float bs = sin(t * uWindShape.w * (0.85 + 0.3 * aWind.y) + bp) * (0.25 + push);
  vec3 bdir = normalize(vec3(wd.x + 0.6 * cos(bp), 0.35 * sin(bp * 1.7), wd.y + 0.6 * sin(bp)));
  P += bdir * aWind.x * bs * uWindShape.z * s;
  // Leaves flutter about their stalks, harder in a gust.
  float lf = sin(t * uLeafWind.y * (0.8 + 0.4 * aWind.w) + aWind.w * 6.2832 + bp);
  P += Nw * aWind.z * lf * uLeafWind.x * (0.2 + push * 1.3) * s;

  vec3 wp = iPosScale.xyz + P;
  vUv = uv;
  vN = Nw;
  vWorld = wp;
  vCol = aColor;
  vLeaf = aLeaf;
  vFade = iYawTint.z;
  vTint = iYawTint.y;
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
  aerialVertex(wp);
}
`;

const FRAG = /* glsl */ `
#include <common>
${SKY_PARS}
${AERIAL_FRAG_PACKED}
uniform sampler2D uLeafTex;
uniform vec3 uExtent;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying vec4 vCol;
varying vec4 vLeaf;
varying float vFade;
varying float vSelf;
varying float vTint;
${SUN_SHADOW_GLSL}
${CLOUD_SHADOW_GLSL}
${FOLIAGE_LIGHT_GLSL}
${ATLAS_GLSL}

float pHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
  // Fading out (to the impostor, or between levels of detail): a stipple, the other side
  // fills in the rest.
  if (vFade < 0.999 && pHash(gl_FragCoord.xy) > vFade) discard;
  float kind = floor(vLeaf.x * 255.0 + 0.5);
  vec3 alb = vCol.rgb * vCol.rgb;
  float alpha = 1.0;
  if (kind == 1.0) {
    vec2 auv = leafAtlasUv(vUv, floor(vLeaf.z * 255.0 + 0.5));
    vec4 t = texture2D(uLeafTex, auv);
    // Keep the leaf's coverage as its texture shrinks with distance (mip levels average the
    // edge away), then make the edge crisp (alpha to coverage takes it from there).
    vec2 sz = vec2(textureSize(uLeafTex, 0));
    vec2 dx = dFdx(auv * sz), dy = dFdy(auv * sz);
    float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
    alpha = t.a * (1.0 + mip * 0.25);
    alpha = (alpha - 0.5) / max(fwidth(alpha), 1e-4) + 0.5;
    if (alpha < 0.02) discard;
    alb *= t.rgb * 2.0;
  } else if (kind == 0.0) {
    // Bark: streaks along the stem.
    float n = pHash(floor(vUv * vec2(40.0, 9.0)));
    alb *= 0.85 + 0.3 * n;
  }
  // Plants vary: some greener, some yellower, some darker.
  alb *= kind == 0.0 ? vec3(1.0) : mix(vec3(0.82, 0.96, 0.8), vec3(1.16, 1.08, 0.86), vTint * 0.5 + 0.5);

  vec3 P = vWorld;
  vec3 V = normalize(cameraPosition - P);
  // Two-sided: the face turned toward the camera is the one lit as the front.
  vec3 N = normalize(vN);
  N *= dot(N, V) < 0.0 ? -1.0 : 1.0;
  float shade = vLeaf.y;
  float sunVis = bakedShadow(P, 0.3) * cloudShadow(P, uSunDir) * vSelf;
  float trans = kind == 0.0 ? 0.0 : vCol.a;
  vec3 col = foliageLight(alb, N, V, sunVis, mix(0.25, 1.0, shade), trans, kind == 0.0 ? 0.1 : vLeaf.w);

  gl_FragColor = vec4(col * vAp.a + vAp.rgb, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uLabel > 0.5) {
    float dist = log2(max(distance(P, cameraPosition), 1.0)) / 20.0;
    gl_FragColor = vec4(6.0 / 255.0, dist, sunVis * max(dot(N, uSunDir), 0.0) > 0.3 ? 1.0 : 0.0, 1.0);
  }
}
`;

// shared: uniforms shared by every plant material (light, haze, wind, shadow).
export function plantMaterial(shared, info, leafTex) {
  const m = new THREE.ShaderMaterial({
    uniforms: {
      ...shared,
      uLeafTex: { value: leafTex },
      uHeight: { value: info.height },
      uCrownC: { value: new THREE.Vector3(...info.crownC) },
      uCrownR: { value: new THREE.Vector3(...info.crownR) },
      uDensity: { value: info.density },
      uWindShape: { value: new THREE.Vector4(info.wind.freq, info.wind.stiff, info.wind.branchAmp, info.wind.branchFreq) },
      uLeafWind: { value: new THREE.Vector2(info.wind.leafAmp, info.wind.leafFreq) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
  });
  // Shared uniform objects stay shared (the spread above copies references).
  return m;
}

// Depth only, for the pass before the ground: the ground's expensive shader then skips what
// the plants hide. Same vertex shader, so the depths match the colour pass exactly.
export function plantDepthMaterial(colorMaterial) {
  const m = new THREE.ShaderMaterial({
    uniforms: colorMaterial.uniforms,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    alphaToCoverage: true,
    colorWrite: false,
  });
  return m;
}
