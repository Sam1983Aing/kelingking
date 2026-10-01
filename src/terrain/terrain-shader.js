// GLSL for the ground: scanned limestone, sand and scrub ground (Poly Haven, CC0), mapped
// from three directions so steep faces do not smear, with a little procedural variation on
// top to break up the tiling. Also reads the data texture shared with the sea
// (R = ground height, G = metres offshore, B = beach weight).
// World coordinates: x = east, y = up, z = south. Map coordinates g = (x, -z) = (east, north).

import { SUN_SHADOW_GLSL } from './sun-shadow.js';
import { STRATA, SHADOW_ROWS } from './strata.js';
import { SURFACES } from './surfaces.js';
import { SWASH_GLSL } from '../water/swash.js';

const NS = SURFACES.length;

export const TERRAIN_PARS = /* glsl */ `
precision highp sampler2DArray;
uniform sampler2D uData;
uniform vec3 uExtent;
uniform vec3 uSunDirW;
uniform float uContours;
uniform float uClay;
uniform float uBeachTop;
uniform sampler2DArray uSurfColor;
uniform sampler2DArray uSurfNormal;
uniform sampler2DArray uSurfMask;
uniform vec3 uGain[${NS}];
uniform float uTile[${NS}];
uniform vec3 uSandAlb;     // the beach's dry sand, linear (surfaces.js)
uniform vec3 uWetTint;     // what water in the pores does to it (WET_SAND)
uniform float uTime;       // for the swash (the sea's clock)
uniform float uPeriod;
uniform sampler2D uStrataA;
uniform sampler2D uStrataB;
uniform sampler2D uStrataC;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
// From the mesh builder: sand under an overhang, share of the sky not hidden by rock
// overhead, how far the face is carved in (/ 32 m), and whether it stands on sand.
varying vec4 vRock;
varying vec3 vHorizon;    // elevation (/ pi, from straight out) above which rock overhead hides
                          // the sky, and the outward direction (world x, z) of the face
varying float vFoot;      // metres out from the foot of a wall on the beach (0 to 8)

#define L_LIMESTONE 0
#define L_BEDS 1
#define L_WET 2
#define L_SAND 3
#define L_GROUND 4
#define L_SAND_DRY 5
#define L_SAND_FIRM 6

${SUN_SHADOW_GLSL}
${SWASH_GLSL}

// Filled in while working out the surface, used later by the lighting.
float tBanked = 0.0;
float tShadow = 1.0;
float tAO = 1.0;
float tRough = 0.9;
vec3 tNormalW = vec3(0.0, 1.0, 0.0);
float tSandW = 0.0;   // how much of this pixel is sand, and ground cover (for the labels)
float tVegW = 0.0;
float tFineShadow = 1.0;   // shadow of the ledges above, on a bedded face
float tLedgeSky = 1.0;     // share of the sky the ledges above leave
float tWet = 0.0;          // sand wet from the swash (0..1)
float tGloss = 0.0;        // a film of water on it, mirror-like (0..1)
float tCanopy = 0.0;       // plants' crowns over this ground (0..1, v7), in shade under them

// ---------------------------------------------------------------- bedding (strata.js)
// Same formulas as strata.js, sines only, so the beds here are the beds in the mesh.
float strataWarp(vec2 g) {
  return 0.016 * g.x - 0.009 * g.y + 2.2 * sin(g.x / 190.0 + 0.7) * sin(g.y / 240.0 + 1.9) + 1.1 * sin((g.x + g.y) / 97.0);
}
float strataStrength(vec2 g) {
  float a = sin(g.x / 23.7 + 1.3 * sin(g.y / 31.1)) * sin(g.y / 19.3 + 0.9 * sin(g.x / 27.9));
  float b = sin(g.x / 71.3 + g.y / 53.9 + 0.4);
  return clamp(0.62 + 0.28 * a + 0.22 * b, 0.2, 1.0);
}
#define STRATA_Z0 ${STRATA.z0.toFixed(1)}
#define STRATA_SPAN ${STRATA.span.toFixed(1)}
#define SHADOW_ROWS ${SHADOW_ROWS.toFixed(1)}



// Hash from Dave Hoskins, "Hash without Sine" (MIT).
float th12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
float tn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th12(i), th12(i + vec2(1.0, 0.0)), u.x), mix(th12(i + vec2(0.0, 1.0)), th12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// fbm whose octaves stop once they are smaller than a couple of pixels.
float tfbm(vec2 p, float scale, float fp) {
  float s = 0.0, a = 0.5, f = 1.0;
  for (int i = 0; i < 5; i++) {
    float keep = smoothstep(4.0 * fp, 8.0 * fp, scale / f);
    if (keep <= 0.0) break;
    s += a * keep * (tn(p * f + float(i) * 17.3) - 0.5);
    a *= 0.5; f *= 2.03;
  }
  return 0.5 + s / 0.96875;
}

// ---------------------------------------------------------------- sand relief
// The dry scan carries small texture; the broader lumps and their slopes come from this noise.
// Individual prints are placed in world space below so they do not tile across the beach.

// Value noise and its slope.
vec3 tnd(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f), du = 6.0 * f * (1.0 - f);
  float a = th12(i), b = th12(i + vec2(1.0, 0.0)), c = th12(i + vec2(0.0, 1.0)), d = th12(i + vec2(1.0, 1.0));
  float k1 = b - a, k2 = c - a, k4 = a - b - c + d;
  return vec3(a + k1 * u.x + k2 * u.y + k4 * u.x * u.y, du * vec2(k1 + k4 * u.y, k2 + k4 * u.x));
}
vec4 tData(vec2 g) {
  vec2 uv = (g - uExtent.xy) / uExtent.z;
  vec4 d = texture2D(uData, clamp(uv, 0.0, 1.0));
  float e = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  return mix(vec4(-45.0, 900.0, 0.0, 0.0), d, smoothstep(0.0, 0.02, e));
}

float groundShadow(vec3 P, vec3 N) {
  if (dot(N, uSunDirW) < -0.05) return 0.0;   // facing away, the lighting is dark anyway
  float ol = length(vHorizon.yz);
  if (ol < 0.1) return bakedShadow(P + N * (0.6 + 3.0 * (1.0 - abs(N.y))), 0.3);
  // A face strip is carved, so it does not lie on the heightfield the shadow was baked from.
  // The rock of its own face that sticks out above it (the mesh builder's horizon, in the
  // face's vertical plane: ledges, bulges, the lip of an overhang), and the baked shadow
  // just out from its uncarved place, for everything further off.
  vec2 o = vHorizon.yz / ol;
  float eSun = atan(uSunDirW.y, dot(uSunDirW.xz, o)) / PI;
  float over = 1.0 - smoothstep(vHorizon.x - 0.012, vHorizon.x + 0.012, eSun);
  vec3 Q = P + vec3(o.x, 0.0, o.y) * (vRock.z * 32.0 + 0.6 + 3.0 * (1.0 - abs(N.y)));
  return over * bakedShadow(Q, 0.3);
}

uniform vec3 uBounceAlb[4];   // what the ground below sends back: sea, sand, land (albedo), and rock

// Light bounced up from the ground below and in front of a surface: the sand under the
// overhang lights its ceiling warm, the sea lights the cliff foot blue-grey. It looks down
// and out along the normal, reads what is there from the data texture, whether the sun
// reaches it, and treats it as a flat ground filling the lower half of the surface's view.
vec3 groundBounce(vec3 P, vec3 N) {
#ifdef SKIP_BOUNCE
  return vec3(0.0);
#endif
  // Under an overhang the map below is rock all the way up, so it cannot say what the
  // light comes up from. The mesh builder worked out how much of the ground out past the
  // drip line the point can see (vRock.w); look there for what it is and whether the sun
  // reaches it.
  if (vRock.w < 0.99) {
    // Which way is out: the face's own direction from the mesh builder (a floor's normal
    // cannot say, and the bumped normal would flick the lookup between sand and sea). Two
    // places, near and far, averaged.
    vec2 dir = vec2(vHorizon.y, -vHorizon.z) / max(length(vHorizon.yz), 1e-3);
    float reach = clamp(P.y * 0.8 + 2.0, 3.0, 60.0);
    vec3 sum = vec3(0.0);
    for (int i = 0; i < 2; i++) {
      vec2 q = vec2(P.x, -P.z) + dir * (vRock.z * 32.0 + reach * (i == 0 ? 0.5 : 1.3));
      vec4 D = tData(q);
      float sea = smoothstep(-0.5, 1.0, D.g);
      // The raw heightfield still contains the ramp carved out of this wall.
      // Near the toe, its beach zone identifies the exposed sand below; using
      // that raw ramp height misclassified the warm bounce as dark land light.
      float toeFloor = smoothstep(0.5, 0.9, D.b) * (1.0 - sea)
                     * (1.0 - smoothstep(uBeachTop + 2.0, uBeachTop + 8.0, P.y));
      float floorH = mix(D.r, min(D.r, uBeachTop), toeFloor);
      float sandW = smoothstep(0.4, 0.75, D.b) * (1.0 - smoothstep(uBeachTop, uBeachTop + 3.0, floorH));
      vec3 alb = mix(mix(uBounceAlb[2], uBounceAlb[1], sandW), uBounceAlb[0], sea);
      float lit = bakedShadow(vec3(q.x, max(floorH, 0.0) + 0.3, -q.y), 0.3);
      sum += alb * (uSunIrr * max(uSunDirW.y, 0.0) * lit + uSkyUp);
    }
    // And a second bounce: the rock overhead (the part of the view the sky share leaves) is
    // itself lit by that same ground, about half of it in view, and sends a share back down.
    // This is what fills the floor and the back of a cave with warm light instead of sky blue.
    return 0.5 * sum * (vRock.w + (1.0 - vRock.y) * 0.5 * uBounceAlb[3]);
  }
  // Only steep faces and overhangs, and only near the camera. A gentle slope sees little of
  // the ground below, and from a kilometre off the light is too subtle to see; the ground
  // shader is the most expensive thing on screen.
  float down = 0.5 * (1.0 - N.y);
  down *= smoothstep(0.12, 0.25, down) * (1.0 - smoothstep(500.0, 800.0, distance(P, cameraPosition)));
  if (down < 0.02) return vec3(0.0);
  vec2 g = vec2(P.x, -P.z);
  vec2 hz = vec2(N.x, -N.z);
  float lh = length(hz);
  // How far out to look: further the higher up the surface is (height above the sea stands
  // in for height above the ground below, which saves a texture read).
  vec2 q = g + (lh > 1e-3 ? hz / lh : vec2(0.0)) * clamp(P.y * 0.5 + 2.0, 2.0, 60.0);
  vec4 D = tData(q);
  float sea = smoothstep(-0.5, 1.0, D.g);
  float sandW = smoothstep(0.4, 0.75, D.b) * (1.0 - smoothstep(uBeachTop, uBeachTop + 3.0, D.r));
  vec3 alb = mix(mix(uBounceAlb[2], uBounceAlb[1], sandW), uBounceAlb[0], sea);
  float lit = bakedShadow(vec3(q.x, max(D.r, 0.0) + 0.3, -q.y), 0.3);
  vec3 E = uSunIrr * max(uSunDirW.y, 0.0) * lit + uSkyUp;
  return alb * E * down;
}

// ---------------------------------------------------------------- texture sampling

// Triplanar frame for one pixel: projection weights, and the screen derivatives of world
// position, taken once outside any branch so sampling inside branches stays correct.
vec3 triW; vec3 triP; vec3 triDx; vec3 triDy;

struct Surf { vec3 color; vec3 dn; float rough; float ao; };

// One projection. uv and its derivatives are in tiles. dn gets the tangent-space normal
// turned into a world-space perturbation (UDN blend): axisU and axisV are the world
// directions of increasing u and of the map's "up" (green).
void sampleProj(int layer, vec2 uv, vec2 gx, vec2 gy, vec3 axisU, vec3 axisV, float w, inout Surf s) {
  vec3 c = textureGrad(uSurfColor, vec3(uv, float(layer)), gx, gy).rgb;
  vec3 n = textureGrad(uSurfNormal, vec3(uv, float(layer)), gx, gy).xyz * 2.0 - 1.0;
  vec2 m = textureGrad(uSurfMask, vec3(uv, float(layer)), gx, gy).rg;
  s.color += c * w;
  s.dn += (axisU * n.x + axisV * n.y) * w;
  s.rough += m.r * w;
  s.ao += m.g * w;
}

// Sample a layer from up to three directions. The texture is stored top row first, so a
// world-up v runs down the rows: v = -height, and the map's green then points world-up.
// offset shifts the tiles, so two samplings of one layer do not line up.
Surf triplanar(int layer, float tile, vec2 offset) {
  Surf s = Surf(vec3(0.0), vec3(0.0), 0.0, 0.0);
  float k = 1.0 / tile;
  if (triW.x > 0.0) sampleProj(layer, vec2(triP.z, -triP.y) * k + offset, vec2(triDx.z, -triDx.y) * k, vec2(triDy.z, -triDy.y) * k, vec3(0.0, 0.0, 1.0), vec3(0.0, 1.0, 0.0), triW.x, s);
  if (triW.y > 0.0) sampleProj(layer, triP.xz * k + offset, triDx.xz * k, triDy.xz * k, vec3(1.0, 0.0, 0.0), vec3(0.0, 0.0, -1.0), triW.y, s);
  if (triW.z > 0.0) sampleProj(layer, vec2(triP.x, -triP.y) * k + offset, vec2(triDx.x, -triDx.y) * k, vec2(triDy.x, -triDy.y) * k, vec3(1.0, 0.0, 0.0), vec3(0.0, 1.0, 0.0), triW.z, s);
  s.color *= uGain[layer];
  return s;
}

// Blend b into a with weight t.
void mixSurf(inout Surf a, Surf b, float t) {
  a.color = mix(a.color, b.color, t);
  a.dn = mix(a.dn, b.dn, t);
  a.rough = mix(a.rough, b.rough, t);
  a.ao = mix(a.ao, b.ao, t);
}

// A layer seen from above, for the beach, which is nearly flat: one projection instead of
// three, turned by rot (cos, sin) and shifted, so two samplings of one tile do not line up.
// The map's x and green (up) are turned the same way into world directions.
Surf topLayer(int layer, float tile, vec2 rot, vec2 off, bool withColor) {
  mat2 R = mat2(rot.x, rot.y, -rot.y, rot.x);
  vec2 q = R * triP.xz / tile + off;
  vec2 gx = R * triDx.xz / tile, gy = R * triDy.xz / tile;
  Surf s = Surf(vec3(0.0), vec3(0.0), 0.9, 1.0);
  vec3 n = textureGrad(uSurfNormal, vec3(q, float(layer)), gx, gy).xyz * 2.0 - 1.0;
  s.dn = vec3(rot.x, 0.0, -rot.y) * n.x + vec3(-rot.y, 0.0, -rot.x) * n.y;
  if (withColor) {
    s.color = textureGrad(uSurfColor, vec3(q, float(layer)), gx, gy).rgb * uGain[layer];
    vec2 m = textureGrad(uSurfMask, vec3(q, float(layer)), gx, gy).rg;
    s.rough = m.r; s.ao = m.g;
  }
  return s;
}

// Five lightly used routes across the upper beach. Each walker leaves alternating, spaced
// impressions along a gently wandering line. World coordinates keep them from repeating with
// the sand scans, and the rest of the beach stays undisturbed.
vec3 beachPrints(vec2 g) {
  vec2 uv = vec2(g.x + g.y, g.x - g.y) * 0.70710678;
  vec3 mark = vec3(0.0); // normal tilt x/z, cavity
  if (uv.x < 179.0 || uv.x > 242.0 || uv.y < -77.0 || uv.y > -28.0) return mark;
  for (int i = 0; i < 5; i++) {
    vec4 walk = i == 0 ? vec4(-44.15, 0.050, 185.0, 228.0)
      : i == 1 ? vec4(-50.5, 0.065, 181.0, 222.0)
      : i == 2 ? vec4(-34.0, -0.050, 185.0, 225.0)
      : i == 3 ? vec4(-62.0, 0.030, 188.0, 230.0)
      : vec4(-72.0, -0.075, 185.0, 241.0);
    if (abs(uv.y - walk.x - walk.y * (uv.x - 200.0)) > 0.9) continue;
    float stride = 0.63 + 0.028 * float(i);
    float stepNo = floor((uv.x - walk.z) / stride + 0.5);
    float at = walk.z + stepNo * stride;
    if (at < walk.z || at > walk.w || abs(uv.x - at) > 0.25) continue;
    float rnd = th12(vec2(stepNo + 31.0, float(i) * 17.0 + 7.0));
    float u = uv.x - at + (rnd - 0.5) * 0.075;
    float side = mod(stepNo, 2.0) < 1.0 ? -0.135 : 0.135;
    float line = walk.x + walk.y * (at - 200.0) + 0.46 * sin(at * 0.11 + float(i) * 1.7);
    float v = uv.y - line - side - (rnd - 0.5) * 0.065;
    if (abs(v) > 0.16) continue;
    float a = 0.145 * (0.92 + 0.15 * rnd);
    float b = 0.075 * (0.9 + 0.2 * rnd) * (1.0 + 0.16 * smoothstep(-a, a, u));
    float r2 = u * u / (a * a) + v * v / (b * b);
    if (r2 >= 1.0) continue;
    float core = 1.0 - r2;
    float fade = smoothstep(walk.z, walk.z + 1.2, at) * (1.0 - smoothstep(walk.w - 1.2, walk.w, at));
    float depth = (0.026 + 0.013 * rnd) * fade;
    // Height -depth*(1-r²)²: its derivative makes a rounded wall, not a stamped outline.
    float dhdu = 4.0 * depth * core * u / (a * a);
    float dhdv = 4.0 * depth * core * v / (b * b);
    mark.xy += vec2(-dhdu - dhdv, dhdu - dhdv) * 0.70710678;
    mark.z = max(mark.z, core * core * fade);
  }
  return mark;
}

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 terrainSurface(vec3 P, vec3 N, float fp) {
  vec2 g = vec2(P.x, -P.z);
  float h = P.y;
  float up = N.y;
  // Under an overhang the map is rock all the way up; what the face stands on (sand or sea)
  // is out past the drip line, so read the map there.
  float carveM = vRock.z * 32.0;                              // metres carved in
  vec2 nh0 = vec2(N.x, -N.z);
  vec4 D = tData(carveM > 0.3 && length(nh0) > 0.2 ? g + normalize(nh0) * (carveM + 2.0) : g);
  float n1 = tfbm(g * 0.07, 14.0, fp);
  float n2 = tfbm(g * 0.021 + 9.1, 48.0, fp);

  // Triplanar frame.
  triP = P; triDx = dFdx(P); triDy = dFdy(P);
  vec3 Ng = normalize(cross(triDx, triDy));   // the triangle's own normal
  // Horizontal position along a face, for things that run along it.
  float wx = abs(N.x), wz = abs(N.z);
  float along = (wx * P.z - wz * P.x) / max(wx + wz, 1e-3);
  // Where this point sits in the stack of beds, and how that changes across the pixel (for
  // explicit texture gradients: the reads below sit inside branches). The beds wander up
  // and down a little along the face, which the mesh (whose beds are a metre across) never
  // notices.
  float bc = h + strataWarp(g) + 0.35 * (tn(vec2(along * 0.07, h * 0.05)) - 0.5);
  float su = (bc - STRATA_Z0) / STRATA_SPAN;
  vec2 sdx = vec2(dFdx(su), 0.0), sdy = vec2(dFdy(su), 0.0);
  float fpz = max(abs(sdx.x), abs(sdy.x)) * STRATA_SPAN;   // pixel footprint up the stack (m)
  float wallF = 1.0 - smoothstep(0.35, 0.72, abs(up));       // how much this is a face (not a floor or a ceiling)
  vec4 SA = vec4(0.0, 0.0, 1.0, 0.5), SB = vec4(0.0, 0.5, 0.0, 0.0);
#ifndef SKIP_STRATA
  if (wallF > 0.01) {
    SA = textureGrad(uStrataA, vec2(su, 0.5), sdx, sdy);
    SB = textureGrad(uStrataB, vec2(su, 0.5), sdx, sdy);
  }
#endif
  // (v10) Where the smoothed normal and the triangle's own disagree a lot (the cut banks beside
  // the path, the corners where a wall meets the beach), the triangle's decides which way the
  // texture is projected: from the smoothed one, a vertical bank got the view from above and
  // its texture ran down it in streaks.
  Ng *= sign(dot(Ng, N) + 1e-4);
  // (Half way, and the projections blended more gently there, so neighbouring facets do not
  // each get their own projection and show as a patchwork.)
  float disagree = smoothstep(0.9, 0.6, dot(Ng, N));
#ifdef SKIP_NG
  disagree = 0.0;
#endif
  vec3 Nt = normalize(mix(N, Ng, 0.5 * disagree));
  // (Squares and fourth powers by multiplying: a pow with a varying exponent is dear.)
  vec3 a2 = Nt * Nt;
  vec3 w = mix(a2 * a2, a2, disagree);
  w /= w.x + w.y + w.z;
  w = max(w - 0.03, 0.0);
  triW = w / (w.x + w.y + w.z);

  // ---------------------------------------------------------------- where is what
  float sandZone = smoothstep(0.4, 0.75, D.b);
  // Under an overhang, dry ground out past the drip line means the rock stands on a beach,
  // whatever the zones say.
  if (carveM > 0.3) sandZone = max(sandZone, smoothstep(1.0, 2.0, D.r));
  // (v10) By the slope of the triangle itself as much as the smoothed normal: across the
  // corner where a wall meets the beach the smoothed normal turns over a metre or two, and the
  // sand came out as a white fade up the foot of the rock. Sand lies where the ground is flat
  // enough to hold it, and the rock starts where it steepens, with a ragged contact.
  // (Less of the triangle's own than at first, v10: at 0.75 the sand's edge followed the
  // facets of the rock and drew them.)
  float upG = abs(Ng.y);
  float upC = mix(up, upG, 0.4) + (tn(g * 1.9 + 4.0) - 0.5) * 0.1;
  // Near a cliff foot the interpolated vertex normal can point upward on a wall triangle.
  // The triangle's own slope keeps a thin sand veneer from climbing that wall.
  // A tagged beach deposit is continuous ground. Let its smooth slope carry
  // the sand transition; applying a triangle-slope cutoff painted straight
  // white bands across the small bank beside the final stairs.
  float bankDeposit = smoothstep(0.98, 1.0, vRock.w)
                    * (1.0 - smoothstep(0.0, 0.02, vRock.z)) * step(0.005, vRock.x);
  float sandSlope = mix(min(upC, upG + 0.08), up, bankDeposit);
  float toeNear = 1.0 - smoothstep(0.2, 2.4, vFoot);
  float slopeMin = mix(0.65, 0.9, toeNear) + (n1 - 0.5) * 0.035;
  float sand = sandZone * smoothstep(slopeMin - 0.05, slopeMin + 0.08, sandSlope) * (1.0 - smoothstep(uBeachTop + 0.8, uBeachTop + 3.5, h + (n1 - 0.5) * 2.0));
  // Sand banked against the foot of the rock: up to a metre and more above the beach just in
  // front of the wall, in drifts along it, its top edge ragged. It covers the line where the
  // rock's strips cross the sand (which the triangles drew as a jagged line), and reads as sand
  // piled against the cliff. The beach level is read 3 m out from the wall.
  float banked = 0.0;
  vec2 nhB = vec2(N.x, -N.z);
  // (Not under an overhang, where the sand runs in on the mesh builder's own mask.) On a slope
  // short of a sheer wall the sand runs further up, as it drifts up the foot of a hillside.
#ifdef SKIP_BANK
  if (false) {
#else
  if (sandZone > 0.05 && up < 0.72 && h < uBeachTop + 6.0 && h > -0.3 && length(nhB) > 0.3 && carveM < 0.3) {
#endif
    float front = tData(g + normalize(nhB) * 3.0).r;
    float bankTop = 0.12 + 0.5 * tn(vec2(along * 0.12, 2.3))
                  + (tn(g * 0.7 + h * 0.3) - 0.5) * 0.24
                  + 0.75 * smoothstep(0.25, 0.6, up) * (0.6 + 0.4 * tn(vec2(along * 0.1, 8.8)));
    banked = sandZone * smoothstep(0.42, 0.74, mix(upG, up, bankDeposit))
           * (1.0 - smoothstep(bankTop - 0.18, bankTop + 0.3, h - front))
           * smoothstep(-2.0, 0.0, h - front + 2.0);
    sand = max(sand, banked);
  }
  tBanked = banked;
  // Just steeper than that, the foot of the rock: sand blown and splashed into its hollows.
  float footDust = sandZone * smoothstep(0.3, 0.62, upC) * (1.0 - sand) * (1.0 - smoothstep(uBeachTop, uBeachTop + 2.5, h));
  sand = max(sand, smoothstep(0.2, -0.4, h) * sandZone);
  // The floor running in under an overhang (the mesh builder's mask, per vertex: v10, its
  // edge taken at a noisy level so it does not follow the columns' triangles, and only where
  // the ground is no steeper than sand can lie; the ramp at the side of the cave mouth came
  // out as a white pyramid with a sawtooth top).
  // (Only where there is any: this ran on every pixel of the island.)
  if (vRock.x > 0.005) {
    // Deposits on the supporting bank follow its smooth slope, while carved
    // wall skirts retain the triangle-slope guard. This prevents a drawn line
    // along every small triangle at a gently sloping sand-to-rock transition.
    float depositSlope = mix(min(upC, upG + 0.08), up, bankDeposit);
    // The authored deposit mask ends on the rounded supporting bank, before the
    // vertical wall. Its thin sand cover must survive the bank's curved shoulder.
    float underSand = smoothstep(0.16, 0.76, vRock.x + (tn(g * 1.1 + h * 0.3) - 0.5) * 0.22)
                    * mix(smoothstep(0.78, 0.90, depositSlope), 1.0, bankDeposit);
    sand = max(sand, underSand);
  }

  // Ground cover on anything short of a sheer face, and in clumps along the ledges.
  // (v10: from 0.3..0.46: on the steep faces of the head it painted olive smears over the rock,
  // where the photos show white rock and the plants on it.)
  // (A narrow band: where it is part rock and part cover both are worked out, the dearest
  // thing this shader does.)
  float veg = smoothstep(0.41, 0.47, up + (n1 - 0.5) * 0.25);
  // On Batu Satu the wooded shoulder carries a thin, patchy understory down between
  // the rooted face shrubs. Fade it into the beds before the pale north-west wall and
  // leave the wave-cut foot as limestone.
  if (g.x > 35.0 && g.x < 125.0 && g.y > -155.0 && g.y < -50.0 && h < 68.0) {
    vec2 delta = g - vec2(80.0, -100.0);
    float island = 1.0 - smoothstep(0.77, 1.03, length(delta / vec2(48.0, 57.0)));
    float flank = smoothstep(-18.0, 18.0, delta.x - 0.2 * delta.y);
    float lower = smoothstep(16.0, 28.0, h) * (1.0 - smoothstep(55.0, 68.0, h));
    float coverPatch = 0.3 + 0.7 * smoothstep(0.38, 0.65, n1 * 0.65 + n2 * 0.35);
    veg = max(veg, 0.72 * island * flank * lower * coverPatch);
  }
  // (v7: no longer painted. The plants on the ledges are real now, src/veg/scatter.js.)
  veg *= 1.0 - smoothstep(0.6, 2.5, carveM);   // nothing grows under an overhang
  veg *= smoothstep(5.0, 11.0, h + (n1 - 0.5) * 6.0);   // salt spray keeps the foot bare
  veg *= 1.0 - 0.85 * sandZone * wallF * (1.0 - smoothstep(uBeachTop + 5.0, uBeachTop + 12.0, h));
  veg *= 1.0 - sand;
  tSandW = sand;
  tVegW = veg;

  float sea = 1.0 - sandZone;
  float notch = sea * (1.0 - smoothstep(4.5, 6.5, h + (n1 - 0.5) * 2.0));
  // The dark band at the waterline: higher where the swell hits, ragged along its top.
  float bandTop = 1.0 + 2.4 * tn(vec2(along * 0.045, 3.1)) + 1.4 * tn(vec2(along * 0.012, 7.7));
  float ragged = (tfbm(vec2(along * 0.5, h * 1.3), 2.0, fp) - 0.5) * 1.1;
  float algae = sea * (1.0 - smoothstep(bandTop - 0.25, bandTop + 0.25, h + ragged));
  float ochre = sandZone * smoothstep(uBeachTop, uBeachTop + 3.0, h) * (1.0 - smoothstep(uBeachTop + 9.0, uBeachTop + 16.0, h));
  float wet = smoothstep(1.1, 0.35, h) * sandZone;
  float detail = smoothstep(0.6, 0.15, fp);               // close-range layers fade out by here

  // The north/right beach wall: salt-weathered bedding and pits at their physical
  // scale. Fade by world position and height, so head turns never change its material.
  float rightFoot = sandZone * (1.0 - smoothstep(14.0, 25.0, h))
                  * (1.0 - smoothstep(0.6, 1.05, length((g - vec2(145.0, 274.0)) / vec2(60.0, 82.0))));

  Surf s = Surf(vec3(0.5), vec3(0.0), 0.85, 1.0);

  // ---------------------------------------------------------------- limestone
  if (veg < 0.999 && sand < 0.999) {
    // Grey-white limestone, sampled at two scales with offset tiles so the 16 m tile does
    // not repeat visibly across a 100 m face.
    Surf a = triplanar(L_LIMESTONE, uTile[L_LIMESTONE], vec2(0.0));
    Surf b = triplanar(L_LIMESTONE, uTile[L_LIMESTONE] * 2.7, vec2(0.37, 0.71));
    mixSurf(a, b, smoothstep(0.35, 0.65, n2));
    // The scan's network of fine dark cracks reads as marble: keep its relief and shading,
    // pull its colour halfway to its own average.
    a.color = mix(a.color, vec3(luma(a.color)) * uGain[L_LIMESTONE] / luma(uGain[L_LIMESTONE]), 0.35);
    // Relief from the layered scan: its shading and normals, not its colour, except for the
    // ochre stain low on the walls over the beach where its colour is the point.
    if (detail > 0.0) {
      Surf beds = triplanar(L_BEDS, uTile[L_BEDS], vec2(0.0));
      float lb = luma(beds.color) / luma(uGain[L_BEDS] * lin(vec3(0.482, 0.322, 0.194)));
      a.color *= mix(1.0, clamp(lb, 0.55, 1.35), 0.45 * detail);
      a.dn += beds.dn * 0.7 * detail;
      a.ao *= mix(1.0, beds.ao, 0.6 * detail);
      a.color = mix(a.color, beds.color, ochre * 0.55);
    }

    // (v10) At arm's length: the layered scan at its own size (1.8 m), and the pitted grain of
    // the rough rock scan, for the relief the face's big scans are too coarse to have there.
    // The marble scan's crack network, which reads as marble up close, pulled further to grey.
    float closeR = max(wallF, footDust) * max(smoothstep(0.02, 0.006, fp), rightFoot * smoothstep(0.14, 0.035, fp));
#ifdef SKIP_CLOSER
    closeR = 0.0;
#endif
    if (closeR > 0.01) {
      Surf fine = triplanar(L_BEDS, uTile[L_BEDS] / 3.0, vec2(0.23, 0.57));
      Surf grain = triplanar(L_WET, mix(0.8, 1.6, rightFoot), vec2(0.61, 0.19));
      float lf = luma(fine.color) / luma(uGain[L_BEDS] * lin(vec3(0.482, 0.322, 0.194)));
      float lg = luma(grain.color) / luma(uGain[L_WET] * lin(vec3(0.271, 0.251, 0.215)));
      a.color = mix(a.color, vec3(luma(a.color)) * uGain[L_LIMESTONE] / luma(uGain[L_LIMESTONE]), 0.5 * closeR);
      // The worn toe is granular limestone; pull back the large marble-like
      // crack colour while retaining the scanned pores, seams and relief.
      a.color = mix(a.color, uGain[L_LIMESTONE] * lin(vec3(0.578, 0.550, 0.513)), 0.42 * rightFoot * closeR);
      a.color *= mix(1.0, clamp(lf, 0.5, 1.4) * clamp(lg, 0.7, 1.25), 0.7 * closeR);
      a.dn = mix(a.dn, a.dn * 0.5 + fine.dn * 1.1 + grain.dn * 1.2, closeR);
      a.ao *= mix(1.0, fine.ao * grain.ao, 0.7 * closeR);
      a.rough = mix(a.rough, 0.95, closeR * 0.5);
      // Sand in the hollows at the foot: where the scans are darkest (the pits and seams).
      float hollow = 1.0 - smoothstep(0.55, 1.0, lf * lg);
      a.color = mix(a.color, uSandAlb * 0.9, footDust * max(hollow, 0.35) * 0.8);
    }

    // The bedding: each bed its own shade, grey or creamy, the seams between them darker
    // and cut back, and the fine relief of the beds tilting the surface up and down.
    // How strongly the beds stand out: by stretches of the island, and coming and going
    // along a face over tens of metres, so the ledges are not ruled lines.
    float m = strataStrength(g) * wallF * (0.35 + 1.1 * tn(vec2(along * 0.045 + 3.0, bc * 0.09)));
    // And each parting comes and goes along the face (the noise changes about once a bed),
    // so the lines are not ruled right across it.
    m *= 0.25 + 0.75 * smoothstep(0.3, 0.7, tn(vec2(along * 0.06 + 11.0, bc * 1.2)));
    tLedgeSky = mix(1.0, SB.a, min(m * 1.2, 1.0));
    a.color *= mix(1.0, SA.b, 0.9 * wallF);
    a.color *= mix(vec3(1.0), mix(vec3(0.95, 0.985, 1.03), vec3(1.05, 1.0, 0.9), SA.a), 0.85 * wallF);
    a.color *= 1.0 - 0.28 * SB.b * m;
    a.dn += vec3(0.0, -clamp(SA.g, -1.5, 1.5) * m * 0.5, 0.0);
    // The ledges above shade the beds below them. How steeply the sun comes down past a
    // ledge depends on how the face is turned to it; the table (strata.js) holds, for each
    // steepness, how far the highest ledge within 6 m above cuts into the sunlight.
    vec2 nh = N.xz;
    float nhl = length(nh);
    if (m > 0.02 && nhl > 0.3) {
      float toward = dot(uSunDirW.xz, nh / nhl);
      if (toward > 0.0) {
        float K = m * uSunDirW.y / max(toward, 1e-3);
        float row = clamp(log2(K / 0.25) / 0.62, 0.0, SHADOW_ROWS - 1.0);
        float margin = textureGrad(uStrataC, vec2(su, (row + 0.5) / SHADOW_ROWS), sdx, sdy).r;
        float soft = max(0.03, 1.5 * fpz);
        // The table is in unscaled relief metres. K accounts for the local strength when
        // finding the occluder; its margin still needs that same strength to be in world
        // metres, like the bias and pixel footprint. Otherwise millimetre ledges on smooth
        // rock cast full black seams. Zero margin is tangent to the sun and remains lit.
        tFineShadow = mix(1.0, 1.0 - smoothstep(0.01, 0.01 + 2.0 * soft, margin * m), wallF);
      }
    }

    // Runoff streaks down the faces: narrow dark grey-brown stains below the ledges, in
    // some stretches of face and not others.
    float streak = tfbm(vec2(along * 0.55, h * 0.02), 3.0, fp);
    float streaky = smoothstep(0.45, 0.7, tn(vec2(along * 0.03 + 7.0, h * 0.01)));
    a.color = mix(a.color, a.color * vec3(0.62, 0.6, 0.57), smoothstep(0.55, 0.8, streak) * 0.6 * streaky * wallF);
#ifndef SKIP_WEATHER
    // Weathering at the scale of the whole face: dark grey zones where water runs and
    // lichen grows, and creamy ochre ones where rock fell away more recently. Tens of metres
    // across and running down the face (built from noise already worked out above: the map
    // noise is constant down a vertical face, the streak noise changes slowly with height).
    float dirt = n2 * 0.65 + streaky * 0.35;
    a.color = mix(a.color, a.color * vec3(0.56, 0.57, 0.58), smoothstep(0.55, 0.72, dirt) * 0.7 * wallF);
    a.color = mix(a.color, a.color * vec3(1.1, 1.0, 0.8), smoothstep(0.6, 0.74, n1 * 0.7 + (1.0 - streaky) * 0.3) * 0.8 * wallF);
    // Joints: near-vertical cracks every several metres, each one only in some stretches of
    // its height, a little darker and cut in.
    if (detail > 0.0) {
      float ju = along / 7.0 + 0.6 * tn(vec2(h * 0.05, 1.3));
      float jc = floor(ju);
      float jx = abs(fract(ju) - 0.2 - 0.6 * th12(vec2(jc, 5.1))) * 7.0;          // metres to the crack
      float jon = smoothstep(0.45, 0.6, tn(vec2(jc * 3.7, h * 0.08)));
      float jw = max(0.12, 1.2 * fp);
      float joint = (1.0 - smoothstep(0.0, jw, jx)) * jon * wallF * detail;
      a.color *= 1.0 - 0.45 * joint;
      a.ao *= 1.0 - 0.4 * joint;
    }
#endif
    // A dirty grey band along the foot of the walls on the beach, and under the overhangs
    // the rock stained ochre and brown.
    float foot = sandZone * (1.0 - smoothstep(uBeachTop + 3.0, uBeachTop + 9.0, h + (n1 - 0.5) * 3.0)) * wallF;
    a.color = mix(a.color, a.color * vec3(0.66, 0.63, 0.58), foot * 0.6);
    // Weathering belongs to the bed, including the uncarved gully between face
    // strips. A carving-attribute threshold stamped orange polygon islands here.
    float beachWall = sandZone * (1.0 - smoothstep(18.0, 30.0, h));
    float gully = 1.0 - smoothstep(14.0, 30.0, length(g - vec2(114.0, 294.0)));
    float under = beachWall * mix(0.38 + 0.62 * smoothstep(0.8, 5.0, carveM), 0.65, gully);
    // Staining follows runoff and individual beds instead of filling the
    // entire recess with one orange stripe. Fresh worn patches stay grey-beige.
    float stain = 0.35 + 0.65 * smoothstep(0.32, 0.7, 0.55 * streaky + 0.3 * n2 + 0.15 * SA.a);
    under *= mix(1.0, stain, rightFoot);
    a.color = mix(a.color, a.color * vec3(1.02, 0.78, 0.52), under * 0.75);
    // The wave-cut notch and the dark wet band at the waterline, from the wet rock scan.
    if (notch > 0.0) {
      Surf wr = triplanar(L_WET, uTile[L_WET], vec2(0.0));
      // The notch is dark because it is a recess (the mesh carves it); its rock is only a
      // little stained. The band the waves wet is dark olive-brown.
      mixSurf(a, wr, max(notch * 0.35, algae));
      a.color *= mix(vec3(1.0), vec3(0.8, 0.72, 0.52), algae);
      a.rough = mix(a.rough, 0.35, algae);
    }
    s = a;
  }

  // ---------------------------------------------------------------- ground under the plants
  if (veg > 0.001) {
    Surf gr = triplanar(L_GROUND, uTile[L_GROUND], vec2(0.0));
    Surf g2 = triplanar(L_GROUND, uTile[L_GROUND] * 3.1, vec2(0.61, 0.13));
    mixSurf(gr, g2, smoothstep(0.35, 0.65, n2));
    // Field-scale cover: greener patches, paler grass, straw where it has dried.
    float cover = tfbm(g * 0.009 + 3.7, 110.0, fp);
    gr.color *= mix(vec3(1.0), vec3(0.8, 0.88, 0.78), smoothstep(0.52, 0.68, cover));
    gr.color *= mix(vec3(1.0), vec3(1.15, 1.12, 1.08), smoothstep(0.42, 0.3, cover));
    gr.color = mix(gr.color, gr.color * vec3(1.9, 1.5, 1.35), smoothstep(0.6, 0.78, n2) * 0.6);
    // (v10) Up on the headland the ground between the scrub is drier, olive and straw with
    // bare earth, where it was a lime lawn; greener down the gullies.
    float headland = 1.0 - smoothstep(180.0, 320.0, length(g - vec2(60.0, 60.0)));
    // (From the noise already worked out: another fbm here cost 5% of the overview.)
    float dryG = headland * smoothstep(0.4, 0.62, n2 * 0.7 + n1 * 0.3) * smoothstep(0.85, 0.6, up);
    gr.color = mix(gr.color, vec3(luma(gr.color)) * vec3(1.5, 1.2, 0.62), clamp(headland * 0.15 + dryG * 0.3, 0.0, 0.5));
    // And from a way off the cover is greyer, as the plants are (impostors.js).
    float farG = smoothstep(50.0, 220.0, distance(P, cameraPosition));
    gr.color = mix(gr.color, vec3(luma(gr.color)) * vec3(0.98, 1.04, 0.8), 0.5 * farG);
    // Under the crowns (v7, the worker's canopy cover in the data's alpha on land): leaf
    // litter and bare earth, and shade, which the lighting takes from tCanopy.
    float canopy = clamp(-D.a, 0.0, 1.0);
    gr.color = mix(gr.color, vec3(luma(gr.color)) * vec3(0.72, 0.7, 0.6), canopy);
    // Near the camera the grass is real (the tussocks, src/veg/, up to 15 m): the ground under
    // it is straw and earth. Further off the ground carries the grass's colour itself.
    float litter = 1.0 - smoothstep(10.0, 15.0, distance(P, cameraPosition));
    vec3 straw = vec3(0.15, 0.12, 0.062) * (0.55 + 0.9 * luma(gr.color) / 0.1) * (0.85 + 0.3 * n1);
    gr.color = mix(gr.color, straw, litter * 0.85);
    tCanopy = canopy * veg;
    mixSurf(s, gr, veg);
  }

  // ---------------------------------------------------------------- sand
  if (sand > 0.001) {
    // Below the swash's reach the sand is packed firm and smooth, and wet; above it people
    // have trampled it, more in some places than others. Both from close-range scans; further
    // off, where a footprint is smaller than a pixel, patches of tone and the sand's own
    // colour. (v1 used the aerial scan here at two scales: its wind ripples came out half a
    // metre apart, and the photos show trampled sand, not ripples.)
    // The swash (swash.js, the same sheets the sea draws): the sand it covers is soaked, just
    // after the backwash has left it is a mirror of water for a couple of seconds, then it
    // drains to dark wet sand that dries out over a minute or so. Above the highest recent
    // swash it is damp for a while (the big waves of a set wet it) and then dry, with a
    // ragged line between.
    float hs = h + (n1 - 0.5) * 0.35;
    float top = uRunup * (1.3 + 0.25 * (n2 - 0.5));   // how high the big waves wet it
    float firm = 1.0 - smoothstep(top - 0.2, top + 0.4, hs);
    float wetS = 0.0;
#ifdef SKIP_SWASH
    if (false) {
#else
    if (h < uRunup * 1.6 + 0.3 && h > SW_RUNDOWN - 0.15 && sandZone > 0.0) {
#endif
      vec4 sm = swashMap(g);   // (swash-map.js)
      float covered = smoothstep(0.0, 0.004, sm.x);
      float dry = max(-sm.z, 0.0);
      float soaked = exp(-dry / 30.0);
      float damp = 0.55 * (1.0 - smoothstep(top - 0.15, top + 0.05, h + (tn(g * 0.6 + 3.0) - 0.5) * 0.09 + (tn(g * 2.3) - 0.5) * 0.04));
      // Low on the beach the sand is below the water table where it meets the sea: always wet.
      float table = 1.0 - smoothstep(0.1, 0.45, h);
      wetS = max(max(covered, table), max(soaked * 0.95, damp));
      tGloss = exp(-dry / 2.2) * (1.0 - covered);
    } else if (h < 0.0) wetS = 1.0;
    // (Single octaves of noise here: the sand covers most of the frame on the beach, and at
    // these scales the eye cannot tell them from fbm.)
    // Wind, weather and a few visitors disturb the dry surface without covering it in prints.
    float trample = (1.0 - firm) * (0.38 + 0.27 * smoothstep(0.25, 0.7, 0.65 * tn(g * 0.07 + 5.3) + 0.35 * tn(g * 0.19 + 1.1)));
    Surf sd = Surf(uSandAlb, vec3(0.0), 0.92, 1.0);
    // Tone: broad patches, drift lines of paler sand, and the pinkish grains of the
    // foraminifera sorted into streaks. (v10: stronger, and in three colours, whiter, creamier
    // and a dull grey-beige, so the beach is not one colour everywhere.)
    float tone = (n2 - 0.5) * 0.16 + (tn(g * 0.31 + 1.7) - 0.5) * 0.12 + (tn(g * 0.045 + 9.0) - 0.5) * 0.16;
    sd.color *= 1.0 + tone;
    // (From noise already worked out.)
    float cream = smoothstep(0.45, 0.75, n2), dull = smoothstep(0.52, 0.78, n1 * 0.6 + (1.0 - n2) * 0.4);
    sd.color *= mix(vec3(1.0), vec3(1.03, 0.98, 0.9), cream * 0.8) * mix(vec3(1.0), vec3(0.9, 0.88, 0.86), dull * 0.7 * (1.0 - firm));
    sd.color *= mix(vec3(1.0), vec3(1.035, 0.985, 0.95), smoothstep(0.55, 0.8, tn(vec2(g.x * 0.05, g.y * 0.2) + 8.0)));
    // Coral grains change brightness and pore roughness at close range, while the broad tone
    // above stays visible as that detail filters away into the distance.
    float grainW = (1.0 - smoothstep(0.012, 0.055, fp)) * (1.0 - firm * 0.5);
    float grain = tn(g * 8.5 + 11.7);
    sd.color *= 1.0 + (grain - 0.5) * 0.075 * grainW;
    sd.rough = clamp(sd.rough + (grain - 0.5) * 0.09 * grainW, 0.75, 1.0);
    // From further off, the aerial scan's variation in colour (its ripples are too small to
    // see from there; up close they came out half a metre apart, which the photos do not show).
    float farW = smoothstep(0.03, 0.12, fp);
    if (farW > 0.0) {
      mat2 Ra = mat2(0.8, 0.6, -0.6, 0.8);
      vec2 qa = Ra * triP.xz / uTile[L_SAND];
      vec3 ac = textureGrad(uSurfColor, vec3(qa, float(L_SAND)), Ra * triDx.xz / uTile[L_SAND], Ra * triDy.xz / uTile[L_SAND]).rgb * uGain[L_SAND];
      sd.color *= mix(vec3(1.0), ac / uSandAlb, farW * 0.7);
    }
    float nearW = 1.0 - smoothstep(0.1, 0.4, fp);
#ifdef SKIP_SANDNEAR
    nearW = 0.0;
#endif
    if (nearW > 0.0) {
      // Trampled: the scan twice, turned and scaled against each other so its 2 m tile does
      // not repeat, handing over through a noise.
      // (The second sampling and the firm sand only where a pixel is small enough to tell:
      // from the trail above, one sampling of the trampled scan is all the eye gets.)
      float close = 1.0 - smoothstep(0.015, 0.03, fp);
      Surf a = topLayer(L_SAND_DRY, uTile[L_SAND_DRY], vec2(1.0, 0.0), vec2(0.0), true);
#ifdef SKIP_SANDB
      if (false) {
#else
      if (close > 0.0) {
#endif
        Surf b = topLayer(L_SAND_DRY, uTile[L_SAND_DRY] * 1.37, vec2(0.8, 0.6), vec2(0.31, 0.77), true);
        mixSurf(a, b, smoothstep(0.3, 0.7, tn(g * 0.33 + 2.0)) * close);
      }
      a.dn *= mix(0.50, 0.90, trample);
      if (firm > 0.001) {
        if (close > 0.0) {
          Surf fs = topLayer(L_SAND_FIRM, uTile[L_SAND_FIRM], vec2(0.6, -0.8), vec2(0.13, 0.4), true);
          fs.color = mix(uSandAlb, fs.color, close);
          fs.dn *= close;
          mixSurf(a, fs, firm);
        } else {
          // Further off, packed sand is the same colour, smoother.
          a.color = mix(a.color, uSandAlb, firm * 0.6);
          a.dn *= 1.0 - firm * 0.7;
        }
      }
      sd.color *= mix(vec3(1.0), a.color / uSandAlb, nearW * 0.85);
      sd.dn = a.dn * nearW;
      sd.rough = mix(sd.rough, a.rough, nearW);
      sd.ao = mix(1.0, a.ao, nearW * 0.7);
    }
    // The relief: lumps and hollows, and footprints up close. The footprints lie on the dry
    // sand; below the swash's reach only a few fresh ones, shallow.
    // (Only above the water: the seabed of the whole bay counts as sand, and from the air this
    // ran over all of it, under water where none of it shows.)
    float reliefW = (1.0 - smoothstep(0.15, 0.5, fp)) * smoothstep(-0.6, -0.2, h);
#ifdef SKIP_SANDRELIEF
    reliefW = 0.0;
#endif
    if (reliefW > 0.0) {
      // Deposited sand has interleaved hummocks and hollows, not uniformly round
      // noise bumps. The elongated field sits above the existing geometric drifts.
      mat2 wind = mat2(0.83, -0.56, 0.56, 0.83);
      vec2 q = wind * g;
      vec3 l1 = tnd(q * vec2(0.65, 1.1) + vec2(2.1, 9.7));
      vec3 drift = tnd(q * vec2(0.23, 0.37) + vec2(7.3, 3.1));
      float lumpA = mix(1.0, 0.18, firm) * mix(0.75, 1.0, trample);
      vec2 slope = transpose(wind) * (l1.yz * vec2(0.65, 1.1)) * (0.10 * lumpA);
      slope += transpose(wind) * (drift.yz * vec2(0.23, 0.37)) * (0.16 * lumpA);
      float lumpH = ((l1.x - 0.5) * 0.10 + (drift.x - 0.5) * 0.16) * lumpA;
      // Fine broken ridges: about 31 cm apart, centimetres high, interrupted by
      // smoother deposits. The warp has analytic slopes, including its curved crests.
      float rippleW = (1.0 - firm) * (1.0 - 0.55 * trample)
                    * smoothstep(0.34, 0.68, drift.x);
      float bend = q.x * 1.05 + drift.x * 4.0;
      float phase = q.y * 20.0 + (drift.x - 0.5) * 4.5 + 1.4 * sin(bend);
      vec2 phaseSlope = vec2(0.0, 20.0) + drift.yz * vec2(0.23, 0.37) * 4.5
                     + 1.4 * cos(bend) * (vec2(1.05, 0.0) + drift.yz * vec2(0.23, 0.37) * 4.0);
      // Filter the phase from explicit world derivatives (valid inside this branch).
      vec2 phaseWorld = transpose(wind) * phaseSlope;
      float phaseFoot = abs(dot(phaseWorld, vec2(triDx.x, -triDx.z)))
                      + abs(dot(phaseWorld, vec2(triDy.x, -triDy.z)));
      float rippleKeep = exp(-0.65 * phaseFoot * phaseFoot);
      float rippleH = sin(phase) + 0.22 * pow(rippleKeep, 3.0) * sin(phase * 2.0);
      float rippleSlope = cos(phase) + 0.44 * pow(rippleKeep, 3.0) * cos(phase * 2.0);
      float rippleA = 0.018 * rippleW * rippleKeep;
      slope += phaseWorld * (rippleA * rippleSlope);
      lumpH += rippleH * rippleA;
      sd.color *= 1.0 + (drift.x - 0.5) * 0.18 * (1.0 - firm);
      // Occluded grain between ridges remains readable under the nearly overhead sun.
      // The shade follows the same height profile; quieter deposits stay unmarked.
      float trough = 0.5 - 0.5 * sin(phase);
      sd.ao *= 1.0 - rippleW * rippleKeep * 0.20 * trough;
      sd.color *= 1.0 - rippleW * rippleKeep * 0.16 * trough;
      // Small irregular clods and pores interrupt the ripple crests. They fade
      // before becoming subpixel speckles; millimetre grain comes from the scans.
      float microW = (1.0 - smoothstep(0.035, 0.10, fp)) * (1.0 - firm);
      vec3 grains = tnd(q * vec2(2.7, 4.6) + vec2(3.8, 7.1));
      slope += transpose(wind) * (grains.yz * vec2(2.7, 4.6)) * (0.040 * microW);
      lumpH += (grains.x - 0.5) * 0.018 * microW;
      sd.color *= 1.0 + (grains.x - 0.5) * 0.20 * microW;
      sd.ao *= 1.0 - 0.17 * (1.0 - grains.x) * microW;
      // Irregular centimetre hollows survive in the middle-distance material as
      // accumulated darker pores. Filter the tiny granules, not this deposited pattern.
      float deposits = (1.0 - firm) * (0.5 + 0.5 * smoothstep(0.25, 0.75, drift.x));
      float pore = smoothstep(0.52, 0.84, 1.0 - grains.x) * (1.0 - smoothstep(0.06, 0.18, fp));
      sd.color *= 1.0 - 0.10 * pore * deposits * reliefW;
      sd.ao *= 1.0 - 0.15 * pore * deposits * reliefW;
      sd.rough = clamp(sd.rough + 0.045 * deposits * (grains.x - 0.5), 0.75, 1.0);
      // A few coral/shell chips among fine grains. Their 1–3 cm size is filtered,
      // and their density follows deposits rather than filling the whole beach.
      float fragmentW = (1.0 - smoothstep(0.012, 0.035, fp)) * (1.0 - firm);
      if (fragmentW > 0.01) {
        vec2 cell = floor(g * 9.0), f = fract(g * 9.0);
        float seed = th12(cell + 13.7);
        vec2 centre = 0.25 + 0.5 * vec2(th12(cell + 2.8), th12(cell + 8.3));
        vec2 d = (f - centre) * vec2(0.8, 1.3);
        float radius = mix(0.065, 0.14, th12(cell + 4.1));
        float aa = max(0.015, fp * 9.0);
        float chip = (1.0 - smoothstep(radius - aa, radius + aa, length(d)))
                   * step(0.965 - 0.018 * drift.x, seed) * fragmentW;
        sd.color *= mix(vec3(1.0), vec3(1.12, 1.09, 1.025), chip);
        sd.ao *= 1.0 - 0.16 * chip;
        slope += d * (0.30 * chip);
      }
      float cav = 0.0;
      // At arm's length the five walking lines have individual heel-sized hollows. Fade their
      // relief as each print becomes smaller than a few pixels from the stairs.
      float printW = (1.0 - smoothstep(0.06, 0.16, fp)) * mix(0.18, 1.0, 1.0 - firm);
      vec3 tr = vec3(0.0);
      if (printW > 0.0) {
        tr = beachPrints(g);
        cav = tr.z * printW;
      }
      slope *= reliefW * 2.0;
      sd.dn += vec3(-slope.x, 0.0, slope.y) + vec3(tr.x, 0.0, tr.y) * printW * reliefW;
      // In a print the sand is disturbed, a touch darker and duller, and the pit sees less sky;
      // the pushed-up rims are fresh dry grains, a touch lighter.
      sd.color *= (1.0 - 0.18 * cav) * (1.0 + lumpH * 1.5 * reliefW);
      sd.ao *= 1.0 - 0.5 * cav;
      // The pits shade the sun too: grains and the pit's own rim throw tiny shadows the
      // relief is too coarse to cast. And trodden sand seen at a low angle shows more of the
      // shaded sides of its lumps than it does from above (from the clifftop, looking down at
      // 25 degrees and more, this is 1: the viewpoint's sand stays as measured).
      // (Into the occlusion, which the lighting already takes for the sun too: another value
      // kept alive to the lighting costs this shader a lot, whatever it does.)
      vec3 Vs = normalize(cameraPosition - P);
      sd.ao *= (1.0 - 0.3 * cav) * mix(1.0, 0.62 + 0.38 * smoothstep(0.06, 0.4, Vs.y), trample * reliefW);
    }
    // Further off, where a print is smaller than a few pixels: trodden sand as a mottle of
    // slightly darker and lighter patches, so the beach still has a grain going into the distance.
    float farMottle = smoothstep(0.03, 0.09, fp) * (1.0 - firm) * step(0.0, h);
#ifdef SKIP_FARMOTTLE
    farMottle = 0.0;
#endif
    if (farMottle > 0.0) sd.color *= 1.0 + farMottle * ((tn(g * 3.1) - 0.5) * 0.3 + (n1 - 0.5) * 0.2 - 0.08 * trample);
    // Along the foot of the walls (vFoot: metres out from it).
    // Where the swash reaches the rock it leaves a narrow maroon band (the red grains of
    // foraminifera and coralline algae it sorts out there, beach-white-sand-surf.jpg); all
    // along the foot grit and pebbles fallen from the wall, thinning out over a few metres;
    // and in under the overhangs the sand is greyer with rock dust.
#ifndef SKIP_FOOT
    if (vFoot < 5.0) {
#else
    if (false) {
#endif
      float fd = vFoot + (tn(g * 0.7) - 0.5) * 0.7 + (tn(g * 3.1) - 0.5) * 0.25;
      float reachFoot = 1.0 - smoothstep(top - 0.1, top + 0.5, h);
      float band = (1.0 - smoothstep(0.1, 0.75, fd)) * reachFoot;
      sd.color = mix(sd.color, sd.color * vec3(0.55, 0.3, 0.27), band * 0.75);
      float grit = 1.0 - smoothstep(-0.5, 3.2, fd);
      if (grit > 0.01 && fp < 0.08) {
        // Sparse chips and small fragments of the actual limestone, in short pockets at
        // the toe rather than a uniform carpet of bright grains.
        vec2 gc = g * 4.5;
        vec2 ci = floor(gc);
        float r = th12(ci);
        vec2 off = vec2(th12(ci + 17.1), th12(ci + 3.7)) * 0.6 + 0.2;
        float dist = length(fract(gc) - off);
        float size = 0.12 + 0.22 * th12(ci + 9.3);
        float pocket = 0.55 + 0.45 * tn(g * 0.16);
        float stone = (1.0 - smoothstep(size * 0.65, size, dist)) * step(1.0 - grit * pocket * 0.36, r) * smoothstep(0.08, 0.025, fp);
        vec3 stoneCol = sd.color * mix(vec3(0.5, 0.54, 0.56), vec3(0.72, 0.7, 0.67), th12(ci + 5.5));
        sd.color = mix(sd.color, stoneCol, stone);
        sd.dn += vec3(fract(gc) - off, 0.0).xzy * vec3(1.0, 0.0, -1.0) * stone * 2.5;
        sd.ao *= 1.0 - 0.3 * (1.0 - smoothstep(size, size * 1.6, dist)) * step(1.0 - grit * pocket * 0.36, r) * (1.0 - stone);
      }
      sd.color *= mix(vec3(1.0), vec3(0.97, 0.94, 0.9), grit * 0.6);
      sd.color *= mix(vec3(1.0), vec3(0.87, 0.88, 0.86), grit * (0.4 + 0.3 * tn(g * 0.45)));
      sd.color *= mix(vec3(1.0), vec3(0.82, 0.8, 0.78), vRock.x);
      sd.ao *= 1.0 - 0.16 * grit * (1.0 - smoothstep(0.1, 1.3, max(fd, 0.0)));
    }
    // Wet sand: water in the pores, darker and a little more saturated.
    tWet = wetS * sand;
    sd.color *= mix(vec3(1.0), uWetTint, wetS);
    sd.rough = mix(sd.rough, 0.45, wetS);
    mixSurf(s, sd, sand);
  }

  tNormalW = normalize(N + s.dn * 0.9);
  // Banked sand lies at its angle of repose (about 33 degrees), whatever the rock under it does.
  if (tBanked > 0.0) {
    vec2 oh = vec2(N.x, N.z);
    vec3 repose = normalize(vec3(oh / max(length(oh), 1e-3) * 0.65, 1.0).xzy);
    tNormalW = normalize(mix(tNormalW, normalize(repose + s.dn * 0.9), tBanked));
  }
  tRough = clamp(s.rough, 0.2, 1.0);
  tAO = s.ao * (1.0 - 0.4 * tCanopy);
  vec3 col = s.color;

  if (uClay > 0.5) { col = lin(vec3(0.74, 0.72, 0.68)); tNormalW = N; tAO = 1.0; tRough = 0.93; }
  // clay=2: the triangles' own normals, to see the mesh itself.
  if (uClay > 1.5) { tNormalW = normalize(cross(triDx, triDy)); tNormalW *= sign(dot(tNormalW, cameraPosition - P)); }

  // Contour lines every 10 m, stronger every 50 m.
  float q = h / 10.0;
  float line = 1.0 - min(abs(fract(q - 0.5) - 0.5) / max(fwidth(q), 1e-4), 1.0);
  float major = step(abs(mod(floor(q + 0.5), 5.0)), 0.5);
  col *= 1.0 - uContours * line * mix(0.35, 0.7, major) * step(0.5, h);
  return col;
}
`;

