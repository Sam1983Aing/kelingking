// Render and time the hero frames for a version (the list is HERO in src/shots.js).
//   node tools/hero.mjs v2              timed against the previous version's git tag
//   node tools/hero.mjs v2 --prev=v1    against a chosen one
// Writes to docs/gallery/<version>/: one JPEG per hero frame (renders only, safe to publish),
// bench.json and README.md (the frames, and frame times against the previous version).
// Side-by-side comparisons with the reference photos go to captures/compare-<version>/, which
// stays local because the photos belong to their authors.
//
// Frame times swing by 2x or more with whatever else is using the GPU, so numbers from another
// day mean nothing. The previous version is checked out from its tag and both are timed back
// to back, alternating, in the same run. Close the page in the browser pane first.
// Needs the local server (python3 -m http.server 5178).

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, readdirSync, rmSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const version = args.find((a) => !a.startsWith('--'));
if (!/^v\d+$/.test(version || '')) { console.log('usage: node tools/hero.mjs v2 [--prev=v1]'); process.exit(1); }
const num = (v) => +v.slice(1);
const gallery = join(root, 'docs/gallery');
const out = join(gallery, version);
const T = '17';   // the sea is frozen at the same moment in every version

const run = (...a) => {
  const r = spawnSync('node', [join(root, 'tools/capture.mjs'), ...a], { stdio: ['ignore', 'pipe', 'pipe'], encoding: 'utf8' });
  const lines = (r.stdout + r.stderr).split('\n').filter((l) => l && !l.includes('UNSUPPORTED'));
  lines.forEach((l) => console.log('  ' + l));
  if (r.status !== 0) process.exit(r.status);
};

const versions = readdirSync(gallery).filter((d) => /^v\d+$/.test(d)).sort((a, b) => num(a) - num(b));
const prevFlag = args.find((a) => a.startsWith('--prev='));
const prev = prevFlag ? prevFlag.split('=')[1] : versions.filter((v) => num(v) < num(version)).pop();
const hasTag = prev && spawnSync('git', ['rev-parse', '-q', '--verify', `refs/tags/${prev}`], { cwd: root }).status === 0;

console.log(`rendering hero frames for ${version}`);
run('--hero', `--t=${T}`, '--jpeg', `--out=docs/gallery/${version}`);

console.log(hasTag ? `timing, alternating with ${prev} checked out from its tag` : 'timing');
let prevDir = null;
if (hasTag) {
  prevDir = `captures/bench-${prev}`;
  rmSync(join(root, prevDir), { recursive: true, force: true });
  mkdirSync(join(root, prevDir), { recursive: true });
  const tar = spawnSync('sh', ['-c', `git archive ${prev} | tar -x -C "${join(root, prevDir)}"`], { cwd: root });
  if (tar.status !== 0) { console.log('could not check out', prev); prevDir = null; }
}
const rounds = { cur: [], prev: [] };
for (let r = 0; r < 3; r++) {
  if (prevDir) {
    run('--hero', '--bench', `--out=captures/bench-runs/${prev}-${r}`, `--url=http://localhost:5178/${prevDir}/`);
    rounds.prev.push(JSON.parse(readFileSync(join(root, `captures/bench-runs/${prev}-${r}/bench.json`), 'utf8')));
  }
  run('--hero', '--bench', `--out=captures/bench-runs/${version}-${r}`);
  rounds.cur.push(JSON.parse(readFileSync(join(root, `captures/bench-runs/${version}-${r}/bench.json`), 'utf8')));
}
// Best of the rounds for each frame: background load only ever makes things slower.
const best = (list) => {
  const o = {};
  for (const b of list) for (const [k, v] of Object.entries(b)) if (!o[k] || v.ms < o[k].ms) o[k] = v;
  return o;
};
const bench = best(rounds.cur);
const prevBench = rounds.prev.length ? best(rounds.prev) : null;
writeFileSync(join(out, 'bench.json'), JSON.stringify(bench, null, 2) + '\n');

console.log('side by side with the photos (local only)');
run('--hero', `--t=${T}`, '--compare', '--jpeg', `--out=captures/compare-${version}`);

// Frame times against the previous version.
const { HERO, SHOTS } = await import(join(root, 'src/shots.js'));

let over = 0;
const rows = HERO.map((name) => {
  const b = bench[name], p = prevBench?.[name];
  let delta = '';
  if (b && p) {
    const d = (b.ms / p.ms - 1) * 100;
    if (d > 10) over++;
    delta = `${d >= 0 ? '+' : ''}${d.toFixed(0)}%${d > 10 ? ' (over budget)' : ''}`;
  }
  return `| ${SHOTS[name].label} | ${b ? b.ms.toFixed(1) + ' ms' : ''} | ${b ? Math.round(1000 / b.ms) : ''} | ${delta} |`;
});

writeFileSync(join(out, 'README.md'), `# ${version}

Hero frames, rendered with \`node tools/hero.mjs ${version}\`. The sea is frozen at ${T} s.

${HERO.map((n) => `### ${SHOTS[n].label}\n\n![${SHOTS[n].label}](${n}.jpg)\n`).join('\n')}
## Frame times

Time to render one frame to completion at 1400 px wide, pixel ratio 1, best of three rounds, on
the build machine (Apple M1 Max). Absolute times depend on what else is using the GPU, so only
the change column means anything${prevBench ? `: it is against ${prev}, timed in the same run` : ''}.

| Frame | Time | fps | Change |
|---|---|---|---|
${rows.join('\n')}
`);

// Gallery index.
const all = readdirSync(gallery).filter((d) => /^v\d+$/.test(d)).sort((a, b) => num(a) - num(b));
writeFileSync(join(gallery, 'README.md'), `# Gallery

The same hero frames for every version, so they can be compared side by side.

${all.map((v) => `- [${v}](${v}/README.md)`).join('\n')}
${existsSync(join(gallery, 'history')) ? '- [How v1 was built, stage by stage](history/README.md)\n' : ''}`);

console.log(`\nwrote docs/gallery/${version}/`);
if (prevBench) console.log(over ? `${over} frame(s) more than 10% slower than ${prev}. Rerun once to rule out noise, then say why in PROCESS.md.` : `frame times within budget against ${prev}`);
else if (prev) console.log(`no git tag ${prev} to time against`);
