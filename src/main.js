// Kelingking: grey terrain (stage 1), the sea (stage 2), and the tools for matching both to photos.
//
// URL parameters
//   shot=viewpoint     start on a shot from shots.js
//   overlay=0.5        reference photo opacity on top of the render
//   diff=1             difference blend for the overlay (black = aligned)
//   compare=side       render and photo side by side
//   q=2048             heightfield resolution (default 1024, 2048 when capturing)
//   contours=1         10 m contour lines
//   outline=1          photo at full strength with the render's coastline (red) and
//                      silhouettes (yellow) traced over it
//   capture=1          hide the UI and set window.__ready once the frame is final
//   t=12               freeze the clock at this many seconds (the sea animates)
//   debug=1..5         water debug view: sediment, see-through, foam, underwater light, normals
//   hide=terrain,water leave objects out (for tracking down which one draws what)
//   clay=1             plain grey ground, to judge the shape on its own
//   pr=1               pin the pixel ratio and turn the resolution governor off (for measuring)
//   hour=11.96         local time on the photo's day (6 April 2025), sets the sun
//   sun=az,el          or set the sun directly, compass heading and elevation in degrees
//   haze=6             aerosol amount (1 = clear continental air)
//   ev=0               exposure compensation in stops
//
// Keys: O overlay, D difference, L outline, F free camera, C contours, 1-8 shots.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import { defaultLayout } from './terrain/layout.js';
import { createTerrain, sample } from './terrain/terrain-mesh.js';
import { SHOTS } from './shots.js';
import { createWater } from './water/water.js';
import { createAtmosphere } from './sky/atmosphere.js';
import { createSkyDome } from './sky/sky-dome.js';
import { PHOTO_DAY, PHOTO_HOUR, sunAtHour } from './sky/sun.js';
import { createGrade } from './post/grade.js';
import { createSunShadow } from './terrain/sun-shadow.js';
import { loadSurfaceTextures } from './terrain/surface-textures.js';
import { createPlants } from './veg/impostors.js';

const params = new URLSearchParams(location.search);
const CAPTURE = params.has('capture');
if (CAPTURE) document.body.classList.add('capture');

const state = {
  shot: SHOTS[params.get('shot')] ? params.get('shot') : 'viewpoint',
  free: false,
  overlay: +(params.get('overlay') ?? 0),
  diff: params.get('diff') === '1',
  compare: params.get('compare') === 'side',
  quality: +(params.get('q') || (CAPTURE ? 2048 : 1024)),
  contours: params.get('contours') === '1',
  outline: params.get('outline') === '1',
  clay: params.get('clay') === '1',
  // The sun where it was when the viewpoint photo was taken (src/sky/sun.js).
  hour: +(params.get('hour') ?? PHOTO_HOUR),
  sunAz: 0,
  sunEl: 0,
};
const layout = defaultLayout();
const FIXED_T = params.has('t') ? +params.get('t') : null;
const clock = new THREE.Clock();
let simTime = FIXED_T ?? 0;
const timeCtl = { paused: false, speed: 1 };
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- renderer and scene

const stage = document.getElementById('stage');
const refImg = document.getElementById('ref');
const statusEl = document.getElementById('status');
const outlineCanvas = document.createElement('canvas');
outlineCanvas.id = 'outline';
stage.append(outlineCanvas);

