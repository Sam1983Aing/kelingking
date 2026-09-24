// The atmosphere: one physical model for the sky, the haze with distance, the colour of the
// sun at the ground and the light the sky casts on everything. See atmosphere-glsl.js.
//
// Units: kilometres inside the tables, metres in the scene, and light in kilolux (klux) and
// kilocandela per square metre (kcd/m2), so a sunny day is about 100 klux and the sky a
// few kcd/m2. The exposure (src/post/grade.js) turns that into pixels like a camera would.
//
// What it hands out:
//   uniforms       shared by every material that shows the sky or sits in the haze
//   sunIrradiance  sunlight arriving at the ground (THREE.Color, klux per channel)
//   sh             sky light as spherical harmonics, for three.js's LightProbe
//   update(camera) once per frame: re-renders the sky view and the haze froxels
//   relight()      when the sun or the air changes: sun colour, sky light, white balance

import * as THREE from 'three';
import {
  LUT_VERT, TRANSMITTANCE_FRAG, MULTISCAT_FRAG, SKYVIEW_FRAG, AERIAL_FRAG,
} from './atmosphere-glsl.js';

// Illuminance of the sun above the atmosphere: 1361 W/m2 at about 93 lm/W.
const SOLAR_KLUX = 127;
const SUN_ANGULAR_RADIUS = THREE.MathUtils.degToRad(0.2666);
const LUMA = [0.2126, 0.7152, 0.0722];

export const ATMOSPHERE_DEFAULTS = {
  // Rayleigh: Hillaire's Earth values (per km at sea level, for 680, 550 and 440 nm).
  rayleigh: [5.802e-3, 13.558e-3, 33.1e-3],
  rayleighH: 8,
  // Aerosols, in two layers. A light background (Hillaire's clear-air 0.004 per km times
  // haze, thinning out over 1.2 km), and the sea haze: salt and moisture packed into the
  // lowest few hundred metres over the water. Measured against the photos: the sky from 5 to
  // 32 degrees wants little aerosol above, and the far ridges (about 75% of their colour left
  // at 2 km) and the pale far sea want a lot near the water.
  mie: 3.996e-3,
  haze: 3,
  mieH: 1.2,
  seaHaze: 0.065,          // scattering per km at sea level
  seaHazeH: 0.35,          // km
  mieAbsorb: 0.05,         // absorption as a fraction of scattering (sea salt barely absorbs)
  // Angstrom exponent: 0 is grey haze (big particles); humid haze of small droplets scatters
  // blue more than red, which is why the far headlands in the photos go blue, not grey.
  angstrom: 0.8,
  mieG: 0.8,
  mieBack: 0.15,           // share of the backward phase lobe
  ozone: [0.650e-3, 1.881e-3, 0.085e-3],
  // What the sea and the land send back up, for multiple scattering and the light from below.
  groundAlbedo: [0.07, 0.09, 0.1],
  whiteBalance: 1,         // how far to neutralise the light (0 none, 1 fully)
  // What comes out neutral: 0 sunlight alone (a camera on its daylight setting), 1 sunlight
  // plus skylight on flat ground (a camera balancing on the scene).
  wbSky: 1,
};

