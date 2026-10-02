// Matched lower-stair, beach, grazing and close sand captures.
// node tools/sand-review.mjs before http://localhost:5183/
// Outputs captures/v28-<label>/; the fixed sea clock is 17 seconds.
import { launch } from './cdp.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
const label = process.argv[2] || 'review';
if (!/^[a-z0-9-]+$/i.test(label)) throw new Error('Use a plain output label.');
const base = (process.argv[3] || 'http://localhost:5183/').replace(/\/?$/, '/');
const out = `captures/v28-${label}`;
mkdirSync(out, { recursive: true });
const views = [
  { name: 'stairs', pos: [138.87580572491748, 179.83731935783217, 21.42465014142438], yaw: 274, pitch: -26, fov: 58 },
  { name: 'beach', pos: [127.23179203160545, 188.4760190272445, 4.549650273586554], yaw: 255.629, pitch: -16, fov: 54 },
  { name: 'grazing', pos: [110, 203, 3.8], yaw: 295, pitch: -8, fov: 54 },
  { name: 'close', pos: [110, 203, 4.5], yaw: 270, pitch: -60, fov: 54 },
];
const b = await launch();
try {
  const p = await b.open(base + '?record=1&q=1024&pr=1&notext&t=17', { width: 1600, height: 1000 });
  await p.waitFor('window.__scroll?.ready', 180000);
  await p.eval('__scroll.begin(true);0');
  for (const v of views) {
    await p.eval(`__app.setPose(${JSON.stringify(v.pos)},${v.yaw},${v.pitch},0,${v.fov});__app.advance(0);for(let i=0;i<4;i++)__app.renderFrame();0`);
    writeFileSync(`${out}/${v.name}.jpg`, await p.screenshot({ format: 'jpeg', quality: 93 }));
  }
  // An optional approach and head turn verifies anchoring and filtered distance fades.
  if (process.argv.includes('--motion')) {
    const dir = `${out}/motion`; mkdirSync(dir, { recursive: true });
    const fps = 24, frames = 145;
    for (let i = 0; i < frames; i++) {
      const t = i / (frames - 1), e = t * t * (3 - 2 * t);
      const pos = [138 - 25 * e, 184 + 17 * e, 18 - 13.5 * e];
      const yaw = 274 + 18 * Math.sin(t * Math.PI);
      const pitch = -32 - 20 * e;
      await p.eval(`__app.setPose(${JSON.stringify(pos)},${yaw},${pitch},0,58);__app.advance(0);__app.renderFrame();0`);
      writeFileSync(`${dir}/f${String(i).padStart(4, '0')}.jpg`, await p.screenshot({ format: 'jpeg', quality: 90 }));
    }
    const r = spawnSync('ffmpeg', ['-y', '-loglevel', 'error', '-framerate', String(fps), '-i', `${dir}/f%04d.jpg`, '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '19', `${out}/approach.mp4`]);
    if (r.status !== 0) throw new Error(r.stderr.toString());
    writeFileSync(`${out}/motion.json`, JSON.stringify({ fps, frames, seaTime: 17, description: 'Six second camera approach with a head turn; wave clock held fixed.' }, null, 2) + '\n');
  }
  const errors = p.log.filter(l => /error|exception/i.test(l));
  writeFileSync(`${out}/cameras.json`, JSON.stringify({ width: 1600, height: 1000, time: 17, views, errors }, null, 2) + '\n');
  console.log('saved', out, 'console', errors);
} finally { b.close(); }
