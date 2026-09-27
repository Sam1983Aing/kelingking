// What each group of plants costs in a frame, in one page (v7): hide one group at a time and
// time it against everything shown, alternating over many rounds, as parts.mjs does for the
// ground's shader. Groups are prefixes of the plant meshes' names (src/veg/near.js,
// impostors.js): near:grass, near:scaevola, near:scaevola:0:1 (a variant's lighter level),
// impostor:0 (a species' impostors), all (every plant), or ~ and a regular expression
// (~:1$ every lighter level).
//
//   node tools/veg-parts.mjs trailTop trailLow --groups=near:grass,near:scaevola,impostor --rounds=16
//
// Needs the local server (python3 tools/serve.py).

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
const groups = String(flag('groups', 'all,near:grass,near,impostor')).split(',').filter(Boolean);
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
  R.setAnimationLoop(null);
  // Pick the plants for this camera once, then leave them (the timing draws a still frame).
  A.renderFrame();
  const match = (name, g) => g === 'all' || (g[0] === '~' ? new RegExp(g.slice(1)).test(name) : name.startsWith(g));
  const meshes = [];
  A.plants.group.traverse((o) => { if (o.isMesh) meshes.push(o); });
  const once = () => { A.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  window.__time = (group, n) => {
    const hide = group === 'none' ? [] : meshes.filter((m) => match(m.name, group));
    const keep = hide.map((m) => m.visible);
    hide.forEach((m) => (m.visible = false));
    once(); once();
    const t0 = performance.now();
    for (let i = 0; i < n; i++) once();
    const t = (performance.now() - t0) / n;
    hide.forEach((m, i) => (m.visible = keep[i]));
    return t;
  };
  window.__count = (group) => meshes.filter((m) => match(m.name, group)).reduce((a, m) => a + (m.visible ? m.geometry.instanceCount ?? 1 : 0), 0);
  return meshes.length;
})()`;

const b = await launch();
try {
  for (const name of shots) {
    const shot = SHOTS[name];
    const extra = flag('set') ? '&' + String(flag('set')).split(';').join('&') : '';
    // (The extra switches first: a page reads the first of a repeated switch.)
    const page = await b.open(`http://localhost:5178/?shot=${name}${extra}&q=1024&pr=1&t=17`, { width: WIDTH, height: Math.round(WIDTH / refAspect(shot.ref)) });
    await page.waitFor('window.__ready === true');
    await page.eval(SETUP);
    const ratios = Object.fromEntries(groups.map((g) => [g, []]));
    const base = [];
    for (let r = 0; r < ROUNDS; r++) {
      const order = r % 2 ? [...groups].reverse() : groups;
      for (const g of order) {
        const t0 = await page.eval(`window.__time('none', ${FRAMES})`);
        const t1 = await page.eval(`window.__time(${JSON.stringify(g)}, ${FRAMES})`);
        base.push(t0);
        ratios[g].push(t1 / t0);
      }
    }
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const all = med(base);
    console.log(`${name.padEnd(12)} everything ${all.toFixed(2)} ms`);
    for (const g of groups) {
      const n = await page.eval(`window.__count(${JSON.stringify(g)})`);
      const r = med(ratios[g]);
      console.log(`  without ${g.padEnd(22)} ${((r - 1) * 100).toFixed(0).padStart(4)}%   (${(all * (1 - r)).toFixed(2)} ms, ${n} instances)`);
    }
    await page.close();
  }
} finally {
  b.close();
}
