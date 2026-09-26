// Turn the raw Poly Haven downloads (assets-src/) into the files the page loads (assets/).
//   node tools/prepare-assets.mjs
// Per surface: <id>_color.jpg (2048, sRGB), <id>_normal.jpg (1024, OpenGL convention) and
// <id>_mask.jpg (1024, R = roughness, G = ambient occlusion). Needs ImageMagick.

import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, statSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SURFACES } from '../src/terrain/surfaces.js';
import { TRAIL_SURFACES } from '../src/trail/surfaces.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'assets-src/polyhaven');
const out = join(root, 'assets/textures');
mkdirSync(out, { recursive: true });
const MAGICK = process.env.MAGICK || '/opt/ImageMagick/bin/convert';
const run = (...args) => execFileSync(MAGICK, args, { stdio: ['ignore', 'ignore', 'pipe'] });

let total = 0;
for (const s of [...SURFACES, ...TRAIL_SURFACES]) {
  const dir = join(src, s.id);
  const files = {
    color: join(out, `${s.id}_color.jpg`),
    normal: join(out, `${s.id}_normal.jpg`),
    mask: join(out, `${s.id}_mask.jpg`),
  };
  run(join(dir, 'color.jpg'), '-resize', '2048x2048!', '-quality', '88', files.color);
  run(join(dir, 'normal.jpg'), '-resize', '1024x1024!', '-quality', '92', files.normal);
  // R = roughness, G = AO, B unused (kept equal to AO so JPEG chroma does not smear it).
  run(join(dir, 'rough.jpg'), join(dir, 'ao.jpg'), join(dir, 'ao.jpg'), '-resize', '1024x1024!', '-combine', '-quality', '92', files.mask);
  const sizes = Object.values(files).map((f) => statSync(f).size);
  total += sizes.reduce((a, b) => a + b, 0);
  console.log(`${s.id.padEnd(20)} ${sizes.map((b) => (b / 1e6).toFixed(2) + ' MB').join('  ')}`);
}

const manifest = JSON.parse(readFileSync(join(src, 'manifest.json'), 'utf8'));
writeFileSync(join(out, 'CREDITS.md'), `# Texture credits

All textures are from Poly Haven (${manifest.source}) under CC0 1.0, resized and repacked.

${[...SURFACES, ...TRAIL_SURFACES].map((s) => `- ${s.id}: ${manifest.textures[s.id]?.page} (${s.use})`).join('\n')}
`);
console.log(`total ${(total / 1e6).toFixed(1)} MB`);
