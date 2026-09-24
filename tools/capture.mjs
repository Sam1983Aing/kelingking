// Render shots headlessly and save PNGs, for comparing against the reference photos.
// Talks to Chrome over the DevTools protocol directly, so there is nothing to install.
//
//   node tools/capture.mjs                        every shot, render only
//   node tools/capture.mjs viewpoint overview     just these
//   node tools/capture.mjs viewpoint --compare    render and photo side by side
//   node tools/capture.mjs viewpoint --overlay=0.5 --diff
//   node tools/capture.mjs viewpoint --outline     render edges traced over the photo
//   node tools/capture.mjs --width=1600 --q=2048 --contours
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
  return a.includes('=') ? a.split('=')[1] : true;
};
const BASE = flag('url', 'http://localhost:5178/');
const WIDTH = +flag('width', 1400);
const CHROME = process.env.CHROME || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

const { SHOTS } = await import(join(root, 'src/shots.js'));
let shots = args.filter((a) => !a.startsWith('--'));
if (!shots.length) shots = Object.keys(SHOTS);

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
ws.addEventListener('message', (e) => {
  const msg = JSON.parse(e.data);
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

mkdirSync(join(root, 'captures'), { recursive: true });
try {
  for (const name of shots) {
    const shot = SHOTS[name];
    if (!shot) { console.log('unknown shot', name); continue; }
    const aspect = await refAspect(shot.ref);
    const compare = flag('compare', false);
    const w = WIDTH, h = Math.round(WIDTH / aspect);
    const q = new URLSearchParams({ shot: name, capture: '1', q: flag('q', '2048') });
    if (compare) q.set('compare', 'side');
    if (flag('overlay')) q.set('overlay', flag('overlay'));
    if (flag('diff')) q.set('diff', '1');
    if (flag('contours')) q.set('contours', '1');
    if (flag('outline')) q.set('outline', '1');

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
      if (Date.now() - t0 > 120000) throw new Error(`${name}: page never became ready`);
      await new Promise((res) => setTimeout(res, 250));
    }
    const shotPng = await send('Page.captureScreenshot', { format: 'png' }, sessionId);
    const out = join(root, 'captures', `${name}${compare ? '-compare' : ''}${flag('overlay') ? '-overlay' : ''}${flag('outline') ? '-outline' : ''}.png`);
    writeFileSync(out, Buffer.from(shotPng.data, 'base64'));
    console.log(`${name}: ${out.replace(root + '/', '')} (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await send('Target.closeTarget', { targetId });
  }
} finally {
  ws.close();
  chrome.kill();
  setTimeout(() => rmSync(profile, { recursive: true, force: true }), 500);
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
