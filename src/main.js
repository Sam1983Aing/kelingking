// Kelingking, stage 1: grey terrain plus the tools for matching it to photos.
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
//
// Keys: O overlay, D difference, F free camera, C contours, 1-5 shots.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import { defaultLayout } from './terrain/layout.js';
import { createTerrain, sample } from './terrain/terrain-mesh.js';
import { SHOTS } from './shots.js';

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
  sandTint: true,
  sunAz: 345,
  sunEl: 64,
  exposure: 1.0,
};
const layout = defaultLayout();
const deg = THREE.MathUtils.degToRad;

// ---------------------------------------------------------------- renderer and scene

const stage = document.getElementById('stage');
const refImg = document.getElementById('ref');
const statusEl = document.getElementById('status');
const outlineCanvas = document.createElement('canvas');
outlineCanvas.id = 'outline';
stage.append(outlineCanvas);

const renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true, preserveDrawingBuffer: CAPTURE });
renderer.setPixelRatio(CAPTURE ? 1 : Math.min(devicePixelRatio, 2));
renderer.toneMapping = THREE.AgXToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
stage.prepend(renderer.domElement);

const scene = new THREE.Scene();
const HORIZON = new THREE.Color(0xd3e4ee);
scene.fog = new THREE.FogExp2(HORIZON, 0.00014);

const camera = new THREE.PerspectiveCamera(57, 1, 0.3, 30000);
camera.rotation.order = 'YXZ';

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.enabled = false;

const sky = new THREE.Mesh(
  new THREE.SphereGeometry(20000, 32, 16),
  new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3a7cc0) }, horizon: { value: HORIZON } },
    vertexShader: 'varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform vec3 top; uniform vec3 horizon; varying vec3 vDir;
      void main(){ float t = pow(max(vDir.y, 0.0), 0.5); gl_FragColor = vec4(mix(horizon, top, t), 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
      }`,
  })
);
sky.renderOrder = -1;
scene.add(sky);

const hemi = new THREE.HemisphereLight(0xcfe3f2, 0x6f6b5c, 0.55);
scene.add(hemi);
const sun = new THREE.DirectionalLight(0xfff3e0, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -750, right: 750, top: 750, bottom: -750, near: 10, far: 5000 });
sun.shadow.bias = -0.0002;
sun.shadow.normalBias = 0.8;
sun.target.position.set(100, 0, -100);
scene.add(sun, sun.target);
function placeSun() {
  const az = deg(state.sunAz), el = deg(state.sunEl), d = 2500, t = sun.target.position;
  sun.position.set(t.x + d * Math.cos(el) * Math.sin(az), d * Math.sin(el), t.z - d * Math.cos(el) * Math.cos(az));
}
placeSun();

const water = new THREE.Mesh(
  new THREE.PlaneGeometry(60000, 60000),
  new THREE.MeshStandardMaterial({ color: 0x1b5874, roughness: 0.22, metalness: 0, transparent: true, opacity: 0.8 })
);
water.rotation.x = -Math.PI / 2;
water.receiveShadow = true;
water.renderOrder = 1;
scene.add(water);

const terrain = createTerrain();
scene.add(terrain.mesh);
terrain.uniforms.uContours.value = state.contours ? 1 : 0;

// ---------------------------------------------------------------- terrain generation

let hf = null;
let genId = 0;
let terrainFrames = -1;
const worker = new Worker(new URL('./terrain/worker.js', import.meta.url), { type: 'module' });
worker.onmessage = (e) => {
  if (e.data.id !== genId) return;
  hf = e.data;
  terrain.update(hf, CAPTURE ? 2048 : 1024);
  terrainFrames = 0;
  outlineDirty = true;
  status();
};
function regenerate() {
  genId++;
  statusEl.textContent = 'generating terrain…';
  worker.postMessage({ id: genId, layout, N: state.quality });
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
  const keep = { fog: scene.fog, water: water.visible, sky: sky.visible };
  scene.fog = null; water.visible = false; sky.visible = false;
  scene.overrideMaterial = maskMaterial;
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 1);
  renderer.clear();
  const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
  renderer.render(scene, camera);
  renderer.toneMapping = tm;
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  scene.fog = keep.fog; water.visible = keep.water; sky.visible = keep.sky;
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

const gui = new GUI({ title: 'Kelingking · stage 1' });
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

const lf = gui.addFolder('Light and view');
lf.add(state, 'sunAz', 0, 360, 1).name('sun heading').onChange(placeSun);
lf.add(state, 'sunEl', 5, 90, 1).name('sun elevation').onChange(placeSun);
lf.add(state, 'exposure', 0.3, 2, 0.01).onChange((v) => (renderer.toneMappingExposure = v));
lf.add(state, 'contours').name('contours (C)').onChange((v) => (terrain.uniforms.uContours.value = v ? 1 : 0)).listen();
lf.add(state, 'sandTint').name('tint sand').onChange((v) => (terrain.uniforms.uSandTint.value = v ? 1 : 0));
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
  statusEl.textContent = `${SHOTS[state.shot].label}${state.free ? ' (free)' : ''}   terrain ${hf.N}² in ${hf.ms} ms   camera ${p.x.toFixed(0)}, ${(-p.z).toFixed(0)}, ${p.y.toFixed(1)} m (${(p.y - g).toFixed(1)} above ground)`;
}
controls.addEventListener('change', () => { status(); outlineDirty = true; });

// Handles for poking at the scene from the console or a test script.
window.__app = { THREE, scene, camera, renderer, terrain, layout, SHOTS, state, groundAt,
  project(x, y, h) {
    const v = new THREE.Vector3(x, h ?? groundAt(x, y), -y).project(camera);
    return [+((v.x * 0.5 + 0.5) * 1400).toFixed(0), +((0.5 - v.y * 0.5) * (1400 / camera.aspect)).toFixed(0), +v.z.toFixed(3)];
  },
};

// ---------------------------------------------------------------- loop

setShot(state.shot);
resize();

renderer.setAnimationLoop(() => {
  if (state.free) controls.update();
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
  if (state.outline && outlineDirty && hf) { outlineDirty = false; drawOutline(); }
  if (terrainFrames >= 0 && ++terrainFrames === 3 && refReady) {
    window.__ready = true;
    status();
  } else if (terrainFrames > 3 && refReady && !window.__ready) {
    window.__ready = true;
  }
});
