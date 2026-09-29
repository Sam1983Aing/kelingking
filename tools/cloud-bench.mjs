// What the cloud march costs on its own (v9): the pass that marches the clouds into their
// half-resolution texture, forced to run every frame (as on the scrolling page, where the clock
// always runs), timed in bursts, against the whole still frame. "march" is what the page pays
// each frame (one pixel in sixteen from v9), "whole march" a still frame's or a jump's.
//   node tools/cloud-bench.mjs eastCove viewpoint --rounds=8
//   node tools/cloud-bench.mjs eastCove --set="clouds.coverage=0.5"
// Needs the local server (python3 tools/serve.py).

import { readFileSync } from 'node:fs';
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
const { SHOTS } = await import(join(root, 'src/shots.js'));
const shots = args.filter((a) => !a.startsWith('--'));
const ROUNDS = +flag('rounds', 9), FRAMES = +flag('frames', 20), WIDTH = +flag('width', 1400);
const BASE = String(flag('url', 'http://localhost:5178/')).replace(/\/?$/, '/');
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
const extra = flag('set') ? '&' + String(flag('set')).split(';').join('&') : '';
const b = await launch();
try {
  for (const name of shots) {
    const h = Math.round(WIDTH / (SHOTS[name].ref ? refAspect(SHOTS[name].ref) : 16 / 9));
    const page = await b.open(`${BASE}?shot=${name}&q=1024&pr=1&t=17${extra}`, { width: WIDTH, height: h });
    await page.waitFor('window.__ready === true');
    // The cloud passes alone, back to back: N marches, then a pixel read back from the clouds'
    // texture, which waits for all of them (each march reads the one before). Per march: the
    // per-frame march the page pays (after a whole one, so it has something to carry over), a
    // whole march; and a still frame for scale. Median of the rounds.
    const r = await page.eval(`(() => {
      const A = window.__app, R = A.renderer, gl = R.getContext(), px = new Uint8Array(4);
      R.setAnimationLoop(null);
      let k = 0;
      const med = (a) => a.sort((x, y) => x - y)[a.length >> 1];
      const burst = (whole) => {
        A.clouds.render(17 + (++k) * 0.37, A.camera, whole); A.clouds.sync();
        const t0 = performance.now();
        for (let i = 0; i < ${FRAMES}; i++) A.clouds.render(17 + (++k) * 0.37, A.camera, whole);
        A.clouds.sync();
        return (performance.now() - t0) / ${FRAMES};
      };
      const frame = () => { A.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px);
        const t0 = performance.now(); for (let i = 0; i < ${FRAMES}; i++) { A.renderFrame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); } return (performance.now() - t0) / ${FRAMES}; };
      // (Read straight from the texture, so it works on any version's clouds.)
      const fb = gl.createFramebuffer(), fpx = new Float32Array(4);
      A.clouds.sync = () => {
        const prev = gl.getParameter(gl.FRAMEBUFFER_BINDING);
        gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, R.properties.get(A.clouds.texture).__webglTexture, 0);
        gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.FLOAT, fpx);
        gl.bindFramebuffer(gl.FRAMEBUFFER, prev);
      };
      const m = [], w = [], f = [];
      for (let i = 0; i < ${ROUNDS}; i++) { m.push(burst(false)); w.push(burst(true)); f.push(frame()); }
      return { march: med(m), whole: med(w), frame: med(f) };
    })()`);
    console.log(`${name.padEnd(12)} march ${r.march.toFixed(2).padStart(6)} ms   (whole march ${r.whole.toFixed(2).padStart(6)} ms)   still frame ${r.frame.toFixed(2).padStart(6)} ms`);
    await page.close();
  }
} finally { b.close(); }
