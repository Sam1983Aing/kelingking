// Bakes the terrain the page loads (v11): runs the terrain worker in node at the page's
// resolution (q=1024), packs what it sends (src/terrain/bake-format.js), gzips it, and writes
// assets/terrain/terrain-1024.bin. The page downloads that instead of generating it (about 8 s),
// unless the file is missing or out of date, when it falls back to the worker.
//
//   node tools/bake-terrain.mjs            write the bake
//   node tools/bake-terrain.mjs --check    exit 1 if the bake is out of date (sources or layout)
//
// Out of date means: the default layout (layout.js) or any source the worker runs has changed
// since the bake. Both go into the file's header as hashes; on localhost the page checks them
// too. Rerun this after changing the terrain, the path, the plants' scatter or the layout.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync, gunzipSync } from 'node:zlib';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'assets/terrain/terrain-1024.bin');
const check = process.argv.includes('--check');

// The worker's sources: its imports, followed from worker.js.
function sources() {
  const seen = new Set();
  const visit = (file) => {
    if (seen.has(file)) return;
    seen.add(file);
    const src = readFileSync(file, 'utf8');
    for (const m of src.matchAll(/^import\s[^'"]*['"](\.[^'"]+)['"]/gm)) visit(resolve(dirname(file), m[1]));
  };
  visit(join(root, 'src/terrain/worker.js'));
  return [...seen].map((f) => relative(root, f)).sort();
}
const sha = (s) => createHash('sha256').update(s).digest('hex').slice(0, 16);
const files = sources();
const sourceHash = sha(files.map((f) => f + '\n' + readFileSync(join(root, f), 'utf8')).join('\n'));
const { defaultLayout } = await import(join(root, 'src/terrain/layout.js'));
const layout = defaultLayout();
const layoutHash = sha(JSON.stringify(layout));

if (check) {
  if (!existsSync(out)) { console.log('no bake'); process.exit(1); }
  const { decodeBake } = await import(join(root, 'src/terrain/bake-format.js'));
  const buf = gunzipSync(readFileSync(out));
  const jl = buf.readUInt32LE(4);
  const head = JSON.parse(buf.subarray(8, 8 + jl).toString());
  void decodeBake;
  const ok = head.bake?.sourceHash === sourceHash && head.bake?.layoutHash === layoutHash;
  console.log(ok ? 'bake is up to date' : `bake is out of date (sources ${head.bake?.sourceHash} now ${sourceHash}, layout ${head.bake?.layoutHash} now ${layoutHash})`);
  process.exit(ok ? 0 : 1);
}

const t0 = performance.now();
let msg = null;
globalThis.self = { postMessage: (m) => { msg = m; } };
await import(join(root, 'src/terrain/worker.js'));
self.onmessage({ data: { id: 1, layout, N: 1024, M: 1025 } });
const genMs = performance.now() - t0;
msg.bake = { sourceHash, layoutHash, sources: files, made: new Date().toISOString().slice(0, 10) };
const { encodeBake, decodeBake } = await import(join(root, 'src/terrain/bake-format.js'));
const packed = encodeBake(msg);
const gz = gzipSync(packed, { level: 9 });
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, gz);
// A round trip, as a check: every array back, and the exact ones exact.
const back = decodeBake(gunzipSync(gz));
const worst = (a, b) => { let w = 0; for (let i = 0; i < a.length; i++) w = Math.max(w, Math.abs(a[i] - b[i])); return w; };
console.log(`generated in ${(genMs / 1000).toFixed(1)} s; ${(packed.length / 1e6).toFixed(1)} MB packed, ${(gz.length / 1e6).toFixed(2)} MB gzipped: ${relative(root, out)}`);
console.log(`round trip, largest error: mesh positions ${worst(msg.mesh.positions, back.mesh.positions).toFixed(4)} m, heights ${worst(msg.heights, back.heights).toFixed(4)} m, index ${worst(msg.mesh.index, back.mesh.index)}, plants' species ${worst(msg.plants.data.filter((_, i) => i % 8 === 5), back.plants.data.filter((_, i) => i % 8 === 5))}, water ${worst(msg.water, back.water)}`);
console.log(`sources (${files.length}): ${files.join(', ')}`);
