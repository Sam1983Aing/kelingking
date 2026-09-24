// Fair-weather cumulus: a layer of cloud between about 0.7 and 2.4 km, like the small trade
// clouds sitting on the horizon in the viewpoint photos.
//
// Shape. A weather map (made once, on the CPU) places each cloud as a cluster of round
// blobs: how much cloud (R) and how tall it grows (G). A cloud fills its column from a flat
// base up to a dome whose height follows the blob, so the edges are low and the middle
// towers. A 3D noise texture of billows eats into the surface.
//
// Light. Sunlight inside a cloud falls off with the depth of cloud above the point toward
// the sun (from the dome's height, no second march), with a slow multiple-scattering tail
// so the bases go grey rather than black, and a two-lobed phase for the silver lining. Sky
// light from above, a little sea light from below. The same haze as everything else sits
// in front of each cloud (the aerial-perspective froxels reach 100 km).
//
// Cost. Marched at half resolution for the sky only, into a texture the sky dome blends in.
// The field stays still unless the clock runs (the clouds drift with the wind).

import * as THREE from 'three';
import { ATMO_PARS, AP_LAYOUT, TRANS_LOOKUP, AERIAL_FN } from './atmosphere-glsl.js';

export const CLOUD_DEFAULTS = {
  coverage: 0.3,      // chance that a cell of the weather map has a cloud
  base: 0.7,          // km
  top: 2.0,           // km, the tallest a cloud gets
  density: 45,        // extinction inside a cloud, per km
  period: 48,         // km before the weather map repeats
  clearRadius: 4,     // km around the island kept clear, as on the photo day
  windHeading: 290,   // compass degrees the clouds drift toward
  windSpeed: 0.006,   // km per second (6 m/s)
  seed: 7,
};

const WEATHER_SIZE = 1024;
const NOISE_SIZE = 64;

