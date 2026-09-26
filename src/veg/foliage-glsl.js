// GLSL shared by every plant: the wind, and how a leaf takes light. The 3D plants near the
// camera and the impostors further off use the same two, so a plant looks and moves the same
// on both sides of the hand-over.

// The wind. One direction for the whole island (the sea's gusts drift the same way,
// src/water/water.js), a steady part, and gusts: patches of stronger wind some tens of metres
// across, longer across the wind than along it, blowing downwind at the wind's speed. They
// are what you see run across a slope of grass and scrub.
//   uWind  xy the direction it blows toward (world x, z), z the steady strength (0..1),
//          w how strong the gusts are (0..1)
export const WIND_GLSL = /* glsl */ `
uniform float uWindTime;
uniform vec4 uWind;
float wHash(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float wNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(wHash(i), wHash(i + vec2(1.0, 0.0)), u.x), mix(wHash(i + vec2(0.0, 1.0)), wHash(i + vec2(1.0, 1.0)), u.x), u.y);
}
// 0 in a lull, 1 in the heart of a gust, at a world position (x, z).
float windGust(vec2 xz) {
  vec2 q = xz - uWind.xy * uWindTime * 5.5;
  vec2 a = vec2(dot(q, uWind.xy), dot(q, vec2(-uWind.y, uWind.x)));
  float n = 0.65 * wNoise(a * vec2(1.0 / 16.0, 1.0 / 38.0)) + 0.35 * wNoise(a * vec2(1.0 / 6.0, 1.0 / 13.0) + 7.3);
  return smoothstep(0.38, 0.82, n);
}
// How hard the wind pushes here now (0..about 1).
float windPush(vec2 xz) {
  return uWind.z * (0.35 + 0.65 * mix(1.0, windGust(xz) * 1.5, uWind.w));
}
`;

// Light on foliage. A leaf reflects light on the side it faces and lets some through to the
// other side, yellower (chlorophyll passes green and a little red); thin leaves pass more.
// Its waxy skin is a dielectric sheen (index about 1.45) that mirrors the sky and catches the
// sun; glossy leaves (the naupaka's) sharper, grass duller. The sky light comes from the
// atmosphere's spherical harmonics on the side the leaf faces, and through from behind.
//   sunVis  how much of the sun reaches the point (terrain shadow, clouds, the crown itself)
//   ao      how much of the sky it sees (1 on the outside of a crown)
//   trans   how much light the leaf lets through, compared with what it reflects
//   gloss   0 matte .. 1 glossy
//   spread  0 .. 1: how many leaves a pixel covers. One leaf has one sharp highlight; a pixel
//           of canopy averages the highlights of leaves turned every way, which is a broad,
//           low lobe (seen from 1 km a glossy canopy is not a mirror).
// Needs SKY_PARS (uSunDir, uSunIrr, uSkySH, skyRadiance).
export const FOLIAGE_LIGHT_GLSL = /* glsl */ `
const vec3 LEAF_TT = vec3(1.0, 1.08, 0.5);
vec3 foliageLight(vec3 alb, vec3 N, vec3 V, float sunVis, float ao, float trans, float gloss, float spread) {
  vec3 L = uSunDir;
  float NdL = dot(N, L);
  float NoV = max(dot(N, V), 0.04);
  // Toward the sun through the leaves: forward scattering.
  float through = pow(max(dot(-V, L), 0.0), 5.0);
  vec3 sunD = uSunIrr * sunVis * (max(NdL, 0.0) + (max(-NdL, 0.0) + through * 0.6) * trans * LEAF_TT);
  // Sky: one evaluation for both sides (the even bands are the same for N and -N, the odd
  // band flips).
  vec3 even = uSkySH[0] * 0.886227 + uSkySH[4] * 0.858086 * N.x * N.y + uSkySH[5] * 0.858086 * N.y * N.z
            + uSkySH[6] * (0.743125 * N.z * N.z - 0.247708) + uSkySH[7] * 0.858086 * N.x * N.z
            + uSkySH[8] * 0.429043 * (N.x * N.x - N.y * N.y);
  vec3 odd = (uSkySH[1] * N.y + uSkySH[2] * N.z + uSkySH[3] * N.x) * 1.023328;
  vec3 sky = (max(even + odd, 0.0) + max(even - odd, 0.0) * trans * LEAF_TT) * ao;
  // The harmonics carry a generic ground below the horizon (atmosphere.js, albedo 0.07, 0.09,
  // 0.1: the sea's); under a plant the ground is scrub and earth, warmer. The difference, on
  // the side facing down (and through the leaf from below).
  vec3 Eg = uSunIrr * max(uSunDir.y, 0.0) + uSkyUp;
  sky += (vec3(0.1, 0.095, 0.05) - vec3(0.07, 0.09, 0.1)) * Eg * (0.5 - 0.5 * N.y + (0.5 + 0.5 * N.y) * trans * 0.5) * ao;
  vec3 col = alb / PI * (sunD + sky);
  float rough = mix(mix(0.62, 0.28, gloss), 0.9, spread);
  float F0 = 0.035;
  if (sunVis * NdL > 0.0) {
    float a2 = rough * rough * rough * rough;
    vec3 Hh = normalize(V + L);
    float NoH = max(dot(N, Hh), 0.0);
    float D = a2 / (PI * pow(NoH * NoH * (a2 - 1.0) + 1.0, 2.0));
    float F = F0 + (1.0 - F0) * pow(1.0 - max(dot(Hh, V), 0.0), 5.0);
    float k = rough * rough * 0.5;
    float G = (NdL / (NdL * (1.0 - k) + k)) * (NoV / (NoV * (1.0 - k) + k));
    col += uSunIrr * sunVis * D * F * G / (4.0 * NoV);
  }
  // The sky in the sheen, where the mirror direction points up out of the plant.
  vec3 R = reflect(-V, N);
  float open = smoothstep(-0.05, 0.35, R.y) * ao * ao;
  if (open > 0.01) {
    float Fv = F0 + (1.0 - F0) * pow(1.0 - NoV, 5.0);
    col += skyRadiance(vec3(R.x, max(R.y, 0.02), R.z)) * Fv * open * mix(0.35, 1.0, gloss) * (1.0 - 0.6 * spread);
  }
  return col;
}
`;
