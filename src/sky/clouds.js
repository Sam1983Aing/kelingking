// Fair-weather cumulus over a tropical sea (v9): scattered puffs to towering cumulus a few
// kilometres across, in clusters, with a low bank of flatter cloud toward the horizon and a
// thin high veil, as on the photo day (the `eastCove` photo: one big cumulus close over the
// cliff, a band of small cloud on the horizon; the aerial photo from the sea: broken cloud
// with grey bases).
//
// Shape. A weather map (made once, on the CPU) places each cloud as a cluster of round
// blobs: how much cloud (R) and how tall it grows (G); its third channel is a field of flat
// sheets for the bank, which only counts far out (B). A cloud fills its column from a flat
// base up to a rounded top. Its body is Perlin-Worley billow noise; finer Worley noise eats
// into the edges, as billows toward the top and as wisps toward the base, and churns slowly
// upward so the edges boil while the clouds drift.
//
// Light. Sunlight inside a cloud: a short march toward the sun (five steps, each twice the
// last) for the depth of cloud in the way, then Beer's law in three octaves of multiple
// scattering, plus light diffused through the cloud so a thick sunlit face glows white. The
// "powder" term darkens the thin outer shell where light has entered but not yet scattered
// back out; the forward lobe of the phase gives the silver edge toward the sun. Sky light
// from above, a little sea light from below, less of both deep inside. The same haze as
// everything else sits in front of each cloud.
//
// Cost. Marched at half resolution for the sky only, into a texture the sky dome blends in.
// On the scrolling page the clock always runs, so the clouds would be marched every frame:
// there only one pixel in sixteen is marched each frame (a 4 x 4 Bayer cycle), and the others
// are carried over from the last frame, moved for the camera and the drift (a resolve pass).
// A still view, a jump, a new size or new settings get a whole march. The field stays still
// unless the clock runs (the clouds drift with the wind).

import * as THREE from 'three';
import { ATMO_PARS, AP_LAYOUT, TRANS_LOOKUP, AERIAL_FN } from './atmosphere-glsl.js';

export const CLOUD_DEFAULTS = {
  coverage: 0.28,     // how much of the sky over the sea has cloud, before the clusters
  base: 0.75,         // km
  top: 3.2,           // km, the tallest a cumulus gets
  density: 60,        // extinction inside a cloud, per km
  period: 48,         // km before the weather map repeats
  clearRadius: 1.5,   // km around the head kept clear, so the island stays in sun (the photo
                      // day had a big cumulus about 3 km east of the viewpoint)
  bank: 0.35,         // how much of the far sea the low bank covers
  high: 0.5,          // the thin high veil (0 none)
  windHeading: 290,   // compass degrees the clouds drift toward
  windSpeed: 0.006,   // km per second (6 m/s)
  seed: 7,
};

const WEATHER_SIZE = 1024;
const SHAPE_SIZE = 64, DETAIL_SIZE = 32;

