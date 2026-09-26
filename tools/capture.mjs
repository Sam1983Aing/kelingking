// Render shots headlessly and save PNGs, for comparing against the reference photos.
// Talks to Chrome over the DevTools protocol directly, so there is nothing to install.
//
//   node tools/capture.mjs                        every shot, render only
//   node tools/capture.mjs viewpoint overview     just these
//   node tools/capture.mjs viewpoint --compare    render and photo side by side
//   node tools/capture.mjs viewpoint --overlay=0.5 --diff
//   node tools/capture.mjs viewpoint --outline     render edges traced over the photo
//   node tools/capture.mjs --width=1600 --q=2048 --contours
//   node tools/capture.mjs beach --t=20.5           freeze the sea at 20.5 s (default 12)
//   node tools/capture.mjs beach --clip=8           8 s clip from --t, 30 fps, to captures/<shot>.mp4 (needs ffmpeg)
//   node tools/capture.mjs viewpoint --clip=10 --hours=6.5:17.8   the sun through the day instead
//   node tools/capture.mjs --hero                   the hero frames (src/shots.js), see tools/hero.mjs
//   node tools/capture.mjs --out=some/dir --jpeg    write elsewhere, as JPEG
//   node tools/capture.mjs --bench                  render time per shot (with --out, also bench.json)
//   node tools/capture.mjs viewpoint --measure      average colour per region, render against photo
//   node tools/capture.mjs viewpoint --eval="window.__light"   print something from the page
//        add --benchpage to load the page as the bench does (q=1024, pr=1, no capture mode)
//                                                   (a PNG data URL comes back as <shot>-eval.png)
//   node tools/capture.mjs viewpoint --set="hour=10;haze=4;ev=-0.5"  any page switches (see main.js)
//   node tools/capture.mjs viewpoint --console      print the page's warnings and errors
//
// Needs the local server running (http://localhost:5178, see .claude/launch.json or
// `python3 -m http.server 5178`). Output goes to captures/<shot>[-compare].png

import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const BASE = flag('url', 'http://localhost:5178/');
const WIDTH = +flag('width', 1400);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const { SHOTS, HERO } = await import(join(root, 'src/shots.js'));
let shots = args.filter((a) => !a.startsWith('--'));
if (!shots.length) shots = flag('hero') ? HERO : Object.keys(SHOTS);
const OUTDIR = join(root, flag('out', 'captures'));
const JPEG = !!flag('jpeg');
const benchResults = {};

const profile = mkdtempSync(join(tmpdir(), 'kelingking-cap-'));
const chrome = spawn(CHROME, [
  '--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`,
  '--no-first-run', '--no-default-browser-check', '--hide-scrollbars',
  '--enable-webgl', '--ignore-gpu-blocklist', '--use-angle=metal', 'about:blank',
], { stdio: ['ignore', 'ignore', 'pipe'] });

const wsUrl = await new Promise((resolve, reject) => {
  let buf = '';
  chrome.stderr.on('data', (d) => {
    buf += d;
    const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
    if (m) resolve(m[1]);
  });
  chrome.on('exit', () => reject(new Error('Chrome exited early:\n' + buf)));
  setTimeout(() => reject(new Error('Chrome did not start')), 15000);
});

const ws = new WebSocket(wsUrl);
await new Promise((r) => ws.addEventListener('open', r, { once: true }));
let seq = 0;
const pending = new Map();
const consoleLog = [];
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
    consoleLog.push(msg.params.type + ': ' + msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ').slice(0, 1500));
  if (msg.method === 'Runtime.exceptionThrown') consoleLog.push('exception: ' + (msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text));
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
  }
});
const send = (method, params = {}, sessionId) =>
  new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, sessionId }));
  });

