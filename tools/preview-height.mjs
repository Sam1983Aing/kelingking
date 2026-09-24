// Render the heightfield as a shaded top-down map with 10 m contours, for checking the
// shape against the satellite view and the straight-down drone shots.
//   node tools/preview-height.mjs [size=1024] [crop x0,y0,x1,y1 in metres]
// Writes captures/height-top.png

import { writeFileSync, mkdirSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHeightfield } from '../src/terrain/heightfield.js';
import { defaultLayout } from '../src/terrain/layout.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const N = +(process.argv[2] || 1024);
const crop = (process.argv[3] || '-300,-250,500,450').split(',').map(Number);

const layout = defaultLayout();
const hf = generateHeightfield(layout, N);
console.log(`generated ${N}x${N} in ${hf.ms} ms`);

const { heights: H, cell } = hf;
const { x0, y0 } = hf.extent;
const W = 1200, Ht = Math.round((W * (crop[3] - crop[1])) / (crop[2] - crop[0]));
const img = Buffer.alloc(W * Ht * 3);
const sample = (x, y) => {
  const fi = (x - x0) / cell - 0.5, fj = (y - y0) / cell - 0.5;
  const i = Math.max(0, Math.min(N - 2, Math.floor(fi))), j = Math.max(0, Math.min(N - 2, Math.floor(fj)));
  const u = fi - i, v = fj - j;
  const a = H[j * N + i], b = H[j * N + i + 1], c = H[(j + 1) * N + i], d = H[(j + 1) * N + i + 1];
  return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
};
const sun = [-0.45, 0.55, 0.7]; // from the north-west, like a map
const sl = Math.hypot(...sun);
for (let py = 0; py < Ht; py++) {
  for (let px = 0; px < W; px++) {
    const x = crop[0] + ((px + 0.5) / W) * (crop[2] - crop[0]);
    const y = crop[3] - ((py + 0.5) / Ht) * (crop[3] - crop[1]);
    const h = sample(x, y), e = 0.6;
    const dx = (sample(x + e, y) - sample(x - e, y)) / (2 * e);
    const dy = (sample(x, y + e) - sample(x, y - e)) / (2 * e);
    const n = [-dx, -dy, 1], nl = Math.hypot(...n);
    let shade = Math.max(0, (n[0] * sun[0] + n[1] * sun[1] + n[2] * sun[2]) / (nl * sl));
    let r, g, b;
    if (h <= 0) {
      const t = Math.min(1, -h / 30);
      r = 40 + 120 * (1 - t); g = 90 + 130 * (1 - t); b = 140 + 90 * (1 - t);
      shade = 0.75 + 0.25 * shade;
    } else {
      const t = Math.min(1, h / 200);
      r = 200 - 40 * t; g = 190 - 30 * t; b = 170 - 30 * t;
      if (h < 6) { r = 235; g = 215; b = 170; }
      shade = 0.25 + 0.85 * shade;
    }
    // Contours every 10 m, heavier every 50 m.
    const q = h / 10, fw = Math.hypot(dx, dy) * ((crop[2] - crop[0]) / W) / 10 + 1e-4;
    const dist = Math.abs(q - Math.round(q)) / fw;
    const line = h > 0.5 ? Math.max(0, 1 - dist) * (Math.round(q) % 5 === 0 ? 0.7 : 0.35) : 0;
    const k = (py * W + px) * 3;
    img[k] = Math.min(255, r * shade * (1 - line));
    img[k + 1] = Math.min(255, g * shade * (1 - line));
    img[k + 2] = Math.min(255, b * shade * (1 - line));
  }
}
mkdirSync(join(root, 'captures'), { recursive: true });
writeFileSync(join(root, 'captures/height-top.png'), png(img, W, Ht));
console.log('wrote captures/height-top.png', W, 'x', Ht);

// Report a few spot heights that the photos constrain.
for (const [name, x, y] of [['viewpoint', 233, 262], ['ridge steps top', 221, 184], ['trail junction', 175, 131], ['saddle', 70, 38], ['summit', 0, 0], ['head west', -100, -20], ['islet', 80, -100], ['beach mid', 110, 220], ['beach back', 160, 220]])
  console.log(name.padEnd(16), sample(x, y).toFixed(1));

function png(rgb, w, h) {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w * 3 + 1)] = 0; rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c = ~0;
  for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1)); }
  return ~c >>> 0;
}