// ---------------------------------------------------------------- weather map (CPU)

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Tileable 2D value noise on an n x n lattice, smooth, 0..1.
function valueNoise2(rand, n) {
  const g = new Float32Array(n * n);
  for (let i = 0; i < g.length; i++) g[i] = rand();
  return (u, v) => {
    const x = u * n, y = v * n;
    const i = Math.floor(x), j = Math.floor(y);
    const fx = x - i, fy = y - j;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const at = (a, b) => g[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
    const a = at(i, j) + (at(i + 1, j) - at(i, j)) * sx;
    const b = at(i, j + 1) + (at(i + 1, j + 1) - at(i, j + 1)) * sx;
    return a + (b - a) * sy;
  };
}

function makeWeather(p) {
  const N = WEATHER_SIZE, km = p.period / N;
  const R = new Float32Array(N * N), G = new Float32Array(N * N), B = new Float32Array(N * N);
  const rand = mulberry32(p.seed * 9973 + 1);
  // Clusters: a slow field (a lattice every 8 km) that says where the sky is busy.
  const busy = valueNoise2(rand, Math.round(p.period / 8));
  const blob = (cx, cy, r, h) => {
    const rr = Math.ceil(r / km) + 1;
    const ci = cx / km, cj = cy / km;
    for (let j = Math.floor(cj - rr); j <= cj + rr; j++) {
      for (let i = Math.floor(ci - rr); i <= ci + rr; i++) {
        const d = Math.hypot((i - ci) * km, (j - cj) * km) / r;
        if (d >= 1) continue;
        const v = Math.pow(1 - d * d, 0.7);
        const k = ((j % N) + N) % N * N + ((i % N) + N) % N;
        if (v > R[k]) R[k] = v;
        // Each blob is a dome: its top comes down to the base at its edge. The tallest dome
        // over a point sets the top there, so a heap of blobs is a heap of rounded turrets.
        const hv = h * Math.sqrt(1 - d * d);
        if (hv > G[k]) G[k] = hv;
      }
    }
  };
  // A cloud: a body and turrets around it; the big ones are heaps of turrets.
  const cloud = (cx, cy, r, h) => {
    blob(cx, cy, r, h);
    const n = 2 + Math.floor(rand() * 3) + Math.floor(r * 5);
    for (let t = 0; t < n; t++) {
      const a = rand() * Math.PI * 2, d = r * (0.3 + 0.55 * rand());
      blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.3 + 0.35 * rand()), h * (0.45 + 0.5 * rand()));
    }
  };
  const cell = 1.2;                       // km between cloud sites
  const cells = Math.round(p.period / cell);
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      const b = busy(ci / cells, cj / cells);
      const chance = p.coverage * (0.15 + 1.9 * b * b);
      const r0 = rand(), r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
      if (r0 > chance) continue;
      const cx = (ci + 0.1 + 0.8 * r1) * cell, cy = (cj + 0.1 + 0.8 * r2) * cell;
      // Mostly small puffs, some middling heaps, and in the busy parts the odd tower a
      // couple of kilometres across and high.
      const size = Math.pow(r3, 2.6) * (0.5 + 0.8 * b);
      const r = 0.1 + 1.1 * size * (0.7 + 0.6 * r4), h = Math.min(1, 0.12 + 0.55 * size + 0.35 * r4 * size + 0.1 * r4);
      cloud(cx, cy, r, h);
    }
  }
  // The cumulus of the photo day: a tall heap about 3 km east of the viewpoint (where the
  // `eastCove` photo shows it, over the cliff), drifting in with the wind.
  cloud(3.3, 0.35, 1.25, 1.0);
  // The bank's sheets: two octaves of value noise, lumpy at a kilometre or two.
  const s1 = valueNoise2(rand, Math.round(p.period / 3)), s2 = valueNoise2(rand, Math.round(p.period / 0.9));
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) B[j * N + i] = 0.68 * s1(i / N, j / N) + 0.32 * s2(i / N, j / N);
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = Math.round(R[k] * 255);
    data[k * 4 + 1] = Math.round(G[k] * 255);
    data[k * 4 + 2] = Math.round(B[k] * 255);
    data[k * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

// ---------------------------------------------------------------- noise (CPU)

// Tileable 3D Worley noise (1 at a feature point, falling off), `cells` per side.
function worley3(rand, cells) {
  const pts = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < pts.length; i++) pts[i] = rand();
  return (x, y, z) => {
    const fx = x * cells, fy = y * cells, fz = z * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    let best = 9;
    for (let dz = -1; dz <= 1; dz++) for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const cx = ix + dx, cy = iy + dy, cz = iz + dz;
      const w = (((cz % cells) + cells) % cells * cells + ((cy % cells) + cells) % cells) * cells + ((cx % cells) + cells) % cells;
      const px = cx + pts[w * 3], py = cy + pts[w * 3 + 1], pz = cz + pts[w * 3 + 2];
      const d = (px - fx) ** 2 + (py - fy) ** 2 + (pz - fz) ** 2;
      if (d < best) best = d;
    }
    return 1 - Math.min(Math.sqrt(best), 1);
  };
}

// Tileable 3D gradient (Perlin) noise, `cells` per side, about -1..1.
function perlin3(rand, cells) {
  const g = new Float32Array(cells * cells * cells * 3);
  for (let i = 0; i < g.length / 3; i++) {
    const z = rand() * 2 - 1, a = rand() * Math.PI * 2, s = Math.sqrt(1 - z * z);
    g[i * 3] = s * Math.cos(a); g[i * 3 + 1] = s * Math.sin(a); g[i * 3 + 2] = z;
  }
  const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
  return (x, y, z) => {
    const fx = x * cells, fy = y * cells, fz = z * cells;
    const ix = Math.floor(fx), iy = Math.floor(fy), iz = Math.floor(fz);
    const ux = fade(fx - ix), uy = fade(fy - iy), uz = fade(fz - iz);
    let out = 0;
    for (let c = 0; c < 8; c++) {
      const ox = c & 1, oy = (c >> 1) & 1, oz = c >> 2;
      const k = ((((iz + oz) % cells) + cells) % cells * cells + (((iy + oy) % cells) + cells) % cells) * cells + (((ix + ox) % cells) + cells) % cells;
      const dot = g[k * 3] * (fx - ix - ox) + g[k * 3 + 1] * (fy - iy - oy) + g[k * 3 + 2] * (fz - iz - oz);
      out += dot * (ox ? ux : 1 - ux) * (oy ? uy : 1 - uy) * (oz ? uz : 1 - uz);
    }
    return out * 1.6;
  };
}

function tex3(data, N) {
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  // Mip levels, so a cloud 100 km off reads the noise averaged, not aliased into blocks.
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.generateMipmaps = true;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
}

