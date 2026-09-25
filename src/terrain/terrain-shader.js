// GLSL for the ground: scanned limestone, sand and scrub ground (Poly Haven, CC0), mapped
// from three directions so steep faces do not smear, with a little procedural variation on
// top to break up the tiling. Also reads the data texture shared with the sea
// (R = ground height, G = metres offshore, B = beach weight).
// World coordinates: x = east, y = up, z = south. Map coordinates g = (x, -z) = (east, north).

import { SUN_SHADOW_GLSL } from './sun-shadow.js';
import { STRATA, SHADOW_ROWS } from './strata.js';

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
uniform vec3 uGain[5];
uniform float uTile[5];
uniform sampler2D uStrataA;
uniform sampler2D uStrataB;
uniform sampler2D uStrataC;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
// From the mesh builder: sand under an overhang, share of the sky not hidden by rock
// overhead, how far the face is carved in (/ 32 m), and whether it stands on sand.
varying vec4 vRock;

#define L_LIMESTONE 0
#define L_BEDS 1
#define L_WET 2
#define L_SAND 3
#define L_GROUND 4

${SUN_SHADOW_GLSL}

// Filled in while working out the surface, used later by the lighting.
float tShadow = 1.0;
float tAO = 1.0;
float tRough = 0.9;
vec3 tNormalW = vec3(0.0, 1.0, 0.0);
float tSandW = 0.0;   // how much of this pixel is sand, and ground cover (for the labels)
float tVegW = 0.0;
float tFineShadow = 1.0;   // shadow of the ledges above, on a bedded face

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
  return bakedShadow(P + N * (0.6 + 3.0 * (1.0 - abs(N.y))), 0.3);
}

uniform vec3 uBounceAlb[3];   // what the ground below sends back: sea, sand, land (albedo)

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
    vec2 hz = vec2(N.x, -N.z);
    float lh = length(hz);
    vec2 q = vec2(P.x, -P.z) + (lh > 1e-3 ? hz / lh : vec2(0.0)) * (vRock.z * 32.0 + 4.0);
    vec4 D = tData(q);
    float sea = smoothstep(-0.5, 1.0, D.g);
    float sandW = smoothstep(0.4, 0.75, D.b) * (1.0 - smoothstep(uBeachTop, uBeachTop + 3.0, D.r));
    vec3 alb = mix(mix(uBounceAlb[2], uBounceAlb[1], sandW), uBounceAlb[0], sea);
    float lit = bakedShadow(vec3(q.x, max(D.r, 0.0) + 0.3, -q.y), 0.3);
    vec3 E = uSunIrr * max(uSunDirW.y, 0.0) * lit + uSkyUp;
    return alb * E * vRock.w;
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

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }
float luma(vec3 c) { return dot(c, vec3(0.2126, 0.7152, 0.0722)); }

