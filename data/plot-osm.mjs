// Plot OSM features in local metres (origin at the T-Rex summit) to an SVG, for checking the layout.
import { readFileSync, writeFileSync } from 'node:fs';
const d = JSON.parse(readFileSync('osm.json', 'utf8'));
const O = { lat: -8.7532187, lon: 115.4720351 };
const R = 6378137, kx = Math.cos(O.lat * Math.PI / 180) * Math.PI / 180 * R, ky = Math.PI / 180 * R;
const P = (lat, lon) => [(lon - O.lon) * kx, (lat - O.lat) * ky]; // x east, y north
const S = 1.0, W = 1400, H = 1400, cx = W / 2 + 100, cy = H / 2 - 150;
const sx = (x) => cx + x * S, sy = (y) => cy - y * S;
const col = { coastline: '#39f', cliff: '#e33', path: '#fb0', steps: '#f0f', beach: '#fd8', scrub: '#4a4' };
let out = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="background:#fff"><rect width="${W}" height="${H}" fill="#fff"/>`;
for (let g = -600; g <= 600; g += 100) out += `<line x1="${sx(g)}" y1="0" x2="${sx(g)}" y2="${H}" stroke="#ddd"/><line x1="0" y1="${sy(g)}" x2="${W}" y2="${sy(g)}" stroke="#ddd"/><text x="${sx(g) + 2}" y="12" font-size="10" fill="#999">${g}</text><text x="2" y="${sy(g) - 2}" font-size="10" fill="#999">${g}</text>`;
for (const e of d.elements) {
  const t = e.tags || {};
  if (e.type === 'way' && e.geometry) {
    const k = t.natural || t.highway;
    const c = col[k] || '#bbb';
    const pts = e.geometry.map((g) => P(g.lat, g.lon)).map(([x, y]) => `${sx(x).toFixed(1)},${sy(y).toFixed(1)}`).join(' ');
    out += `<polyline points="${pts}" fill="none" stroke="${c}" stroke-width="${col[k] ? 2.5 : 1}"/>`;
    if (col[k] && k !== 'coastline') { const [x, y] = P(e.geometry[0].lat, e.geometry[0].lon); out += `<text x="${sx(x) + 3}" y="${sy(y) - 3}" font-size="11" fill="${c}">${k} ${e.id}</text>`; }
  } else if (e.type === 'node') {
    const [x, y] = P(e.lat, e.lon);
    out += `<circle cx="${sx(x)}" cy="${sy(y)}" r="5" fill="${t.natural === 'peak' ? '#070' : '#00f'}"/><text x="${sx(x) + 7}" y="${sy(y) + 4}" font-size="12">${t.natural === 'peak' ? '▲' + (t.ele || '') + ' ' + (t.name || '') : 'VP ' + (t.name || e.id)}</text>`;
  }
}
writeFileSync('osm-plot.svg', out + '</svg>');