export function createAtmosphere(renderer, opts = {}) {
  const params = { ...ATMOSPHERE_DEFAULTS, ...opts };

  const uniforms = {
    uRg: { value: 6360 },
    uRt: { value: 6460 },
    uRayScat: { value: new THREE.Vector3() },
    uRayH: { value: 8 },
    uMieScat: { value: 0 },
    uMieH: { value: 1.2 },
    uSeaScat: { value: 0 },
    uSeaH: { value: 0.35 },
    uMieAbs: { value: 0.05 },
    uMieSpectral: { value: new THREE.Vector3(1, 1, 1) },
    uMieG: { value: 0.8 },
    uMieBack: { value: 0 },
    uOzone: { value: new THREE.Vector3() },
    uGroundAlbedo: { value: new THREE.Vector3() },
    uTransLUT: { value: null },
    uMsLUT: { value: null },
    uSkyViewLUT: { value: null },
    uAerialLUT: { value: null },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uSunDirW: null,   // alias, filled in below
    uSunE: { value: new THREE.Vector3(SOLAR_KLUX, SOLAR_KLUX, SOLAR_KLUX) },
    uSunIrr: { value: new THREE.Color(100, 100, 100) },
    uSunRadiance: { value: new THREE.Vector3() },
    uSunCosAngle: { value: Math.cos(SUN_ANGULAR_RADIUS) },
    uSunCos: { value: 1 },
    uCamR: { value: 6360.1 },
    uCamPos: { value: new THREE.Vector3() },
    uCamFwd: { value: new THREE.Vector3() },
    uCamRight: { value: new THREE.Vector3() },
    uCamUp: { value: new THREE.Vector3() },
    uApMaxKm: { value: 160 },   // far enough for clouds on the horizon
    uResolution: { value: new THREE.Vector2(1, 1) },
    uSkySH: { value: Array.from({ length: 9 }, () => new THREE.Vector3()) },
    uSkyUp: { value: new THREE.Vector3() },   // sky light alone on flat ground (klux)
  };
  uniforms.uSunDirW = uniforms.uSunDir;

  function applyParams() {
    const u = uniforms;
    u.uRayScat.value.fromArray(params.rayleigh);
    u.uRayH.value = params.rayleighH;
    u.uMieScat.value = params.mie * params.haze;
    u.uMieH.value = params.mieH;
    u.uSeaScat.value = params.seaHaze;
    u.uSeaH.value = params.seaHazeH;
    u.uMieAbs.value = params.mieAbsorb;
    u.uMieSpectral.value.set(...mieSpectral(params));
    u.uMieG.value = params.mieG;
    u.uMieBack.value = params.mieBack;
    u.uOzone.value.fromArray(params.ozone);
    u.uGroundAlbedo.value.fromArray(params.groundAlbedo);
  }

  // ---------------------------------------------------------------- the passes
  const rt = (w, h, type = THREE.HalfFloatType) => new THREE.WebGLRenderTarget(w, h, {
    type, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping, depthBuffer: false, generateMipmaps: false,
  });
  const targets = {
    trans: rt(256, 64),
    ms: rt(32, 32),
    skyView: rt(192, 128),
    aerial: rt(256, 128),
    // Full float so it can be read back for the sky light.
    skyRef: rt(192, 128, THREE.FloatType),
  };
  uniforms.uTransLUT.value = targets.trans.texture;
  uniforms.uMsLUT.value = targets.ms.texture;
  uniforms.uSkyViewLUT.value = targets.skyView.texture;
  uniforms.uAerialLUT.value = targets.aerial.texture;

  const pass = (frag) => new THREE.ShaderMaterial({
    uniforms, vertexShader: LUT_VERT, fragmentShader: frag,
    depthTest: false, depthWrite: false, toneMapped: false,
  });
  const materials = {
    trans: pass(TRANSMITTANCE_FRAG),
    ms: pass(MULTISCAT_FRAG),
    skyView: pass(SKYVIEW_FRAG),
    aerial: pass(AERIAL_FRAG),
  };
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const quadScene = new THREE.Scene();
  quadScene.add(quad);
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  function draw(material, target) {
    quad.material = material;
    const prev = renderer.getRenderTarget();
    const xr = renderer.xr.enabled; renderer.xr.enabled = false;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
    renderer.setRenderTarget(prev);
    renderer.xr.enabled = xr;
  }

  // Tables that only depend on the air: when it changes.
  function precompute() {
    applyParams();
    draw(materials.trans, targets.trans);
    draw(materials.ms, targets.ms);
    lastSkyKey = '';
    lastApKey = '';
    version++;
  }

  // ---------------------------------------------------------------- per frame
  let lastSkyKey = '', lastApKey = '';
  let version = 0;   // bumped whenever the air or the light changes (the clouds cache on it)
  const fwd = new THREE.Vector3(), right = new THREE.Vector3(), up = new THREE.Vector3();
  const size = new THREE.Vector2();
  function update(camera) {
    const u = uniforms;
    camera.updateMatrixWorld();
    const h = Math.max(camera.position.y, 0.5);
    u.uCamPos.value.set(camera.position.x, h, camera.position.z);
    u.uCamR.value = u.uRg.value + h / 1000;
    const sd = u.uSunDir.value;
    u.uSunCos.value = sd.y;
    // The sky view only changes with the camera's height and the sun.
    const key = `${h.toFixed(1)}|${sd.x.toFixed(5)},${sd.y.toFixed(5)},${sd.z.toFixed(5)}|${u.uMieScat.value},${u.uSeaScat.value},${u.uSeaH.value}`;
    if (key !== lastSkyKey) {
      lastSkyKey = key;
      draw(materials.skyView, targets.skyView);
      // The sun's disc, as seen through the air above the camera.
      const T = transmittance(h / 1000, sd.y, params);
      const solid = Math.PI * SUN_ANGULAR_RADIUS * SUN_ANGULAR_RADIUS;
      u.uSunRadiance.value.set(u.uSunE.value.x * T[0], u.uSunE.value.y * T[1], u.uSunE.value.z * T[2]).multiplyScalar(1 / solid);
    }
    const e = camera.matrixWorld.elements;
    fwd.set(-e[8], -e[9], -e[10]).normalize();
    right.set(e[0], e[1], e[2]).normalize();
    up.set(e[4], e[5], e[6]).normalize();
    const ty = Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) / (camera.zoom || 1);
    u.uCamFwd.value.copy(fwd);
    u.uCamRight.value.copy(right).multiplyScalar(ty * camera.aspect);
    u.uCamUp.value.copy(up).multiplyScalar(ty);
    renderer.getDrawingBufferSize(size);
    u.uResolution.value.copy(size);
    // The haze froxels follow the camera: redrawn when it moves (or the sun, or the air).
    const apKey = `${e.join()}|${ty}|${camera.aspect}|${key}`;
    if (apKey !== lastApKey) {
      lastApKey = apKey;
      draw(materials.aerial, targets.aerial);
    }
  }

  // ---------------------------------------------------------------- sun and sky light
  const sunIrradiance = new THREE.Color();
  const sh = new THREE.SphericalHarmonics3();      // sky, and a generic ground below the horizon
  const shSky = new THREE.SphericalHarmonics3();   // sky alone, for surfaces that work out their own ground light
  let refPixels = null;
  // The sky as seen from near the ground (50 m), which is what lights the ground.
  const REF_KM = 0.05;
  // Sun and sky light at the ground for a sun direction, for a sun of unit illuminance above
  // the atmosphere: the sky view from the reference height, read back and projected.
  function lightFor(sd) {
    const u = uniforms;
    const keepR = u.uCamR.value, keepCos = u.uSunCos.value;
    u.uCamR.value = u.uRg.value + REF_KM;
    u.uSunCos.value = sd.y;
    draw(materials.skyView, targets.skyRef);
    u.uCamR.value = keepR; u.uSunCos.value = keepCos;
    refPixels ??= new Float32Array(192 * 128 * 4);
    renderer.readRenderTargetPixels(targets.skyRef, 0, 0, 192, 128, refPixels);
    const Tsun = transmittance(REF_KM, sd.y, params);
    const cosZ = Math.max(sd.y, 0);
    const shUnit = projectSky(refPixels, sd, u.uRg.value + REF_KM, u.uRg.value, () => null);
    // Irradiance on flat ground from the sky alone, then the ground's own glow below the
    // horizon from sun plus sky, and project again with it.
    const skyUp = irradianceUp(shUnit);
    const Eh = [0, 1, 2].map((c) => Tsun[c] * cosZ + skyUp[c]);
    const g = params.groundAlbedo;
    const ground = [0, 1, 2].map((c) => g[c] * Eh[c] / Math.PI);
    const shFull = projectSky(refPixels, sd, u.uRg.value + REF_KM, u.uRg.value, () => ground);
    return { Tsun, cosZ, shUnit, skyUp, Eh, shFull };
  }

  // White balance, like a camera: the chosen light (see wbSky) under the reference sun comes
  // out neutral, at the luminance an uncoloured sun would have given. The reference is the
  // sun of the photo day (setWhiteBalanceSun), and the balance is held when the sun moves, so
  // a late afternoon comes out golden instead of being neutralised like a daylight preset
  // would not.
  const wbSun = new THREE.Vector3(0, 1, 0);
  let wbKey = '', wbGains = [1, 1, 1];
  function whiteBalance() {
    const key = `${wbSun.toArray().map((v) => v.toFixed(5))}|${JSON.stringify(params)}`;
    if (key === wbKey) return wbGains;
    wbKey = key;
    const L = lightFor(wbSun);
    const ref = [0, 1, 2].map((c) => L.Tsun[c] * L.cosZ + L.skyUp[c] * params.wbSky);
    const lumRef = ref[0] * LUMA[0] + ref[1] * LUMA[1] + ref[2] * LUMA[2];
    const lumEh = L.Eh[0] * LUMA[0] + L.Eh[1] * LUMA[1] + L.Eh[2] * LUMA[2];
    const wb = ref.map((v) => Math.pow(lumRef / v, params.whiteBalance));
    const norm = lumEh / (L.Eh[0] * wb[0] * LUMA[0] + L.Eh[1] * wb[1] * LUMA[1] + L.Eh[2] * wb[2] * LUMA[2]);
    wbGains = wb.map((w) => w * norm);
    return wbGains;
  }

  function relight() {
    const u = uniforms;
    applyParams();
    const wb = whiteBalance();
    const { Tsun, shUnit, skyUp, shFull } = lightFor(u.uSunDir.value);
    const E = wb.map((w) => SOLAR_KLUX * w);
    u.uSunE.value.set(E[0], E[1], E[2]);
    sunIrradiance.setRGB(E[0] * Tsun[0], E[1] * Tsun[1], E[2] * Tsun[2], THREE.LinearSRGBColorSpace);
    u.uSunIrr.value.copy(sunIrradiance);
    for (let i = 0; i < 9; i++) {
      const c = shFull[i], cs = shUnit[i];
      sh.coefficients[i].set(c[0] * E[0], c[1] * E[1], c[2] * E[2]);
      shSky.coefficients[i].set(cs[0] * E[0], cs[1] * E[1], cs[2] * E[2]);
      u.uSkySH.value[i].copy(sh.coefficients[i]);
    }
    u.uSkyUp.value.set(skyUp[0] * E[0], skyUp[1] * E[1], skyUp[2] * E[2]);
    lastSkyKey = '';
    lastApKey = '';
    version++;
    const upIrr = irradianceUp(sh.coefficients.map((v) => [v.x, v.y, v.z]));
    return { sunIrradiance: sunIrradiance.clone(), skyUp: upIrr, Tsun, wb };
  }

  applyParams();
  precompute();

  return {
    params, uniforms, targets, sunIrradiance, sh, shSky,
    precompute, update, relight,
    get version() { return version; },
    setSun(dir) { uniforms.uSunDir.value.copy(dir).normalize(); },
    setWhiteBalanceSun(dir) { wbSun.copy(dir).normalize(); },
  };
}

