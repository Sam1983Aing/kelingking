// Frame times all the way down the scroll's path (v8), not just at the hero frames.
//
//   node tools/path-bench.mjs                 21 cameras from tau 0 to 5, this build against the
//                                             previous version's tag at the same cameras
//   node tools/path-bench.mjs --step=0.1      closer together
//   node tools/path-bench.mjs --rounds=8      more rounds (default 6)
//   node tools/path-bench.mjs --pace          the landing page itself, scrolled top to bottom in
//                                             real time: how long the frames really take
//   node tools/path-bench.mjs --pace --dpr=2 --size=1512x945   as on a 14-inch MacBook Pro
//
// Side by side (the default): both builds open as shot pages in one headless Chrome (as
// tools/ab.mjs), at 1400 x 788, pixel ratio 1, the 1024 terrain. The cameras come from
// src/scroll/path.js (worked out here in node, the same for both builds), and each page's
// camera is set directly. Two timings at each camera:
//   still    the sea frozen and the camera still, as the hero frames are timed
//   moving   the clock running and the camera moving a little every frame, as in the scroll:
//            the sea's passes, the sky tables, the clouds and the near plants all redo their
//            work every frame
// Reported: the median of the per-round ratios (this build over the other).
//
// --pace: requestAnimationFrame intervals while the page scrolls itself from top to bottom over
// --seconds (default 40), with the page's own resolution governor. Headless Chrome paces
// frames like a 60 Hz screen, so 16.7 ms is a frame on time and anything over 25 ms is a
// dropped one.

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { generateHeightfield } from '../src/terrain/heightfield.js';
import { defaultLayout } from '../src/terrain/layout.js';
import { walkLine } from '../src/trail/route.js';
import { SHOTS } from '../src/shots.js';
import { buildDescent } from '../src/scroll/path.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};

if (flag('pace')) await pace();
else await sideBySide();

async function sideBySide() {
  const W = 1400, H = 788, ROUNDS = +flag('rounds', 6), FRAMES = +flag('frames', 8), STEP = +flag('step', 0.25);
  // The cameras, from the same heightfield the page makes.
  const layout = defaultLayout();
  const hf = generateHeightfield(layout, 1024);
  const groundAt = (x, y) => hf.heightAt(x, y);
  const route = hf.trail.route, pad = layout.trail.pads[0];
  let join0 = 0;
  for (let i = 0; i < route.n; i++) if (route.ht[i] <= pad.h + 0.05) { join0 = route.s[i]; break; }
  const walk = walkLine(route, { from: [SHOTS.viewpoint.pos[0], SHOTS.viewpoint.pos[1]], fromH: pad.h, join: join0 });
  const D = buildDescent({ walk, groundAt, shots: SHOTS, view: { aspect: W / H, fov: 57 }, extent: layout.extent });
  const taus = [];
  for (let t = 0; t <= 5 + 1e-9; t += STEP) taus.push(+t.toFixed(3));
  const cams = taus.map((t) => D.poseAt(t));

  // The other build: a tag checked out under captures/.
  const num = (v) => +v.slice(1);
  const versions = readdirSync(join(root, 'docs/gallery')).filter((d) => /^v\d+$/.test(d)).sort((a, b) => num(a) - num(b));
  const tagged = versions.filter((v) => spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${v}`], { cwd: root }).status === 0);
  const tag = flag('a', tagged.at(-1));
  const dir = `captures/ab-${tag}`;
  rmSync(join(root, dir), { recursive: true, force: true });
  mkdirSync(join(root, dir), { recursive: true });
  if (spawnSync('sh', ['-c', `git archive ${tag} | tar -x -C "${join(root, dir)}"`], { cwd: root }).status !== 0) throw new Error('could not check out ' + tag);

  // In the page: place the camera, then time frames to completion (reading back a pixel makes
  // the CPU wait for the GPU).
  const SETUP = `(() => {
    const A = window.__app, R = A.renderer, gl = R.getContext(), px = new Uint8Array(4), T = A.THREE;
    R.setAnimationLoop(null);
    R.setSize(${W}, ${H}); A.camera.aspect = ${W / H}; A.camera.updateProjectionMatrix();
    let clock = 17;
    const place = (c, dx = 0) => {
      A.camera.position.set(c.pos[0] + dx, c.pos[2], -c.pos[1]);
      A.camera.rotation.set(T.MathUtils.degToRad(c.pitch), -T.MathUtils.degToRad(c.yaw), 0, 'YXZ');
      A.camera.fov = c.fov; A.camera.updateProjectionMatrix();
    };
    const once = () => { A.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
    window.__time = (c, n, moving) => {
      place(c);
      // The sea at the same moment in both builds, and a first frame to settle.
      clock = 17; A.water.update(clock, A.camera, R); once(); once();
      const t0 = performance.now();
      for (let i = 0; i < n; i++) {
        if (moving) { clock += 1 / 60; A.water.update(clock, A.camera, R); place(c, (i % 2) * 0.03); }
        once();
      }
      return (performance.now() - t0) / n;
    };
    return 1; })()`;
  const b = await launch();
  const pages = {};
  try {
    for (const [k, base] of [['a', `http://localhost:5178/${dir}/`], ['b', 'http://localhost:5178/']]) {
      pages[k] = await b.open(`${base}?shot=viewpoint&q=1024&pr=1&t=17`, { width: W, height: H });
      await pages[k].waitFor('window.__ready === true');
      await pages[k].eval(SETUP);
    }
    const res = cams.map(() => ({ still: { a: [], b: [], r: [] }, moving: { a: [], b: [], r: [] } }));
    for (let r = 0; r < ROUNDS; r++) {
      for (let i = 0; i < cams.length; i++) {
        for (const mode of ['still', 'moving']) {
          const order = (r + i) % 2 ? ['b', 'a'] : ['a', 'b'];
          const t = {};
          for (const k of order) { await pages[k].front(); t[k] = await pages[k].eval(`window.__time(${JSON.stringify(cams[i])}, ${FRAMES}, ${mode === 'moving'})`); }
          const o = res[i][mode];
          o.a.push(t.a); o.b.push(t.b); o.r.push(t.b / t.a);
        }
      }
      console.log(`round ${r + 1} of ${ROUNDS}`);
    }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const pct = (v) => `${v >= 1 ? '+' : ''}${((v - 1) * 100).toFixed(0)}%`;
    const rows = taus.map((t, i) => {
      const s = res[i].still, m = res[i].moving;
      return { tau: t, [`${tag} still`]: +med(s.a).toFixed(1), 'still': +med(s.b).toFixed(1), 'still change': pct(med(s.r)),
        [`${tag} moving`]: +med(m.a).toFixed(1), 'moving': +med(m.b).toFixed(1), 'moving change': pct(med(m.r)) };
    });
    console.table(rows);
    const all = (mode) => res.map((o) => med(o[mode].r));
    console.log(`median change along the path: still ${pct(med(all('still')))}, moving ${pct(med(all('moving')))}; worst point: still ${pct(Math.max(...all('still')))}, moving ${pct(Math.max(...all('moving')))}`);
    console.log(`slowest camera here: still ${Math.max(...res.map((o) => med(o.still.b))).toFixed(1)} ms, moving ${Math.max(...res.map((o) => med(o.moving.b))).toFixed(1)} ms (1400 x 788, pixel ratio 1)`);
    mkdirSync(join(root, 'captures'), { recursive: true });
    writeFileSync(join(root, 'captures', 'path-bench.json'), JSON.stringify({ tag, W, H, rows }, null, 1));
  } finally {
    b.close();
  }
}