// Reversed depth (float, 1 at the near plane) keeps precision from 0.3 m to 30 km. A
// logarithmic depth buffer would too, but it writes depth from the fragment shader, which
// turns off early depth testing, and then every hidden layer of ground gets fully shaded.
const renderer = new THREE.WebGLRenderer({ antialias: true, reversedDepthBuffer: true, preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(devicePixelRatio, 1.5));
// Exposure from the viewpoint photo's EXIF, tone curve and grade (src/post/grade.js). Has to
// be set up before any material compiles.
const gradeOpts = { ev100: PHOTO_DAY.ev100 };
if (params.has('ev')) gradeOpts.compensation = +params.get('ev');
if (params.has('contrast')) gradeOpts.contrast = +params.get('contrast');
if (params.has('saturation')) gradeOpts.saturation = +params.get('saturation');
const grade = createGrade(renderer, gradeOpts);
// No shadow map for now: the ground and the sea both march their own sun shadows through the
// height data, which a shadow map cannot match on 100 m faces drawn from thin triangles.
// It comes back for small objects (steps, railings) in the descent.
renderer.shadowMap.enabled = false;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();

// Far enough for the sea to reach the horizon from the air (118 km from 1 km up).
const camera = new THREE.PerspectiveCamera(57, 1, 0.3, 400000);
camera.rotation.order = 'YXZ';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = false;

// One atmosphere for the sky, the haze, the sun's colour and the sky light (src/sky/).
const atmoOpts = {};
for (const k of ['haze', 'mieH', 'seaHaze', 'seaHazeH', 'mieG', 'angstrom', 'whiteBalance']) if (params.has(k)) atmoOpts[k] = +params.get(k);
const atmosphere = createAtmosphere(renderer, atmoOpts);
const water = createWater(atmosphere.uniforms, grade.uniforms);
const skyDome = createSkyDome(atmosphere, grade.uniforms);
const sky = skyDome.mesh;
scene.add(sky);

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
  skyLight.sh.copy(atmosphere.sh);
  water.uniforms.uSkyIrr.value.setRGB(...r.skyUp);
  window.__light = { sun: r.sunIrradiance.toArray().map((v) => +v.toFixed(2)), skyUp: r.skyUp.map((v) => +v.toFixed(2)),
    transmittance: r.Tsun.map((v) => +v.toFixed(3)), whiteBalance: r.wb.map((v) => +v.toFixed(3)), sunAz: state.sunAz, sunEl: state.sunEl };
}
placeSun();

scene.add(water.mesh);
water.uniforms.uDebug.value = +(params.get('debug') || 0);

const terrain = createTerrain(atmosphere.uniforms, grade.uniforms);
scene.add(terrain.mesh);
terrain.uniforms.uContours.value = state.contours ? 1 : 0;
terrain.uniforms.uClay.value = state.clay ? 1 : 0;
const sunShadow = createSunShadow(renderer);
let texturesReady = false;
let plants = null, plantsReady = false;
fetch('assets/veg/impostors.json').then((r) => r.json())
  .then((index) => createPlants(index, ['island_tree_01', 'island_tree_02', 'tree_small_02'], { ...atmosphere.uniforms, ...grade.uniforms }))
  .then((p) => {
    plants = p;
    plants.group.visible = !hidden.has('plants');
    scene.add(plants.group);
    if (hf) plants.setInstances(hf.plants);
    plantsReady = true;
  })
  .catch((e) => { console.error('plants failed', e); plantsReady = true; });
loadSurfaceTextures().then((t) => { terrain.setSurfaces(t); texturesReady = true; })
  .catch((e) => { console.error('surface textures failed', e); texturesReady = true; });
terrain.uniforms.uSunShadow = water.uniforms.uSunShadow; // and the same baked shadow
const hidden = new Set((params.get('hide') || '').split(','));
for (const name of hidden) {
  if (name === 'terrain') terrain.mesh.visible = false;
  if (name === 'water') water.mesh.visible = false;
  if (name === 'sky') sky.visible = false;
}

// ---------------------------------------------------------------- terrain generation

