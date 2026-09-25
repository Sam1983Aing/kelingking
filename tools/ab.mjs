// Time two builds against each other in one browser, at the same time.
//
//   node tools/ab.mjs beach sideFromSea                   this folder against the previous version's tag
//   node tools/ab.mjs beach --a=v3 --rounds=15            against a chosen tag
//   node tools/ab.mjs --hero                              every hero frame
//
// Frame times on this Mac swing by 2x with whatever else is on the GPU, and `hero.mjs` times
// each version in its own pages, minutes apart, so one version can catch a quiet moment the
// other did not. Here both pages stay open side by side in one headless Chrome and are timed
// in alternation (a burst of frames in one, then the other, many rounds), so background load
// falls on both alike. Reported: the median of the per-round ratios, and the spread.
// Needs the local server (python3 -m http.server 5178).

import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const { SHOTS, HERO } = await import(join(root, 'src/shots.js'));
let shots = args.filter((a) => !a.startsWith('--'));
if (flag('hero') || !shots.length) shots = HERO;
const ROUNDS = +flag('rounds', 12);
const FRAMES = +flag('frames', 8);
const WIDTH = 1400;

// The other build: a tag checked out under captures/.
const num = (v) => +v.slice(1);
const gallery = join(root, 'docs/gallery');
const versions = readdirSync(gallery).filter((d) => /^v\d+$/.test(d)).sort((a, b) => num(a) - num(b));
const tag = flag('a', versions.at(-2));
const dir = `captures/ab-${tag}`;
rmSync(join(root, dir), { recursive: true, force: true });
mkdirSync(join(root, dir), { recursive: true });
if (spawnSync('sh', ['-c', `git archive ${tag} | tar -x -C "${join(root, dir)}"`], { cwd: root }).status !== 0) throw new Error('could not check out ' + tag);

const TIMER = `(n) => {
  const A = window.__app, R = A.renderer, gl = R.getContext(), px = new Uint8Array(4);
  const draw = A.renderFrame ?? (() => R.render(A.scene, A.camera));
  const once = () => { draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  once(); once();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) once();
  return (performance.now() - t0) / n;
}`;

// Aspect ratio of a JPEG from its SOF header (as capture.mjs sizes its pages).
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

const b = await launch();
const rows = [];
try {
  for (const name of shots) {
    const shot = SHOTS[name];
    const q = `shot=${name}&q=1024&pr=1&t=17`;
    const h = Math.round(WIDTH / refAspect(shot.ref));
    const pages = {};
    // One at a time: a page that is not in front gets no animation frames, and its ready flag
    // is set from the animation loop.
    for (const [k, base] of [['a', `http://localhost:5178/${dir}/`], ['b', 'http://localhost:5178/']]) {
      pages[k] = await b.open(base + '?' + q, { width: WIDTH, height: h });
      await pages[k].waitFor('window.__ready === true');
    }
    // Stop both pages' own animation loops, or each would keep drawing while the other is
    // being timed. The sea is frozen (t=17), so a still frame is all there is to draw.
    for (const p of Object.values(pages)) await p.eval(`window.__app.renderer.setAnimationLoop(null); window.__time = ${TIMER}; 0`);
    const ta = [], tb = [], ratio = [];
    for (let r = 0; r < ROUNDS; r++) {
      // Alternate which goes first, so neither always gets the warmer GPU.
      const order = r % 2 ? ['b', 'a'] : ['a', 'b'];
      const t = {};
      for (const k of order) { await pages[k].front(); t[k] = await pages[k].eval(`window.__time(${FRAMES})`); }
      ta.push(t.a); tb.push(t.b); ratio.push(t.b / t.a);
    }
    for (const p of Object.values(pages)) await p.close();
    const med = (a) => [...a].sort((x, y) => x - y)[a.length >> 1];
    const q1 = (a) => [...a].sort((x, y) => x - y)[Math.floor(a.length / 4)];
    const q3 = (a) => [...a].sort((x, y) => x - y)[Math.floor((3 * a.length) / 4)];
    const pct = (v) => `${v >= 1 ? '+' : ''}${((v - 1) * 100).toFixed(0)}%`;
    const row = { name, a: med(ta), b: med(tb), ratio: med(ratio), lo: q1(ratio), hi: q3(ratio) };
    rows.push(row);
    console.log(`${name.padEnd(12)} ${tag} ${row.a.toFixed(2).padStart(6)} ms   this ${row.b.toFixed(2).padStart(6)} ms   ${pct(row.ratio).padStart(5)}  (middle half ${pct(row.lo)} to ${pct(row.hi)})`);
  }
} finally {
  b.close();
}
