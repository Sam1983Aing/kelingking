// The camera line for walking the path (v6, for v8's scroll): from the viewpoint on the
// platform, onto the concrete steps, along the ridge and down to the sand, at eye height.
//   node tools/walk-line.mjs            writes data/walk-line.json and prints its checks
// Each point: s (metres walked), pos [east, north, height], heading (compass degrees, the way
// the path goes), grade (rise over run, a few metres either side).

import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateHeightfield } from '../src/terrain/heightfield.js';
import { defaultLayout } from '../src/terrain/layout.js';
import { walkLine } from '../src/trail/route.js';
import { SHOTS } from '../src/shots.js';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const layout = defaultLayout();
const hf = generateHeightfield(layout, 2048);
const { route } = hf.trail;
const vp = SHOTS.viewpoint.pos;
const pad = layout.trail.pads[0];
// From the viewpoint photo's spot (its camera is 1.6 m over the platform), onto the steps where
// they come down level with the platform.
let joinS = 0;
for (let i = 0; i < route.n; i++) if (route.ht[i] <= pad.h + 0.05) { joinS = route.s[i]; break; }
const line = walkLine(route, { from: [vp[0], vp[1]], fromH: pad.h, join: joinS });

// Checks: no jumps, eye height over the ground, how steep.
let maxStep = 0, maxDh = 0, minEye = Infinity, maxEye = -Infinity, maxTurn = 0;
for (let k = 1; k < line.length; k++) {
  const a = line[k - 1], b = line[k];
  maxStep = Math.max(maxStep, Math.hypot(b.pos[0] - a.pos[0], b.pos[1] - a.pos[1]));
  maxDh = Math.max(maxDh, Math.abs(b.pos[2] - a.pos[2]));
  maxTurn = Math.max(maxTurn, Math.abs(((b.heading - a.heading + 540) % 360) - 180));
}
// Eye over what is underfoot: the tread on the path, the platform before it.
for (const p of line) {
  const q = route.nearest(p.pos[0], p.pos[1], 0.3);
  const under = q ? route.lerpAt(route.ht, q) : pad.h;
  minEye = Math.min(minEye, p.pos[2] - under); maxEye = Math.max(maxEye, p.pos[2] - under);
}
const out = { note: 'Camera line along the path at eye height (v6). s metres walked, pos [east, north, height], heading compass degrees, grade rise over run.',
  start: 'viewpoint', joinsPathAt: +joinS.toFixed(2), eye: 1.6, points: line };
writeFileSync(join(root, 'data/walk-line.json'), JSON.stringify(out) + '\n');
console.log(`${line.length} points over ${line.at(-1).s} m, from ${line[0].pos.join(', ')} to ${line.at(-1).pos.join(', ')}`);
console.log(`joins the path ${joinS.toFixed(1)} m down it; largest step ${maxStep.toFixed(2)} m, largest height change between points ${maxDh.toFixed(2)} m, sharpest turn between points ${maxTurn.toFixed(1)} degrees`);
console.log(`eye over the tread or platform ${minEye.toFixed(2)} to ${maxEye.toFixed(2)} m; steepest grade ${Math.max(...line.map((p) => Math.abs(p.grade))).toFixed(2)}`);
console.log('wrote data/walk-line.json');
