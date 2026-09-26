// What each part of a frame costs, in one page: switch parts off one at a time with compile
// switches, alternate the variants over many rounds, report medians against everything on.
// Single bench runs on this Mac swing too much to read a part of a millisecond; alternating
// in one page puts any background load on every variant alike.
//
//   node tools/parts.mjs trailLow beach --parts=SKIP_SWASH,WSKIP_SWASH --rounds=12
//
// A part is a define: SKIP_x on the ground's material, WSKIP_x (sets SKIP_x) on the sea's;
// SKIP_a+WSKIP_b switches several at once.
// `none` in the list times everything on again, as a check on the spread.
// Needs the local server (python3 -m http.server 5178).

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { launch } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const { SHOTS } = await import(join(root, 'src/shots.js'));
const shots = args.filter((a) => !a.startsWith('--'));
const parts = String(flag('parts', 'none')).split(',').filter(Boolean);
const ROUNDS = +flag('rounds', 12), FRAMES = +flag('frames', 8), WIDTH = 1400;

function refAspect(rel) {
  try {
    const buf = readFileSync(join(root, rel));
    for (let i = 2; i < buf.length; ) {
      if (buf[i] !== 0xff) { i++; continue; }
      const m = buf[i + 1];
      if (m >= 0xc0 && m <= 0xc3) return buf.readUInt16BE(i + 7) / buf.readUInt16BE(i + 5);
      i += 2 + buf.readUInt16BE(i + 2);
    }
  } catch {}
  return 16 / 9;
}

const SETUP = `(() => {
  const A = window.__app, R = A.renderer, gl = R.getContext(), px = new Uint8Array(4);
  const draw = A.renderFrame ?? (() => R.render(A.scene, A.camera));
  const once = () => { draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  const orig = { g: A.terrain.mesh.material, w: A.water.mesh.material };
  const meshes = { g: A.terrain.mesh, w: A.water.mesh };
  // One material per variant, kept alive, so each keeps its compiled program (three.js drops a
  // program as soon as no material uses it, and switching defines back and forth on one
  // material recompiled every time). Clones share the originals' uniforms and hooks.
  const cache = {};
  // A variant can switch several parts at once: SKIP_A+WSKIP_B.
  const matFor = (m, k) => {
    const key = m + ':' + k;
    if (!cache[key]) {
      const mine = k === 'all' || k === 'none' ? [] : k.split('+').filter((d) => (d.startsWith('WSKIP_') ? m === 'w' : m === 'g'));
      if (!mine.length) cache[key] = orig[m];
      else {
        const c = orig[m].clone();
        c.onBeforeCompile = orig[m].onBeforeCompile;
        if (orig[m].uniforms) c.uniforms = orig[m].uniforms;
        c.defines = { ...(orig[m].defines || {}) };
        for (const d of mine) c.defines[d.startsWith('WSKIP_') ? d.slice(1) : d] = 1;
        c.customProgramCacheKey = () => 'parts-' + key;
        cache[key] = c;
      }
    }
    return cache[key];
  };
  window.__variant = (k) => {
    for (const m of ['g', 'w']) meshes[m].material = matFor(m, k);
    once(); once();
  };
  window.__time = (n) => { once(); const t0 = performance.now(); for (let i = 0; i < n; i++) once(); return (performance.now() - t0) / n; };
  R.setAnimationLoop(null);
  return 0;
})()`;

const b = await launch();
try {
  for (const name of shots) {
    const shot = SHOTS[name];
    const page = await b.open(`http://localhost:5178/?shot=${name}&q=1024&pr=1&t=17`, { width: WIDTH, height: Math.round(WIDTH / refAspect(shot.ref)) });
    await page.waitFor('window.__ready === true');
    await page.front();
    await page.eval(SETUP);
    const variants = ['all', ...parts];
    for (const v of variants) await page.eval(`window.__variant(${JSON.stringify(v)}); 0`);
    const t = Object.fromEntries(variants.map((v) => [v, []]));
    for (let r = 0; r < ROUNDS; r++) {
      const order = r % 2 ? [...variants].reverse() : variants;
      for (const v of order) t[v].push(await page.eval(`window.__variant(${JSON.stringify(v)}); window.__time(${FRAMES})`));
    }
    await page.close();
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const all = med(t.all);
    console.log(`${name.padEnd(12)} all ${all.toFixed(2)} ms` + parts.map((p) => `   ${p.toLowerCase()} ${(med(t[p]) - all >= 0 ? '+' : '')}${(med(t[p]) - all).toFixed(2)}`).join(''));
  }
} finally {
  b.close();
}
