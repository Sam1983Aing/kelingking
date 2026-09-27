// The landing page (v8): the scroll takes the camera down from high over the bay to the
// water's edge (path.js), and the words come and go with where the camera is.
//
// One loop: GSAP's ticker drives Lenis (the weighted smooth scroll), then the camera, the words
// and the frame, so the scene and the page never disagree by a frame. ScrollTrigger is not
// used: every animation here keys off the camera's place on the path (tau), which follows the
// scroll through a little extra smoothing (so a keyboard jump or a drag of the scrollbar still
// glides), and ScrollTrigger only knows about the scroll.
//
// URL switches (the scene's own are in app.js):
//   debug              the settings panel, keys 1-6 for the stops, and a readout
//   at=2.5             start at this tau (0 over the bay, 5 at the water), for stills
//   notext             the scene alone, no words or frame
//   record             the recorder drives the page frame by frame (tools/scroll-clip.mjs)
//   pr=1               pixel ratio pinned (else it is picked while loading, then governed)

import { gsap } from 'gsap';
import { SplitText } from 'gsap/SplitText.js';
import Lenis from 'lenis';
import { createApp } from '../app.js';
import { buildPanel } from '../debug.js';
import { SHOTS } from '../shots.js';
import { ORIGIN } from '../terrain/geo.js';
import { walkLine } from '../trail/route.js';
import { buildDescent, makePace, STOPS } from './path.js';

gsap.registerPlugin(SplitText);

// One motion personality for the page: this ease and this length for every reveal.
const EASE = 'expo.out';
const REVEAL = 1.1;
// How quickly the camera catches up with the scroll (per second): Lenis already smooths the
// wheel, this only takes the edge off jumps (keys, the scrollbar, a touch fling).
const FOLLOW = 9;