// The body: Perlin-Worley (Perlin noise dilated by billowy Worley noise), so the lumps are
// round like cauliflower but join up into one cloud.
function makeShapeNoise(seed) {
  const N = SHAPE_SIZE;
  const rand = mulberry32(seed * 7919 + 3);
  const p1 = perlin3(rand, 4), p2 = perlin3(rand, 8), p3 = perlin3(rand, 16);
  const w1 = worley3(rand, 4), w2 = worley3(rand, 8), w3 = worley3(rand, 16);
  const data = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
    const per = Math.min(Math.max(0.5 + 0.5 * (p1(u, v, w) * 0.6 + p2(u, v, w) * 0.28 + p3(u, v, w) * 0.12), 0), 1);
    const wor = w1(u, v, w) * 0.5 + w2(u, v, w) * 0.3 + w3(u, v, w) * 0.2;
    // remap(per, 0, 1, wor - 1, 1): Perlin pushed up where the Worley billows are.
    const pw = per * (2 - wor) + (wor - 1);
    const n = 0.35 * Math.min(Math.max(pw, 0), 1) + 0.65 * wor;
    data[(z * N + y) * N + x] = Math.round(Math.min(Math.max(n, 0), 1) * 255);
  }
  return tex3(data, N);
}

// The edges: three octaves of Worley noise at the scale of the billows on a billow.
function makeDetailNoise(seed) {
  const N = DETAIL_SIZE;
  const rand = mulberry32(seed * 104729 + 11);
  const w1 = worley3(rand, 2), w2 = worley3(rand, 4), w3 = worley3(rand, 8);
  const data = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
    const n = w1(u, v, w) * 0.625 + w2(u, v, w) * 0.25 + w3(u, v, w) * 0.125;
    data[(z * N + y) * N + x] = Math.round(Math.min(Math.max(n, 0), 1) * 255);
  }
  return tex3(data, N);
}

// Cloud shadow on the ground and the sea: follow the sun up to the middle of the cloud
// layer and read the weather map there. A cumulus in sunlight is close to opaque, so the
// shadow is deep where the map has cloud, with the blob's own falloff as the soft edge.
// 1 = full sun.
export const CLOUD_SHADOW_GLSL = /* glsl */ `
uniform sampler2D uWeather;
uniform vec4 uCloudLayer;
uniform vec2 uCloudWind;
uniform float uCloudShadow;   // 0 off, 1 on
float cloudShadow(vec3 wp, vec3 sunDir) {
  if (uCloudShadow <= 0.0) return 1.0;
  float hMid = (uCloudLayer.x + 0.25 * (uCloudLayer.y - uCloudLayer.x)) * 1000.0;
  vec3 q = wp + sunDir * max(hMid - wp.y, 0.0) / max(sunDir.y, 0.1);
  vec2 xz = q.xz * 0.001;
  // Inside the clear sky over the island: no cloud, no texture read.
  float clear = smoothstep(uCloudLayer.w, uCloudLayer.w * 2.2, length(xz));
  if (clear <= 0.0) return 1.0;
  vec2 w = texture2D(uWeather, (xz - uCloudWind) / uCloudLayer.z).rg;
  w.r *= clear;
  return 1.0 - 0.93 * smoothstep(0.15, 0.5, w.r) * smoothstep(0.05, 0.2, w.g) * uCloudShadow;
}
`;

// ---------------------------------------------------------------- the march