// ---------------------------------------------------------------- CPU side

// Transmittance from height h (km) to the top of the atmosphere, toward a direction whose
// cosine with the vertical is mu. Same model as the GPU table, integrated directly.
export function transmittance(h, mu, p, Rg = 6360, Rt = 6460) {
  const r = Rg + h;
  const disc = r * r * (mu * mu - 1) + Rt * Rt;
  const tMax = -r * mu + Math.sqrt(Math.max(disc, 0));
  const N = 400;
  const tau = [0, 0, 0];
  const spec = mieSpectral(p);
  let prev = 0;
  for (let i = 0; i < N; i++) {
    const f = (i + 1) / N, t = tMax * f * f, tm = 0.5 * (t + prev), dt = t - prev;
    prev = t;
    const x = tm * Math.sqrt(Math.max(1 - mu * mu, 0)), y = r + tm * mu;
    const hh = Math.max(Math.hypot(x, y) - Rg, 0);
    const dR = Math.exp(-hh / p.rayleighH);
    const mie = (p.mie * p.haze * Math.exp(-hh / p.mieH) + p.seaHaze * Math.exp(-hh / p.seaHazeH)) * (1 + p.mieAbsorb);
    const dO = Math.max(0, 1 - Math.abs(hh - 25) / 15);
    for (let c = 0; c < 3; c++) tau[c] += (p.rayleigh[c] * dR + mie * spec[c] + p.ozone[c] * dO) * dt;
  }
  return tau.map((t) => Math.exp(-t));
}

