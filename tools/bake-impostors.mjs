// Bake the plant scans into impostor atlases.
//   node tools/bake-impostors.mjs [id ...]     default: every tree in fetch-assets.mjs
// Needs the local server (python3 -m http.server 5178). Writes assets/veg/<id>_color.png,
// <id>_data.png and assets/veg/impostors.json.

import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { launch } from './cdp.mjs';
import { encodePNG } from './png.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/veg');
mkdirSync(out, { recursive: true });
const ids = process.argv.slice(2).length ? process.argv.slice(2) : ['island_tree_01', 'island_tree_02', 'tree_small_02'];
const indexFile = join(out, 'impostors.json');
const index = existsSync(indexFile) ? JSON.parse(readFileSync(indexFile, 'utf8')) : {};

const browser = await launch();
try {
  for (const id of ids) {
    const t0 = Date.now();
    const page = await browser.open('http://localhost:5178/tools/bake-impostors.html', { width: 400, height: 300 });
    await page.waitFor('window.bakeReady === true');
    const r = await page.eval(`window.bake(${JSON.stringify(id)})`);
    const color = Buffer.from(r.color, 'base64');
    const data = Buffer.from(r.data, 'base64');
    writeFileSync(join(out, `${id}_color.png`), encodePNG(color, r.size, r.size, 4));
    writeFileSync(join(out, `${id}_data.png`), encodePNG(data, r.size, r.size, 4));
    const { color: _c, data: _d, ...meta } = r;
    index[id] = meta;
    console.log(`${id}: ${r.size}px atlas, radius ${r.radius.toFixed(2)} m, height ${r.height.toFixed(2)} m (${((Date.now() - t0) / 1000).toFixed(1)} s)`);
    await page.close();
  }
} finally {
  browser.close();
}
writeFileSync(indexFile, JSON.stringify(index, null, 2));