const CLOUD_PARS = /* glsl */ `
precision highp sampler3D;
uniform sampler2D uWeather;
uniform sampler3D uCloudShape;
uniform sampler3D uCloudDetail;
uniform vec4 uCloudLayer;     // base km, top km, weather period km, clear radius km
uniform vec2 uCloudWind;      // weather map offset (km) from the drift
uniform float uCloudBoil;     // how far the edges have churned upward (km)
uniform float uCloudSigma;    // extinction per km
uniform vec2 uCloudBank;      // how much of the far sea the bank covers, the high veil

#ifndef SHAPE_KM
#define SHAPE_KM 2.4
#endif
#ifndef DETAIL_KM
#define DETAIL_KM 0.28
#endif
#ifndef EDGE
#define EDGE 0.2
#endif
#ifndef ERODE
#define ERODE 0.6
#endif
#define BANK_TOP 0.16

// How wide a pixel is at a distance, in km (set per march from the lens), for picking mip
// levels: inside the march the GPU cannot tell which level a pixel needs, and guesses per
// block of four pixels, which showed as square blocks along the edges.
float gPixKm = 0.0;
float lodFor(float texelKm) { return max(log2(max(gPixKm, 1e-4) / texelKm), 0.0); }

// Weather at a map position (km): cumulus amount and top (0..1 of the layer), and the
// bank's sheet amount.
vec3 cloudWeather(vec2 xz) {
  vec3 w = textureLod(uWeather, (xz - uCloudWind) / uCloudLayer.z, lodFor(uCloudLayer.z / 1024.0)).rgb;
  float r = length(xz);
  // Keep the sky over the island clear, so it stays in sun as on the photo day.
  w.r *= smoothstep(uCloudLayer.w, uCloudLayer.w * 2.2, r);
  // The island heats the air and grows the big cumulus; out over the open sea the trade
  // cumulus stay small and scattered (the photos' horizon: a thin band of small puffs).
  float open = smoothstep(6.0, 30.0, r);
  w.g *= 1.0 - 0.75 * open;
  w.r *= 1.0 - 0.45 * open;
  // The bank: sheets that fill in 25 to 60 km out, where they pile up along the horizon.
  float bank = smoothstep(25.0, 60.0, r) * uCloudBank.x;
  w.b = bank > 0.0 ? clamp((w.b - (1.0 - bank)) / max(bank, 0.05), 0.0, 1.0) : 0.0;
  return w;
}

float remap(float v, float a, float b) { return clamp((v - a) / (b - a), 0.0, 1.0); }

// Density (0..1) at a point p (km, planet-centred, y up) at height h (km) above the sea.
// detail: 1 with the edge noise, 0 where the march steps are too long to resolve it.
float cloudDensity(vec3 p, float h, vec3 w, float detail) {
  // The base is flat under the middle of a cloud and curves up toward its edge, and it sits a
  // little higher or lower from one cloud to the next (by up to 120 m), so the bases do not
  // line up across the sky.
  float lift = 0.12 * (textureLod(uCloudShape, vec3(p.x - uCloudWind.x, 0.37, p.z - uCloudWind.y) / 19.0, 3.0).r - 0.5)
             + 0.1 * (1.0 - w.r) * (1.0 - w.r);
  float hn = (h - uCloudLayer.x - lift) / (uCloudLayer.y - uCloudLayer.x);
  if (hn <= 0.0) return 0.0;
  // Cumulus: a flat base (about 60 m of fade) and the weather map's domes over it, rounded
  // off at the top.
  // The dome sets the outline: the billow noise is kept where it clears a threshold that
  // rises toward the dome's surface, so the top is a heap of rounded turrets and the sides
  // come down to the base. More cloud (the map's R) is a lower threshold, a fuller heap.
  float top = w.g;
  float dc = 0.0;
  if (hn < top && w.r > 0.01) {
    float rel = hn / top;
    float prof = smoothstep(0.0, 0.025, hn) * (1.0 - smoothstep(0.35, 1.0, rel));
    vec3 q = vec3(p.x - uCloudWind.x, h, p.z - uCloudWind.y) / SHAPE_KM;
    float shape = textureLod(uCloudShape, q, lodFor(SHAPE_KM / 64.0)).r;
    // Full density a short way inside the surface: a cumulus has an edge, not a fade.
    // (Far out, where the detail noise is gone, a softer edge.)
    float thr = mix(0.6, 0.3, w.r);
    dc = remap(shape * prof, thr, thr + EDGE * (1.0 + 2.0 * (1.0 - detail))) * smoothstep(0.02, 0.2, w.r);
  }
  // The bank: flat sheets a couple of hundred metres thick.
  float hk = h - uCloudLayer.x;
  float ds = 0.0;
  if (w.b > 0.0 && hk < BANK_TOP) {
    float prof = smoothstep(0.0, 0.03, hk) * (1.0 - smoothstep(0.0, BANK_TOP, hk / (0.3 + 0.7 * w.b)));
    ds = w.b * w.b * prof;
  }
  float d = max(dc, ds);
  if (d <= 0.0) return 0.0;
  if (detail > 0.0) {
    // Billows on the billows up top, wisps toward the base (the detail noise inverted), and
    // the whole churning slowly upward.
    float rel = clamp(hn / max(top, 0.05), 0.0, 1.0);
    vec3 qd = vec3(p.x - uCloudWind.x, h - uCloudBoil, p.z - uCloudWind.y) / DETAIL_KM;
    float n = textureLod(uCloudDetail, qd, lodFor(DETAIL_KM / 32.0)).r;
    n = mix(1.0 - n, n, smoothstep(0.05, 0.35, rel));
    d = remap(d, n * ERODE * detail, 1.0);
  }
  return d;
}

float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
`;

