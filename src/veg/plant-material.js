// The material for plants drawn as real geometry (near the camera): bark, leaves on the leaf
// atlas, and strap leaves and grass blades coloured per vertex. Instanced: each instance is
// a plant at a world position with a size, a heading, a colour shift, and the band of a
// stipple pattern it keeps (for the hand-overs, near.js).
//
// It moves in the wind in three layers: the whole plant leans and sways with the push of the
// wind where it stands (gusts included), each branch sways on its own, and leaves flutter.
// Light passing through the crown to a leaf is cut by the leaves in front of it: the crown
// is an ellipsoid, and the path from each vertex out of it toward the sun sets how much
// sunlight gets there.
//
// SOLID (plants not handing over) leaves out the stipple, and NO_ALPHA (plants whose leaves
// are built to their outline) every cut-out: a shader that can discard a pixel keeps a
// tile-based GPU from skipping hidden leaves before shading them, and a bush is many layers
// of leaves deep (measured in v7: that, not the lighting, was most of the plants' cost).
//
// VERTEX_LIGHT (the lighter level of detail further off, and all grass): the light is worked
// out per vertex, as the light falling on the leaf and its sheen, and the fragment shader
// only multiplies in the leaf's texture. A leaf is a few centimetres to a few pixels across
// there; the cost of lighting every pixel of thousands of overlapping leaves is not.

import * as THREE from 'three';
import { SKY_PARS, AERIAL_VERT_PACKED, AERIAL_FRAG_PACKED } from '../sky/atmosphere-glsl.js';
import { SUN_SHADOW_GLSL } from '../terrain/sun-shadow.js';
import { CLOUD_SHADOW_GLSL } from '../sky/clouds.js';
import { WIND_GLSL, FOLIAGE_LIGHT_GLSL, GUST_SHEEN_GLSL } from './foliage-glsl.js';
import { ATLAS_GLSL } from './grow/leaves.js';