vec3 terrainSurface(vec3 P, vec3 N, float fp) {
  vec2 g = vec2(P.x, -P.z);
  float h = P.y;
  float up = N.y;
  vec4 D = tData(g);
  float n1 = tfbm(g * 0.07, 14.0, fp);
  float n2 = tfbm(g * 0.021 + 9.1, 48.0, fp);

  // Triplanar frame.
  triP = P; triDx = dFdx(P); triDy = dFdy(P);
  // Where this point sits in the stack of beds, and how that changes across the pixel (for
  // explicit texture gradients: the reads below sit inside branches).
  float bc = h + strataWarp(g);
  float su = (bc - STRATA_Z0) / STRATA_SPAN;
  vec2 sdx = vec2(dFdx(su), 0.0), sdy = vec2(dFdy(su), 0.0);
  float fpz = max(abs(sdx.x), abs(sdy.x)) * STRATA_SPAN;   // pixel footprint up the stack (m)
  float wallF = 1.0 - smoothstep(0.35, 0.72, up);            // how much this is a face
  vec4 SA = vec4(0.0, 0.0, 1.0, 0.5), SB = vec4(0.0, 0.5, 0.0, 0.0);
  if (wallF > 0.01) {
    SA = textureGrad(uStrataA, vec2(su, 0.5), sdx, sdy);
    SB = textureGrad(uStrataB, vec2(su, 0.5), sdx, sdy);
  }
  float carveM = vRock.z * 32.0;                              // metres carved in
  vec3 w = pow(abs(N), vec3(4.0));
  w /= w.x + w.y + w.z;
  w = max(w - 0.03, 0.0);
  triW = w / (w.x + w.y + w.z);

  // ---------------------------------------------------------------- where is what
  float sandZone = smoothstep(0.4, 0.75, D.b);
  float sand = sandZone * smoothstep(0.55, 0.8, up) * (1.0 - smoothstep(uBeachTop + 0.8, uBeachTop + 3.5, h + (n1 - 0.5) * 2.0));
  sand = max(sand, smoothstep(0.2, -0.4, h) * sandZone);
  sand = max(sand, vRock.x);   // the floor running in under an overhang

  // Ground cover on anything short of a sheer face, and in clumps along the ledges.
  float veg = smoothstep(0.3, 0.46, up + (n1 - 0.5) * 0.25);
  float wx = abs(N.x), wz = abs(N.z);
  float along = (wx * P.z - wz * P.x) / max(wx + wz, 1e-3);
  float clump = tfbm(vec2(along * 0.06, h * 0.32) + g * 0.02, 6.0, fp);
  // Clumps along the ledges, which are the tops of the hard beds.
  float ledges = smoothstep(0.6, 0.7, clump + (n1 - 0.5) * 0.12 + (SB.g - 0.5) * 0.25) * smoothstep(10.0, 40.0, h) * 0.95;
  veg = max(veg, ledges);
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
    float m = strataStrength(g) * wallF;
    a.color *= mix(1.0, SA.b, 0.9 * wallF);
    a.color *= mix(vec3(1.0), mix(vec3(0.95, 0.985, 1.03), vec3(1.05, 1.0, 0.9), SA.a), 0.85 * wallF);
    a.color *= 1.0 - 0.28 * SB.b * m;
    a.dn += vec3(0.0, -clamp(SA.g, -3.0, 3.0) * m * 0.8, 0.0);
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
        tFineShadow = mix(1.0, 1.0 - smoothstep(-soft, soft, margin), wallF);
      }
    }

    // Runoff streaks down the faces, greyer and darker.
    float streak = tfbm(vec2(along * 0.25, h * 0.018), 6.0, fp);
    a.color = mix(a.color, a.color * vec3(0.7, 0.71, 0.72), smoothstep(0.5, 0.85, streak) * 0.55);
    // Under the overhangs on the beach the rock is stained ochre and brown.
    float under = smoothstep(0.8, 5.0, carveM) * vRock.w * (1.0 - smoothstep(18.0, 30.0, h));
    a.color = mix(a.color, a.color * vec3(1.02, 0.78, 0.52), under * 0.75);
    // The wave-cut notch and the dark wet band at the waterline, from the wet rock scan.
    if (notch > 0.0) {
      Surf wr = triplanar(L_WET, uTile[L_WET], vec2(0.0));
      mixSurf(a, wr, max(notch * 0.6, algae));
      a.color *= 1.0 - 0.4 * algae;
      a.rough = mix(a.rough, 0.35, algae);
    }
    s = a;
  }

  // ---------------------------------------------------------------- ground under the plants
  if (veg > 0.001) {
    Surf gr = triplanar(L_GROUND, uTile[L_GROUND], vec2(0.0));
    Surf g2 = triplanar(L_GROUND, uTile[L_GROUND] * 3.1, vec2(0.61, 0.13));
    mixSurf(gr, g2, smoothstep(0.35, 0.65, n2));
    // Field-scale cover: darker, greener forest patches, brighter grass, the odd dry patch.
    float cover = tfbm(g * 0.009 + 3.7, 110.0, fp);
    gr.color *= mix(vec3(1.0), vec3(0.55, 0.72, 0.5), smoothstep(0.52, 0.68, cover));
    gr.color *= mix(vec3(1.0), vec3(1.25, 1.2, 1.1), smoothstep(0.42, 0.3, cover));
    gr.color = mix(gr.color, gr.color * vec3(1.35, 1.1, 0.9), smoothstep(0.64, 0.8, n2) * 0.5);
    mixSurf(s, gr, veg);
  }

  // ---------------------------------------------------------------- sand
  if (sand > 0.001) {
    Surf sd = triplanar(L_SAND, uTile[L_SAND], vec2(0.0));
    Surf s2 = triplanar(L_SAND, uTile[L_SAND] * 0.31, vec2(0.21, 0.83));   // finer grain up close
    mixSurf(sd, s2, 0.5 * detail);
    sd.color *= mix(vec3(1.0), vec3(0.62, 0.6, 0.58), wet);
    sd.rough = mix(sd.rough, 0.3, wet);
    mixSurf(s, sd, sand);
  }

  tNormalW = normalize(N + s.dn * 0.9);
  tRough = clamp(s.rough, 0.2, 1.0);
  tAO = s.ao;
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
  tShadow = groundShadow(vWorldPos, tN) * tFineShadow;
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
`;

// Labels for the measuring tool: class (sand 3, rock 4, ground cover 5) and whether the sun
// reaches it.
export const TERRAIN_LABEL = /* glsl */ `
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
