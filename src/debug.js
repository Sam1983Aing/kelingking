// The tools: fixed shots matched to reference photos, the photo overlay and outline, a free
// camera, the settings panel and keys, and the handles the capture scripts use
// (window.__app). The page runs this instead of the scroll when the URL asks for a shot
// (?shot=, ?capture, ?cam=); the landing page shows the panel only with ?debug (v8).
//
// URL switches for the tools (the scene's own are listed in app.js):
//   shot=viewpoint     start on a shot from shots.js
//   overlay=0.5        reference photo opacity on top of the render
//   diff=1             difference blend for the overlay (black = aligned)
//   compare=side       render and photo side by side
//   contours=1         10 m contour lines
//   outline=1          photo at full strength with the render's coastline (red) and
//                      silhouettes (yellow) traced over it
//   capture=1          hide the UI and set window.__ready once the frame is final
//   cam=e,n,h,yaw,pitch[,fov[,roll]]  any camera, in the frame of the chosen shot
//
// Keys: O overlay, D difference, L outline, F free camera, C contours, 1-9 shots.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { GUI } from 'lil-gui';
import { SHOTS } from './shots.js';

// Renders the terrain above sea level (and its log distance) for the outline mode and the
// camera fitter: red where land meets water or sky, yellow where one landform passes in front
// of another.
export const maskMaterial = new THREE.ShaderMaterial({
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

// ---------------------------------------------------------------- the settings panel

// The panel over the scene's settings. `top(gui)` adds controls at the top (the shots, or the
// scroll's own).
export function buildPanel(app, { top } = {}) {
  const { state, layout, water, atmosphere, clouds, skyDome, grade, terrain, timeCtl } = app;
  const gui = new GUI({ title: 'Kelingking' });
  top?.(gui);

  const tf = gui.addFolder('Terrain');
  tf.add(state, 'quality', [512, 1024, 2048]).onChange(app.regenerate);
  const spineF = tf.addFolder('Spine heights').close();
  layout.spine.forEach((c) => {
    spineF.add(c, 'h', 20, 200, 0.5).name(`h @ ${c.at.join(',')}`).onChange(app.regenerateSoon);
    spineF.add(c, 'w', 20, 120, 0.5).name(`width @ ${c.at.join(',')}`).onChange(app.regenerateSoon);
  });
  const jaw = layout.spurs[0];
  const jawF = tf.addFolder('Jaw').close();
  jaw.h.forEach((_, i) => jawF.add(jaw.h, i, 20, 140, 0.5).name(`h ${i}`).onChange(app.regenerateSoon));
  jawF.add(jaw, 'w', 10, 80, 0.5).onChange(app.regenerateSoon);
  jawF.add(jaw.path[2], 1, 60, 130, 0.5).name('tip north').onChange(app.regenerateSoon);
  tf.add(layout.islets[0], 'h', 20, 100, 0.5).name('islet height').onChange(app.regenerateSoon);
  tf.add(layout.plateau, 'base', 100, 200, 0.5).name('plateau base').onChange(app.regenerateSoon);
  tf.add(layout.plateau, 'shoulder', 0.6, 1, 0.01).name('plateau shoulder').onChange(app.regenerateSoon);
  const zoneF = tf.addFolder('Cliff zones').close();
  layout.zones.filter((z) => z.face !== undefined).forEach((z) => {
    zoneF.add(z, 'face', 2, 100, 0.5).name(z.name + ' width').onChange(app.regenerateSoon);
    zoneF.add(z, 'pf', 0.3, 3, 0.05).name(z.name + ' profile').onChange(app.regenerateSoon);
  });
  tf.add(layout.noise, 'broad', 0, 15, 0.1).name('broad noise').onChange(app.regenerateSoon);
  tf.add(layout.noise, 'fine', 0, 5, 0.1).name('fine noise').onChange(app.regenerateSoon);
  tf.close();

  const wf = gui.addFolder('Water');
  const wp = water.params, wa = () => water.applyParams();
  wf.add(timeCtl, 'paused').name('pause time');
  wf.add(timeCtl, 'speed', 0, 3, 0.05).name('time speed');
  wf.add(wp, 'period', 4, 18, 0.1).name('wave period (s)').onChange(wa);
  wf.add(wp, 'swell', 0, 3, 0.01).name('swell height (m)').onChange(wa);
  wf.add(wp, 'breakAt', 4, 60, 0.5).name('break distance (m)').onChange(wa);
  wf.add(wp, 'runup', 0, 2.5, 0.01).name('swash run-up (m)').onChange(wa);
  wf.add(wp, 'swashT', 0.8, 6, 0.05).name('uprush time (s)').onChange(wa);
  wf.add(wp, 'swellHeading', 0, 360, 1).name('swell heading').onChange(wa);
  wf.add(wp, 'foam', 0, 2, 0.01).onChange(wa);
  wf.add(wp, 'whitecaps', 0, 3, 0.01).onChange(wa);
  wf.add(wp, 'murk', 0, 3, 0.01).name('milky plumes').onChange(wa);
  wf.add(wp, 'gust', 0, 1, 0.01).name('gusts').onChange(wa);
  wf.add(wp, 'gordonF', 0.05, 1, 0.01).name('deep water brightness').onChange(wa);
  wf.add(wp, 'turbidity', 0, 2, 0.01).name('stirred sand').onChange(wa);
  wf.add(wp.absorb, 0, 0.05, 1.5, 0.005).name('absorb red').onChange(wa);
  wf.add(wp.absorb, 1, 0.005, 0.5, 0.001).name('absorb green').onChange(wa);
  wf.add(wp.absorb, 2, 0.005, 0.5, 0.001).name('absorb blue').onChange(wa);
  wf.add(wp.backscatter, 0, 0, 0.02, 0.0001).name('backscatter red').onChange(wa);
  wf.add(wp.backscatter, 1, 0, 0.02, 0.0001).name('backscatter green').onChange(wa);
  wf.add(wp.backscatter, 2, 0, 0.02, 0.0001).name('backscatter blue').onChange(wa);
  wf.add(wp, 'sedBack', 0, 0.3, 0.001).name('sand backscatter').onChange(wa);
  wf.addColor(wp, 'sandAlbedo').name('seabed sand').onChange(wa);
  wf.addColor(wp, 'reefAlbedo').name('seabed reef').onChange(wa);
  wf.close();

  const lf = gui.addFolder('Light and view');
  lf.add(state, 'hour', 6, 18.5, 0.05).name('time (6 Apr 2025)').onChange(app.placeSun);
  lf.add(state, 'sunAz').name('sun heading').disable().listen();
  lf.add(state, 'sunEl').name('sun elevation').disable().listen();
  const ap = atmosphere.params;
  const reair = () => { atmosphere.precompute(); app.relight(); };
  lf.add(ap, 'haze', 0, 30, 0.1).name('background haze').onChange(reair);
  lf.add(ap, 'seaHaze', 0, 0.4, 0.005).name('sea haze (/km)').onChange(reair);
  lf.add(ap, 'seaHazeH', 0.05, 1.5, 0.05).name('sea haze depth (km)').onChange(reair);
  lf.add(ap, 'mieG', 0.5, 0.95, 0.01).name('haze forward scatter').onChange(reair);
  lf.add(ap, 'angstrom', 0, 2.5, 0.05).name('haze blueness (Angstrom)').onChange(reair);
  lf.add(ap, 'whiteBalance', 0, 1, 0.01).name('white balance').onChange(app.relight);
  lf.add(ap, 'wbSky', 0, 1, 0.01).name('balance on sky too').onChange(app.relight);
  const cf = gui.addFolder('Clouds').close();
  const cp = clouds.params, ca = () => clouds.applyParams();
  cf.add(skyDome.material.uniforms.uHasClouds, 'value', 0, 1, 1).name('clouds');
  cf.add(clouds.uniforms.uCloudShadow, 'value', 0, 1, 1).name('cloud shadows').onChange(app.terrainCloudShadows);
  cf.add(cp, 'coverage', 0, 1, 0.01).onChange(ca);
  cf.add(cp, 'density', 5, 150, 1).name('density (/km)').onChange(ca);
  cf.add(cp, 'base', 0.3, 2, 0.05).name('base (km)').onChange(ca);
  cf.add(cp, 'top', 0.8, 5, 0.05).name('top (km)').onChange(ca);
  cf.add(cp, 'clearRadius', 0, 20, 0.5).name('clear over island (km)').onChange(() => { ca(); app.terrainCloudShadows(); });
  cf.add(cp, 'seed', 1, 50, 1).onChange(ca);
  const gp = grade.params, ga = () => grade.apply();
  lf.add(gp, 'compensation', -3, 3, 0.05).name('exposure (stops)').onChange(ga);
  lf.add(gp, 'contrast', -0.5, 0.5, 0.01).onChange(ga);
  lf.add(gp, 'saturation', -0.5, 0.8, 0.01).onChange(ga);
  lf.add(state, 'contours').name('contours (C)').onChange((v) => (terrain.uniforms.uContours.value = v ? 1 : 0)).listen();
  lf.add(state, 'clay').name('clay (no materials)').onChange((v) => (terrain.uniforms.uClay.value = v ? 1 : 0));
  lf.close();
  return gui;
}

// ---------------------------------------------------------------- the shot page

export function startTools(app, { params, capture }) {
  const { THREE: T, renderer, scene, camera, terrain, water, trail, sky, state } = app;
  Object.assign(state, {
    shot: SHOTS[params.get('shot')] ? params.get('shot') : 'viewpoint',
    free: false,
    overlay: +(params.get('overlay') ?? 0),
    diff: params.get('diff') === '1',
    compare: params.get('compare') === 'side',
    outline: params.get('outline') === '1',
  });
  // cam=east,north,height,yaw,pitch[,fov] puts the camera anywhere, keeping the shot's photo
  // and frame (for close-ups while working on something).
  if (params.has('cam')) {
    const [e, n, h, yaw, pitch, fov, roll] = params.get('cam').split(',').map(Number);
    Object.assign(SHOTS[state.shot], { pos: [e, n, h], yaw, pitch, roll: roll || 0 }, fov ? { fov } : {});
  }

  const stage = document.getElementById('stage');
  const refImg = document.getElementById('ref');
  const statusEl = document.getElementById('status');
  const outlineCanvas = document.createElement('canvas');
  outlineCanvas.id = 'outline';
  stage.append(outlineCanvas);
  stage.prepend(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.enabled = false;

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
    app.setPose(s.pos, s.yaw, s.pitch, s.roll, s.fov);
    camera.fov = s.fov;
    camera.updateProjectionMatrix();
  }
  function setFree(on) {
    state.free = on;
    controls.enabled = on;
    if (on) {
      const fwd = new T.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
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

  // Outline mode: render the land mask, find its edges, and draw them over the photo.
  let outlineDirty = false;
  function drawOutline() {
    const w = renderer.domElement.width, h = renderer.domElement.height;
    const rt = new T.WebGLRenderTarget(w, h);
    const plants = app.plants;
    const keep = { water: water.mesh.visible, sky: sky.visible, plants: plants?.group.visible, trail: trail.group.visible };
    water.mesh.visible = false; sky.visible = false; trail.group.visible = false;
    if (plants) plants.group.visible = false;
    scene.overrideMaterial = maskMaterial;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    const tm = renderer.toneMapping; renderer.toneMapping = T.NoToneMapping;
    renderer.render(scene, camera);
    renderer.toneMapping = tm;
    renderer.setRenderTarget(null);
    scene.overrideMaterial = null;
    water.mesh.visible = keep.water; sky.visible = keep.sky; trail.group.visible = keep.trail;
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
    app.setSize(w, h);
    Object.assign(refImg.style, { width: w + 'px', height: h + 'px', left: (state.compare ? w : 0) + 'px' });
    Object.assign(outlineCanvas.style, { width: w + 'px', height: h + 'px' });
    applyOverlay();
  }
  addEventListener('resize', resize);
  app.governor.onChange = resize;

  // ---------------------------------------------------------------- panel and keys

  let gui = null, camFolder = null;
  function buildCameraFolder() {
    if (!gui) return;
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
    camFolder.add({ eye() { s.pos[2] = app.groundAt(s.pos[0], s.pos[1]) + 1.7; camFolder.controllersRecursive().forEach((c) => c.updateDisplay()); on(); } }, 'eye').name('drop to eye level');
    camFolder.add({ copy() { const t = JSON.stringify({ pos: s.pos.map((v) => +v.toFixed(1)), yaw: +s.yaw.toFixed(1), pitch: +s.pitch.toFixed(1), roll: +s.roll.toFixed(1), fov: +s.fov.toFixed(1) }); navigator.clipboard?.writeText(t); console.log(state.shot, t); } }, 'copy').name('copy numbers');
  }
  if (!capture) {
    gui = buildPanel(app, {
      top: (g) => {
        g.add(state, 'shot', Object.keys(SHOTS)).onChange(setShot).listen();
        g.add(state, 'free').name('free camera (F)').onChange(setFree).listen();
        g.add(state, 'overlay', 0, 1, 0.01).name('photo overlay (O)').onChange(applyOverlay).listen();
        g.add(state, 'diff').name('difference (D)').onChange(applyOverlay).listen();
        g.add(state, 'compare').name('side by side').onChange(resize);
        g.add(state, 'outline').name('outline on photo (L)').onChange(applyOverlay).listen();
      },
    });
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
  }

  function status() {
    const hf = app.hf;
    if (!hf || capture) return;
    const p = camera.position;
    const g = app.groundAt(p.x, -p.z);
    statusEl.textContent = `${SHOTS[state.shot].label}${state.free ? ' (free)' : ''}   terrain ${hf.N}² in ${hf.ms} ms, mesh ${hf.mesh.M}² in ${hf.mesh.ms} ms (${hf.mesh.moved} moved)   camera ${p.x.toFixed(0)}, ${(-p.z).toFixed(0)}, ${p.y.toFixed(1)} m (${(p.y - g).toFixed(1)} above ground)`;
  }
  controls.addEventListener('change', () => { status(); outlineDirty = true; });
  app.on('generating', () => { if (!capture) statusEl.textContent = 'generating terrain…'; });
  app.on('terrain', () => { outlineDirty = true; status(); });

  // ---------------------------------------------------------------- handles for scripts

  // Handles for poking at the scene from the console or a test script.
  window.__app = Object.assign(app, {
    SHOTS,
    // Region-by-region comparison with the photo (src/measure.js, capture.mjs --measure).
    async measure(opts = {}) {
      const { measure } = await import('./measure.js');
      // Labels: a uniform for the light shaders, a compile-time switch for the ground (its
      // shader is heavy enough that even an unused branch costs).
      const setLabels = (on) => {
        app.grade.uniforms.uLabel.value = on ? 1 : 0;
        const m = terrain.mesh.material;
        m.defines = { ...m.defines };
        if (on) m.defines.LABELS = 1; else delete m.defines.LABELS;
        m.needsUpdate = true;
      };
      return measure({ renderer, scene, camera, refImg, setLabels, rois: SHOTS[state.shot].rois, ...opts });
    },
    project(x, y, h) {
      const v = new T.Vector3(x, h ?? app.groundAt(x, y), -y).project(camera);
      return [+((v.x * 0.5 + 0.5) * 1400).toFixed(0), +((0.5 - v.y * 0.5) * (1400 / camera.aspect)).toFixed(0), +v.z.toFixed(3)];
    },
    // Several cameras in one go, as one PNG (a row of frames, `width` each): [{ pos, yaw, pitch,
    // roll, fov }] in the shot's frame, or { s, side, eye, ... } to stand on the path.
    async contactSheet(cams, width = 420, perRow = 4) {
      const { makeFitter } = await import('./fit.js');
      const fitter = makeFitter({ THREE: T, renderer, scene, camera, maskMaterial, hide: () => () => {}, route: app.hf?.trail?.line });
      const h = Math.round(width / camera.aspect);
      const rows = Math.ceil(cams.length / perRow);
      const out = document.createElement('canvas');
      out.width = width * Math.min(perRow, cams.length); out.height = h * rows;
      const g = out.getContext('2d');
      for (let k = 0; k < cams.length; k++) {
        const c = cams[k];
        if (c.s !== undefined) fitter.place({ side: 0, eye: 1.6, roll: 0, ...c });
        else fitter.place({ x: c.pos[0], y: c.pos[1], h: c.pos[2], roll: 0, ...c });
        for (let i = 0; i < 3; i++) { water.update(app.simTime, camera, renderer); app.renderFrame(); }
        g.drawImage(renderer.domElement, (k % perRow) * width, Math.floor(k / perRow) * h, width, h);
        g.fillStyle = '#fff'; g.font = '13px sans-serif';
        g.fillText(c.label ?? String(k), (k % perRow) * width + 6, Math.floor(k / perRow) * h + 16);
      }
      applyShot();
      return out.toDataURL('image/png');
    },
    // Fit the camera to the shot's photo by traced outlines, standing on the path (src/fit.js).
    async fitCamera(opts) {
      const { makeFitter } = await import('./fit.js');
      const hide = () => {
        const plants = app.plants;
        const keep = { water: water.mesh.visible, sky: sky.visible, plants: plants?.group.visible, trail: trail.group.visible };
        water.mesh.visible = false; sky.visible = false; trail.group.visible = false;
        if (plants) plants.group.visible = false;
        return () => { water.mesh.visible = keep.water; sky.visible = keep.sky; trail.group.visible = keep.trail; if (plants) plants.group.visible = keep.plants; };
      };
      const fitter = makeFitter({ THREE: T, renderer, scene, camera, maskMaterial, hide, route: app.hf?.trail?.line });
      return opts.scoreOnly ? fitter.score(opts.start, opts.points) : fitter.fit(opts);
    },
    // Where the ray through a point of the frame (u, v from 0 to 1, top left) meets the ground:
    // [east, north, height, distance], marched through the heightfield.
    rayToGround(u, v) { return rayToGround(app, u, v); },
    // Map lines drawn over the shot's photo (or the render, with render: true), as a PNG data
    // URL for capture.mjs --eval. lines: [{ pts: [[e, n, h?], ...], color, width }]; a point
    // without a height sits on the ground, lifted by `lift` metres.
    traceOnPhoto(lines, opts) { return traceLines(app, lines, { ...opts, photo: refImg }); },
  });

  // ---------------------------------------------------------------- loop

  setShot(state.shot);
  resize();
  const clock = new T.Clock();
  renderer.setAnimationLoop(() => {
    app.frame(clock.getDelta(), () => { if (state.free) controls.update(); });
    if (state.outline && outlineDirty && app.hf) { outlineDirty = false; drawOutline(); }
    // Ready for a capture once the terrain and the textures are in and a few frames have run.
    if (!window.__ready && app.loadedFrames >= 3 && refReady) {
      window.__ready = true;
      status();
    }
  });
}

// ---------------------------------------------------------------- shared helpers

export function rayToGround(app, u, v) {
  const { THREE: T, camera, groundAt } = app;
  const d = new T.Vector3(u * 2 - 1, 1 - v * 2, 0.5).unproject(camera).sub(camera.position).normalize();
  const p = camera.position.clone();
  let t = 0;
  for (let i = 0; i < 4000; i++) {
    const step = Math.max(0.05, 0.004 * t);
    const q = p.clone().addScaledVector(d, t + step);
    const above = q.y - groundAt(q.x, -q.z);
    if (above < 0) {
      // Bisect the last step.
      let a = t, b = t + step;
      for (let k = 0; k < 20; k++) {
        const m = 0.5 * (a + b), r = p.clone().addScaledVector(d, m);
        if (r.y - groundAt(r.x, -r.z) < 0) b = m; else a = m;
      }
      const r = p.clone().addScaledVector(d, a);
      return [+r.x.toFixed(2), +(-r.z).toFixed(2), +r.y.toFixed(2), +a.toFixed(1)];
    }
    t += step;
  }
  return null;
}

export function traceLines(app, lines, { width = 1400, render = false, lift = 0, photo = null } = {}) {
  const { THREE: T, camera, renderer, groundAt } = app;
  const h = Math.round(width / camera.aspect);
  const c = document.createElement('canvas');
  c.width = width; c.height = h;
  const g = c.getContext('2d');
  g.drawImage(render || !photo ? renderer.domElement : photo, 0, 0, width, h);
  const v = new T.Vector3();
  for (const L of lines) {
    g.strokeStyle = L.color || '#f0f'; g.lineWidth = L.width || 2; g.beginPath();
    let pen = false;
    for (const p of L.pts) {
      v.set(p[0], p[2] ?? groundAt(p[0], p[1]) + lift, -p[1]).project(camera);
      if (v.z > 1 || v.z < -1) { pen = false; continue; }
      const X = (v.x * 0.5 + 0.5) * width, Y = (0.5 - v.y * 0.5) * h;
      if (pen) g.lineTo(X, Y); else g.moveTo(X, Y);
      pen = true;
      if (L.dots) g.fillRect(X - 2, Y - 2, 4, 4);
    }
    g.stroke();
    if (L.text) {
      v.set(L.pts[0][0], L.pts[0][2] ?? groundAt(L.pts[0][0], L.pts[0][1]) + lift, -L.pts[0][1]).project(camera);
      g.fillStyle = L.color || '#fff'; g.font = `${L.size || 12}px sans-serif`;
      g.fillText(L.text, (v.x * 0.5 + 0.5) * width + 3, (0.5 - v.y * 0.5) * h - 3);
    }
  }
  return c.toDataURL('image/png');
}
