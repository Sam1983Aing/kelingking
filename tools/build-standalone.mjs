// Folds the landing page into one double-clickable HTML file (v11): kelingking.html.
//
// A browser will not fetch an ES module from file://, nor start a worker there, so the build has
// no modules and no worker. Every module of the page (src/ and three.js) becomes a function that
// returns its exports, registered by name, and imports become lookups on that registry: one
// classic <script>. GSAP and Lenis go in as their own browser builds (window.gsap, SplitText,
// Lenis). The tools (debug.js: the panel, the photo overlay, the fitting) are left out.
// This only works because the code keeps a simple module surface: no `export default`, no
// `export *`, no dynamic import(), no top-level await. The build checks and stops if it finds one.
//
// The terrain comes as the bake (tools/bake-terrain.mjs) and the textures as JPEGs, both from
// the assets repo on the CDN, pinned to a tag (TAG below). The fonts and the stylesheet are
// inside the file. Without a network the page still runs: the textures fall back to flat layers
// and the terrain is generated on the page (it freezes for several seconds while it does).
//
//   node tools/build-standalone.mjs            kelingking.html, assets from the CDN
//   node tools/build-standalone.mjs --local    kelingking-local.html, assets from localhost:5178
//                                              (for testing before the assets are pushed)
//
// The assets repo: see README.md, "The standalone file".

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const LOCAL = process.argv.includes('--local');

// Bump after pushing new assets to the assets repo. A tag, never a branch: a file already out
// in the world must not change because something was pushed later.
export const TAG = '1.10.0';
const CDN = `https://cdn.jsdelivr.net/gh/Sam1983Aing/aura-assets@${TAG}/kelingking/`;
const BASE = LOCAL ? 'http://localhost:5178/assets/' : CDN;
const ASSETS = { textures: `${BASE}textures/`, bake: `${BASE}terrain/terrain-1024.bin` };
const OUT = join(root, LOCAL ? 'kelingking-local.html' : 'kelingking.html');

const read = (p) => readFileSync(join(root, p), 'utf8');

// ---------------------------------------------------------------- the module graph

// Specifiers that are not files of the project: what they turn into.
const GLOBALS = {
  gsap: 'return { gsap: window.gsap };',
  'gsap/SplitText.js': 'return { SplitText: window.SplitText };',
  lenis: 'return { default: window.Lenis };',
};
const STUBS = {
  // The tools' panel: nothing, in the standalone page.
  'src/debug.js': 'return { buildPanel() {}, startTools() {} };',
};
const resolveSpec = (from, spec) => {
  if (spec === 'three') return 'vendor/three.module.js';
  if (GLOBALS[spec]) return 'global:' + spec;
  if (spec.startsWith('.')) return relative(root, resolve(dirname(join(root, from)), spec));
  throw new Error(`${from}: cannot bundle the import of ${spec}`);
};

const IMPORT = /^import\s+([^;]*?)\bfrom\s+'([^']+)'[ \t]*;?[ \t]*$/gm;
// `export { A, B } from './x.js'` is a re-export: matched before the plain block form, and the
// braces may not contain braces, so it cannot run on past the end of the statement.
const REEXPORT = /^export\s*\{([^{}]*)\}\s*from\s+'([^']+)'[ \t]*;?[ \t]*$/gm;
const EXPORT_BLOCK = /^export\s*\{([^{}]*)\}[ \t]*;?[ \t]*$/gm;
const EXPORT_DECL = /^export\s+(const|let|var|function\*?|class|async\s+function)\s+([A-Za-z_$][\w$]*)/gm;