const VERT = /* glsl */ `
#include <common>
#ifdef VERTEX_LIGHT
${SKY_PARS}
uniform vec3 uExtent;
${SUN_SHADOW_GLSL}
${CLOUD_SHADOW_GLSL}
${FOLIAGE_LIGHT_GLSL}
varying vec3 vDiffE;         // light falling on the leaf (times albedo / pi gives its colour)
varying vec3 vSpec;          // its sheen
varying vec4 vAp;
// (The haze per vertex, as AERIAL_VERT_PACKED does it; SKY_PARS already declares its inputs.)
vec4 aerialSliceA(float k, vec2 uv) {
  vec2 tile = vec2(mod(k, AP_COLS), floor(k / AP_COLS));
  vec2 px = tile * AP_RES + clamp(uv * AP_RES, 0.5, AP_RES - 0.5);
  return texture(uAerialLUT, px / AP_ATLAS);
}
void aerialVertex(vec3 wp) {
  vec2 uv = clamp(gl_Position.xy / max(gl_Position.w, 1e-6) * 0.5 + 0.5, 0.0, 1.0);
  float dKm = distance(wp, uCamPos) * 0.001;
  float s = sqrt(clamp(dKm / uApMaxKm, 0.0, 1.0)) * AP_SLICES - 0.5;
  vec4 a;
  if (s < 0.0) { float w = (s + 0.5) / 0.5; a = mix(vec4(0.0, 0.0, 0.0, 1.0), aerialSliceA(0.0, uv), w * w); }
  else { float k = floor(s); a = mix(aerialSliceA(k, uv), aerialSliceA(min(k + 1.0, AP_SLICES - 1.0), uv), s - k); }
  vAp = vec4(a.rgb * uSunE, a.a);
}
#else
uniform vec3 uSunDir;
${AERIAL_VERT_PACKED}
#endif
attribute vec4 aColor;
attribute vec4 aWind;
attribute vec4 aLeaf;
attribute vec4 iPosScale;    // world x, y, z of the foot, scale
attribute vec4 iYawTint;     // heading, colour shift (-1..1), the band of the stipple pattern kept (near.js)
uniform float uHeight;       // the plant's height at scale 1
uniform vec3 uCrownC;        // the crown's ellipsoid, plant space
uniform vec3 uCrownR;
uniform float uDensity;      // extinction in the crown, per metre
uniform vec4 uWindShape;     // sway frequency, stiffness, branch amplitude (m), branch frequency
uniform vec2 uLeafWind;      // leaf flutter amplitude (m), frequency
${WIND_GLSL}
varying vec2 vUv;
varying vec3 vN;
varying vec3 vWorld;
varying vec4 vCol;
varying vec4 vLeaf;
varying vec2 vKeep;
varying float vSelf;         // sunlight left after the crown
varying float vTint;
varying float vGust;         // a gust turning the leaves over (foliage-glsl.js)

vec3 rotY(vec3 v, float a) { float c = cos(a), s = sin(a); return vec3(c * v.x + s * v.z, v.y, -s * v.x + c * v.z); }

void main() {
  float s = iPosScale.w, yaw = iYawTint.x;
  float seed = fract(sin(dot(iPosScale.xz, vec2(12.9898, 78.233))) * 43758.5453);
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
#ifdef DBG_NOWIND
  float push = 0.0;
#else
  float push = windPush(iPosScale.xz);
#endif
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
  vKeep = iYawTint.zw;
  vTint = iYawTint.y;
  // (Leaves only; the flicker from each leaf's own phase.)
  vGust = floor(aLeaf.x * 255.0 + 0.5) == 0.0 ? 0.0 : windGust(iPosScale.xz) * uWind.z * uWind.w * (0.3 + 0.7 * (0.5 + 0.5 * sin(t * 7.0 + aWind.w * 40.0)));
  vec4 mv = viewMatrix * vec4(wp, 1.0);
  gl_Position = projectionMatrix * mv;
#ifdef DBG_NOAERIAL
  vAp = vec4(0.0, 0.0, 0.0, 1.0);
#else
  aerialVertex(wp);
#endif
#ifdef VERTEX_LIGHT
  {
    float kind = floor(aLeaf.x * 255.0 + 0.5);
    vec3 V = normalize(cameraPosition - wp);
    vec3 N = normalize(Nw);
    N *= dot(N, V) < 0.0 ? -1.0 : 1.0;
    float sunVis = bakedShadow(wp, 0.3) * cloudShadow(wp, uSunDir) * vSelf;
    float trans = kind == 0.0 ? 0.0 : aColor.a;
    foliageLightSplit(N, V, sunVis, mix(0.25, 1.0, aLeaf.y), trans, kind == 0.0 ? 0.1 : aLeaf.w, 0.7, vDiffE, vSpec);
  }
#endif
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
varying vec2 vKeep;
varying float vSelf;
varying float vTint;
varying float vGust;
${GUST_SHEEN_GLSL}
#ifdef VERTEX_LIGHT
varying vec3 vDiffE;
varying vec3 vSpec;
#else
${SUN_SHADOW_GLSL}
${CLOUD_SHADOW_GLSL}
${FOLIAGE_LIGHT_GLSL}
#endif
${ATLAS_GLSL}

float pHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}

void main() {
#ifdef DBG_NOFRAG
  gl_FragColor = vec4(0.1, 0.2, 0.05, 1.0);
  return;
#endif
#if !defined(DBG_NODISCARD) && !defined(SOLID)
  // Handing over (to the impostor, or between levels of detail): a stipple, each side keeps
  // its band of it.
  if (vKeep.x > 0.001 || vKeep.y < 0.999) {
    float hsh = pHash(gl_FragCoord.xy);
    if (hsh < vKeep.x || hsh >= vKeep.y) discard;
  }
#endif
  float kind = floor(vLeaf.x * 255.0 + 0.5);
  vec3 alb = vCol.rgb * vCol.rgb;
  float alpha = 1.0;
#ifndef NO_ALPHA
  if (kind == 1.0) {
    vec2 auv = leafAtlasUv(vUv, floor(vLeaf.z * 255.0 + 0.5));
    vec4 t = texture2D(uLeafTex, auv);
    // Keep the leaf's coverage as its texture shrinks with distance (mip levels average the
    // edge away), then make the edge crisp (alpha to coverage takes it from there).
    vec2 sz = vec2(textureSize(uLeafTex, 0));
    vec2 dx = dFdx(auv * sz), dy = dFdy(auv * sz);
    float mip = max(0.0, 0.5 * log2(max(dot(dx, dx), dot(dy, dy))));
#ifndef DBG_NODISCARD
    alpha = t.a * (1.0 + mip * 0.25);
    alpha = (alpha - 0.5) / max(fwidth(alpha), 1e-4) + 0.5;
    if (alpha < 0.02) discard;
#endif
    alb *= t.rgb * 2.0;
  } else
#endif
  if (kind == 3.0) {
    // A leaf built to its outline: the texture for its markings only.
    alb *= texture2D(uLeafTex, leafAtlasUv(vUv, floor(vLeaf.z * 255.0 + 0.5))).rgb * 2.0;
  } else if (kind == 0.0) {
    // Bark: streaks along the stem.
    float n = pHash(floor(vUv * vec2(40.0, 9.0)));
    alb *= 0.85 + 0.3 * n;
  }
  // Plants vary: some greener, some yellower, some darker.
  alb *= kind == 0.0 ? vec3(1.0) : mix(vec3(0.82, 0.96, 0.8), vec3(1.16, 1.08, 0.86), vTint * 0.5 + 0.5);
  if (vGust > 0.01) alb = gustSheen(alb, vGust, 1.0);

  vec3 P = vWorld;
#if defined(VERTEX_LIGHT)
  vec3 col = alb / PI * vDiffE + vSpec;
  float lit = 1.0;
#elif defined(DBG_FLAT)
  vec3 col = alb * 30.0;
  float lit = 1.0;
#else
  vec3 V = normalize(cameraPosition - P);
  // Two-sided: the face turned toward the camera is the one lit as the front.
  vec3 N = normalize(vN);
  N *= dot(N, V) < 0.0 ? -1.0 : 1.0;
  float shade = vLeaf.y;
  float sunVis = bakedShadow(P, 0.3) * cloudShadow(P, uSunDir) * vSelf;
  float trans = kind == 0.0 ? 0.0 : vCol.a;
  // How many leaves a pixel covers: from the footprint of a pixel on a leaf of about 10 cm.
  float spread = smoothstep(0.02, 0.12, length(fwidth(P)));
  vec3 col = foliageLight(alb, N, V, sunVis, mix(0.25, 1.0, shade), trans, kind == 0.0 ? 0.1 : vLeaf.w, spread);
  float lit = sunVis * max(dot(N, uSunDir), 0.0);
#endif

  gl_FragColor = vec4(col * vAp.a + vAp.rgb, clamp(alpha, 0.0, 1.0));
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  if (uLabel > 0.5) {
    float dist = log2(max(distance(P, cameraPosition), 1.0)) / 20.0;
    gl_FragColor = vec4(6.0 / 255.0, dist, lit > 0.3 ? 1.0 : 0.0, 1.0);
  }
}
`;

// shared: uniforms shared by every plant material (light, haze, wind, shadow).
// solid: for plants not handing over (no stipple); alpha: whether any leaf is cut out by its
// texture. A shader without discard lets the GPU skip what is hidden before shading it.
export function plantMaterial(shared, info, leafTex, { vertexLight = false, solid = false, alpha = true } = {}) {
  const defines = {};
  if (solid) defines.SOLID = 1;
  if (solid && !alpha) defines.NO_ALPHA = 1;
  // (Switches for finding what costs what: vegFlags=NOAERIAL,FLAT on the page.)
  for (const f of (new URLSearchParams(location.search).get('vegFlags') || '').split(',').filter(Boolean)) defines['DBG_' + f] = 1;
  if (vertexLight) defines.VERTEX_LIGHT = 1;
  return new THREE.ShaderMaterial({
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
    defines,
    vertexShader: VERT,
    fragmentShader: FRAG,
    side: THREE.DoubleSide,
    alphaToCoverage: !defines.DBG_NODISCARD && !defines.NO_ALPHA,
  });
}