// ---------------------------------------------------------------- weather map (CPU)

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeWeather(p) {
  const N = WEATHER_SIZE, km = p.period / N;
  const R = new Float32Array(N * N), G = new Float32Array(N * N);
  const rand = mulberry32(p.seed * 9973 + 1);
  const cell = 1.6;                       // km between cloud sites
  const cells = Math.round(p.period / cell);
  const blob = (cx, cy, r, h) => {
    const rr = Math.ceil(r / km) + 1;
    const ci = cx / km, cj = cy / km;
    for (let j = Math.floor(cj - rr); j <= cj + rr; j++) {
      for (let i = Math.floor(ci - rr); i <= ci + rr; i++) {
        const d = Math.hypot((i - ci) * km, (j - cj) * km) / r;
        if (d >= 1) continue;
        const v = Math.pow(1 - d * d, 0.8);
        const k = ((j % N) + N) % N * N + ((i % N) + N) % N;
        if (v > R[k]) { R[k] = v; G[k] = h; }
      }
    }
  };
  for (let cj = 0; cj < cells; cj++) {
    for (let ci = 0; ci < cells; ci++) {
      if (rand() > p.coverage) { rand(); rand(); rand(); continue; }
      const cx = (ci + 0.15 + 0.7 * rand()) * cell, cy = (cj + 0.15 + 0.7 * rand()) * cell;
      // Mostly small clouds, the odd big one, and heights that do not simply follow size.
      const size = Math.pow(rand(), 2.5);
      const r = 0.25 + 0.8 * size, h = 0.25 + 0.75 * (0.45 * rand() + 0.55 * size);
      blob(cx, cy, r, h);
      // Turrets: a few smaller blobs around the main one.
      const n = 2 + Math.floor(rand() * 4);
      for (let t = 0; t < n; t++) {
        const a = rand() * Math.PI * 2, d = r * (0.45 + 0.4 * rand());
        blob(cx + Math.cos(a) * d, cy + Math.sin(a) * d, r * (0.35 + 0.35 * rand()), h * (0.5 + 0.45 * rand()));
      }
    }
  }
  const data = new Uint8Array(N * N * 4);
  for (let k = 0; k < N * N; k++) {
    data[k * 4] = Math.round(R[k] * 255);
    data[k * 4 + 1] = Math.round(G[k] * 255);
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

// ---------------------------------------------------------------- billow noise (CPU)

// Tileable 3D Worley noise, three octaves, inverted so it bulges like cauliflower.
function makeNoise(seed) {
  const N = NOISE_SIZE;
  const rand = mulberry32(seed * 7919 + 3);
  const octave = (cells) => {
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
  };
  const o1 = octave(4), o2 = octave(8), o3 = octave(16);
  const data = new Uint8Array(N * N * N);
  for (let z = 0; z < N; z++) for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
    const u = (x + 0.5) / N, v = (y + 0.5) / N, w = (z + 0.5) / N;
    const n = o1(u, v, w) * 0.625 + o2(u, v, w) * 0.25 + o3(u, v, w) * 0.125;
    data[(z * N + y) * N + x] = Math.round(Math.min(Math.max(n, 0), 1) * 255);
  }
  const tex = new THREE.Data3DTexture(data, N, N, N);
  tex.format = THREE.RedFormat;
  tex.wrapS = tex.wrapT = tex.wrapR = THREE.RepeatWrapping;
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.unpackAlignment = 1;
  tex.needsUpdate = true;
  return tex;
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
  float hMid = (uCloudLayer.x + 0.35 * (uCloudLayer.y - uCloudLayer.x)) * 1000.0;
  vec3 q = wp + sunDir * max(hMid - wp.y, 0.0) / max(sunDir.y, 0.1);
  vec2 xz = q.xz * 0.001;
  // Inside the clear sky over the island: no cloud, no texture read.
  float clear = smoothstep(uCloudLayer.w, uCloudLayer.w * 2.2, length(xz));
  if (clear <= 0.0) return 1.0;
  vec2 w = texture2D(uWeather, (xz - uCloudWind) / uCloudLayer.z).rg;
  w.r *= clear;
  return 1.0 - 0.93 * smoothstep(0.12, 0.45, w.r) * smoothstep(0.08, 0.3, w.g) * uCloudShadow;
}
`;

// ---------------------------------------------------------------- the march

export const CLOUD_PARS = /* glsl */ `
precision highp sampler3D;
uniform sampler2D uWeather;
uniform sampler3D uCloudNoise;
uniform vec4 uCloudLayer;     // base km, top km, weather period km, clear radius km
uniform vec2 uCloudWind;      // weather map offset (km) from the drift
uniform float uCloudSigma;    // extinction per km

// Weather at a map position (km): cloud amount and how tall it grows.
vec2 cloudWeather(vec2 xz) {
  vec2 w = texture2D(uWeather, (xz - uCloudWind) / uCloudLayer.z).rg;
  // Keep the sky over the island clear, as it was the day the photos were taken.
  w.r *= smoothstep(uCloudLayer.w, uCloudLayer.w * 2.2, length(xz));
  return w;
}

// Density (0..1) at height h (km) above the sea, map position xz (km). The shape is billow
// noise kept where the weather map says there is cloud (the more cloud, the more of the
// noise survives), under a cumulus height profile: a flat base, and a top that rounds off
// at this cloud's own height. So the lumps of the noise are the lumps of the cloud.
// detail: 1 with the finest billows, 0 where the march steps are too long to resolve them.
float cloudDensity(vec2 xz, float h, vec2 w, float detail) {
  float hn = (h - uCloudLayer.x) / (uCloudLayer.y - uCloudLayer.x);
  float hTop = w.g;
  if (hn < 0.0 || hn > hTop) return 0.0;
  float grad = smoothstep(0.0, 0.07, hn) * (1.0 - smoothstep(hTop * 0.35, hTop, hn));
  vec3 q = vec3(xz.x - uCloudWind.x, h * 1.3, xz.y - uCloudWind.y) / 3.0;
  float nb = texture(uCloudNoise, q).r;
  float cov = w.r;
  float d = clamp((nb * grad - (1.0 - cov)) / max(cov, 0.05), 0.0, 1.0);
  if (d <= 0.0) return 0.0;
  if (detail > 0.0) {
    float nd = texture(uCloudNoise, q * 3.7 + 0.37).r;
    d = clamp((d - (1.0 - nd) * 0.35 * detail) / (1.0 - 0.35 * detail), 0.0, 1.0);
  }
  // Soft edges: density builds up over the outer part of the cloud.
  return d * d;
}


float hg(float c, float g) { float g2 = g * g; return (1.0 - g2) / (4.0 * 3.14159265 * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5)); }
`;

const FRAG = /* glsl */ `
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
uniform vec2 uCloudRes;
${CLOUD_PARS}
float meanDensity(float h0, float h1, float H) {
  float dh = h1 - h0;
  float a = exp(-max(h0, 0.0) / H);
  if (abs(dh) < 1e-3) return a;
  return H * (a - exp(-max(h1, 0.0) / H)) / dh;
}
${AERIAL_FN}
varying vec2 vUv;