async function pace() {
  const [W, H] = String(flag('size', '1440x900')).split('x').map(Number);
  const DPR = +flag('dpr', 1), SECONDS = +flag('seconds', 40);
  const b = await launch();
  try {
    const p = await b.open('about:blank', { width: W, height: H });
    await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false }, p.sessionId);
    await b.send('Page.navigate', { url: 'http://localhost:5178/' }, p.sessionId);
    await p.waitFor('window.__ready === true', 180000);
    const r = await p.eval(`new Promise((done) => {
      const S = __scroll, L = S.lenis, total = S.pace.screens * innerHeight;
      const dts = [], taus = [], prs = [];
      let last = performance.now(), t0 = last;
      L.scrollTo(total, { duration: ${SECONDS}, easing: (x) => x, lock: true });
      const tick = () => {
        const now = performance.now();
        dts.push(now - last); taus.push(S.cam.tau); prs.push(__app.governor.pr); last = now;
        if (now - t0 < ${SECONDS * 1000 + 1500}) requestAnimationFrame(tick);
        else done({ dts, taus, prs, calibration: window.__calibration, size: [__app.renderer.domElement.width, __app.renderer.domElement.height] });
      };
      requestAnimationFrame(tick);
    })`, (SECONDS + 30) * 1000);
    const d = r.dts.slice(5);
    const sorted = [...d].sort((a, b) => a - b);
    const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))].toFixed(1);
    const long = d.filter((v) => v > 25).length, hitches = d.filter((v) => v > 50);
    console.log(`${d.length} frames in ${(d.reduce((a, v) => a + v, 0) / 1000).toFixed(1)} s at ${r.size.join(' x ')} (pixel ratio ${r.prs[0]} to ${r.prs.at(-1)}, calibrated ${JSON.stringify(r.calibration)})`);
    console.log(`frame intervals: median ${q(0.5)} ms, 90% ${q(0.9)}, 99% ${q(0.99)}, longest ${sorted.at(-1).toFixed(1)}; over 25 ms: ${long} (${((100 * long) / d.length).toFixed(1)}%); over 50 ms: ${hitches.length}`);
    // Where along the path the slow frames were, by tenths of tau.
    const by = new Map();
    d.forEach((v, i) => { const k = Math.floor(r.taus[i + 5] * 2) / 2; const o = by.get(k) ?? { n: 0, slow: 0, sum: 0 }; o.n++; o.sum += v; if (v > 25) o.slow++; by.set(k, o); });
    console.table([...by].sort((a, b) => a[0] - b[0]).map(([k, o]) => ({ tau: `${k}-${k + 0.5}`, frames: o.n, 'mean ms': +(o.sum / o.n).toFixed(1), 'over 25 ms': o.slow })));
    const hitchAt = hitches.length ? d.map((v, i) => [v, r.taus[i + 5]]).filter(([v]) => v > 50).map(([v, t]) => `${v.toFixed(0)} ms at tau ${t.toFixed(2)}`) : [];
    if (hitchAt.length) console.log('hitches: ' + hitchAt.join(', '));
  } finally {
    b.close();
  }
}
