// Opens the standalone file from file:// in headless Chrome (v11), as a double-click would, and
// checks it: the page loads, where the terrain came from (the bake or generated on the page),
// the console's errors, a screenshot at a few places down the scroll.
//   node tools/test-standalone.mjs                  kelingking.html
//   node tools/test-standalone.mjs --file=kelingking-local.html --offline
// --offline blocks the network, to see the page degrade (flat ground, terrain generated).

import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launch } from './cdp.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const file = join(root, flag('file', 'kelingking.html'));
const b = await launch();
const t0 = Date.now();
try {
  const p = await b.open('about:blank', { width: 1280, height: 720 });
  if (flag('offline')) {
    await b.send('Network.enable', {}, p.sessionId);
    await b.send('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: 0, uploadThroughput: 0 }, p.sessionId);
  }
  await p.front();
  await b.send('Page.navigate', { url: pathToFileURL(file).href + '?notext' }, p.sessionId);
  await p.waitFor(`performance.getEntriesByName('kl:begin').length > 0`, 240000);
  const info = JSON.parse(await p.eval(`JSON.stringify({ baked: __app.hf.baked ?? null, marks: Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('kl:')).map((m) => [m.name.slice(3), Math.round(m.startTime)])), textures: !!__app.terrain.uniforms.uSurfColor?.value })`));
  console.log(`loaded in ${((Date.now() - t0) / 1000).toFixed(1)} s: terrain ${info.baked !== null ? `from the bake (${info.baked} ms)` : 'generated on the page'}, textures ${info.textures ? 'in' : 'missing'}`);
  console.log('marks: ' + Object.entries(info.marks).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join('  '));
  const out = join(root, 'captures/standalone');
  mkdirSync(out, { recursive: true });
  for (const tau of [0.3, 1, 2.6, 4.6]) {
    await p.eval(`__scroll.jumpTo(__scroll.pace.screensAt(${tau}))`);
    await new Promise((r) => setTimeout(r, 2500));
    writeFileSync(join(out, `tau-${tau}${flag('offline') ? '-offline' : ''}.jpg`), await p.screenshot({ format: 'jpeg', quality: 85 }));
  }
  const bad = p.log.filter((l) => /error|exception/i.test(l));
  console.log(bad.length ? 'console:\n' + bad.join('\n') : 'no errors in the console');
  console.log(`screenshots in captures/standalone/`);
} finally { b.close(); }
