// A recording of the landing page scrolled from top to bottom (v8), as someone reading it
// would: the loader lifting, the title, then an even scroll (the camera's own pacing slows it
// at each stop, src/scroll/path.js), and a few seconds at the end.
//
//   node tools/scroll-clip.mjs                    1920 x 1080, 30 fps, to captures/scroll-desktop.mp4
//   node tools/scroll-clip.mjs --phone            390 x 844 at 2x, to captures/scroll-phone.mp4
//   node tools/scroll-clip.mjs --speed=0.3        screens of scroll per second (default 0.28)
//   node tools/scroll-clip.mjs --from=8 --to=11   only part of the scroll, in screens
//   node tools/scroll-clip.mjs --set="notext"     any page switches (; between several)
//   node tools/scroll-clip.mjs --out=name         captures/<name>.mp4
//   node tools/scroll-clip.mjs --drag=12,-70      at 12 s into the video, turn the head 70 degrees
//                                                 left (as a drag would) over 1.2 s, hold 1.5 s and let
//                                                 go; ; between several (v9)
//   node tools/scroll-clip.mjs --stills=2.3,2.5   stills at these values of tau instead, tiled into
//                                                 captures/<name>.jpg (--cols=4, --width=480 each)
//
// The page is stepped frame by frame on the recording's clock (scroll.js ?record), so the sea,
// the plants, the camera and the words all move exactly as they would at the frame rate,
// however long each frame takes to draw here. What it does not show is how smoothly a given
// machine draws it: that is tools/path-bench.mjs. Needs ffmpeg and the local server.

import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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
const PHONE = !!flag('phone');
const [W, H] = String(flag('size', PHONE ? '390x844' : '1920x1080')).split('x').map(Number);
const DPR = +flag('dpr', PHONE ? 2 : 1);
const FPS = +flag('fps', 30);
const SPEED = +flag('speed', 0.28);
const out = join(root, 'captures', `${flag('out', PHONE ? 'scroll-phone' : 'scroll-desktop')}.mp4`);

const q = new URLSearchParams({ record: '1' });
if (flag('set')) for (const kv of String(flag('set')).split(';')) { const [k, ...v] = kv.split('='); q.set(k, v.join('=')); }