const FRAG = /* glsl */ `
#ifndef FINE_DIV
#define FINE_DIV 4.0
#endif
#ifndef LIGHT_STEPS
#define LIGHT_STEPS 4
#endif
${ATMO_PARS}
${TRANS_LOOKUP}
${AP_LAYOUT}
uniform sampler2D uAerialLUT;
uniform vec3 uCamPos;
uniform float uApMaxKm;
uniform vec3 uSunE;
uniform vec3 uSunIrr;
uniform vec3 uSunDir;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uSkySH[9];
uniform vec2 uHalfRes;        // the clouds' full size (half the drawing buffer)
uniform vec2 uMarchOffset;    // this frame's pixel within each 4 x 4 block (stride 4), or 0
uniform float uMarchStride;   // 1 for a whole march, 4 for one pixel in sixteen
uniform float uMarchFrame;    // moves the steps' jitter on from frame to frame
${CLOUD_PARS}
float meanDensity(float h0, float h1, float H) {
  float dh = h1 - h0;
  float a = exp(-max(h0, 0.0) / H);
  if (abs(dh) < 1e-3) return a;
  return H * (a - exp(-max(h1, 0.0) / H)) / dh;
}
${AERIAL_FN}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}

// The thin high veil (cirrus and altostratus, about 8 km up): streaks of value noise
// stretched along the wind, lit thinly by the sun. Returns light and how much it covers.
vec4 highVeil(vec3 ro, vec3 rd, float cosT) {
  if (uCloudBank.y <= 0.0 || rd.y < 0.01) return vec4(0.0);
  float t = raySphere(ro, rd, uRg + 8.0);
  if (t <= 0.0 || t > 250.0) return vec4(0.0);
  vec3 p = ro + rd * t;
  // Streaks along the wind, bent by a slower field so they are not ruled lines.
  vec2 xz = p.xz - uCloudWind * 3.0;
  xz += 6.0 * vec2(vnoise(xz * 0.03), vnoise(xz * 0.03 + 7.3)) - 3.0;
  vec2 q = xz * vec2(0.11, 0.3);
  float n = 0.0, a = 0.5;
  for (int i = 0; i < 5; i++) { n += a * vnoise(q); q = q * 2.03 + vec2(1.7, 9.2); a *= 0.5; }
  float patchy = smoothstep(0.35, 0.75, vnoise(xz * 0.02 + 3.1));
  float c = smoothstep(0.5, 0.85, n) * patchy * uCloudBank.y * 0.3;
  // Thinner toward the horizon, where the haze and the distance take it.
  c *= smoothstep(0.01, 0.12, rd.y);
  vec3 skyTop = max(uSkySH[0] * 0.886227 + uSkySH[1] * 1.023328, vec3(0.0));
  vec3 L = uSunIrr * (0.05 + 0.6 * hg(cosT, 0.7)) + skyTop / (4.0 * 3.14159265) * 1.2;
  return vec4(L * c, c);
}

void main() {
  // Which of the clouds' pixels this is.
  vec2 px = floor(gl_FragCoord.xy) * uMarchStride + uMarchOffset;
  vec2 vUv = (px + 0.5) / uHalfRes;
  vec3 rd = normalize(uCamFwd + (vUv.x * 2.0 - 1.0) * uCamRight + (vUv.y * 2.0 - 1.0) * uCamUp);
  vec3 ro = vec3(uCamPos.x * 0.001, uRg + uCamPos.y * 0.001, uCamPos.z * 0.001);
  // Nothing to do below the horizon (the sea covers it) or where the ray never gets up to
  // the cloud base before hitting the planet.
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  float tGround = raySphere(ro, rd, uRg);
  float camH = length(ro) - uRg;
  if (camH < uCloudLayer.x && tGround > 0.0) return;
  float cosT = dot(rd, uSunDir);
  vec4 veil = highVeil(ro, rd, cosT);
  float t0, t1;
  if (camH < uCloudLayer.x) {
    // Below the layer: from the base up to the top.
    t0 = raySphere(ro, rd, uRg + uCloudLayer.x);
    t1 = raySphere(ro, rd, uRg + uCloudLayer.y);
  } else {
    // Up in it: from here to the top, or down to the base.
    t0 = 0.0;
    float tb = raySphere(ro, rd, uRg + uCloudLayer.x);
    t1 = tb > 0.0 ? tb : raySphere(ro, rd, uRg + uCloudLayer.y);
  }
  if (t0 < 0.0 || t1 < 0.0 || t0 > 160.0) { gl_FragColor = vec4(veil.rgb, 1.0 - veil.a); return; }
  // Clouds on the horizon seen from the clifftop are 100 to 150 km away.
  t1 = min(t1, t0 + 60.0);
  // Steps grow with distance (1.2% of it, 2.5% past 30 km, where a pixel is a few hundred
  // metres across), and the empty sky between clouds is crossed in longer strides. Detail
  // too fine for the step is left out, not aliased into grain.
  float jitter = fract(52.9829189 * fract(dot(px + 0.5, vec2(0.06711056, 0.00583715))) + uMarchFrame * 0.618034);
  float sunY = max(uSunDir.y, 0.15);
  float layerKm = uCloudLayer.y - uCloudLayer.x;
  // Sky light on a cloud: from above, and the sea's light from below.
  vec3 skyTop = max(uSkySH[0] * 0.886227 + uSkySH[1] * 1.023328, vec3(0.0));
  vec3 skyBottom = max(uSkySH[0] * 0.886227 - uSkySH[1] * 1.023328, vec3(0.0));
  // Phase: a strong forward lobe (the silver edge), a weak backward one.
  float Tl = 1.0;
  vec3 L = vec3(0.0);
  float dSum = 0.0, wSum = 0.0;
  float t = t0 + jitter * max(0.04, t0 * 0.012);
  // Coarse steps through empty sky; on reaching cloud, back up one step and go on in fine
  // steps (a sixth), so the edge of a cloud lands where it is, not on the step grid.
  float fine = 0.0;
  float pixAngle = 2.0 * length(uCamUp) / uHalfRes.y;
  for (int i = 0; i < 128; i++) {
    if (t > t1) break;
    gPixKm = t * pixAngle;
    float coarse = max(0.04, t * mix(0.012, 0.025, smoothstep(20.0, 40.0, t)));
    // Fine steps inside cloud: a sixth of a coarse one close by, a half far out.
    float ds = fine > 0.0 ? coarse / mix(FINE_DIV, 2.0, smoothstep(8.0, 30.0, t)) : coarse;
    vec3 p = ro + rd * t;
    float h = length(p) - uRg;
    vec3 w = cloudWeather(p.xz);
    if (w.r < 0.02 && w.b < 0.02) { fine = 0.0; t += coarse * 2.5; continue; }
    float detail = smoothstep(0.25, 0.06, ds);
    float dens = cloudDensity(p, h, w, detail);
    if (dens > 0.0 && fine <= 0.0) {
      fine = 12.0;                 // fine steps for a while
      t = max(t - coarse, t0);
      continue;
    }
    if (dens > 0.0) {
      fine = 12.0;                 // stay fine while inside cloud
      float sigma = dens * uCloudSigma;
      // Depth of cloud toward the sun: five steps, each twice as long as the last (the
      // first two with the edge noise), then the rest of the cloud's dome above.
      // Far out, where a cloud is a few pixels, fewer and longer steps.
      int nl = t < 15.0 ? LIGHT_STEPS : (t < 40.0 ? 3 : 2);
      float od = 0.0, sl = t < 15.0 ? 0.025 : (t < 40.0 ? 0.08 : 0.2);
      vec3 q = p;
      for (int k = 0; k < LIGHT_STEPS; k++) {
        if (k >= nl) break;
        q += uSunDir * sl;
        float hq = length(q) - uRg;
        od += cloudDensity(q, hq, cloudWeather(q.xz), k < 2 ? detail : 0.0) * sl;
        sl *= 2.0;
      }
      float hq = (length(q) - uRg - uCloudLayer.x) / layerKm;
      float rest = max(w.g - hq, 0.0) * layerKm / sunY * w.r * 0.35;
      float tau = (od + rest) * uCloudSigma;
      // Three octaves of multiple scattering (each weaker, reaching deeper, rounder), and
      // the light diffused through the cloud: a thick sunlit face is a white surface (albedo
      // about 0.8, a quarter of the sunlight per steradian), less the deeper it sits.
      float ms = 0.0, a = 1.0, b = 1.0, c = 1.0;
      for (int o = 0; o < 3; o++) {
        ms += a * exp(-tau * b) * mix(hg(cosT, 0.8 * c), hg(cosT, -0.3 * c), 0.2);
        a *= 0.55; b *= 0.35; c *= 0.5;
      }
      float diff = 0.22 / (1.0 + 0.09 * tau);
      // Powder: the thin outer shell has taken light in but not yet scattered it back out,
      // so it is darker, except toward the sun, where the forward lobe lights it.
      float powder = 1.0 - exp(-2.0 * (tau + sigma * 0.03));
      powder = mix(powder, 1.0, smoothstep(0.2, 0.9, cosT));
      float sunT = (ms + diff) * mix(0.35, 1.0, powder);
      float hn = clamp((h - uCloudLayer.x) / (max(w.g, BANK_TOP / layerKm) * layerKm), 0.0, 1.0);
      vec3 amb = mix(skyBottom * 0.55, skyTop, smoothstep(0.0, 0.9, hn)) / (4.0 * 3.14159265) * mix(0.9, 1.7, hn);
      vec3 S = uSunIrr * sunT + amb;
      float Ts = exp(-sigma * ds);
      L += Tl * S * (1.0 - Ts);
      dSum += t * Tl * (1.0 - Ts);
      wSum += Tl * (1.0 - Ts);
      Tl *= Ts;
      if (Tl < 0.01) break;
    }
    fine -= 1.0;
    t += ds;
  }
  if (wSum <= 0.0) { gl_FragColor = vec4(veil.rgb, 1.0 - veil.a); return; }
  // The haze in front of the cloud.
  float d = dSum / wSum;
  vec3 hit = ro + rd * d;
  vec3 wp = vec3(hit.x * 1000.0, (length(hit) - uRg) * 1000.0, hit.z * 1000.0);
  vec3 Tair, ins;
  aerial(wp, vUv, Tair, ins);
  float cover = 1.0 - Tl;
  gl_FragColor = vec4(ins * cover + Tair * L + Tl * veil.rgb, Tl * (1.0 - veil.a));
}
`;