mkdirSync(OUTDIR, { recursive: true });
try {
  for (const name of shots) {
    const shot = SHOTS[name];
    if (!shot) { console.log('unknown shot', name); continue; }
    const aspect = await refAspect(shot.ref);
    const compare = flag('compare', false);
    const w = WIDTH, h = Math.round(WIDTH / aspect);
    const q = new URLSearchParams({ shot: name, capture: '1', q: flag('q', '2048'), t: flag('t', '12') });
    if (flag('bench') || flag('benchpage')) { q.delete('capture'); q.set('q', '1024'); q.set('pr', '1'); }
    if (compare) q.set('compare', 'side');
    if (flag('overlay')) q.set('overlay', flag('overlay'));
    if (flag('diff')) q.set('diff', '1');
    if (flag('contours')) q.set('contours', '1');
    if (flag('outline')) q.set('outline', '1');
    if (flag('debug')) q.set('debug', flag('debug'));
    if (flag('hide')) q.set('hide', flag('hide'));
    if (flag('clay')) q.set('clay', flag('clay') === true ? '1' : flag('clay'));
    if (flag('set')) for (const kv of String(flag('set')).split(';')) { const [k, ...v] = kv.split('='); q.set(k, v.join('=')); }

    const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    await send('Emulation.setDeviceMetricsOverride', { width: compare ? w * 2 : w, height: h, deviceScaleFactor: 1, mobile: false }, sessionId);
    await send('Runtime.enable', {}, sessionId);
    await send('Page.enable', {}, sessionId);
    const t0 = Date.now();
    await send('Page.navigate', { url: BASE + '?' + q }, sessionId);
    for (;;) {
      const r = await send('Runtime.evaluate', { expression: 'window.__ready === true', returnByValue: true }, sessionId);
      if (r.result.value) break;
      if (Date.now() - t0 > 120000) throw new Error(`${name}: page never became ready\n` + consoleLog.filter((l) => !/deprecated|PCFSoft/.test(l)).join('\n'));
      await new Promise((res) => setTimeout(res, 250));
    }
    // --console: print the page's warnings and errors (a shader that fails to compile does
    // not stop the page, it just draws nothing).
    if (flag('console')) {
      const lines = consoleLog.splice(0).filter((l) => !/deprecated|PCFSoft|UNSUPPORTED/.test(l));
      console.log(`${name}: ${lines.length} console message(s)`);
      lines.forEach((l) => console.log('  ' + l.slice(0, 3000)));
    }
    if (flag('bench')) {
      // Time to render a frame to completion: render, then read back one pixel, which makes
      // the CPU wait for the GPU. Repeated and averaged, with the ground and the sea each
      // switched off in turn. (GPU timer queries through ANGLE on Metal return nonsense, and
      // frame-to-frame timing in headless Chrome mostly measures the compositor.)
      const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: `(async () => {
        const A = window.__app, R = A.renderer, gl = R.getContext(), px = new Uint8Array(4);
        // The whole frame where the page says what that is (v2 on: sky tables and clouds too).
        const draw = A.renderFrame ?? (() => R.render(A.scene, A.camera));
        const once = () => { draw(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
        const time = () => { for (let i = 0; i < 3; i++) once(); const t0 = performance.now(); for (let i = 0; i < 15; i++) once(); return (performance.now() - t0) / 15; };
        await new Promise((r) => setTimeout(r, 500));
        const out = { all: time() };
        A.terrain.mesh.visible = false; out.noGround = time(); A.terrain.mesh.visible = true;
        A.water.mesh.visible = false; out.noSea = time(); A.water.mesh.visible = true;
        out.all = Math.min(out.all, time());
        const mat = A.terrain.mesh.material;
        // Ablations: SKIP_* defines on the ground material, or whole parts of the frame.
        const parts = {
          SKIP_plants: [() => A.plants && (A.plants.group.visible = false), () => A.plants && (A.plants.group.visible = true)],
          SKIP_trail: [() => A.trail && (A.trail.group.visible = false), () => A.trail && (A.trail.group.visible = true)],
          SKIP_sky: [() => (A.scene.getObjectByProperty('renderOrder', 10).visible = false), () => (A.scene.getObjectByProperty('renderOrder', 10).visible = true)],
          SKIP_passes: [() => (A.__draw = draw), () => {}],
        };
        for (const k of ${JSON.stringify(String(flag('ablate', '')).split(',').filter(Boolean))}) {
          if (k === 'SKIP_passes') { out[k] = (() => { const d = () => { R.render(A.scene, A.camera); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); }; for (let i = 0; i < 3; i++) d(); const t0 = performance.now(); for (let i = 0; i < 15; i++) d(); return (performance.now() - t0) / 15; })(); continue; }
          if (parts[k]) { parts[k][0](); time(); out[k] = time(); parts[k][1](); continue; }
          // WSKIP_x: a define on the sea's material instead of the ground's.
          const m2 = k.startsWith('WSKIP_') ? A.water.mesh.material : mat;
          const keep = { ...m2.defines };
          m2.defines = { ...keep, [k.startsWith('WSKIP_') ? k.slice(1) : k]: 1 }; m2.needsUpdate = true; time(); out[k] = time();
          m2.defines = keep; m2.needsUpdate = true;
        }
        mat.defines = {}; mat.needsUpdate = true;
        const c = R.domElement; out.mp = c.width * c.height / 1e6;
        out.reversed = R.capabilities.reversedDepthBuffer;
        return out; })()` }, sessionId);
      const o = r.result.value, f = (v) => v.toFixed(1).padStart(5);
      benchResults[name] = { ms: +o.all.toFixed(1), noGround: +o.noGround.toFixed(1), noSea: +o.noSea.toFixed(1), mp: +o.mp.toFixed(2) };
      console.log(`${name.padEnd(12)} ${f(o.all)} ms (${(1000 / o.all).toFixed(0).padStart(3)} fps) at ${o.mp.toFixed(2)} MP   no ground ${f(o.noGround)}   no sea ${f(o.noSea)}`
        + Object.keys(o).filter((k) => k.startsWith('SKIP')).map((k) => `   ${k.slice(5).toLowerCase()} ${f(o[k])}`).join(''));
      await send('Target.closeTarget', { targetId });
      continue;
    }
    if (flag('eval')) {
      // Evaluate an expression in the page once it is ready and print the result.
      const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: String(flag('eval')) }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      const v = r.result.value;
      if (typeof v === 'string' && v.startsWith('data:image/png;base64,')) {
        // The expression drew something and handed back the canvas: save it.
        const out = join(OUTDIR, `${name}-eval.png`);
        writeFileSync(out, Buffer.from(v.slice(22), 'base64'));
        console.log(`${name}: ${out.replace(root + '/', '')}`);
      } else console.log(`${name}:`, JSON.stringify(v, null, 1));
      await send('Target.closeTarget', { targetId });
      continue;
    }
    if (flag('measure')) {
      const r = await send('Runtime.evaluate', { awaitPromise: true, returnByValue: true, expression: 'window.__app.measure()' }, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      const rows = r.result.value;
      const light = (await send('Runtime.evaluate', { returnByValue: true, expression: 'window.__light' }, sessionId)).result.value;
      const f = (v) => String(v).padStart(4);
      console.log(`${name}: region              pixels   render sRGB      photo sRGB     render/photo       scene kcd/m2`);
      for (const row of rows) {
        const ratio = row.render.lum / row.photo.lum;
        console.log(`  ${row.name.padEnd(18)} ${String(row.n).padStart(7)}   ${row.render.srgb.map(f).join('')}   ${row.photo.srgb.map(f).join('')}   ${(Math.log2(ratio) >= 0 ? '+' : '') + Math.log2(ratio).toFixed(2)} stops   ${row.scene.lum.toFixed(2).padStart(6)}`);
      }
      if (light) console.log('  light:', JSON.stringify(light));
      writeFileSync(join(OUTDIR, `${name}-measure.json`), JSON.stringify({ rows, light }, null, 1));
      await send('Target.closeTarget', { targetId });
      continue;
    }
    if (flag('clip')) {
      const secs = +flag('clip'), fps = +flag('fps', 30), t0s = +flag('t', 12);
      const dir = mkdtempSync(join(tmpdir(), 'kelingking-clip-'));
      const n = Math.round(secs * fps);
      const hours = flag('hours') ? String(flag('hours')).split(':').map(Number) : null;
      for (let f = 0; f < n; f++) {
        const set = hours ? `window.__app.setHour(${hours[0] + (hours[1] - hours[0]) * f / Math.max(n - 1, 1)})` : `window.__app.setTime(${t0s + f / fps})`;
        await send('Runtime.evaluate', {
          expression: `new Promise(r => { ${set}; requestAnimationFrame(() => requestAnimationFrame(r)); })`,
          awaitPromise: true,
        }, sessionId);
        const fr = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
        writeFileSync(join(dir, `f${String(f).padStart(4, '0')}.png`), Buffer.from(fr.data, 'base64'));
      }
      const mp4 = join(OUTDIR, `${name}${hours ? '-day' : ''}.mp4`);
      const { spawnSync } = await import('node:child_process');
      const enc = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', join(dir, 'f%04d.png'),
        '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '20', mp4]);
      rmSync(dir, { recursive: true, force: true });
      if (enc.status !== 0) throw new Error('ffmpeg failed: ' + enc.stderr);
      console.log(`${name}: ${mp4.replace(root + '/', '')} (${n} frames, ${((Date.now() - t0) / 1000).toFixed(1)} s)`);
      await send('Target.closeTarget', { targetId });
      continue;
    }
    const shotPng = await send('Page.captureScreenshot', JPEG ? { format: 'jpeg', quality: 88 } : { format: 'png' }, sessionId);
    const out = join(OUTDIR, `${name}${compare ? '-compare' : ''}${flag('overlay') ? '-overlay' : ''}${flag('outline') ? '-outline' : ''}.${JPEG ? 'jpg' : 'png'}`);
    writeFileSync(out, Buffer.from(shotPng.data, 'base64'));
    console.log(`${name}: ${out.replace(root + '/', '')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await send('Target.closeTarget', { targetId });
  }
  if (flag('bench') && flag('out')) writeFileSync(join(OUTDIR, 'bench.json'), JSON.stringify(benchResults, null, 2) + '\n');
} finally {
  ws.close();
  chrome.kill();
  // Chrome can still be writing to its profile for a moment after being killed.
  setTimeout(() => { try { rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch {} }, 800);
}

// Aspect ratio of a JPEG from its SOF header, without decoding it.
async function refAspect(rel) {
  const { readFileSync } = await import('node:fs');
  try {
    const b = readFileSync(join(root, rel));
    for (let i = 2; i < b.length; ) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m >= 0xc0 && m <= 0xc3) return b.readUInt16BE(i + 7) / b.readUInt16BE(i + 5);
      i += 2 + b.readUInt16BE(i + 2);
    }
  } catch {}
  return 16 / 9;
}
