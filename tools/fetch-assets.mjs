// Download the CC0 scans this build uses from Poly Haven (https://polyhaven.com).
//   node tools/fetch-assets.mjs
// Raw downloads go to assets-src/polyhaven/<id>/ (not committed: the tree scans alone are
// over 200 MB). tools/prepare-assets.mjs turns them into the small files that ship.

import { mkdirSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'KelingkingBuild/1.0 (personal project)';

export const TEXTURES = {
  aerial_beach_01: 'sand with wind ripples, the beach',
  marble_cliff_05: 'grey-white rock, the limestone faces',
  cliff_side: 'layered rock, the bedding on the faces',
  seaside_rock: 'dark wet rock, the notch and the waterline band',
  aerial_grass_rock: 'scrub and grass seen from above, the ground under the plants',
};
export const MODELS = {
  island_tree_01: 'tree',
  island_tree_02: 'tree',
  tree_small_02: 'tree',
  grass_medium_02: 'grass clump',
};
const MAPS = { Diffuse: 'color', nor_gl: 'normal', Rough: 'rough', AO: 'ao' };

const getJSON = async (u) => (await fetch(u, { headers: { 'User-Agent': UA } })).json();
async function download(url, out, size) {
  if (existsSync(out) && (!size || statSync(out).size === size)) return false;
  mkdirSync(dirname(out), { recursive: true });
  const r = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  const buf = Buffer.from(await r.arrayBuffer());
  if (size && buf.length !== size) throw new Error(`size mismatch for ${url}: ${buf.length} vs ${size}`);
  writeFileSync(out, buf);
  return true;
}

const manifest = { source: 'https://polyhaven.com', license: 'CC0 1.0', textures: {}, models: {} };
let total = 0;

for (const [id, use] of Object.entries(TEXTURES)) {
  const files = await getJSON(`https://api.polyhaven.com/files/${id}`);
  manifest.textures[id] = { use, page: `https://polyhaven.com/a/${id}` };
  for (const [key, name] of Object.entries(MAPS)) {
    const f = files[key]?.['2k']?.jpg;
    if (!f) { console.log(`  ${id}: no 2k ${key}`); continue; }
    const got = await download(f.url, join(root, 'assets-src/polyhaven', id, `${name}.jpg`), f.size);
    total += f.size;
    console.log(`${got ? 'saved' : 'have '} ${id}/${name}.jpg ${(f.size / 1e6).toFixed(1)} MB`);
  }
}

for (const [id, use] of Object.entries(MODELS)) {
  const files = await getJSON(`https://api.polyhaven.com/files/${id}`);
  const g = files.gltf['1k'].gltf;
  manifest.models[id] = { use, page: `https://polyhaven.com/a/${id}` };
  const dir = join(root, 'assets-src/polyhaven', id);
  await download(g.url, join(dir, `${id}.gltf`), g.size);
  total += g.size;
  for (const [rel, inc] of Object.entries(g.include || {})) {
    const got = await download(inc.url, join(dir, rel), inc.size);
    total += inc.size;
    if (got) console.log(`saved ${id}/${rel} ${(inc.size / 1e6).toFixed(1)} MB`);
  }
  console.log(`model ${id} done`);
}

writeFileSync(join(root, 'assets-src/polyhaven/manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`total ${(total / 1e6).toFixed(1)} MB`);