let hf = null;
let genId = 0;
let terrainFrames = -1;
const worker = new Worker(new URL('./terrain/worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => {
  if (e.data.id !== genId) return;
  hf = e.data;
  terrain.update(hf);
  const tex = new THREE.DataTexture(hf.water, hf.N, hf.N, THREE.RGBAFormat, THREE.HalfFloatType);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  const dir = new THREE.DataTexture(hf.shoreDir, hf.N, hf.N, THREE.RGBAFormat);
  dir.minFilter = THREE.LinearFilter;
  dir.magFilter = THREE.LinearFilter;
  dir.needsUpdate = true;
  water.uniforms.uData.value?.dispose();
  water.uniforms.uShoreDir.value?.dispose();
  water.setData(tex, dir, hf.extent);
  terrain.setData(tex, hf.extent, layout.beach.top);
  plants?.setInstances(hf.plants);
  shadowDirty = true;
  terrainFrames = 0;
  outlineDirty = true;
  status();
};
function regenerate() {
  genId++;
  statusEl.textContent = 'generating terrain…';
  worker.postMessage({ id: genId, layout, N: state.quality, M: state.quality >= 2048 ? 2049 : 1025 });
}
let regenTimer = 0;
const regenerateSoon = () => { clearTimeout(regenTimer); regenTimer = setTimeout(regenerate, 250); };
regenerate();

const groundAt = (x, y) => (hf ? sample(hf.heights, hf.N, hf.cell, hf.extent.x0, hf.extent.y0, x, y) : 0);

// ---------------------------------------------------------------- shots and overlay

let refAspect = 0;
let refReady = false;
function setShot(name) {
  state.shot = name;
  const shot = SHOTS[name];
  refReady = false;
  refAspect = 0;
  refImg.onload = () => { refAspect = refImg.naturalWidth / refImg.naturalHeight; refReady = true; resize(); };
  refImg.onerror = () => { refReady = true; };
  refImg.src = shot.ref;
  applyShot();
  buildCameraFolder();
}
function applyShot() {
  const s = SHOTS[state.shot];
  camera.position.set(s.pos[0], s.pos[2], -s.pos[1]);
  camera.rotation.set(deg(s.pitch), -deg(s.yaw), deg(s.roll), 'YXZ');
  camera.fov = s.fov;
  camera.updateProjectionMatrix();
}
function setFree(on) {
  state.free = on;
  controls.enabled = on;
  if (on) {
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    controls.target.copy(camera.position).addScaledVector(fwd, 250);
    controls.update();
  } else {
    applyShot();
  }
  resize();
}
function applyOverlay() {
  refImg.style.opacity = state.compare || state.outline ? 1 : state.overlay;
  refImg.style.mixBlendMode = state.diff && !state.compare && !state.outline ? 'difference' : 'normal';
  outlineCanvas.style.display = state.outline ? 'block' : 'none';
  if (state.outline) outlineDirty = true;
}

// Outline mode: render a mask of the terrain (above sea level, plus log distance), find
// the edges, and draw them over the photo. Red = where land meets water or sky,
// yellow = where one landform passes in front of another.
const maskMaterial = new THREE.ShaderMaterial({
  vertexShader: `#include <common>
    #include <logdepthbuf_pars_vertex>
    varying float vY; varying float vDist;
    void main() {
      vec4 wp = modelMatrix * vec4(position, 1.0);
      vY = wp.y;
      vec4 mv = viewMatrix * wp;
      vDist = -mv.z;
      gl_Position = projectionMatrix * mv;
      #include <logdepthbuf_vertex>
    }`,
  fragmentShader: `#include <logdepthbuf_pars_fragment>
    varying float vY; varying float vDist;
    void main() {
      #include <logdepthbuf_fragment>
      float d = clamp(log2(max(vDist, 1.0)) / 16.0, 0.0, 1.0);
      gl_FragColor = vec4(step(0.4, vY), floor(d * 255.0) / 255.0, fract(d * 255.0), 1.0);
    }`,
});
let outlineDirty = false;
function drawOutline() {
  const w = renderer.domElement.width, h = renderer.domElement.height;
  const rt = new THREE.WebGLRenderTarget(w, h);
  const keep = { water: water.mesh.visible, sky: sky.visible, plants: plants?.group.visible };
  water.mesh.visible = false; sky.visible = false;
  if (plants) plants.group.visible = false;
  scene.overrideMaterial = maskMaterial;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  renderer.render(scene, camera);
  renderer.toneMapping = tm;
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  water.mesh.visible = keep.water; sky.visible = keep.sky;
  if (plants) plants.group.visible = keep.plants;
  const px = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
  rt.dispose();

  outlineCanvas.width = w; outlineCanvas.height = h;
  const ctx = outlineCanvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const land = (i) => px[i * 4] > 127;
  const dist = (i) => px[i * 4 + 1] / 255 + px[i * 4 + 2] / 65025;
  const jump = Math.log2(1.35) / 16;
  for (let y = 0; y < h - 1; y++) {
    for (let x = 0; x < w - 1; x++) {
      const i = y * w + x, r = i + 1, u = i + w;
      let c = null;
      if (land(i) !== land(r) || land(i) !== land(u)) c = [255, 40, 40];
      else if (land(i) && (Math.abs(dist(i) - dist(r)) > jump || Math.abs(dist(i) - dist(u)) > jump)) c = [255, 225, 40];
      if (!c) continue;
      // WebGL rows run bottom-up, canvas rows top-down.
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const o = ((h - 1 - y - dy) * w + x + dx) * 4;
        if (o < 0) continue;
        img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = 255;
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function resize() {
  const W = innerWidth, H = innerHeight;
  const aspect = !state.free && refAspect ? refAspect : W / H;
  const panels = state.compare ? 2 : 1;
  let w = W / panels, h = w / aspect;
  if (h > H) { h = H; w = h * aspect; }
  w = Math.floor(w); h = Math.floor(h);
  stage.style.width = w * panels + 'px';
  stage.style.height = h + 'px';
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  Object.assign(refImg.style, { width: w + 'px', height: h + 'px', left: (state.compare ? w : 0) + 'px' });
  Object.assign(outlineCanvas.style, { width: w + 'px', height: h + 'px' });
  applyOverlay();
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- GUI

const gui = new GUI({ title: 'Kelingking' });
if (CAPTURE) gui.hide();
gui.add(state, 'shot', Object.keys(SHOTS)).onChange(setShot).listen();
gui.add(state, 'free').name('free camera (F)').onChange(setFree).listen();
gui.add(state, 'overlay', 0, 1, 0.01).name('photo overlay (O)').onChange(applyOverlay).listen();
gui.add(state, 'diff').name('difference (D)').onChange(applyOverlay).listen();
gui.add(state, 'compare').name('side by side').onChange(resize);
gui.add(state, 'outline').name('outline on photo (L)').onChange(applyOverlay).listen();

let camFolder = null;
function buildCameraFolder() {
  camFolder?.destroy();
  const s = SHOTS[state.shot];
  camFolder = gui.addFolder('Camera: ' + s.label);
  const proxy = {
    get east() { return s.pos[0]; }, set east(v) { s.pos[0] = v; },
    get north() { return s.pos[1]; }, set north(v) { s.pos[1] = v; },
    get height() { return s.pos[2]; }, set height(v) { s.pos[2] = v; },
  };
  const on = () => { if (!state.free) applyShot(); outlineDirty = true; status(); };
  camFolder.add(proxy, 'east', -700, 900, 0.5).onChange(on);
  camFolder.add(proxy, 'north', -700, 900, 0.5).onChange(on);
  camFolder.add(proxy, 'height', 0.5, 1500, 0.1).onChange(on);
  camFolder.add(s, 'yaw', -360, 360, 0.1).onChange(on);
  camFolder.add(s, 'pitch', -90, 60, 0.1).onChange(on);
  camFolder.add(s, 'roll', -30, 30, 0.1).onChange(on);
  camFolder.add(s, 'fov', 10, 100, 0.1).onChange(on);
  camFolder.add({ eye() { s.pos[2] = groundAt(s.pos[0], s.pos[1]) + 1.7; camFolder.controllersRecursive().forEach((c) => c.updateDisplay()); on(); } }, 'eye').name('drop to eye level');
  camFolder.add({ copy() { const t = JSON.stringify({ pos: s.pos.map((v) => +v.toFixed(1)), yaw: +s.yaw.toFixed(1), pitch: +s.pitch.toFixed(1), roll: +s.roll.toFixed(1), fov: +s.fov.toFixed(1) }); navigator.clipboard?.writeText(t); console.log(state.shot, t); } }, 'copy').name('copy numbers');
}

const tf = gui.addFolder('Terrain');
tf.add(state, 'quality', [512, 1024, 2048]).onChange(regenerate);
const spineF = tf.addFolder('Spine heights').close();
layout.spine.forEach((c) => {
  spineF.add(c, 'h', 20, 200, 0.5).name(`h @ ${c.at.join(',')}`).onChange(regenerateSoon);
  spineF.add(c, 'w', 20, 120, 0.5).name(`width @ ${c.at.join(',')}`).onChange(regenerateSoon);
});
const jaw = layout.spurs[0];
const jawF = tf.addFolder('Jaw').close();
jaw.h.forEach((_, i) => jawF.add(jaw.h, i, 20, 140, 0.5).name(`h ${i}`).onChange(regenerateSoon));
jawF.add(jaw, 'w', 10, 80, 0.5).onChange(regenerateSoon);
jawF.add(jaw.path[2], 1, 60, 130, 0.5).name('tip north').onChange(regenerateSoon);
tf.add(layout.islets[0], 'h', 20, 100, 0.5).name('islet height').onChange(regenerateSoon);
tf.add(layout.plateau, 'base', 100, 200, 0.5).name('plateau base').onChange(regenerateSoon);
tf.add(layout.plateau, 'shoulder', 0.6, 1, 0.01).name('plateau shoulder').onChange(regenerateSoon);
const zoneF = tf.addFolder('Cliff zones').close();
layout.zones.filter((z) => z.face !== undefined).forEach((z) => {
  zoneF.add(z, 'face', 2, 100, 0.5).name(z.name + ' width').onChange(regenerateSoon);
  zoneF.add(z, 'pf', 0.3, 3, 0.05).name(z.name + ' profile').onChange(regenerateSoon);
});
tf.add(layout.noise, 'broad', 0, 15, 0.1).name('broad noise').onChange(regenerateSoon);
tf.add(layout.noise, 'fine', 0, 5, 0.1).name('fine noise').onChange(regenerateSoon);
tf.close();

const wf = gui.addFolder('Water');
const wp = water.params, wa = () => water.applyParams();
wf.add(timeCtl, 'paused').name('pause time');
wf.add(timeCtl, 'speed', 0, 3, 0.05).name('time speed');
wf.add(wp, 'period', 4, 18, 0.1).name('wave period (s)').onChange(wa);
wf.add(wp, 'swell', 0, 3, 0.01).name('swell height (m)').onChange(wa);
wf.add(wp, 'breakAt', 4, 60, 0.5).name('break distance (m)').onChange(wa);
wf.add(wp, 'surge', 0, 1.5, 0.01).name('swash run-up (m)').onChange(wa);
wf.add(wp, 'swellHeading', 0, 360, 1).name('swell heading').onChange(wa);
wf.add(wp, 'windHeading', 0, 360, 1).name('wind heading').onChange(wa);
wf.add(wp, 'chop', 0, 3, 0.01).name('wind chop').onChange(wa);
wf.add(wp, 'foam', 0, 2, 0.01).onChange(wa);
wf.add(wp, 'turbidity', 0, 2, 0.01).name('stirred sand').onChange(wa);
wf.add(wp.absorb, 0, 0.05, 1.5, 0.005).name('absorb red').onChange(wa);
wf.add(wp.absorb, 1, 0.005, 0.5, 0.001).name('absorb green').onChange(wa);
wf.add(wp.absorb, 2, 0.005, 0.5, 0.001).name('absorb blue').onChange(wa);
wf.addColor(wp, 'scatter').name('scatter colour').onChange(wa);
wf.addColor(wp, 'sandAlbedo').name('seabed sand').onChange(wa);
wf.addColor(wp, 'reefAlbedo').name('seabed reef').onChange(wa);
wf.close();

const lf = gui.addFolder('Light and view');
lf.add(state, 'hour', 6, 18.5, 0.05).name('time (6 Apr 2025)').onChange(placeSun);
lf.add(state, 'sunAz').name('sun heading').disable().listen();
lf.add(state, 'sunEl').name('sun elevation').disable().listen();
const ap = atmosphere.params;
const reair = () => { atmosphere.precompute(); relight(); };
lf.add(ap, 'haze', 0, 30, 0.1).name('background haze').onChange(reair);
lf.add(ap, 'seaHaze', 0, 0.4, 0.005).name('sea haze (/km)').onChange(reair);
lf.add(ap, 'seaHazeH', 0.05, 1.5, 0.05).name('sea haze depth (km)').onChange(reair);
lf.add(ap, 'mieG', 0.5, 0.95, 0.01).name('haze forward scatter').onChange(reair);
lf.add(ap, 'angstrom', 0, 2.5, 0.05).name('haze blueness (Angstrom)').onChange(reair);
lf.add(ap, 'whiteBalance', 0, 1, 0.01).name('white balance').onChange(relight);
const gp = grade.params, ga = () => grade.apply();
lf.add(gp, 'compensation', -3, 3, 0.05).name('exposure (stops)').onChange(ga);
lf.add(gp, 'contrast', -0.5, 0.5, 0.01).onChange(ga);
lf.add(gp, 'saturation', -0.5, 0.8, 0.01).onChange(ga);
lf.add(state, 'contours').name('contours (C)').onChange((v) => (terrain.uniforms.uContours.value = v ? 1 : 0)).listen();
lf.add(state, 'clay').name('clay (no materials)').onChange((v) => (terrain.uniforms.uClay.value = v ? 1 : 0));
lf.close();

addEventListener('keydown', (e) => {
  if (e.target.tagName === 'INPUT') return;
  if (e.key === 'o') { state.overlay = state.overlay > 0 ? 0 : 0.5; applyOverlay(); }
  if (e.key === 'd') { state.diff = !state.diff; applyOverlay(); }
  if (e.key === 'l') { state.outline = !state.outline; applyOverlay(); }
  if (e.key === 'f') setFree(!state.free);
  if (e.key === 'c') { state.contours = !state.contours; terrain.uniforms.uContours.value = state.contours ? 1 : 0; }
  const n = +e.key;
  const names = Object.keys(SHOTS);
  if (n >= 1 && n <= names.length) { setFree(false); setShot(names[n - 1]); }
});

function status() {
  if (!hf) return;
  const p = camera.position;
  const g = groundAt(p.x, -p.z);
  statusEl.textContent = `${SHOTS[state.shot].label}${state.free ? ' (free)' : ''}   terrain ${hf.N}² in ${hf.ms} ms, mesh ${hf.mesh.M}² in ${hf.mesh.ms} ms (${hf.mesh.moved} moved)   camera ${p.x.toFixed(0)}, ${(-p.z).toFixed(0)}, ${p.y.toFixed(1)} m (${(p.y - g).toFixed(1)} above ground)`;
}
controls.addEventListener('change', () => { status(); outlineDirty = true; });

// Handles for poking at the scene from the console or a test script.
window.__app = { THREE, scene, camera, renderer, terrain, water, layout, SHOTS, state, groundAt, atmosphere, grade,
  get plants() { return plants; },
  setTime(t) { simTime = t; },
  // Region-by-region comparison with the photo (src/measure.js, capture.mjs --measure).
  async measure(opts = {}) {
    const { measure } = await import('./measure.js');
    return measure({ renderer, scene, camera, refImg, labelUniform: grade.uniforms.uLabel, rois: SHOTS[state.shot].rois, ...opts });
  },
  project(x, y, h) {
    const v = new THREE.Vector3(x, h ?? groundAt(x, y), -y).project(camera);
    return [+((v.x * 0.5 + 0.5) * 1400).toFixed(0), +((0.5 - v.y * 0.5) * (1400 / camera.aspect)).toFixed(0), +v.z.toFixed(3)];
  },
};

// ---------------------------------------------------------------- loop

setShot(state.shot);
resize();

// Dynamic resolution: drop the pixel ratio when frames run long, raise it when there is room.
const MAX_PR = Math.min(devicePixelRatio, 1.5);
let pr = MAX_PR, frameAvg = 16;
const FIXED_PR = params.has('pr') ? +params.get('pr') : null;
if (FIXED_PR) { pr = FIXED_PR; renderer.setPixelRatio(pr); }
function governResolution(dt) {
  if (CAPTURE || FIXED_PR) return;
  frameAvg += (dt * 1000 - frameAvg) * 0.05;
  const next = frameAvg > 22 ? Math.max(0.85, pr - 0.1) : frameAvg < 13 ? Math.min(MAX_PR, pr + 0.05) : pr;
  if (Math.abs(next - pr) > 0.01) {
    pr = next;
    renderer.setPixelRatio(pr);
    resize();
    frameAvg = 16;
  }
}

renderer.setAnimationLoop(() => {
  const dt = clock.getDelta();
  governResolution(dt);
  if (FIXED_T === null && !timeCtl.paused) simTime += dt * timeCtl.speed;
  water.update(simTime, camera);
  if (plants) {
    plants.update(hf?.extent);
    plants.uniforms.uSunShadow.value = water.uniforms.uSunShadow.value;
  }
  if (shadowDirty && hf) {
    shadowDirty = false;
    water.uniforms.uSunShadow.value = sunShadow.bake(water.uniforms.uData.value, hf.extent, water.uniforms.uSunDir.value, hf.N);
  }
  if (state.free) controls.update();
  atmosphere.update(camera);
  renderer.render(scene, camera);
  if (state.outline && outlineDirty && hf) { outlineDirty = false; drawOutline(); }
  // Ready for a capture once the terrain and the textures are in and a few frames have run.
  if (terrainFrames >= 0 && texturesReady && plantsReady) terrainFrames++;
  if (!window.__ready && terrainFrames >= 3 && refReady) {
    window.__ready = true;
    status();
  }
});
