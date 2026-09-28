// The scene itself: renderer, sky, sea, ground, path and plants, the terrain worker, and the
// work done every frame. Shared by the landing page (src/scroll/) and the tools (src/debug.js),
// which each decide where the camera goes and how big the canvas is. Split out of main.js in v8.
//
// URL switches read here (the tool-only ones are listed in debug.js):
//   q=2048             heightfield resolution (default 1024, 2048 when capturing)
//   t=12               freeze the clock at this many seconds (the sea animates)
//   debug=1..10        water debug view: sediment, see-through, foam (surf, whitecaps, fresh),
//                      underwater light, normals, unseen slope spread, rock coast (near,
//                      exposure, openness), foam simulation (foam, sand, travel), breaker
//                      (across, stage, thickness), 10 the swash (sheet, foam, thickness).
//                      Skips the tone curve.
//   sprayDebug=1..4    spray: at each breaker column's crest, at its site, as it flies, rock sites
//   w.name=value       any water setting (src/water/water.js), o.name= the wave spectrum
//                      (ocean.js), s.name= the foam simulation (surf-sim.js)
//   hide=terrain,water leave objects out (for tracking down which one draws what)
//   clay=1             plain grey ground, to judge the shape on its own (2: flat triangles)
//   pr=1               pin the pixel ratio and turn the resolution governor off (for measuring)
//   hour=11.96         local time on the photo's day (6 April 2025), sets the sun
//   sun=az,el          or set the sun directly, compass heading and elevation in degrees
//   haze=3             background aerosol (1 = clear continental air); seaHaze=0.065 the
//                      haze layer over the water, per km (more switches in src/sky/atmosphere.js)
//   ev=0               exposure compensation in stops
//   clouds=0           no clouds; bounce=0 no light bounced up from the ground (A/B checks)
//   clouds.name=value  (v9) coverage, density, base, top, clearRadius, bank, high, seed
//                      (src/sky/clouds.js); cloudDefines=LIGHT_STEPS:3,FINE_DIV:4.0 its shader's
//                      step counts and shape constants, for timing (tools/cloud-bench.mjs)
//   trail=0            no path (v6): the ground uncarved, no steps, rails or plants cleared for it
//   faceStep=0.55      spacing of the face strips' vertices near the headland (metres)
//   vegDetail=1        (v7) how far the full plants reach before their lighter level (0: none)
//   vegHide=near:grass,impostor   (v7) leave out plant meshes by the start of their names
//   lab=x,y[,gap]      (v7) instead of the scattered plants, one of every species and variant in
//                      a row across the map from (x, y) east, gap metres apart (for looking at them)
//   terrainDebug=1..5  ground debug views: sun shadow, sky share, overhang horizon, lit
//                      ground share, carved depth (terrain-shader.js)

import * as THREE from 'three';
import { defaultLayout } from './terrain/layout.js';
import { createTerrain, sample } from './terrain/terrain-mesh.js';
import { createWater } from './water/water.js';
import { createAtmosphere } from './sky/atmosphere.js';
import { createSkyDome } from './sky/sky-dome.js';
import { createClouds } from './sky/clouds.js';
import { PHOTO_DAY, PHOTO_HOUR, sunAtHour } from './sky/sun.js';
import { createGrade } from './post/grade.js';
import { createSunShadow } from './terrain/sun-shadow.js';
import { loadSurfaceTextures } from './terrain/surface-textures.js';
import { createVegetation } from './veg/plants.js';
import { SPECIES } from './veg/scatter.js';
import { createTrail } from './trail/trail.js';
import { decodeBake } from './terrain/bake-format.js';

// Where the assets are (v11): next to the page, or, in the standalone build, on the CDN it sets
// in globalThis.__klAssets ({ textures, bake }).
export const ASSETS = globalThis.__klAssets ?? { textures: 'assets/textures/', bake: 'assets/terrain/terrain-1024.bin' };