const order = [], seen = new Set();
function visit(file) {
  if (seen.has(file)) return;
  seen.add(file);
  if (file.startsWith('global:') || STUBS[file]) { order.push(file); return; }
  const src = read(file);
  for (const bad of [/^export\s+default\b/m, /^export\s*\*/m, /\bimport\s*\(/, /^await\s/m]) {
    if (bad.test(src.replace(/\/\/[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, ''))) throw new Error(`${file}: ${bad} cannot be bundled`);
  }
  for (const m of src.matchAll(IMPORT)) visit(resolveSpec(file, m[2]));
  for (const m of src.matchAll(REEXPORT)) visit(resolveSpec(file, m[2]));
  order.push(file);
}
visit('src/scroll/scroll.js');
// The generator too, for when the bake cannot be downloaded (app.js, startWorker).
visit('src/terrain/worker.js');

function transform(file) {
  const key = JSON.stringify(file);
  if (file.startsWith('global:')) return `__m[${key}] = (function () { ${GLOBALS[file.slice(7)]} })();`;
  if (STUBS[file]) return `__m[${key}] = (function () { ${STUBS[file]} })();`;
  let src = read(file);
  const exports = {};
  const reg = (spec) => `__m[${JSON.stringify(resolveSpec(file, spec))}]`;
  src = src.replace(IMPORT, (_, clause, spec) => {
    clause = clause.trim();
    const r = reg(spec);
    if (clause.startsWith('*')) return `const ${clause.split(' as ')[1].trim()} = ${r};`;
    if (clause.startsWith('{')) {
      const parts = clause.replace(/^\{|\}$/g, '').split(',').map((p) => p.trim()).filter(Boolean)
        .map((p) => (p.includes(' as ') ? p.split(/\s+as\s+/).join(': ') : p));
      return `const { ${parts.join(', ')} } = ${r};`;
    }
    return `const ${clause} = ${r}["default"];`;
  });
  src = src.replace(REEXPORT, (_, inner, spec) => {
    for (const p of inner.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [local, ext] = p.includes(' as ') ? p.split(/\s+as\s+/) : [p, p];
      exports[ext] = `${reg(spec)}[${JSON.stringify(local)}]`;
    }
    return '';
  });
  src = src.replace(EXPORT_BLOCK, (_, inner) => {
    for (const p of inner.split(',').map((x) => x.trim()).filter(Boolean)) {
      const [local, ext] = p.includes(' as ') ? p.split(/\s+as\s+/) : [p, p];
      exports[ext] = local;
    }
    return '';
  });
  for (const m of src.matchAll(EXPORT_DECL)) exports[m[2]] = m[2];
  src = src.replace(EXPORT_DECL, (_, kind, name) => `${kind} ${name}`);
  // (Only on the path that starts a worker, which the standalone page never takes.)
  src = src.replaceAll('import.meta.url', 'location.href');
  const ret = `return { ${Object.entries(exports).sort().map(([k, v]) => `${JSON.stringify(k)}: ${v}`).join(', ')} };`;
  return `// ${file}\n__m[${key}] = (function () {\n"use strict";\n${src}\n${ret}\n})();`;
}

const code = ['var __m = {};', ...order.map(transform),
  // The generator on the page, for app.js when the bake cannot be downloaded.
  'window.__klGenerate = __m["src/terrain/worker.js"].generateAll;',
  'document.documentElement.classList.contains("tool") || __m["src/scroll/scroll.js"].startScroll({ params: new URLSearchParams(location.search) });',
].join('\n')
  // `</script` only ever occurs in a string or a comment in JavaScript, and `<\/script` parses
  // the same, so this cannot change what the code does.
  .replaceAll('</script', '<\\/script');

// ---------------------------------------------------------------- the page

const b64 = (p) => readFileSync(join(root, p)).toString('base64');
const fonts = [
  ['Instrument Serif', 'normal', '400', 'vendor/fonts/InstrumentSerif-latin.woff2'],
  ['Instrument Serif', 'italic', '400', 'vendor/fonts/InstrumentSerif-italic-latin.woff2'],
  ['Inter', 'normal', '400 500', 'vendor/fonts/Inter-latin.woff2'],
].map(([family, style, weight, file]) => `@font-face{font-family:'${family}';font-style:${style};font-weight:${weight};font-display:swap;src:url(data:font/woff2;base64,${b64(file)}) format('woff2');}`).join('\n');

let commit = 'unknown';
try { commit = execSync('git rev-parse --short HEAD', { cwd: root }).toString().trim(); } catch {}
let html = read('index.html');
const swap = (from, to) => {
  if (!html.includes(from)) throw new Error(`index.html no longer has: ${from.slice(0, 60)}`);
  html = html.replace(from, () => to);
};
html = html.replace(/\n\s*<link rel="preconnect"[^>]*>/g, '').replace(/\n\s*<link rel="stylesheet" href="https:\/\/fonts\.googleapis[^>]*>/, '');
swap('<link rel="stylesheet" href="src/scroll/page.css">', `<style>\n${fonts}\n${read('src/scroll/page.css')}</style>`);
html = html.replace(/\n\s*<script type="importmap">[\s\S]*?<\/script>/, '');
const libs = ['vendor/gsap.min.js', 'vendor/SplitText.min.js', 'vendor/lenis.min.js'].map((f) => read(f).replaceAll('</script', '<\\/script'));
swap('<script type="module" src="src/main.js"></script>',
  `<script>\n${libs.join('\n')}\n</script>\n<script>\nwindow.__klAssets = ${JSON.stringify(ASSETS)};\n${code}\n</script>`);
swap('<head>', `<head>\n  <!-- Kelingking, the standalone build (tools/build-standalone.mjs), from commit ${commit}. Assets: ${BASE} -->`);
writeFileSync(OUT, html);
console.log(`${relative(root, OUT)}: ${(statSync(OUT).size / 1e6).toFixed(2)} MB, ${order.length} modules, assets from ${BASE}`);
