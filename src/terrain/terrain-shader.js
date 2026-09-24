// GLSL for the ground: scanned limestone, sand and scrub ground (Poly Haven, CC0), mapped
// from three directions so steep faces do not smear, with a little procedural variation on
// top to break up the tiling. Also reads the data texture shared with the sea
// (R = ground height, G = metres offshore, B = beach weight).
// World coordinates: x = east, y = up, z = south. Map coordinates g = (x, -z) = (east, north).

import { SUN_SHADOW_GLSL } from './sun-shadow.js';

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
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

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
vec3 tBounce = vec3(0.0);   // light bounced up from the ground below (irradiance)



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
  float down = 0.5 * (1.0 - N.y);
  if (down < 0.02) return vec3(0.0);
  vec2 g = vec2(P.x, -P.z);
  vec2 hz = vec2(N.x, -N.z);
  float lh = length(hz);
  float here = tData(g).r;
  float above = max(P.y - max(here, 0.0), 0.0);
  vec2 q = g + (lh > 1e-3 ? hz / lh : vec2(0.0)) * clamp(above * 0.7 + 2.0, 2.0, 60.0);
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
  vec3 w = pow(abs(N), vec3(4.0));
  w /= w.x + w.y + w.z;
  w = max(w - 0.03, 0.0);
  triW = w / (w.x + w.y + w.z);

  // ---------------------------------------------------------------- where is what
  float sandZone = smoothstep(0.4, 0.75, D.b);
  float sand = sandZone * smoothstep(0.55, 0.8, up) * (1.0 - smoothstep(uBeachTop + 0.8, uBeachTop + 3.5, h + (n1 - 0.5) * 2.0));
  sand = max(sand, smoothstep(0.2, -0.4, h) * sandZone);

  // Ground cover on anything short of a sheer face, and in clumps along the ledges.
  float veg = smoothstep(0.3, 0.46, up + (n1 - 0.5) * 0.25);
  float wx = abs(N.x), wz = abs(N.z);
  float along = (wx * P.z - wz * P.x) / max(wx + wz, 1e-3);
  float clump = tfbm(vec2(along * 0.06, h * 0.32) + g * 0.02, 6.0, fp);
  float ledges = smoothstep(0.6, 0.7, clump + (n1 - 0.5) * 0.12) * smoothstep(10.0, 40.0, h) * 0.95;
  veg = max(veg, ledges);
  veg *= smoothstep(5.0, 11.0, h + (n1 - 0.5) * 6.0);   // salt spray keeps the foot bare
  veg *= 1.0 - sand;
  tSandW = sand;
  tVegW = veg;

  float sea = 1.0 - sandZone;
  float notch = sea * (1.0 - smoothstep(4.5, 6.5, h + (n1 - 0.5) * 2.0));
  float algae = sea * (1.0 - smoothstep(0.8, 1.8, h + (n1 - 0.5)));
  float ochre = sandZone * smoothstep(uBeachTop, uBeachTop + 3.0, h) * (1.0 - smoothstep(uBeachTop + 9.0, uBeachTop + 16.0, h));
  float wet = smoothstep(1.1, 0.35, h) * sandZone;
  float detail = smoothstep(0.6, 0.15, fp);               // close-range layers fade out by here

  Surf s = Surf(vec3(0.5), vec3(0.0), 0.85, 1.0);

  // ---------------------------------------------------------------- limestone
  if (veg < 0.999 && sand < 0.999) {
    // Grey-white fractured limestone, sampled at two scales with offset tiles so the 16 m
    // tile does not repeat visibly across a 100 m face.
    Surf a = triplanar(L_LIMESTONE, uTile[L_LIMESTONE], vec2(0.0));
    Surf b = triplanar(L_LIMESTONE, uTile[L_LIMESTONE] * 2.7, vec2(0.37, 0.71));
    mixSurf(a, b, smoothstep(0.35, 0.65, n2));
    // Bedding relief from the layered scan: its shading and normals, not its colour, except
    // for the ochre stain over the beach undercut where its colour is the point.
    if (detail > 0.0) {
      Surf beds = triplanar(L_BEDS, uTile[L_BEDS], vec2(0.0));
      float lb = luma(beds.color) / luma(uGain[L_BEDS] * lin(vec3(0.482, 0.322, 0.194)));
      a.color *= mix(1.0, clamp(lb, 0.55, 1.35), 0.55 * detail);
      a.dn += beds.dn * 0.8 * detail;
      a.ao *= mix(1.0, beds.ao, 0.6 * detail);
      a.color = mix(a.color, beds.color, ochre * 0.7);
    }
    // Large-scale variation the tiles cannot give: some beds brighter than others, grey
    // runoff streaks down the faces.
    float L = h / 1.9 + 1.4 * tn(vec2(h * 0.1, 1.7)) + (tfbm(g * 0.012, 80.0, fp) - 0.5) * 3.0;
    a.color *= 0.9 + 0.2 * th12(vec2(floor(L), 3.3));
    float streak = tfbm(vec2(along * 0.25, h * 0.018), 6.0, fp);
    a.color = mix(a.color, a.color * vec3(0.72, 0.73, 0.74), smoothstep(0.5, 0.85, streak) * 0.6);
    // The wave-cut notch and the dark wet band at the waterline, from the wet rock scan.
    if (notch > 0.0) {
      Surf wr = triplanar(L_WET, uTile[L_WET], vec2(0.0));
      mixSurf(a, wr, max(notch * 0.75, algae));
      a.color *= 1.0 - 0.35 * algae;
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
  tShadow = groundShadow(vWorldPos, tN);
  tBounce = groundBounce(vWorldPos, tNormalW);
`;

// Labels for the measuring tool: class (sand 3, rock 4, ground cover 5) and whether the sun
// reaches it.
export const TERRAIN_LABEL = /* glsl */ `
  if (uLabel > 0.5) {
    float cls = tSandW > 0.5 ? 3.0 : (tVegW > 0.5 ? 5.0 : 4.0);
    float lit = tShadow * max(dot(tNormalW, uSunDirW), 0.0) > 0.3 ? 1.0 : 0.0;
    float dist = log2(max(distance(vWorldPos, cameraPosition), 1.0)) / 20.0;
    gl_FragColor = vec4(cls / 255.0, dist, lit, 1.0);
  }
`;

// The normal comes from the scanned maps, already in world space.
export const TERRAIN_NORMAL = /* glsl */ `
  normal = normalize((viewMatrix * vec4(tNormalW, 0.0)).xyz);
`;
