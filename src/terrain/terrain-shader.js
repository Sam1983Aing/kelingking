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
      float sandW = smoothstep(0.4, 0.75, D.b) * (1.0 - smoothstep(uBeachTop, uBeachTop + 3.0, D.r));
      vec3 alb = mix(mix(uBounceAlb[2], uBounceAlb[1], sandW), uBounceAlb[0], sea);
      float lit = bakedShadow(vec3(q.x, max(D.r, 0.0) + 0.3, -q.y), 0.3);
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
  vec3 w = pow(abs(N), vec3(4.0));
  w /= w.x + w.y + w.z;
  w = max(w - 0.03, 0.0);
  triW = w / (w.x + w.y + w.z);

  // ---------------------------------------------------------------- where is what
  float sandZone = smoothstep(0.4, 0.75, D.b);
  // Under an overhang, dry ground out past the drip line means the rock stands on a beach,
  // whatever the zones say.
  if (carveM > 0.3) sandZone = max(sandZone, smoothstep(1.0, 2.0, D.r));
  float sand = sandZone * smoothstep(0.55, 0.8, up) * (1.0 - smoothstep(uBeachTop + 0.8, uBeachTop + 3.5, h + (n1 - 0.5) * 2.0));
  sand = max(sand, smoothstep(0.2, -0.4, h) * sandZone);
  sand = max(sand, vRock.x);   // the floor running in under an overhang

  // Ground cover on anything short of a sheer face, and in clumps along the ledges.
  float veg = smoothstep(0.3, 0.46, up + (n1 - 0.5) * 0.25);
  // (v7: no longer painted. The plants on the ledges are real now, src/veg/scatter.js.)
  veg *= 1.0 - smoothstep(0.6, 2.5, carveM);   // nothing grows under an overhang
  veg *= smoothstep(5.0, 11.0, h + (n1 - 0.5) * 6.0);   // salt spray keeps the foot bare
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
        // A margin of about zero is the face just below, tangent to the sun: lit. (Centring
        // the soft edge on zero left every face half in shadow.)
        tFineShadow = mix(1.0, 1.0 - smoothstep(0.01, 0.01 + 2.0 * soft, margin), wallF);
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
    float under = smoothstep(0.8, 5.0, carveM) * sandZone * (1.0 - smoothstep(18.0, 30.0, h));
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
    float trample = (1.0 - firm) * smoothstep(0.3, 0.62, 0.65 * tn(g * 0.09 + 5.3) + 0.35 * tn(g * 0.21 + 1.1) + 0.12 * (n1 - 0.5));
    Surf sd = Surf(uSandAlb, vec3(0.0), 0.92, 1.0);
    // Tone: broad patches, drift lines of paler sand, and the pinkish grains of the
    // foraminifera sorted into streaks.
    float tone = (n2 - 0.5) * 0.08 + (tn(g * 0.31 + 1.7) - 0.5) * 0.05;
    sd.color *= 1.0 + tone;
    sd.color *= mix(vec3(1.0), vec3(1.035, 0.985, 0.95), smoothstep(0.55, 0.8, tn(vec2(g.x * 0.05, g.y * 0.2) + 8.0)));
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
      a.dn *= mix(0.35, 1.0, trample);
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
      float grit = 1.0 - smoothstep(-0.5, 3.5, fd);
      if (grit > 0.01 && fp < 0.08) {
        vec2 gc = g * 16.0;
        vec2 ci = floor(gc);
        float r = th12(ci);
        vec2 off = vec2(th12(ci + 17.1), th12(ci + 3.7)) * 0.6 + 0.2;
        float dist = length(fract(gc) - off);
        float size = 0.12 + 0.3 * th12(ci + 9.3);
        float stone = (1.0 - smoothstep(size * 0.7, size, dist)) * step(1.0 - grit * 0.55, r) * smoothstep(0.08, 0.03, fp);
        vec3 stoneCol = uGain[L_LIMESTONE] * mix(vec3(0.3, 0.28, 0.25), vec3(0.62, 0.6, 0.55), th12(ci + 5.5));
        sd.color = mix(sd.color, stoneCol, stone);
        sd.dn += vec3(fract(gc) - off, 0.0).xzy * vec3(1.0, 0.0, -1.0) * stone * 2.5;
        sd.ao *= 1.0 - 0.35 * (1.0 - smoothstep(size, size * 1.6, dist)) * step(1.0 - grit * 0.55, r) * (1.0 - stone);
      }
      sd.color *= mix(vec3(1.0), vec3(0.97, 0.94, 0.9), grit * 0.6);
      sd.color *= mix(vec3(1.0), vec3(0.82, 0.8, 0.78), vRock.x);
    }
    // Wet sand: water in the pores, darker and a little more saturated.
    tWet = wetS * sand;
    sd.color *= mix(vec3(1.0), uWetTint, wetS);
    sd.rough = mix(sd.rough, 0.45, wetS);
    mixSurf(s, sd, sand);
  }

  tNormalW = normalize(N + s.dn * 0.9);
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