// Aerosol scattering per channel relative to 550 nm, for wavelengths 680, 550 and 440 nm.
export const mieSpectral = (p) => [680, 550, 440].map((l) => Math.pow(l / 550, -p.angstrom));

// Sky-view table lookup on the CPU (same mapping as SKYVIEW_MAP), bilinear.
function skyViewSample(px, r, Rg, viewZenithCos, lightViewCos) {
  const W = 192, H = 128;
  const vHorizon = Math.sqrt(Math.max(r * r - Rg * Rg, 0));
  const beta = Math.acos(Math.min(1, vHorizon / r));
  const zh = Math.PI - beta;
  const vz = Math.acos(Math.max(-1, Math.min(1, viewZenithCos)));
  let v;
  if (vz < zh) v = (1 - Math.sqrt(1 - Math.min(1, vz / zh))) * 0.5;
  else v = Math.sqrt(Math.min(1, (vz - zh) / beta)) * 0.5 + 0.5;
  const uu = Math.sqrt(Math.max(0, Math.min(1, -lightViewCos * 0.5 + 0.5)));
  const fx = uu * (W - 1), fy = v * (H - 1);
  const x0 = Math.min(W - 2, Math.floor(fx)), y0 = Math.min(H - 2, Math.floor(fy));
  const ax = fx - x0, ay = fy - y0;
  const out = [0, 0, 0];
  for (let c = 0; c < 3; c++) {
    const a = px[(y0 * W + x0) * 4 + c], b = px[(y0 * W + x0 + 1) * 4 + c];
    const d = px[((y0 + 1) * W + x0) * 4 + c], e = px[((y0 + 1) * W + x0 + 1) * 4 + c];
    out[c] = (a * (1 - ax) + b * ax) * (1 - ay) + (d * (1 - ax) + e * ax) * ay;
  }
  return out;
}

