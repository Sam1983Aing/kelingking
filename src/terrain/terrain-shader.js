// GLSL for the ground: limestone, scrub and sand, all procedural, fed by the same data
// texture as the sea (R = ground height, G = metres offshore, B = beach weight).
// Local coordinates are metres, x = east, y = north, h = height (world y).
//
// Everything that has a scale smaller than a pixel is faded out by the pixel footprint
// `fp` (metres per pixel), so the same shader holds up at your feet and from 1 km up.

import { SUN_SHADOW_GLSL } from './sun-shadow.js';

export const TERRAIN_PARS = /* glsl */ `
uniform sampler2D uData;
uniform vec3 uExtent;
uniform vec3 uSunDirW;
uniform float uContours;
uniform float uClay;
uniform float uBeachTop;
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

// Filled in while working out the colour, used later by the lighting.
float tShadow = 1.0;
float tAO = 1.0;
float tBump = 0.0;
float tRough = 0.9;

// Hash from Dave Hoskins, "Hash without Sine" (MIT).
float th12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 th22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float tn(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(th12(i), th12(i + vec2(1.0, 0.0)), u.x), mix(th12(i + vec2(0.0, 1.0)), th12(i + vec2(1.0, 1.0)), u.x), u.y);
}
// fbm whose octaves fade out once they are smaller than a couple of pixels.
// Octaves get smaller as they go, so the first one that is gone means all the rest are.
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

${SUN_SHADOW_GLSL}

vec4 tData(vec2 g) {
  vec2 uv = (g - uExtent.xy) / uExtent.z;
  vec4 d = texture2D(uData, clamp(uv, 0.0, 1.0));
  float e = min(min(uv.x, uv.y), min(1.0 - uv.x, 1.0 - uv.y));
  return mix(vec4(-45.0, 900.0, 0.0, 0.0), d, smoothstep(0.0, 0.02, e));
}

// Sun shadow from the baked shadow heights (sun-shadow.js). The sample point is pushed out
// of steep faces a little, so a face that looks at the sun does not read its own column.
float groundShadow(vec3 P, vec3 N) {
#ifdef SKIP_SHADOW
  return 1.0;
#endif
  if (dot(N, uSunDirW) < -0.05) return 0.0;   // facing away, the lighting is dark anyway
  return bakedShadow(P + N * (0.6 + 3.0 * (1.0 - abs(N.y))), 0.3);
}

// Crowns: jittered cells (size) metres across. Returns crown height 0..1 and the
// plant's own random value in id.
float crowns(vec2 g, float size, out float id) {
  vec2 p = g / size;
  vec2 ip = floor(p), fp = fract(p);
  float d1 = 9.0; id = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 c = vec2(float(i), float(j));
    vec2 o = th22(ip + c);
    float r = 0.7 + 0.5 * o.x;                    // bushes come in different sizes
    float d = length(c + o - fp) / r;
    if (d < d1) { d1 = d; id = th12(ip + c + 5.7); }
  }
  return 1.0 - smoothstep(0.1, 0.95, d1);
}

vec3 lin(vec3 c) { return pow(c, vec3(2.2)); }

vec3 terrainSurface(vec3 P, vec3 N, float fp) {
#ifdef SKIP_SURFACE
  return vec3(0.5);
#endif
  vec2 g = vec2(P.x, -P.z);
  float h = P.y;
  float up = N.y;
  vec4 D = tData(g);
  float n1 = tfbm(g * 0.07, 14.0, fp);
  float n2 = tfbm(g * 0.021 + 9.1, 48.0, fp);

  // ---------------------------------------------------------------- where is what
  float sandZone = smoothstep(0.4, 0.75, D.b);
  float sand = sandZone * smoothstep(0.55, 0.8, up) * (1.0 - smoothstep(uBeachTop + 0.8, uBeachTop + 3.5, h + (n1 - 0.5) * 2.0));
  sand = max(sand, smoothstep(0.2, -0.4, h) * sandZone);

  // Scrub grows on anything that is not close to vertical, ragged at the edge.
  // The flanks of the finger are 60 to 70 degrees and still fully covered, so only the
  // sheer faces are bare.
  float veg = smoothstep(0.3, 0.46, up + (n1 - 0.5) * 0.25);
  // It also clings to ledges on the faces, more so higher up, in clumps.
  float wx = abs(N.x), wz = abs(N.z);
  float along = (wx * P.z - wz * P.x) / max(wx + wz, 1e-3);
  // On the faces it hangs off the ledges, so the clumps are stretched along the bedding.
  float clump = tfbm(vec2(along * 0.06, h * 0.32) + g * 0.02, 6.0, fp);
  float ledges = smoothstep(0.6, 0.7, clump + (n1 - 0.5) * 0.12) * smoothstep(10.0, 40.0, h) * 0.95;
  veg = max(veg, ledges);
  // Salt spray keeps the rock bare near the sea, and nothing grows on the beach.
  veg *= smoothstep(5.0, 11.0, h + (n1 - 0.5) * 6.0);
  veg *= 1.0 - sand;

  // Each material is only worked out where it shows. Screen-space derivatives are not
  // reliable inside a branch, so everything that needs fwidth is computed first.
  float detail = smoothstep(1.5, 0.3, fp);
  float L = h / 1.5 + 1.4 * tn(vec2(h * 0.12, 1.7)) + 0.4 * tn(vec2(h * 0.35, 5.3)) + (tfbm(g * 0.012, 80.0, fp) - 0.5) * 3.0;
  float wL = fwidth(L);
  float bedI = floor(L);
  float bed = th12(vec2(bedI, 3.3));
  float jx = along / (2.5 + 2.0 * th12(vec2(bedI, 1.1))) + bed * 7.0;
  float wJ = fwidth(jx);
  float sea = 1.0 - sandZone;
  float notch = sea * (1.0 - smoothstep(4.5, 6.5, h + (n1 - 0.5) * 2.0));
  float wet = smoothstep(1.1, 0.35, h) * sandZone;

  vec3 rock = vec3(0.0), plant = vec3(0.0), beach = vec3(0.0);
  float rockBump = 0.0, plantBump = 0.0, sandBump = 0.0, gaps = 1.0;

  // ---------------------------------------------------------------- limestone
#ifdef SKIP_ROCK
  if (false) {
#else
  if (veg < 0.999 && sand < 0.999) {
#endif
    // Beds of uneven thickness (about 1 to 3 m), gently warped across the island. Each has
    // its own shade. Only some boundaries show a parting, and a parting is a soft groove,
    // faded out once it is thinner than a pixel.
    float fl = fract(L);
    float edge = min(fl, 1.0 - fl);
    // A bed only shows as a ledge in stretches along the face: it erodes unevenly.
    float stretch = smoothstep(0.35, 0.65, tn(vec2(along * 0.07, bedI * 3.1)));
    float shows = step(0.45, th12(vec2(bedI, 8.1))) * stretch;
    float parting = (1.0 - smoothstep(0.0, max(0.07, wL * 1.5), edge)) * shows;
    parting *= 1.0 - smoothstep(0.06, 0.2, wL);
    // Blocks and joints on the face: vertical cracks every few metres, offset bed by bed.
    float joint = (1.0 - smoothstep(0.0, max(0.05, wJ * 1.5), min(fract(jx), 1.0 - fract(jx)))) * step(0.35, th12(vec2(floor(jx), bedI)));
    joint *= (1.0 - smoothstep(0.04, 0.12, wJ)) * smoothstep(0.35, 0.15, up);
    float pits = tfbm(vec2(along, h) * 0.9, 1.1, fp);
    // Crags: ridged noise a few metres across, which is what the face looks like up close.
    float crag = 1.0 - abs(2.0 * tfbm(vec2(along * 0.3, h * 0.42) + 4.2, 3.0, fp) - 1.0);
    // Grey runoff streaks down the faces, and dark lichen.
    float streak = tfbm(vec2(along * 0.25, h * 0.018), 6.0, fp);
    float lichen = smoothstep(0.58, 0.78, tfbm(vec2(along * 0.12, h * 0.1) + g * 0.03, 8.0, fp));

    rock = mix(lin(vec3(0.70, 0.68, 0.62)), lin(vec3(0.89, 0.87, 0.81)), 0.3 + 0.7 * bed);
    rock *= (0.86 + 0.28 * pits) * mix(1.0, 0.72 + 0.36 * crag, detail);
    rock *= 1.0 - 0.22 * parting - 0.3 * joint;
    rock = mix(rock, lin(vec3(0.54, 0.53, 0.49)), smoothstep(0.45, 0.8, streak) * 0.5);
    rock = mix(rock, lin(vec3(0.36, 0.35, 0.30)), lichen * 0.5);
    // Ochre staining over the undercut at the back of the beach.
    float ochre = sandZone * smoothstep(uBeachTop, uBeachTop + 3.0, h) * (1.0 - smoothstep(uBeachTop + 9.0, uBeachTop + 16.0, h));
    rock = mix(rock, lin(vec3(0.62, 0.45, 0.27)), ochre * (0.45 + 0.4 * n1));
    // The wave-cut notch and the algae line at the waterline, on the rock coasts.
    float algae = sea * (1.0 - smoothstep(0.8, 1.8, h + (n1 - 0.5)));
    rock = mix(rock, lin(vec3(0.24, 0.19, 0.14)), notch * 0.9);
    rock = mix(rock, lin(vec3(0.11, 0.12, 0.09)), algae * 0.85);
    // Relief must be continuous: a step in the bump turns into a row of dashes once it is
    // differentiated per 2x2 pixel block. Each bed is a slightly proud ledge instead, back
    // to zero at both of its edges.
    float ledge = smoothstep(0.0, 0.22, fl) * (1.0 - smoothstep(0.8, 1.0, fl)) * (1.0 - smoothstep(0.08, 0.25, wL));
    rockBump = (ledge * (0.05 + 0.1 * bed) * shows + crag * 0.55 + pits * 0.3) * detail;
  }

  // ---------------------------------------------------------------- scrub
#ifdef SKIP_PLANT
  if (false) {
#else
  if (veg > 0.001) {
#endif
    // Land cover at the scale of a field: dark forest, mid scrub, bright grassy scrub and
    // the odd bare brown patch, like the plateau in the drone photo.
    float cover = tfbm(g * 0.009 + 3.7, 110.0, fp);
    float forest = smoothstep(0.52, 0.68, cover);
    float grass = smoothstep(0.42, 0.3, cover);
    float crownKeep = smoothstep(0.6, 0.15, fp);          // bush crowns fade out beyond a few hundred m
    float treeKeep = smoothstep(2.5, 0.8, fp) * forest;   // 5 to 8 m trees in the forest patches
    float leafKeep = smoothstep(0.08, 0.02, fp);          // leaves only right up close
    float bushId = 0.0, crown = 0.0, treeId = 0.0, tree = 0.0, leaves = 0.5;
    if (crownKeep > 0.0) crown = crowns(g, 1.8, bushId);
    if (treeKeep > 0.0) tree = crowns(g + 31.0, 6.5, treeId);
    if (leafKeep > 0.0) leaves = tn(g * 4.3) * 0.6 + tn(g * 9.1 + 2.0) * 0.4;
    float cluster = tfbm(g * 0.14, 7.0, fp);               // clumps of bushes, 5 to 10 m
    float tone = mix(cluster, bushId, crownKeep * 0.6) + (leaves - 0.5) * 0.35 * leafKeep;
    vec3 dark = lin(vec3(0.13, 0.21, 0.07)), mid = lin(vec3(0.28, 0.38, 0.11)), light = lin(vec3(0.49, 0.56, 0.19));
    plant = mix(dark, mid, smoothstep(0.25, 0.75, tone));
    plant = mix(plant, light, smoothstep(0.7, 0.95, tone) * 0.7);
    plant = mix(plant, dark * 0.85, forest * 0.6);
    plant = mix(plant, mix(dark * 0.7, mid * 1.1, treeId), treeKeep * 0.6);
    plant = mix(plant, lin(vec3(0.52, 0.56, 0.27)), grass * 0.55);
    plant = mix(plant, lin(vec3(0.50, 0.42, 0.27)), smoothstep(0.64, 0.8, n2) * 0.5);   // drier, bare patches
    gaps = mix(0.72, mix(0.42, 1.0, crown), crownKeep);
    gaps *= mix(1.0, mix(0.5, 1.0, tree), treeKeep);
    gaps = mix(gaps, 0.85, grass * 0.6);
    plantBump = (crown * 0.9 * crownKeep + cluster * 1.2 + leaves * 0.12 * leafKeep) * (1.0 - grass * 0.6) + forest * cluster * 1.5 + tree * 3.0 * treeKeep;
  }

  // ---------------------------------------------------------------- sand
  if (sand > 0.001) {
    beach = mix(lin(vec3(0.94, 0.91, 0.84)), lin(vec3(0.68, 0.63, 0.54)), wet);
    beach *= 0.94 + 0.06 * tn(g * 1.7);
    sandBump = tn(g * 0.6 + vec2(0.0, h)) * 0.05 * detail;
  }

  // ---------------------------------------------------------------- mix
  vec3 col = rock;
  tBump = rockBump;
  tRough = 0.85;
  tAO = 1.0 - 0.35 * notch;
  col = mix(col, plant, veg);
  tBump = mix(tBump, plantBump, veg);
  tRough = mix(tRough, 0.92, veg);
  tAO = mix(tAO, gaps, veg);
  col = mix(col, beach, sand);
  tBump = mix(tBump, sandBump, sand);
  tRough = mix(tRough, mix(0.95, 0.35, wet), sand);
  tAO = mix(tAO, 1.0, sand);

  if (uClay > 0.5) { col = lin(vec3(0.74, 0.72, 0.68)); tBump = 0.0; tAO = 1.0; tRough = 0.93; }

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
`;

// Bump from the procedural relief, by screen-space derivatives (surface gradient method).
export const TERRAIN_NORMAL = /* glsl */ `
#ifndef SKIP_BUMP
  {
    vec3 Nw = normalize(vWorldNormal);
    vec3 dpdx = dFdx(vWorldPos), dpdy = dFdy(vWorldPos);
    float bx = dFdx(tBump), by = dFdy(tBump);
    vec3 r1 = cross(dpdy, Nw), r2 = cross(Nw, dpdx);
    float det = dot(dpdx, r1);
    vec3 grad = sign(det) * (bx * r1 + by * r2);
    vec3 Nb = normalize(abs(det) * Nw - grad);
    normal = normalize((viewMatrix * vec4(Nb, 0.0)).xyz);
  }
#endif
`;
