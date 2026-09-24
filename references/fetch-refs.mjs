// Reference photo helper for the Kelingking build.
//   node fetch-refs.mjs          check sizes, rebuild board.html and REFERENCES.md
//   node fetch-refs.mjs --get    also download the stills into ./<chapter>/
// Source of truth is refs.json. Photos are other people's work: keep them local,
// never push them to the public assets repo.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const refs = JSON.parse(readFileSync(join(here, 'refs.json'), 'utf8'));
const UA = 'KelingkingRefs/1.0 (personal reference collection)';
const GET = process.argv.includes('--get');

const mb = (b) => (typeof b === 'number' ? (b / 1048576).toFixed(1) + ' MB' : b);
const enc = (n) => encodeURIComponent(n).replace(/%2C/g, ',');
function urls(img) {
  if (img.src === 'unsplash') {
    const base = `https://images.unsplash.com/${img.path}`;
    return { thumb: `${base}?w=700&q=70`, full: `${base}?w=2400&q=85&fm=jpg`, page: `https://unsplash.com/photos/${img.id}` };
  }
  const n = enc(img.name);
  const up = 'https://upload.wikimedia.org/wikipedia/commons';
  const aerial = img.name.includes('aerial');
  return {
    thumb: `${up}/thumb/${img.hash}/${n}/960px-${n}`,
    full: aerial ? `${up}/${img.hash}/${n}` : `${up}/thumb/${img.hash}/${n}/1920px-${n}`,
    page: `https://commons.wikimedia.org/wiki/File:${n}`,
  };
}

// Wikimedia answers 429 if you go too fast, so back off and retry.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function size(url) {
  for (let wait = 1500; ; wait *= 2) {
    const r = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    if (r.status === 429 && wait < 20000) { await sleep(wait); continue; }
    return r.ok ? Number(r.headers.get('content-length')) || null : `HTTP ${r.status}`;
  }
}

const rows = [];
for (const img of refs.images) {
  const u = urls(img);
  const bytes = await size(u.full);
  rows.push({ ...img, ...u, bytes });
  if (GET && typeof bytes === 'number') {
    const dir = join(here, img.ch);
    const out = join(dir, `${img.file}.jpg`);
    if (!existsSync(out)) {
      mkdirSync(dir, { recursive: true });
      let r;
      for (let wait = 1500; ; wait *= 2) {
        r = await fetch(u.full, { headers: { 'User-Agent': UA } });
        if (r.status === 429 && wait < 20000) { await sleep(wait); continue; }
        break;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      if (!r.ok || buf[0] !== 0xff || buf[1] !== 0xd8) { console.log('FAILED', img.file, r.status); continue; }
      writeFileSync(out, buf);
      console.log('saved', `${img.ch}/${img.file}.jpg`, mb(buf.length));
    }
  }
}

const total = rows.reduce((s, r) => s + (typeof r.bytes === 'number' ? r.bytes : 0), 0);

// Markdown list
let md = `# Kelingking references\n\n${refs.facts.map((f) => `- ${f}`).join('\n')}\n\nSatellite: ${refs.coords.satellite}\n\n`;
for (const ch of refs.chapters) {
  md += `## ${ch.title}\n\n${ch.why}\n\n| File | What it's for | Credit | Size |\n|---|---|---|---|\n`;
  for (const r of rows.filter((r) => r.ch === ch.key))
    md += `| [${r.file}](${r.page}) | ${r.note} | ${r.author}, ${r.license} | ${mb(r.bytes)} |\n`;
  md += '\n';
}
md += `## Video (optional)\n\n${refs.videos.map((v) => `- ${v.page || 'https://commons.wikimedia.org/wiki/File:' + v.name}: ${v.note}`).join('\n')}\n\n`;
md += `Stills total: ${rows.length} files, ${mb(total)}\n`;
writeFileSync(join(here, 'REFERENCES.md'), md);

// Visual board (hotlinks, nothing downloaded)
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');
let n = 0;
const sections = refs.chapters.map((ch) => {
  const cards = rows.filter((r) => r.ch === ch.key).map((r) => {
    n++;
    return `<a class="card" href="${r.page}" target="_blank"><img loading="lazy" src="${r.thumb}"><span class="n">${n}</span><div class="cap"><b>${esc(r.file)}</b><br>${esc(r.note)}<br><i>${esc(r.author)} · ${esc(r.license)}</i></div></a>`;
  }).join('');
  return `<section><h2>${esc(ch.title)}</h2><p>${esc(ch.why)}</p><div class="grid">${cards}</div></section>`;
}).join('');
writeFileSync(join(here, 'board.html'), `<!doctype html><meta charset="utf-8"><title>Kelingking references</title>
<style>
body{margin:0;background:#101214;color:#e8e6e1;font:14px/1.45 -apple-system,system-ui,sans-serif}
header{padding:28px 24px 8px}h1{margin:0;font-size:22px}header p{margin:6px 0 0;color:#9a9890}
section{padding:12px 24px 24px}h2{margin:0;font-size:17px}section>p{margin:4px 0 12px;color:#9a9890}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:12px}
.card{position:relative;display:block;color:inherit;text-decoration:none;background:#1a1d20;border-radius:6px;overflow:hidden}
.card img{display:block;width:100%;aspect-ratio:3/2;object-fit:cover;background:#000}
.n{position:absolute;top:8px;left:8px;background:#000b;padding:2px 8px;border-radius:4px;font-weight:600}
.cap{padding:8px 10px;font-size:12.5px;color:#c9c6bf}.cap i{color:#7d7a73}
</style>
<header><h1>Kelingking references</h1><p>${rows.length} stills, about ${mb(total)} at download size. Click a photo to open its source page.</p></header>
${sections}`);

for (const r of rows) console.log(r.ch.padEnd(13), r.file.padEnd(26), mb(r.bytes));
console.log('total', mb(total));