const b = await launch();
const t0 = Date.now();
const page = await b.open('about:blank', { width: W, height: H });
await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: PHONE }, page.sessionId);
if (PHONE) await b.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, page.sessionId);
await b.send('Page.navigate', { url: `http://localhost:5178/?${q}` }, page.sessionId);
await page.waitFor('window.__scroll && window.__scroll.ready === true', 180000);
const total = await page.eval('__scroll.pace.screens');
const from = +flag('from', 0), to = +flag('to', total);
console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s; recording screens ${from} to ${to} at ${SPEED} screens/s`);

// The scroll over time: the title first (only from the top), then an even speed with a
// second's ease in and out, then a hold.
const intro = from === 0 ? 3.4 : 0.6, hold = to >= total ? 4.5 : 0.6, ramp = 1.2;
const dist = to - from, cruise = dist / SPEED;
const T = intro + cruise + ramp + hold;
// Distance after time s into the move, easing up to speed over `ramp` and down at the end.
const moved = (s) => {
  const v = SPEED, dur = cruise + ramp;
  if (s <= 0) return 0;
  if (s >= dur) return dist;
  if (s < ramp) return (v * s * s) / (2 * ramp);
  if (s > dur - ramp) { const r = dur - s; return dist - (v * r * r) / (2 * ramp); }
  return (v * ramp) / 2 + v * (s - ramp);
};
const screensAt = (t) => from + moved(t - intro);

const dir = mkdtempSync(join(tmpdir(), 'kelingking-scroll-'));
if (flag('stills')) {
  // Each still: the page jumped to that tau, a second of frames to settle, then a screenshot.
  const taus = String(flag('stills')).split(',').map(Number);
  await page.eval(`__scroll.begin(true); const l = document.createElement('div'); l.id = 'still-label';
    l.style.cssText = 'position:fixed;left:8px;top:6px;z-index:99;font:600 ${PHONE ? 13 : 20}px sans-serif;color:#fff;text-shadow:0 1px 2px #000';
    document.body.append(l);`);
  for (let k = 0; k < taus.length; k++) {
    const s = await page.eval(`__scroll.pace.screensAt(${taus[k]})`);
    await page.eval(`document.getElementById('still-label').textContent = 'tau ${taus[k]}'`);
    for (let f = 0; f < 30; f++) await page.eval(`__scroll.frame(${1 / FPS}, ${s}, true)`);
    writeFileSync(join(dir, `s${String(k).padStart(3, '0')}.jpg`), await page.screenshot({ format: 'jpeg', quality: 90 }));
  }
  b.close();
  const cols = Math.min(+flag('cols', 4), taus.length), rows = Math.ceil(taus.length / cols), w = +flag('width', 480);
  const labels = taus.map((t, k) => `[${k}:v]scale=${w}:-2[v${k}]`).join(';');
  const pad = cols * rows - taus.length;
  const inputs = taus.flatMap((_, k) => ['-i', join(dir, `s${String(k).padStart(3, '0')}.jpg`)]);
  const tiles = taus.map((_, k) => `[v${k}]`).join('') + (pad ? `${Array.from({ length: pad }, (_, k) => `[p${k}]`).join('')}` : '');
  const blanks = pad ? ';' + Array.from({ length: pad }, (_, k) => `color=black:s=${w}x${Math.round((w * H) / W / 2) * 2}:d=1[p${k}]`).join(';') : '';
  const sheet = join(root, 'captures', `${flag('out', PHONE ? 'stills-phone' : 'stills')}.jpg`);
  const graph = taus.length === 1 ? `[0:v]scale=${w}:-2` : `${labels}${blanks};${tiles}xstack=inputs=${cols * rows}:grid=${cols}x${rows}`;
  const enc = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', ...inputs, '-filter_complex', graph, '-frames:v', '1', '-q:v', '3', sheet]);
  rmSync(dir, { recursive: true, force: true });
  if (enc.status !== 0) throw new Error('ffmpeg failed: ' + enc.stderr);
  console.log(`${sheet.replace(root + '/', '')}: ${taus.length} stills`);
  process.exit(0);
}
const n = Math.round(T * FPS);
// Drags, as the head's turn over time: eased out to the angle, held, then let go (the page
// eases it back itself).
const drags = flag('drag') ? String(flag('drag')).split(';').map((d) => d.split(',').map(Number)) : [];
const dragAt = (t) => {
  for (const [t0, deg] of drags) {
    if (t < t0 || t > t0 + 2.7) continue;
    const u = Math.min((t - t0) / 1.2, 1);
    return { yaw: deg * (1 - (1 - u) ** 3), held: t < t0 + 2.7 - 1 / FPS };
  }
  return null;
};
await page.eval(`__scroll.frame(0, ${from}, true); ${from === 0 ? '__scroll.begin()' : '__scroll.begin(true)'}`);
const tr = Date.now();
for (let f = 0; f < n; f++) {
  const d = dragAt(f / FPS);
  if (d) await page.eval(`Object.assign(__scroll.look, { yaw: ${d.yaw}, id: ${d.held ? 1 : null}, idle: 0, vyaw: 0 })`);
  const tau = await page.eval(`__scroll.frame(${1 / FPS}, ${screensAt(f / FPS)})`);
  writeFileSync(join(dir, `f${String(f).padStart(5, '0')}.jpg`), await page.screenshot({ format: 'jpeg', quality: 92 }));
  if (f % (FPS * 5) === 0) console.log(`  ${(f / FPS).toFixed(0).padStart(3)} s  tau ${tau.toFixed(2)}  (${((Date.now() - tr) / 1000).toFixed(0)} s)`);
}
const lines = page.log.filter((l) => /error|exception/i.test(l));
if (lines.length) console.log(lines.join('\n'));
b.close();
const enc = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(FPS), '-i', join(dir, 'f%05d.jpg'),
  '-vf', 'scale=trunc(iw/2)*2:trunc(ih/2)*2', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', '-preset', 'slow', '-movflags', '+faststart', out]);
rmSync(dir, { recursive: true, force: true });
if (enc.status !== 0) throw new Error('ffmpeg failed: ' + enc.stderr);
console.log(`${out.replace(root + '/', '')}: ${n} frames, ${T.toFixed(1)} s of video, in ${((Date.now() - t0) / 1000).toFixed(0)} s`);