// Replaces the colour chunk: work out the surface, keep the numbers for later chunks.
export const TERRAIN_COLOR = /* glsl */ `
  vec3 tN = normalize(vWorldNormal);
  float tFp = max(length(fwidth(vWorldPos)), 0.005);
  diffuseColor.rgb = terrainSurface(vWorldPos, tN, tFp);
  // Under the crowns: the sun gets through the gaps, and green through the leaves.
  tShadow = groundShadow(vWorldPos, tN) * tFineShadow * (1.0 - 0.8 * tCanopy);
  // Cloud shadows only reach the island when the clear sky over it is small (main.js sets
  // this); by default the island sits in sun, as on the photo day.
#ifdef TERRAIN_CLOUDS
  tShadow *= cloudShadow(vWorldPos, uSunDirW);
#endif
`;

// Light bounced up from below, added where three.js gathers the indirect light. Worked out
// here, late, from the final normal, so nothing has to be carried through the shader.
export const TERRAIN_BOUNCE = /* glsl */ `
  reflectedLight.indirectDiffuse += groundBounce(vWorldPos, normalize((vec4(normal, 0.0) * viewMatrix).xyz)) * BRDF_Lambert(material.diffuseColor) * tAO;
  // Wet sand reflects the sky: a blurred sheen when damp, and a mirror when a film of water
  // still lies on it after the backwash (on the smooth surface: the water fills the dimples).
#ifdef SKIP_GLOSS
  if (false) {
#else
  if ((tWet > 0.01 || tGloss > 0.01) && vWorldPos.y > -0.3) {
#endif
    vec3 Vw = normalize(cameraPosition - vWorldPos);
    vec3 Ns = normalize(vWorldNormal);
    vec3 Nw = normalize(mix(tNormalW, Ns, tGloss));
    float NoVw = max(dot(Nw, Vw), 1e-3);
    float Fw = 0.02 + 0.98 * pow(1.0 - NoVw, 5.0);
    vec3 Rw = reflect(-Vw, Nw);
    Rw.y = abs(Rw.y) + 0.01;
    vec3 sky = mix(skyIrradiance(Rw) / PI, skyRadiance(Rw), tGloss);
    reflectedLight.indirectSpecular += sky * Fw * max(tGloss, 0.35 * tWet) * vRock.y * tAO;
    // The sun in the film.
    if (tGloss > 0.01) {
      vec3 Hw = normalize(Vw + uSunDirW);
      float a2w = 0.0025;
      float NoH = max(dot(Nw, Hw), 0.0), NoL = max(dot(Nw, uSunDirW), 0.0);
      float Dw = a2w / (PI * pow(NoH * NoH * (a2w - 1.0) + 1.0, 2.0));
      float FsW = 0.02 + 0.98 * pow(1.0 - max(dot(Hw, Vw), 0.0), 5.0);
      reflectedLight.directSpecular += uSunIrr * tShadow * Dw * FsW * NoL / (4.0 * NoVw * max(NoL, 1e-3) + 1e-3) * tGloss;
    }
    reflectedLight.indirectDiffuse *= 1.0 - Fw * tGloss;
    reflectedLight.directDiffuse *= 1.0 - Fw * tGloss;
  }
`;