export function startScroll({ params }) {
  const RECORD = params.has('record');
  const DEBUG = params.has('debug');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const html = document.documentElement;
  if (params.has('notext')) html.classList.add('notext');
  const $ = (s) => document.querySelector(s);
  const loaderEl = $('.loader');

  let app;
  try {
    app = createApp({ params, keepBuffer: RECORD });
  } catch (e) {
    console.error(e);
    loaderEl.classList.add('failed');
    return;
  }
  window.__app = app;
  const { renderer, camera } = app;
  const stage = $('#stage');
  stage.prepend(renderer.domElement);
  if (params.has('pr')) app.governor.on = false;

  // ---------------------------------------------------------------- size and scroll length

  const pace = makePace();
  const track = $('.track');
  // One "screen" of scroll is the stage's height (100lvh, which does not change as a phone's
  // address bar comes and goes).
  let unit = stage.clientHeight || innerHeight;
  let descent = null, walk = null;
  let size = [0, 0];
  function resize(force = false) {
    const w = stage.clientWidth, h = stage.clientHeight;
    // A phone resizes the window as its address bar slides; the stage does not, so only a real
    // change of size re-sizes the canvas.
    if (!force && w === size[0] && Math.abs(h - size[1]) < 2) return;
    size = [w, h];
    app.setSize(w, h);
    unit = h;
    track.style.height = `${pace.screens * unit + innerHeight}px`;
    if (walk && Math.abs(w / h / descent.aspect - 1) > 0.03) build();
  }
  resize(true);
  addEventListener('resize', () => resize());
  app.governor.onChange = () => { app.setSize(size[0], size[1]); };

  // The lens for the screen's shape: the path's poses are made for a landscape screen, and on a
  // tall one the same vertical angle leaves a sliver. Widen it, but not all the way.
  function fovFor(fov, aspect) {
    if (aspect >= 1.2) return fov;
    const t = Math.tan((fov * Math.PI) / 360) * Math.pow(1.2 / aspect, 0.42);
    return Math.min(82, (Math.atan(t) * 360) / Math.PI);
  }

  // ---------------------------------------------------------------- scroll

  let lenis = null;
  if (!RECORD && !reduced) {
    lenis = new Lenis({ autoRaf: false, lerp: 0.07, wheelMultiplier: 0.9, smoothWheel: true });
    lenis.stop();
  }
  history.scrollRestoration = 'manual';
  scrollTo(0, 0);
  // No scrolling until the loader lifts (Lenis stops it itself; without Lenis this does).
  html.classList.add('loading');
  const scrollY = () => (lenis ? lenis.scroll : window.scrollY);
  function jumpTo(screens) {
    const y = screens * unit;
    if (lenis) lenis.scrollTo(y, { immediate: true, force: true }); else scrollTo(0, y);
    cam.screens = screens;
  }

  // ---------------------------------------------------------------- the path

  // The flight's start depends on the screen's shape (path.js), so the path is rebuilt when
  // that changes.
  function build() {
    const aspect = size[0] / size[1];
    descent = buildDescent({ walk, groundAt: app.groundAt, shots: SHOTS, view: { aspect, fov: fovFor(SHOTS.viewpoint.fov, aspect) }, extent: app.layout.extent });
    descent.aspect = aspect;
  }
  app.on('terrain', (hf) => {
    // The walk line from the path the worker just carved (as tools/walk-line.mjs makes it).
    const L = hf.trail.line, pad = app.layout.trail.pads[0];
    const route = { n: L.x.length, x: L.x, y: L.y, ht: L.ht };
    let join = 0;
    for (let i = 0; i < route.n; i++) if (L.ht[i] <= pad.h + 0.05) { join = L.s[i]; break; }
    walk = walkLine(route, { from: [SHOTS.viewpoint.pos[0], SHOTS.viewpoint.pos[1]], fromH: pad.h, join });
    build();
  });

  const cam = { screens: 0, tau: 0, pose: null };
  function placeCamera(dt, snap = false) {
    const target = scrollY() / unit;
    cam.screens = snap ? target : cam.screens + (target - cam.screens) * (1 - Math.exp(-FOLLOW * dt));
    if (Math.abs(target - cam.screens) < 1e-4) cam.screens = target;
    cam.tau = pace.tauAt(cam.screens);
    if (!descent) return;
    const p = (cam.pose = descent.poseAt(cam.tau));
    app.setPose(p.pos, p.yaw, p.pitch, 0, fovFor(p.fov, camera.aspect));
  }

  // ---------------------------------------------------------------- words

  // Every block over the scene shows while the camera's tau is inside its data-tau range.
  const blocks = [...document.querySelectorAll('.words > [data-tau]')].map((el) => {
    const [a, b] = el.dataset.tau.split(',').map(Number);
    const lines = [...el.querySelectorAll('[data-lines]')].flatMap((d) => SplitText.create(d, { type: 'lines', mask: 'lines', linesClass: 'line' }).lines);
    const after = [...el.querySelectorAll('.label, .chapter__num, .body, .cue, .end__actions, .end__credits')];
    const drift = el.querySelector('.display');
    const num = el.querySelector('.chapter__num');
    gsap.set(lines, { yPercent: 105 });
    gsap.set(after, { autoAlpha: 0, y: 14 });
    return { el, a, b, lines, after, drift, num, on: false, tl: null };
  });
  let rewinding = false;
  function show(k) {
    k.tl?.kill();
    const t = (k.tl = gsap.timeline());
    t.set(k.el, { visibility: 'visible' });
    const d = reduced ? 0 : REVEAL;
    t.to(k.lines, { yPercent: 0, duration: d, ease: EASE, stagger: 0.09 }, 0);
    // The small words come in after the line, one after another.
    t.to(k.after, { autoAlpha: 1, y: 0, duration: d, ease: EASE, stagger: 0.07 }, reduced ? 0 : 0.35);
  }
  function hide(k) {
    k.tl?.kill();
    const t = (k.tl = gsap.timeline());
    const d = reduced ? 0 : 0.7;
    t.to(k.lines, { yPercent: -105, duration: d, ease: EASE, stagger: 0.04 }, 0);
    t.to(k.after, { autoAlpha: 0, y: -8, duration: d * 0.8, ease: EASE }, 0);
    t.set(k.el, { visibility: 'hidden' });
    t.set(k.lines, { yPercent: 105 });
  }
  const scrim = $('.scrim');
  let scrimOn = false, wordsOn = false;
  function updateWords() {
    if (!wordsOn) return;
    let any = false;
    for (const k of blocks) {
      const on = !rewinding && cam.tau >= k.a && cam.tau <= k.b;
      if (on !== k.on) { k.on = on; on ? show(k) : hide(k); }
      // (The end is on its own card, the sand chapter in dark ink: no scrim for them.)
      if (on && (k.el.classList.contains('end') || k.el.classList.contains('on-light'))) continue;
      any ||= on;
      // The line drifts across a little while it is up, the number the other way.
      if (on && !reduced) {
        const u = Math.min(Math.max((cam.tau - k.a) / (k.b - k.a), 0), 1);
        const vw = innerWidth / 100;
        if (k.drift) gsap.set(k.drift, { x: (0.8 - 1.6 * u) * vw });
        if (k.num) gsap.set(k.num, { x: (-0.6 + 1.2 * u) * vw });
      }
    }
    if (any !== scrimOn) { scrimOn = any; gsap.to(scrim, { autoAlpha: any ? 1 : 0, duration: 1.2, ease: EASE }); }
  }

  // ---------------------------------------------------------------- the frame around the scene

  const altEl = $('.hud__alt'), latEl = $('.hud__lat'), lonEl = $('.hud__lon');
  const railFill = $('.rail__fill'), railMark = $('.rail__mark'), railLabel = $('.rail__mark span'), railEl = $('.rail');
  const stops = STOPS.map((_, i) => {
    const d = document.createElement('div');
    d.className = 'rail__stop';
    d.style.top = `${(i / (STOPS.length - 1)) * 100}%`;
    railEl.append(d);
    return d;
  });
  const dms = (v, pos, neg) => {
    const a = Math.abs(v), d = Math.floor(a), m = Math.floor((a - d) * 60), s = Math.floor(((a - d) * 60 - m) * 60);
    return `${d}°${String(m).padStart(2, '0')}′${String(s).padStart(2, '0')}″${v >= 0 ? pos : neg}`;
  };
  let lastHud = '';
  const narrow = matchMedia('(max-width: 720px)');
  function updateFrame() {
    if (!cam.pose) return;
    const [e, n, h] = cam.pose.pos;
    const lat = ORIGIN.lat + n / 111320, lon = ORIGIN.lon + e / (111320 * Math.cos((ORIGIN.lat * Math.PI) / 180));
    const alt = `${Math.max(0, Math.round(h)).toLocaleString('en')} m`;
    const key = alt + lat.toFixed(5) + lon.toFixed(5);
    if (key !== lastHud) {
      lastHud = key;
      altEl.textContent = alt;
      railLabel.textContent = alt;
      latEl.textContent = dms(lat, 'N', 'S');
      lonEl.textContent = dms(lon, 'E', 'W');
    }
    const u = cam.tau / (STOPS.length - 1);
    if (narrow.matches) railFill.style.transform = `scaleX(${u})`;
    else {
      railFill.style.transform = `scaleY(${u})`;
      railMark.style.transform = `translateY(${u * railEl.clientHeight}px)`;
    }
    stops.forEach((d, i) => d.classList.toggle('passed', cam.tau >= i - 0.001));
  }

  // ---------------------------------------------------------------- loading

  const steps = [
    { key: 'terrain', w: 0.42, label: 'Raising the headland' },
    { key: 'textures', w: 0.1, label: 'Laying down rock and sand' },
    { key: 'plants', w: 0.22, label: 'Growing the plants' },
    { key: 'trail', w: 0.06, label: 'Cutting the path' },
    { key: 'warm', w: 0.2, label: 'Filling the bay' },
  ];
  const done = new Set();
  let shown = 0, sinceStep = 0, loaded = false, started = false;
  for (const s of steps) if (s.key !== 'warm') app.on(s.key, () => { done.add(s.key); sinceStep = 0; });
  app.on('plants', (p) => { steps[2].label = `Growing ${Math.round((app.hf?.plants.count ?? 180000) / 1000) * 1000} plants`.replace(/(\d)(?=(\d{3})+\b)/g, '$1,'); });
  const countEl = $('.loader__count'), whatEl = $('.loader__what'), barEl = $('.loader__bar span');
  function updateLoader(dt) {
    sinceStep += dt;
    const doneW = steps.filter((s) => done.has(s.key)).reduce((a, s) => a + s.w, 0);
    const next = steps.find((s) => !done.has(s.key));
    const goal = next ? doneW + next.w * 0.9 * (1 - Math.exp(-sinceStep / 2.5)) : 1;
    shown += (goal - shown) * (1 - Math.exp(-dt * 4));
    if (!next) shown = Math.max(shown, 0.999);
    countEl.textContent = String(Math.min(100, Math.floor(shown * 100 + 0.5))).padStart(3, '0');
    barEl.style.transform = `scaleX(${shown})`;
    if (next && whatEl.textContent !== next.label) whatEl.textContent = next.label;
  }

  // Once everything is in: draw a frame at points all the way down, so every shader is
  // compiled and every texture uploaded behind the loader (not the first time the camera gets
  // there), and time a few to pick the resolution.
  async function warmUp() {
    const frame = () => new Promise((r) => requestAnimationFrame(r));
    const gl = renderer.getContext(), px = new Uint8Array(4);
    const timed = [];
    const at = [0, 0.4, 0.7, 1, 1.4, 1.8, 2, 2.3, 2.6, 3, 3.3, 3.6, 4, 4.5, 5];
    for (const t of at) {
      const p = descent.poseAt(t);
      app.setPose(p.pos, p.yaw, p.pitch, 0, fovFor(p.fov, camera.aspect));
      app.frame(1 / 60);
      if ([0, 1, 2.6, 4].includes(t)) {
        // Twice more, timed to completion (reading a pixel makes the CPU wait for the GPU).
        app.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now();
        app.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        timed.push(performance.now() - t0);
      }
      await frame();
    }
    // Pixels scale with the square of the pixel ratio: aim for about 13 ms a frame.
    if (app.governor.on) {
      timed.sort((a, b) => a - b);
      const ms = timed[Math.floor(timed.length / 2)];
      const pr = Math.min(app.governor.max, Math.max(0.75, app.governor.pr * Math.sqrt(13 / ms)));
      const r = Math.round(pr * 20) / 20;
      if (Math.abs(r - app.governor.pr) > 0.01) { app.governor.pr = r; renderer.setPixelRatio(r); app.setSize(size[0], size[1]); }
      app.governor.min = Math.min(0.75, r);
      window.__calibration = { ms: timed.map((v) => +v.toFixed(1)), pr: r };
    }
    const at0 = params.has('at') ? +params.get('at') : 0;
    jumpTo(pace.screensAt(at0));
    placeCamera(0, true);
    done.add('warm');
  }
  app.on('loaded', () => { loaded = true; warmUp().catch((e) => console.error('warm-up failed', e)); });

  // The loader lifts from black onto the bay, and the title comes up line by line.
  function begin(skip = false) {
    started = true;
    html.classList.remove('loading');
    if (skip) { gsap.set(loaderEl, { autoAlpha: 0 }); gsap.set(['.hud', '.rail'], { autoAlpha: 1 }); lenis?.start(); wordsOn = true; window.__ready = true; return; }
    const t = gsap.timeline();
    t.to(loaderEl, { autoAlpha: 0, duration: reduced ? 0 : 1.6, ease: 'power2.inOut' });
    // The title once the black has mostly lifted.
    t.add(() => { wordsOn = true; }, reduced ? 0 : 1.2);
    t.to(['.hud', '.rail'], { autoAlpha: 1, duration: reduced ? 0 : REVEAL, ease: EASE }, reduced ? 0 : 1.1);
    t.add(() => { lenis?.start(); }, 0.4);
    t.add(() => { window.__ready = true; }, reduced ? 0 : 3.2);
  }

  // Back to the top: the camera climbs the whole way back up. The words stay out of the way.
  document.querySelectorAll('[data-top]').forEach((b) => b.addEventListener('click', (e) => {
    e.preventDefault();
    if (!lenis || reduced) { rewinding = false; jumpTo(0); return; }
    rewinding = true;
    lenis.scrollTo(0, { duration: Math.min(9, 2.5 + cam.screens * 0.45), easing: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2), onComplete: () => { rewinding = false; } });
  }));

  // ---------------------------------------------------------------- the loop

  const statusEl = $('#status');
  let frames = 0, fpsT = 0, fps = 0;
  function tick(dt) {
    if (!started) {
      updateLoader(dt);
      if (done.has('warm') && shown > 0.995) begin();
      return;
    }
    placeCamera(dt);
    updateWords();
    updateFrame();
    app.frame(dt);
    if (DEBUG) {
      frames++; fpsT += dt;
      if (fpsT > 0.5) { fps = frames / fpsT; frames = 0; fpsT = 0; }
      const p = cam.pose;
      statusEl.textContent = `tau ${cam.tau.toFixed(3)}  screens ${cam.screens.toFixed(2)}/${pace.screens}  walked ${p && cam.tau > 1 ? descent.wAt(cam.tau).toFixed(1) + ' m' : '-'}\n`
        + `pos ${p?.pos.map((v) => v.toFixed(1)).join(', ')}  yaw ${p?.yaw.toFixed(1)} pitch ${p?.pitch.toFixed(1)} fov ${camera.fov.toFixed(1)}\n`
        + `${fps.toFixed(0)} fps  pixel ratio ${app.governor.pr.toFixed(2)}  ${renderer.domElement.width}x${renderer.domElement.height}`;
    }
  }

  if (RECORD) {
    // Frame by frame, on the recorder's clock: GSAP's own clock stops and is stepped with it.
    gsap.ticker.remove(gsap.updateRoot);
    let vt = 0;
    window.__scroll = {
      get ready() { return done.has('warm'); },
      begin(skip) { begin(skip); },
      // Advance dt seconds with the page scrolled to `screens`.
      frame(dt, screens) {
        vt += dt;
        scrollTo(0, screens * unit);
        gsap.updateRoot(vt);
        tick(dt);
        return cam.tau;
      },
      pace, get descent() { return descent; }, cam,
    };
    // Until the recorder starts, the loader runs on the real clock.
    const idle = () => { if (!started) { updateLoader(1 / 60); if (!done.has('warm')) requestAnimationFrame(idle); } };
    requestAnimationFrame(idle);
  } else {
    gsap.ticker.lagSmoothing(0);
    gsap.ticker.add((time, deltaMs) => {
      lenis?.raf(time * 1000);
      tick(Math.min(deltaMs / 1000, 0.1));
    });
    window.__scroll = { pace, get descent() { return descent; }, cam, jumpTo, get lenis() { return lenis; } };
  }

  // ---------------------------------------------------------------- debug

  if (DEBUG) {
    buildPanel(app, {
      top: (g) => {
        const f = g.addFolder('Scroll');
        f.add(cam, 'tau').listen().disable();
        const go = { stop: STOPS[0] };
        f.add(go, 'stop', STOPS).name('go to (1-6)').onChange((s) => goTo(STOPS.indexOf(s)));
        f.add({ text: true }, 'text').name('words').onChange((v) => html.classList.toggle('notext', !v));
      },
    });
    const goTo = (i) => lenis ? lenis.scrollTo(pace.screensAt(i) * unit, { duration: 2.5 }) : jumpTo(pace.screensAt(i));
    addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT') return;
      const n = +e.key;
      if (n >= 1 && n <= STOPS.length) goTo(n - 1);
    });
  }
}