// capture: a still for the tools (pixel ratio 1, 2048 terrain, the drawing buffer kept for
// screenshots). keepBuffer: keep the drawing buffer without the rest (recording the scroll).
// maxPixelRatio: the resolution governor's ceiling.
export function createApp({ params, capture = false, keepBuffer = false, maxPixelRatio = 1.5 } = {}) {
  const deg = THREE.MathUtils.degToRad;
  const state = {
    quality: +(params.get('q') || (capture ? 2048 : 1024)),
    contours: params.get('contours') === '1',
    clay: +(params.get('clay') || 0),
    // The sun where it was when the viewpoint photo was taken (src/sky/sun.js).
    hour: +(params.get('hour') ?? PHOTO_HOUR),
    sunAz: 0,
    sunEl: 0,
  };
  const layout = defaultLayout();
  if (params.has('faceStep')) layout.mesh.faceStep[0] = +params.get('faceStep');
  if (params.get('trail') === '0') layout.trail = null;
  const FIXED_T = params.has('t') ? +params.get('t') : null;
  let simTime = FIXED_T ?? 0;
  const timeCtl = { paused: false, speed: 1 };

  // Something to listen to while the page loads: 'terrain', 'textures', 'plants', 'trail',
  // then 'loaded' once all of them are in.
  const listeners = {};
  const on = (name, fn) => { (listeners[name] ??= []).push(fn); };
  // (Each also a performance mark, kl:name, for tools/load-time.mjs, v11.)
  const emit = (name, ...a) => { performance.mark('kl:' + name); (listeners[name] ?? []).forEach((fn) => fn(...a)); };

  // ---------------------------------------------------------------- renderer and scene

  // Reversed depth (float, 1 at the near plane) keeps precision from 0.3 m to 30 km. A
  // logarithmic depth buffer would too, but it writes depth from the fragment shader, which
  // turns off early depth testing, and then every hidden layer of ground gets fully shaded.
  const renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true, preserveDrawingBuffer: capture || keepBuffer });
  const MAX_PR = Math.min(devicePixelRatio, maxPixelRatio);
  renderer.setPixelRatio(capture ? 1 : MAX_PR);
  // Exposure from the viewpoint photo's EXIF, tone curve and grade (src/post/grade.js). Has to
  // be set up before any material compiles.
  const gradeOpts = { ev100: PHOTO_DAY.ev100 };
  if (params.has('ev')) gradeOpts.compensation = +params.get('ev');
  if (params.has('contrast')) gradeOpts.contrast = +params.get('contrast');
  if (params.has('saturation')) gradeOpts.saturation = +params.get('saturation');
  const grade = createGrade(renderer, gradeOpts);
  // No shadow map: the ground and the sea both march their own sun shadows through the height
  // data, which a shadow map cannot match on 100 m faces drawn from thin triangles.
  renderer.shadowMap.enabled = false;

  const scene = new THREE.Scene();

  // Far enough for the sea to reach the horizon from the air (118 km from 1 km up).
  const camera = new THREE.PerspectiveCamera(57, 1, 0.3, 400000);
  camera.rotation.order = 'YXZ';

  // One atmosphere for the sky, the haze, the sun's colour and the sky light (src/sky/).
  const atmoOpts = {};
  for (const k of ['haze', 'mieH', 'seaHaze', 'seaHazeH', 'mieG', 'angstrom', 'whiteBalance', 'wbSky', 'mieBack']) if (params.has(k)) atmoOpts[k] = +params.get(k);
  const atmosphere = createAtmosphere(renderer, atmoOpts);
  // Fair-weather cumulus, marched at half resolution and blended in by the sky, and their
  // shadows on everything else (src/sky/clouds.js).
  const cloudOpts = {};
  for (const k of ['coverage', 'density', 'base', 'top', 'clearRadius', 'bank', 'high', 'seed']) if (params.has('clouds.' + k)) cloudOpts[k] = +params.get('clouds.' + k);
  if (params.has('cloudDefines')) cloudOpts.defines = Object.fromEntries(params.get('cloudDefines').split(',').map((kv) => kv.split(':')));
  const clouds = createClouds(renderer, atmosphere, cloudOpts);
  if (params.get('clouds') === '0') clouds.uniforms.uCloudShadow.value = 0;
  // What every lit material shares: sun, sky light, haze, cloud shadows.
  const lightUniforms = { ...atmosphere.uniforms, ...clouds.shadowUniforms };
  // w.name=value sets a water parameter, o.name=value an ocean spectrum one (src/water/),
  // numbers or comma-separated lists.
  const urlParams = (prefix) => {
    const o = {};
    const parse = (v) => (v === 'true' ? true : v === 'false' ? false : v.includes(',') ? v.split(',').map(Number) : isNaN(+v) ? v : +v);
    for (const [k, v] of params) if (k.startsWith(prefix)) o[k.slice(prefix.length)] = parse(v);
    return o;
  };
  const water = createWater(renderer, lightUniforms, grade.uniforms, urlParams('o.'), urlParams('s.'));
  Object.assign(water.params, urlParams('w.'));
  water.applyParams();
  const skyDome = createSkyDome(atmosphere, grade.uniforms);
  const sky = skyDome.mesh;
  scene.add(sky);
  // (The clouds swap between two targets: the sky reads whichever is current.)
  skyDome.material.uniforms.uClouds = clouds.output;
  skyDome.material.uniforms.uHasClouds.value = params.get('clouds') === '0' ? 0 : 1;

  // The sky's light on the ground, as spherical harmonics from the atmosphere.
  const skyLight = new THREE.LightProbe();
  scene.add(skyLight);
  const sun = new THREE.DirectionalLight(0xffffff, 1);
  sun.target.position.set(100, 0, -100);
  scene.add(sun, sun.target);
  let shadowDirty = true;
  function placeSun() {
    if (params.has('sun')) {
      [state.sunAz, state.sunEl] = params.get('sun').split(',').map(Number);
    } else {
      const p = sunAtHour(state.hour);
      state.sunAz = +p.azimuth.toFixed(2);
      state.sunEl = +p.elevation.toFixed(2);
    }
    const az = deg(state.sunAz), el = deg(state.sunEl), d = 2500, t = sun.target.position;
    // The camera's white balance is set for the photo's light and kept when the sun moves.
    const ps = sunAtHour(PHOTO_HOUR), pa = deg(ps.azimuth), pe = deg(ps.elevation);
    atmosphere.setWhiteBalanceSun(new THREE.Vector3(Math.cos(pe) * Math.sin(pa), Math.sin(pe), -Math.cos(pe) * Math.cos(pa)));
    sun.position.set(t.x + d * Math.cos(el) * Math.sin(az), d * Math.sin(el), t.z - d * Math.cos(el) * Math.cos(az));
    atmosphere.setSun(sun.position.clone().sub(t));
    relight();
    shadowDirty = true;
  }
  // The sun's colour at the ground and the sky light both come out of the atmosphere.
  function relight() {
    const r = atmosphere.relight();
    sun.color.copy(r.sunIrradiance);
    sun.intensity = 1;
    // The ground works out the light bounced up from what lies below it (sand, sea, scrub)
    // itself, so its probe carries the sky alone.
    skyLight.sh.copy(atmosphere.shSky);
    water.uniforms.uSkyIrr.value.setRGB(...r.skyUp);
    window.__light = { sun: r.sunIrradiance.toArray().map((v) => +v.toFixed(2)), skyUp: r.skyUp.map((v) => +v.toFixed(2)),
      transmittance: r.Tsun.map((v) => +v.toFixed(3)), whiteBalance: r.wb.map((v) => +v.toFixed(3)), sunAz: state.sunAz, sunEl: state.sunEl };
  }
  placeSun();

  scene.add(water.mesh);
  water.uniforms.uDebug.value = +(params.get('debug') || 0);
  water.spray.uniforms.uSprayDebug.value = +(params.get('sprayDebug') || 0);

  const terrain = createTerrain(lightUniforms, grade.uniforms);
  scene.add(terrain.mesh);
  if (params.get('bounce') === '0') terrain.uniforms.uBounceAlb.value.forEach((v) => v.set(0, 0, 0));
  // Cloud shadows on the island only when clouds can get over it (the ground shader leaves
  // them out otherwise; it is the most expensive shader on screen). Clouds start at the clear
  // radius, and with the sun near overhead their shadows fall within a few hundred metres of
  // them, beyond the 1.6 km of modelled ground from 1.2 km out.
  function terrainCloudShadows() {
    const onIsland = clouds.params.clearRadius < 1.2 && clouds.uniforms.uCloudShadow.value > 0;
    const m = terrain.mesh.material;
    if (!!m.defines?.TERRAIN_CLOUDS !== onIsland) {
      m.defines = { ...m.defines };
      if (onIsland) m.defines.TERRAIN_CLOUDS = 1; else delete m.defines.TERRAIN_CLOUDS;
      m.needsUpdate = true;
    }
  }
  terrainCloudShadows();
  if (params.has('terrainDebug')) terrain.mesh.material.defines = { ...terrain.mesh.material.defines, TERRAIN_DEBUG: +params.get('terrainDebug') };
  terrain.uniforms.uContours.value = state.contours ? 1 : 0;
  terrain.uniforms.uClay.value = state.clay;
  const sunShadow = createSunShadow(renderer);
  let texturesReady = false;
  let plants = null, plantsReady = false;
  const hidden = new Set((params.get('hide') || '').split(','));
  createVegetation(renderer, { ...lightUniforms, ...grade.uniforms }, { detailScale: +(params.get('vegDetail') ?? 1), hideParts: (params.get('vegHide') || '').split(',').filter(Boolean) })
    .then((p) => {
      plants = p;
      plants.group.visible = !hidden.has('plants');
      scene.add(plants.group);
      if (hf) plants.setInstances(hf.plants);
      plantsReady = true;
      emit('plants', plants);
      checkLoaded();
    })
    .catch((e) => { console.error('plants failed', e); plantsReady = true; checkLoaded(); });
  loadSurfaceTextures(ASSETS.textures).then((t) => { terrain.setSurfaces(t); texturesReady = true; emit('textures'); checkLoaded(); })
    // (Without the scans the ground's own noise stands in; the page still has to go on, or the
    // loader waits for this step forever, v10.)
    .catch((e) => { console.error('surface textures failed', e); texturesReady = true; emit('textures'); checkLoaded(); });
  terrain.uniforms.uSunShadow = water.uniforms.uSunShadow; // and the same baked shadow
  // The swash on the sand runs on the sea's clock and settings, and the sheet over it sees the
  // ground's wet sand through it.
  for (const k of ['uTime', 'uPeriod', 'uRunup', 'uSwashT', 'uSwashMap', 'uSwashRect']) terrain.uniforms[k] = water.uniforms[k];
  water.uniforms.uWetSandAlb.value.setRGB(...terrain.uniforms.uSandAlb.value.toArray().map((v, i) => v * terrain.uniforms.uWetTint.value.getComponent(i)));
  // The path and what stands along it (src/trail/, v6), lit like the ground.
  const trail = createTrail({ ...lightUniforms }, grade.uniforms, { uExtent: terrain.uniforms.uExtent, uSunShadow: water.uniforms.uSunShadow });
  scene.add(trail.group);
  trail.uniforms.uClayT.value = state.clay ? 1 : 0;
  let trailReady = false;
  trail.ready.then(() => { trailReady = true; emit('trail'); checkLoaded(); });
  for (const name of hidden) {
    if (name === 'trail') trail.group.visible = false;
    if (name === 'terrain') terrain.mesh.visible = false;
    if (name === 'water') water.mesh.visible = false;
    if (name === 'sky') sky.visible = false;
  }

  // ---------------------------------------------------------------- terrain generation

  let hf = null;
  let genId = 0;
  // Frames drawn since everything came in (-1 until then): a capture waits for a few.
  let loadedFrames = -1;
  let loadedSent = false;
  function checkLoaded() {
    if (loadedSent || !hf || !texturesReady || !plantsReady || !trailReady) return;
    loadedSent = true;
    emit('loaded');
  }
  // The terrain comes from the worker, or (v11) from the bake: the worker's output at the page's
  // resolution, baked by tools/bake-terrain.mjs into a file that downloads in a second or two
  // instead of taking 8 s to generate. The tools (q=2048) and any change to the layout from the
  // URL generate it; bake=0 forces that.
  let worker = null;
  function startWorker() {
    if (worker) return;
    // The standalone build cannot start a worker from file://: it sets globalThis.__klGenerate
    // (the worker's generateAll) and the terrain is generated on the page, which freezes it for
    // several seconds. Only when the bake cannot be downloaded (offline).
    if (globalThis.__klGenerate) {
      worker = { postMessage: (m) => setTimeout(() => receive(globalThis.__klGenerate(m)[0]), 50) };
      return;
    }
    worker = new Worker(new URL('./terrain/worker.js', import.meta.url), { type: 'module' });
    // Errors in the worker do not reach the page's console on their own.
    worker.onerror = (e) => console.error('terrain worker failed:', e.message, e.filename, e.lineno);
    worker.onmessage = (e) => receive(e.data);
  }
  const canBake = !capture && state.quality === 1024 && params.get('bake') !== '0'
    && !['faceStep', 'trail', 'lab'].some((k) => params.has(k));
  async function loadBake() {
    const res = await fetch(ASSETS.bake);
    if (!res.ok) throw new Error(`${res.status}`);
    let buf = new Uint8Array(await res.arrayBuffer());
    // (Gzipped by the bake tool; a server that sent it with Content-Encoding has undone that.)
    if (buf[0] === 0x1f && buf[1] === 0x8b) buf = new Uint8Array(await new Response(new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer());
    const data = decodeBake(buf);
    // Out of date? The layout always; the generator's sources when they can be read (the page
    // served from a working copy). Either way the worker makes it instead.
    const hex = async (str) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str)))].map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 16);
    if (crypto?.subtle) {
      if (data.bake.layoutHash !== await hex(JSON.stringify(layout))) throw new Error('the layout has changed since the bake');
      if (/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname)) {
        const texts = await Promise.all(data.bake.sources.map((f) => fetch(f).then((r) => r.text())));
        if (data.bake.sourceHash !== await hex(data.bake.sources.map((f, i) => f + '\n' + texts[i]).join('\n'))) throw new Error('the terrain code has changed since the bake (node tools/bake-terrain.mjs)');
      }
    }
    return data;
  }
  function receive(data) {
    if (data.id !== genId) return;
    hf = data;
    terrain.update(hf);
    const tex = new THREE.DataTexture(hf.water, hf.N, hf.N, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    const dir = new THREE.DataTexture(hf.shoreDir, hf.N, hf.N, THREE.RGBAFormat);
    dir.minFilter = THREE.LinearFilter;
    dir.magFilter = THREE.LinearFilter;
    dir.needsUpdate = true;
    const coast = new THREE.DataTexture(hf.coast, hf.N, hf.N, THREE.RGBAFormat, THREE.HalfFloatType);
    coast.minFilter = THREE.LinearFilter;
    coast.magFilter = THREE.LinearFilter;
    coast.needsUpdate = true;
    water.uniforms.uData.value?.dispose();
    water.uniforms.uShoreDir.value?.dispose();
    water.uniforms.uCoast.value?.dispose();
    water.setData(tex, dir, hf.extent, coast);
    if (hf.breakers) water.setBreakers(hf.breakers, hf.rockSites);
    terrain.setData(tex, hf.extent, layout.beach.top);
    if (params.has('lab')) hf.plants = labPlants(hf);
    plants?.setInstances(hf.plants);
    trail.update(hf.trail);
    shadowDirty = true;
    loadedFrames = 0;
    emit('terrain', hf);
    checkLoaded();
  };
  function regenerate() {
    genId++;
    emit('generating');
    startWorker();
    worker.postMessage({ id: genId, layout, N: state.quality, M: state.quality >= 2048 ? 2049 : 1025 });
  }
  // lab=x,y[,gap]: every species and variant in a row, for looking at them one by one.
  function labPlants(h) {
    const [x0, y0, gap = 8] = params.get('lab').split(',').map(Number);
    const out = [];
    let x = x0;
    SPECIES.forEach((sp, k) => sp.heights.forEach((_, v) => {
      const y = y0;
      // (Hanging plants hang in the air, to be seen whole.)
      out.push(x, sample(h.heights, h.N, h.cell, h.extent.x0, h.extent.y0, x, y) - 0.05 + (sp.id === 'creeper' ? 4 : 0), -y, 1, 0.6, k, v, 0.5);
      x += gap * (sp.id === 'palm' ? 1.5 : sp.id === 'grass' ? 0.5 : 1);
    }));
    return { data: new Float32Array(out), count: out.length / 8, shrubs: out.length / 8 };
  }
  let regenTimer = 0;
  const regenerateSoon = () => { clearTimeout(regenTimer); regenTimer = setTimeout(regenerate, 250); };
  if (canBake) {
    genId = 1;
    emit('generating');
    const t0 = performance.now();
    loadBake().then((data) => { data.id = genId; data.baked = Math.round(performance.now() - t0); receive(data); })
      .catch((e) => { console.warn(`terrain bake not used (${e.message}): generating it`); regenerate(); });
  } else regenerate();

  const groundAt = (x, y) => (hf ? sample(hf.heights, hf.N, hf.cell, hf.extent.x0, hf.extent.y0, x, y) : 0);

  // ---------------------------------------------------------------- camera and size

  // A camera in the shots' terms: position [east, north, height], compass yaw, pitch and roll
  // in degrees, vertical fov.
  function setPose(pos, yaw, pitch, roll = 0, fov = camera.fov) {
    camera.position.set(pos[0], pos[2], -pos[1]);
    camera.rotation.set(deg(pitch), -deg(yaw), deg(roll), 'YXZ');
    if (fov !== camera.fov) { camera.fov = fov; camera.updateProjectionMatrix(); }
  }
  function setSize(w, h) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // A capture waits for a few whole frames at the final size (the clouds and haze tables
    // follow the drawing buffer).
    if (loadedFrames > 0) loadedFrames = 0;
  }

  // Dynamic resolution: drop the pixel ratio when frames run long, raise it when there is room.
  const FIXED_PR = params.has('pr') ? +params.get('pr') : null;
  const governor = { on: !capture && !FIXED_PR, pr: capture ? 1 : MAX_PR, max: MAX_PR, min: 0.85, avg: 16, onChange: null };
  if (FIXED_PR) { governor.pr = FIXED_PR; renderer.setPixelRatio(FIXED_PR); }
  function governResolution(dt) {
    if (!governor.on) return;
    governor.avg += (dt * 1000 - governor.avg) * 0.05;
    const next = governor.avg > 22 ? Math.max(governor.min, governor.pr - 0.1) : governor.avg < 13 ? Math.min(governor.max, governor.pr + 0.05) : governor.pr;
    if (Math.abs(next - governor.pr) > 0.01) {
      governor.pr = next;
      renderer.setPixelRatio(next);
      governor.onChange?.(next);
      governor.avg = 16;
    }
  }

  // ---------------------------------------------------------------- frame

  // Everything a frame draws: the haze froxels and sky view, the clouds, then the scene. The
  // bench in capture.mjs times this.
  function renderFrame() {
    // The plants near the camera are picked for where it is now (near.js).
    if (plants) plants.update(hf?.extent, camera, simTime);
    atmosphere.update(camera);
    if (sky.visible && skyDome.material.uniforms.uHasClouds.value && skyInView()) clouds.render(simTime, camera);
    renderer.render(scene, camera);
  }
  // Whether any of the view looks above the horizon (the clouds are only marched then).
  const corner = new THREE.Vector3();
  function skyInView() {
    for (const [x, y] of [[-1, 1], [1, 1], [-1, -1], [1, -1], [0, 1]]) {
      corner.set(x, y, 0.5).unproject(camera).sub(camera.position);
      if (corner.y > -0.02 * corner.length()) return true;
    }
    return false;
  }
  // The sea's clock and its passes, the sun's shadow when it moved. `beforeRender` places the
  // camera (the scroll, the tools' free camera).
  function advance(dt) {
    if (FIXED_T === null && !timeCtl.paused) simTime += dt * timeCtl.speed;
    water.update(simTime, camera, renderer);
    if (plants) plants.uniforms.uSunShadow.value = water.uniforms.uSunShadow.value;
    if (shadowDirty && hf) {
      shadowDirty = false;
      water.uniforms.uSunShadow.value = sunShadow.bake(water.uniforms.uData.value, hf.extent, water.uniforms.uSunDir.value, hf.N);
    }
  }
  function frame(dt, beforeRender) {
    governResolution(dt);
    advance(dt);
    beforeRender?.();
    renderFrame();
    if (loadedSent) loadedFrames++;
  }

  return {
    THREE, params, state, layout, renderer, scene, camera, terrain, water, trail, sky, skyDome, atmosphere, grade, clouds, sunShadow,
    timeCtl, governor, hidden, on, groundAt, setPose, setSize, renderFrame, frame, advance, placeSun, relight, regenerate,
    regenerateSoon, terrainCloudShadows,
    get plants() { return plants; },
    get hf() { return hf; },
    get simTime() { return simTime; },
    get loadedFrames() { return loadedFrames; },
    get loaded() { return loadedSent; },
    setTime(t) { simTime = t; },
    // Move the sun to a local time on the photo day (for time-of-day clips).
    setHour(h) { state.hour = h; placeSun(); },
    markShadowDirty() { shadowDirty = true; },
  };
}