// Labels for the measuring tool: class (sand 3, rock 4, ground cover 5) and whether the sun
// reaches it.
export const TERRAIN_LABEL = /* glsl */ `
#ifdef TERRAIN_DEBUG
  // Debug views (terrainDebug= on the page): 1 sun shadow, 2 sky share, 3 overhang horizon,
  // 4 lit ground share, 5 carved depth / 32 m.
  {
    float d = TERRAIN_DEBUG == 1 ? tShadow : TERRAIN_DEBUG == 2 ? vRock.y : TERRAIN_DEBUG == 3 ? vHorizon.x : TERRAIN_DEBUG == 4 ? vRock.w : vRock.z;
    gl_FragColor = vec4(vec3(d), 1.0);
  }
#endif
#ifdef LABELS
  {
    float cls = tSandW > 0.5 ? 3.0 : (tVegW > 0.5 ? 5.0 : 4.0);
    float lit = tShadow * max(dot(tNormalW, uSunDirW), 0.0) > 0.3 ? 1.0 : 0.0;
    float dist = log2(max(distance(vWorldPos, cameraPosition), 1.0)) / 20.0;
    gl_FragColor = vec4(cls / 255.0, dist, lit, 1.0);
  }
#endif
`;

// The normal comes from the scanned maps, already in world space.
export const TERRAIN_NORMAL = /* glsl */ `
  normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);
`;