// The resolve: this frame's marched pixel where there is one, else last frame's clouds moved
// for the camera and the drift, else (off the edge of last frame) the sparse march spread out.
// To move a pixel it needs a distance: where its ray crosses the lower third of the layer
// (clouds are kilometres away, so the error is a fraction of a pixel for a walking camera).
const RESOLVE = /* glsl */ `
${ATMO_PARS}
uniform sampler2D uMarch;
uniform sampler2D uHistory;
uniform vec2 uHalfRes;
uniform vec2 uMarchRes;
uniform vec2 uMarchOffset;
uniform vec3 uCamFwd;
uniform vec3 uCamRight;
uniform vec3 uCamUp;
uniform vec3 uEye;            // the camera (m, world)
uniform vec4 uCloudLayer;
uniform vec2 uDrift;          // how far the clouds drifted since last frame (m, x and z)
uniform mat4 uPrevViewProj;
uniform float uHistoryOk;
void main() {
  vec2 px = floor(gl_FragCoord.xy);
  vec2 cell = floor(px / 4.0);
  bool fresh = px - cell * 4.0 == uMarchOffset;
  vec2 uv = (px + 0.5) / uHalfRes;
  vec3 rd = normalize(uCamFwd + (uv.x * 2.0 - 1.0) * uCamRight + (uv.y * 2.0 - 1.0) * uCamUp);
  vec3 ro = vec3(0.0, uRg + max(uEye.y, 0.5) * 0.001, 0.0);
  float d = raySphere(ro, rd, uRg + uCloudLayer.x + 0.33 * (uCloudLayer.y - uCloudLayer.x));
  d = d > 0.0 ? min(d, 150.0) : 8.0;
  vec3 wp = uEye + rd * d * 1000.0 - vec3(uDrift.x, 0.0, uDrift.y);
  vec4 clip = uPrevViewProj * vec4(wp, 1.0);
  vec2 prev = clip.xy / max(clip.w, 1e-6) * 0.5 + 0.5;
  bool ok = uHistoryOk > 0.5 && clip.w > 0.0 && all(greaterThan(prev, vec2(0.0))) && all(lessThan(prev, vec2(1.0)));
  if (fresh) {
    // This frame's march, blended with what was there: the jitter moves from frame to frame,
    // so an edge settles to its average (smooth) instead of one sample's step.
    vec4 now = texture2D(uMarch, (cell + 0.5) / uMarchRes);
    gl_FragColor = ok ? mix(texture2D(uHistory, prev), now, 0.45) : now;
    return;
  }
  gl_FragColor = ok ? texture2D(uHistory, prev) : texture2D(uMarch, ((px - uMarchOffset) / 4.0 + 0.5) / uMarchRes);
}
`;

