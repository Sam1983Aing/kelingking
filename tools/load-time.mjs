// How long the landing page takes to load, and where the time goes (v11): the page marks each
// step (app.js emits, scroll.js's warm-up and the loader lifting) and this reads the marks.
//   node tools/load-time.mjs                 three loads, a fresh browser each (nothing cached)
//   node tools/load-time.mjs --runs=5 --size=1512x945 --dpr=2
// Needs the local server (python3 tools/serve.py).

import { launch } from './cdp.mjs';

const args = process.argv.slice(2);
const flag = (name, dflt) => {
  const a = args.find((x) => x === `--${name}` || x.startsWith(`--${name}=`));
  if (!a) return dflt;
  return a.includes('=') ? a.slice(a.indexOf('=') + 1) : true;
};
const RUNS = +flag('runs', 3);
const [W, H] = String(flag('size', '1512x945')).split('x').map(Number);
const DPR = +flag('dpr', 2);
const url = `http://localhost:5178/${flag('set') ? '?' + String(flag('set')).split(';').join('&') : ''}`;

const rows = [];
for (let r = 0; r < RUNS; r++) {
  const b = await launch();
  const page = await b.open('about:blank', { width: W, height: H });
  await b.send('Emulation.setDeviceMetricsOverride', { width: W, height: H, deviceScaleFactor: DPR, mobile: false }, page.sessionId);
  // (In front: a page behind gets no animation frames, and the loader runs on them.)
  await page.front();
  await b.send('Page.navigate', { url }, page.sessionId);
  await page.waitFor(`performance.getEntriesByName('kl:begin').length > 0`, 180000);
  const marks = await page.eval(`JSON.stringify(Object.fromEntries(performance.getEntriesByType('mark').filter((m) => m.name.startsWith('kl:')).map((m) => [m.name.slice(3), Math.round(m.startTime)])))`);
  const nav = await page.eval(`JSON.stringify(performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd | 0)`);
  const res = await page.eval(`JSON.stringify(performance.getEntriesByType('resource').reduce((a, e) => a + (e.transferSize || 0), 0))`);
  b.close();
  const m = JSON.parse(marks);
  rows.push({ dom: +nav, ...m, MB: +(JSON.parse(res) / 1e6).toFixed(1) });
  console.log(`run ${r + 1}: ` + Object.entries({ dom: +nav, ...m }).map(([k, v]) => `${k} ${(v / 1000).toFixed(1)}s`).join('  ') + `  (${(JSON.parse(res) / 1e6).toFixed(1)} MB over the network)`);
}
const keys = Object.keys(rows[0]);
const med = (k) => { const v = rows.map((r) => r[k]).filter((x) => x !== undefined).sort((a, b) => a - b); return v[v.length >> 1]; };
console.log('median: ' + keys.map((k) => `${k} ${k === 'MB' ? med(k) : (med(k) / 1000).toFixed(1) + 's'}`).join('  '));
