// Measuring a render against its photo, region by region, so light and colour can be tuned
// on numbers instead of by eye.
//
// Every material can draw a flat class label instead of its colour (uLabel): sky with its
// elevation, water with its distance and whether the bed shows, sand, rock and ground cover
// with whether the sun reaches them, and the plants. The labels are rendered from the shot's
// camera, and the same pixels are averaged in the render and in the photo. Pixels near a
// class boundary are left out (the photo and the model never line up exactly), and each bin
// reports the median as well as the mean, so a few people or leaves in the photo do not
// drag it.
//
// Used by `node tools/capture.mjs <shot> --measure`.

import * as THREE from 'three';

const toLin = (v) => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
const toSrgb = (v) => (v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
const LIN = Array.from({ length: 256 }, (_, i) => toLin(i / 255));

// Bins: a name and a test on (class, g, b) of the label.
const dist = (g) => Math.pow(2, g * 20);   // metres, from the label's green
const BINS = [
  ['sky 0-1 deg', (c, g, b) => c === 1 && b < 4],
  ['sky 1-3 deg', (c, g, b) => c === 1 && b >= 4 && b < 12],
  ['sky 3-8 deg', (c, g, b) => c === 1 && b >= 12 && b < 32],
  ['sky 8-20 deg', (c, g, b) => c === 1 && b >= 32 && b < 80],
  ['sky > 20 deg', (c, g, b) => c === 1 && b >= 80],
  ['sea < 400 m', (c, g, b) => c === 2 && b === 0 && dist(g) < 400],
  ['sea 0.4-1.5 km', (c, g, b) => c === 2 && b === 0 && dist(g) >= 400 && dist(g) < 1500],
  ['sea 1.5-5 km', (c, g, b) => c === 2 && b === 0 && dist(g) >= 1500 && dist(g) < 5000],
  ['sea 5-15 km', (c, g, b) => c === 2 && b === 0 && dist(g) >= 5000 && dist(g) < 15000],
  ['sea > 15 km', (c, g, b) => c === 2 && b === 0 && dist(g) >= 15000],
  ['shallows', (c, g, b) => c === 2 && b > 0],
  ['sand, sun', (c, g, b) => c === 3 && b > 0],
  ['sand, shade', (c, g, b) => c === 3 && b === 0],
  ['rock, sun', (c, g, b) => c === 4 && b > 0],
  ['rock, shade', (c, g, b) => c === 4 && b === 0],
  ['cover, sun', (c, g, b) => c === 5 && b > 0],
  ['cover, shade', (c, g, b) => c === 5 && b === 0],
  ['plants, sun', (c, g, b) => c === 6 && b > 0],
  ['plants, shade', (c, g, b) => c === 6 && b === 0],
];

// rois: extra regions, { name: [x0, y0, x1, y1] } as fractions of the frame from the top left,
// or { name: { render: [...], photo: [...] } } where the model and the photo put the same
// surface in different places.
export function measure({ renderer, scene, camera, refImg, setLabels, erode = 4, rois = {} }) {
  const size = renderer.getDrawingBufferSize(new THREE.Vector2());
  const w = size.x, h = size.y;
  const gl = renderer.getContext();

  // The colour render, straight from the canvas.
  renderer.setRenderTarget(null);
  renderer.render(scene, camera);
  const col = new Uint8Array(w * h * 4);
  gl.readPixels(0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, col);

  // The same frame before exposure and the tone curve: scene light in kcd/m2. Render targets
  // skip three's tone mapping, and a float target keeps values above 1.
  const frt = new THREE.WebGLRenderTarget(w, h, { type: THREE.FloatType });
  renderer.setRenderTarget(frt);
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  const lin = new Float32Array(w * h * 4);
  renderer.readRenderTargetPixels(frt, 0, 0, w, h, lin);
  frt.dispose();

  // Labels.
  const rt = new THREE.WebGLRenderTarget(w, h);
  setLabels(true);
  renderer.setRenderTarget(rt);
  renderer.setClearColor(0x000000, 0);
  renderer.clear();
  renderer.render(scene, camera);
  renderer.setRenderTarget(null);
  setLabels(false);
  const lab = new Uint8Array(w * h * 4);
  renderer.readRenderTargetPixels(rt, 0, 0, w, h, lab);
  rt.dispose();

  // The photo at the same size (rows top-down, unlike the GL reads).
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(refImg, 0, 0, w, h);
  const photo = ctx.getImageData(0, 0, w, h).data;

  // A pixel counts if its whole neighbourhood has the same label.
  const clsOnly = (i) => lab[i * 4];
  const stats = BINS.map(([name]) => ({ name, r: [], p: [], s: [] }));
  for (let y = erode; y < h - erode; y++) {
    for (let x = erode; x < w - erode; x++) {
      const i = y * w + x;
      const c = clsOnly(i);
      if (c === 0) continue;
      let ok = true;
      for (let dy = -erode; dy <= erode && ok; dy += erode) {
        for (let dx = -erode; dx <= erode && ok; dx += erode) {
          if (clsOnly(i + dy * w + dx) !== c) ok = false;
        }
      }
      if (!ok) continue;
      const g = lab[i * 4 + 1] / 255, b = lab[i * 4 + 2];
      const bin = BINS.findIndex(([, test]) => test(c, g, b));
      if (bin < 0) continue;
      const pi = ((h - 1 - y) * w + x) * 4;   // photo row for this GL row
      stats[bin].r.push(LIN[col[i * 4]], LIN[col[i * 4 + 1]], LIN[col[i * 4 + 2]]);
      stats[bin].p.push(LIN[photo[pi]], LIN[photo[pi + 1]], LIN[photo[pi + 2]]);
      stats[bin].s.push(lin[i * 4], lin[i * 4 + 1], lin[i * 4 + 2]);
    }
  }
  // Hand-picked rectangles, whatever their labels say.
  const rect = ([x0, y0, x1, y1], fn) => {
    for (let y = Math.round(y0 * h); y < Math.round(y1 * h); y++) {
      for (let x = Math.round(x0 * w); x < Math.round(x1 * w); x++) fn(x, y);
    }
  };
  for (const [name, r] of Object.entries(rois)) {
    const st = { name: 'roi ' + name, r: [], p: [], s: [] };
    rect(r.render ?? r, (x, y) => {
      const i = (h - 1 - y) * w + x;
      st.r.push(LIN[col[i * 4]], LIN[col[i * 4 + 1]], LIN[col[i * 4 + 2]]);
      st.s.push(lin[i * 4], lin[i * 4 + 1], lin[i * 4 + 2]);
    });
    rect(r.photo ?? r, (x, y) => {
      const pi = (y * w + x) * 4;
      st.p.push(LIN[photo[pi]], LIN[photo[pi + 1]], LIN[photo[pi + 2]]);
    });
    stats.push(st);
  }

  const summarise = (arr, linear = false) => {
    const n = arr.length / 3;
    const mean = [0, 0, 0];
    const lum = new Float32Array(n);
    for (let k = 0; k < n; k++) {
      for (let c = 0; c < 3; c++) mean[c] += arr[k * 3 + c];
      lum[k] = 0.2126 * arr[k * 3] + 0.7152 * arr[k * 3 + 1] + 0.0722 * arr[k * 3 + 2];
    }
    mean.forEach((_, c) => (mean[c] /= n));
    lum.sort();
    const L = 0.2126 * mean[0] + 0.7152 * mean[1] + 0.0722 * mean[2];
    if (linear) return { rgb: mean.map((v) => +v.toFixed(3)), lum: +L.toFixed(3), median: +lum[n >> 1].toFixed(3) };
    const srgb = mean.map((v) => Math.round(toSrgb(v) * 255));
    return { srgb, lum: +L.toFixed(4), median: +lum[n >> 1].toFixed(4) };
  };
  return stats.filter((s) => s.r.length / 3 >= 200).map((s) => ({
    name: s.name, n: s.r.length / 3, render: summarise(s.r), photo: summarise(s.p), scene: summarise(s.s, true),
  }));
}