// The order the 16 pixels of each 4 x 4 block are marched in (a Bayer matrix), so each
// frame's pixels are spread evenly.
const BAYER = [0, 10, 2, 8, 5, 15, 7, 13, 1, 11, 3, 9, 4, 14, 6, 12];

export function createClouds(renderer, atmosphere, opts = {}) {
  const params = { ...CLOUD_DEFAULTS, ...opts };
  const uniforms = {
    uWeather: { value: null },
    uCloudShape: { value: makeShapeNoise(params.seed) },
    uCloudDetail: { value: makeDetailNoise(params.seed) },
    uCloudLayer: { value: new THREE.Vector4() },
    uCloudWind: { value: new THREE.Vector2() },
    uCloudBoil: { value: 0 },
    uCloudSigma: { value: params.density },
    uCloudBank: { value: new THREE.Vector2() },
    uCloudShadow: { value: 1 },
    uHalfRes: { value: new THREE.Vector2(1, 1) },
    uMarchOffset: { value: new THREE.Vector2() },
    uMarchStride: { value: 1 },
    uMarchFrame: { value: 0 },
  };
  let weatherKey = '';
  function applyParams() {
    const key = `${params.coverage}|${params.period}|${params.seed}`;
    if (key !== weatherKey) {
      weatherKey = key;
      uniforms.uWeather.value?.dispose();
      uniforms.uWeather.value = makeWeather(params);
    }
    uniforms.uCloudLayer.value.set(params.base, params.top, params.period, params.clearRadius);
    uniforms.uCloudSigma.value = params.density;
    uniforms.uCloudBank.value.set(params.bank, params.high);
  }
  applyParams();

  const vert = 'void main() { gl_Position = vec4(position.xy, 0.0, 1.0); }';
  const material = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere.uniforms, ...uniforms },
    vertexShader: vert, fragmentShader: FRAG,
    depthTest: false, depthWrite: false, toneMapped: false,
    defines: opts.defines || {},
  });
  const resolveUniforms = {
    uMarch: { value: null }, uHistory: { value: null },
    uHalfRes: uniforms.uHalfRes, uMarchRes: { value: new THREE.Vector2(1, 1) }, uMarchOffset: uniforms.uMarchOffset,
    uEye: { value: new THREE.Vector3() }, uCloudLayer: uniforms.uCloudLayer, uDrift: { value: new THREE.Vector2() },
    uPrevViewProj: { value: new THREE.Matrix4() }, uHistoryOk: { value: 0 },
  };
  const resolve = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere.uniforms, ...resolveUniforms },
    vertexShader: vert, fragmentShader: RESOLVE,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const rt = () => new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });
  // Two whole-size targets in turn (this frame's and last frame's), and the sparse march.
  let front = rt(), back = rt();
  const sparse = rt();
  sparse.texture.minFilter = sparse.texture.magFilter = THREE.LinearFilter;
  // What the sky dome reads (its uniform is this object, so it follows the swaps).
  const output = { value: front.texture };
  const size = new THREE.Vector2();
  let lastKey = '', lastSetup = '', frame = 0, historyOk = false;
  const lastEye = new THREE.Vector3(), lastFwd = new THREE.Vector3(), fwd = new THREE.Vector3();
  const lastWind = new THREE.Vector2();
  const viewProj = new THREE.Matrix4(), viewInv = new THREE.Matrix4();
  function pass(mat, target) {
    quad.material = mat;
    renderer.setRenderTarget(target);
    renderer.render(scene, cam);
  }

  return {
    params, uniforms, output, applyParams,
    get texture() { return output.value; },
    // What the ground, sea and plants need for cloud shadows (CLOUD_SHADOW_GLSL).
    shadowUniforms: { uWeather: uniforms.uWeather, uCloudLayer: uniforms.uCloudLayer, uCloudWind: uniforms.uCloudWind, uCloudShadow: uniforms.uCloudShadow },
    // Drift with the clock, then march at half the drawing-buffer size: all of it, or one
    // pixel in sixteen and the rest carried over. A still view with a still clock (or drift
    // under a metre) keeps the last march. `whole` forces a whole march.
    render(time, camera, whole = false) {
      const a = THREE.MathUtils.degToRad(params.windHeading);
      // Map coordinates are (x east, z south) in km; heading is a compass bearing.
      uniforms.uCloudWind.value.set(Math.sin(a), -Math.cos(a)).multiplyScalar(params.windSpeed * time);
      // The edges churn upward at about 2.5 m/s.
      uniforms.uCloudBoil.value = 0.0025 * time;
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, Math.round(size.x / 2)), h = Math.max(1, Math.round(size.y / 2));
      const setup = `${w}x${h}|${JSON.stringify(params)}|${atmosphere.version}|${camera.projectionMatrix.elements.join()}`;
      const key = `${camera.matrixWorld.elements.join()}|${setup}|${Math.round(params.windSpeed * time * 1000)}`;
      if (key === lastKey && !whole) return;
      lastKey = key;
      // A jump (the camera moved more than 30 m or turned more than 25 degrees since the last
      // march), a new size or new settings: nothing to carry over.
      camera.getWorldDirection(fwd);
      const jump = lastEye.distanceTo(camera.position) > 30 || fwd.dot(lastFwd) < Math.cos(THREE.MathUtils.degToRad(25));
      const full = whole || !historyOk || jump || setup !== lastSetup;
      lastSetup = setup;
      if (front.width !== w || front.height !== h) {
        front.setSize(w, h); back.setSize(w, h);
        sparse.setSize(Math.ceil(w / 4), Math.ceil(h / 4));
      }
      uniforms.uHalfRes.value.set(w, h);
      const prevRT = renderer.getRenderTarget();
      [front, back] = [back, front];
      if (full) {
        uniforms.uMarchStride.value = 1;
        uniforms.uMarchOffset.value.set(0, 0);
        pass(material, front);
      } else {
        const b = BAYER[frame++ % 16];
        uniforms.uMarchFrame.value = Math.floor(frame / 16) % 64;
        uniforms.uMarchStride.value = 4;
        uniforms.uMarchOffset.value.set(b % 4, b >> 2);
        pass(material, sparse);
        resolveUniforms.uMarch.value = sparse.texture;
        resolveUniforms.uHistory.value = back.texture;
        resolveUniforms.uMarchRes.value.set(sparse.width, sparse.height);
        resolveUniforms.uEye.value.copy(camera.position);
        const wv = uniforms.uCloudWind.value;
        resolveUniforms.uDrift.value.set((wv.x - lastWind.x) * 1000, (wv.y - lastWind.y) * 1000);
        resolveUniforms.uHistoryOk.value = 1;
        pass(resolve, front);
      }
      renderer.setRenderTarget(prevRT);
      output.value = front.texture;
      historyOk = true;
      lastEye.copy(camera.position);
      lastFwd.copy(fwd);
      lastWind.copy(uniforms.uCloudWind.value);
      // (From the world matrix: three.js refreshes matrixWorldInverse only when it draws the
      // scene, which comes after the clouds, so it is still last frame's here.)
      viewInv.copy(camera.matrixWorld).invert();
      viewProj.multiplyMatrices(camera.projectionMatrix, viewInv);
      resolveUniforms.uPrevViewProj.value.copy(viewProj);
    },
  };
}