// Project the sky (from the read-back table) onto spherical harmonics, three.js basis.
// Below the horizon, below(dir) gives the radiance of the ground, or null for the air only.
function projectSky(px, sunDir, r, Rg, below) {
  const coef = Array.from({ length: 9 }, () => [0, 0, 0]);
  const NT = 96, NP = 96;
  const basis = new Array(9);
  const dir = new THREE.Vector3();
  const sunAz = Math.atan2(sunDir.z, sunDir.x);
  const horizonCos = -Math.sqrt(Math.max(1 - (Rg / r) ** 2, 0));
  for (let i = 0; i < NT; i++) {
    const th = ((i + 0.5) / NT) * Math.PI;
    const dOmega = Math.sin(th) * (Math.PI / NT) * ((2 * Math.PI) / NP);
    for (let j = 0; j < NP; j++) {
      const ph = ((j + 0.5) / NP) * 2 * Math.PI;
      dir.set(Math.sin(th) * Math.cos(ph), Math.cos(th), Math.sin(th) * Math.sin(ph));
      let L = skyViewSample(px, r, Rg, dir.y, Math.cos(ph - sunAz));
      if (dir.y < horizonCos) {
        const g = below(dir);
        if (g) L = [L[0] + g[0], L[1] + g[1], L[2] + g[2]];
      }
      THREE.SphericalHarmonics3.getBasisAt(dir, basis);
      for (let k = 0; k < 9; k++) {
        const w = basis[k] * dOmega;
        coef[k][0] += L[0] * w; coef[k][1] += L[1] * w; coef[k][2] += L[2] * w;
      }
    }
  }
  return coef;
}

function evalIrradiance(c, n) {
  const x = n.x, y = n.y, z = n.z;
  const k = [0.886227, 1.023328 * y, 1.023328 * z, 1.023328 * x, 0.858086 * x * y, 0.858086 * y * z,
    0.743125 * z * z - 0.247708, 0.858086 * x * z, 0.429043 * (x * x - y * y)];
  return [0, 1, 2].map((ch) => c.reduce((s, v, i) => s + v[ch] * k[i], 0));
}
const irradianceUp = (c) => evalIrradiance(c, { x: 0, y: 1, z: 0 });