void main() {
  vec3 rd = normalize(uCamFwd + (vUv.x * 2.0 - 1.0) * uCamRight + (vUv.y * 2.0 - 1.0) * uCamUp);
  vec3 ro = vec3(uCamPos.x * 0.001, uRg + uCamPos.y * 0.001, uCamPos.z * 0.001);
  // Nothing to do below the horizon (the sea covers it) or where the ray never gets up to
  // the cloud base before hitting the planet.
  gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0);
  float tGround = raySphere(ro, rd, uRg);
  float camH = length(ro) - uRg;
  float t0, t1;
  if (camH < uCloudLayer.x) {
    // Below the layer, as in every shot so far: from the base up to the top.
    if (tGround > 0.0) return;
    t0 = raySphere(ro, rd, uRg + uCloudLayer.x);
    t1 = raySphere(ro, rd, uRg + uCloudLayer.y);
  } else {
    // Up in it: from here to the top, or down to the base.
    t0 = 0.0;
    float tb = raySphere(ro, rd, uRg + uCloudLayer.x);
    t1 = tb > 0.0 ? tb : raySphere(ro, rd, uRg + uCloudLayer.y);
  }
  if (t0 < 0.0 || t1 < 0.0) return;
  // Clouds on the horizon seen from the clifftop are 100 to 140 km away.
  t1 = min(t1, t0 + 60.0);
  if (t0 > 150.0) return;
  // Steps grow with distance (1.2% of it), and the empty sky between clouds is crossed in
  // longer strides. Detail too fine for the step is left out, not aliased into grain.
  float jitter = fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715))));
  float cosT = dot(rd, uSunDir);
  float phase = mix(hg(cosT, 0.8), hg(cosT, -0.25), 0.3);
  float sunY = max(uSunDir.y, 0.15);
  // Sky light on a cloud: from above, and the sea's light from below.
  vec3 skyTop = max(uSkySH[0] * 0.886227 + uSkySH[1] * 1.023328, vec3(0.0));
  vec3 skyBottom = max(uSkySH[0] * 0.886227 - uSkySH[1] * 1.023328, vec3(0.0));
  float Tl = 1.0;
  vec3 L = vec3(0.0);
  float dSum = 0.0, wSum = 0.0;
  float t = t0 + jitter * max(0.05, t0 * 0.012);
  // Coarse steps through empty sky; on reaching cloud, back up one step and go on in fine
  // steps (a sixth), so the edge of a cloud lands where it is, not on the step grid.
  float fine = 0.0;
  for (int i = 0; i < 128; i++) {
    if (t > t1) break;
    float coarse = max(0.05, t * 0.012);
    float ds = fine > 0.0 ? coarse / 6.0 : coarse;
    vec3 p = ro + rd * t;
    float h = length(p) - uRg;
    vec2 xz = p.xz;
    vec2 w = cloudWeather(xz);
    if (w.r < 0.02) { fine = 0.0; t += coarse * 2.5; continue; }
    float detail = smoothstep(0.3, 0.1, ds);
    float dens = cloudDensity(xz, h, w, detail);
    if (dens > 0.0 && fine <= 0.0) {
      fine = 12.0;                 // fine steps for a while
      t = max(t - coarse, t0);
      continue;
    }
    if (dens > 0.0) {
      fine = 12.0;                 // stay fine while inside cloud
      float sigma = dens * uCloudSigma;
      // Depth of cloud toward the sun: the dome above gives the bulk; three short steps
      // toward the sun find the billows that shade their neighbours.
      float hn = (h - uCloudLayer.x) / (uCloudLayer.y - uCloudLayer.x);
      float above = max(w.g * w.r - hn, 0.0) * (uCloudLayer.y - uCloudLayer.x) / sunY;
      float near = 0.0;
      for (int k = 1; k <= 2; k++) {
        float sl = 0.1 * float(k * k);
        vec3 q = p + uSunDir * sl;
        vec2 wq = cloudWeather(q.xz);
        near += cloudDensity(q.xz, length(q) - uRg, wq, detail) * 0.1 * float(2 * k - 1);
      }
      float tau = max(above * 0.5, near) * uCloudSigma;
      // Single scattering for the silver lining, plus light that has diffused through the
      // cloud: a thick cloud's sunlit face glows like a white surface (albedo about 0.75,
      // so 0.24 of the sunlight per steradian), fading with the depth of cloud above
      // (diffusion through a slab: 1 / (1 + 0.75 tau (1 - g)), g = 0.85).
      float sunT = exp(-tau) * phase * 0.5 + 0.24 / (1.0 + 0.11 * tau);
      vec3 amb = mix(skyBottom * 0.5, skyTop, smoothstep(0.0, 1.0, hn)) / (4.0 * 3.14159265) * 1.6;
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
  if (wSum <= 0.0) return;
  // The haze in front of the cloud.
  float d = dSum / wSum;
  vec3 hit = ro + rd * d;
  vec3 wp = vec3(hit.x * 1000.0, (length(hit) - uRg) * 1000.0, hit.z * 1000.0);
  vec3 Tair, ins;
  aerial(wp, vUv, Tair, ins);
  gl_FragColor = vec4(ins * (1.0 - Tl) + Tair * L, Tl);
}
`;

export function createClouds(renderer, atmosphere, opts = {}) {
  const params = { ...CLOUD_DEFAULTS, ...opts };
  const uniforms = {
    uWeather: { value: null },
    uCloudNoise: { value: makeNoise(params.seed) },
    uCloudLayer: { value: new THREE.Vector4() },
    uCloudWind: { value: new THREE.Vector2() },
    uCloudSigma: { value: params.density },
    uCloudRes: { value: new THREE.Vector2() },
    uCloudShadow: { value: 1 },
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
  }
  applyParams();

  const material = new THREE.ShaderMaterial({
    uniforms: { ...atmosphere.uniforms, ...uniforms },
    vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
    fragmentShader: FRAG,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), material);
  quad.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(quad);
  const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const target = new THREE.WebGLRenderTarget(4, 4, {
    type: THREE.HalfFloatType, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter, depthBuffer: false,
  });
  const size = new THREE.Vector2();
  let lastKey = '';

  return {
    params, uniforms, texture: target.texture, applyParams,
    // What the ground, sea and plants need for cloud shadows (CLOUD_SHADOW_GLSL).
    shadowUniforms: { uWeather: uniforms.uWeather, uCloudLayer: uniforms.uCloudLayer, uCloudWind: uniforms.uCloudWind, uCloudShadow: uniforms.uCloudShadow },
    // Drift with the clock, then march at half the drawing-buffer size. A still view with a
    // still clock (or drift under a metre) keeps the last march.
    render(time, camera) {
      const a = THREE.MathUtils.degToRad(params.windHeading);
      // Map coordinates are (x east, z south) in km; heading is a compass bearing.
      uniforms.uCloudWind.value.set(Math.sin(a), -Math.cos(a)).multiplyScalar(params.windSpeed * time);
      renderer.getDrawingBufferSize(size);
      const w = Math.max(1, Math.round(size.x / 2)), h = Math.max(1, Math.round(size.y / 2));
      const key = `${camera.matrixWorld.elements.join()}|${camera.projectionMatrix.elements.join()}|${w}x${h}|${Math.round(params.windSpeed * time * 1000)}|${JSON.stringify(params)}|${atmosphere.version}`;
      if (key === lastKey) return;
      lastKey = key;
      if (target.width !== w || target.height !== h) target.setSize(w, h);
      uniforms.uCloudRes.value.set(w, h);
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(target);
      renderer.render(scene, cam);
      renderer.setRenderTarget(prev);
    },
  };
}
