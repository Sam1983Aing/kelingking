// The path cut into the ground (v6): a level bench under the tread, a steep cut bank on the
// uphill side and a fill on the downhill side, running out into the slope.
//
// For a point beside the path, at e metres past the edge of the bench, the ground is held to
// within cut * e above and fill * e below the bench's height: the natural height where it
// already is, the bank where it is not. Across a hairpin, where two legs of the path are
// close, the bench height is a blend of the nearby samples weighted by how much nearer each
// is than the nearest, so it hands over from one leg to the other in the metre between them.
//
// It is worked out once, on a 25 cm grid over the path, as the change it makes to the height;
// heightAt adds that (bilinear) to the natural height. Where the change is smooth (the bench
// follows the ground, and the banks are planes), interpolating it is exact to within the
// ground's own curvature over 25 cm.
//
// The grid also carries, for the ground's shader: how much of each point is the bench (the
// tread, and the trodden strip either side of it), and how much bank the carve exposed.

const CELL = 0.25;

export function buildCarve(route, heightAt, bank) {
  const t0 = performance.now();
  const R = bank.reach;
  const [bx0, by0, bx1, by1] = route.bbox;
  const x0 = Math.floor((bx0 - R) / CELL) * CELL, y0 = Math.floor((by0 - R) / CELL) * CELL;
  const nx = Math.ceil((bx1 + R - x0) / CELL) + 1, ny = Math.ceil((by1 + R - y0) / CELL) + 1;
  const D = new Float32Array(nx * ny);
  // For the shader: bench (0..1), bank (metres of height the carve moved, 0..1 over 1.5 m).
  const mask = new Uint8Array(nx * ny * 4);
  const { hg, w } = route;
  let cells = 0;
  for (let j = 0; j < ny; j++) {
    const py = y0 + j * CELL;
    for (let i = 0; i < nx; i++) {
      const px = x0 + i * CELL;
      let dmin = Infinity;
      route.near(px, py, R, (k, d) => { if (d < dmin) dmin = d; });
      if (dmin >= R) continue;
      cells++;
      let sw = 0, sh = 0, sb = 0;
      route.near(px, py, dmin + 1.6, (k, d) => {
        const wt = Math.exp(-(d - dmin) / 0.3);
        sw += wt; sh += wt * hg[k]; sb += wt * w[k];
      });
      const hb = sh / sw;                                  // the bench's height here
      const half = sb / sw / 2 + bank.shoulder;            // and its half width
      const h = heightAt(px, py);
      // Metres past the edge of the bench, eased in over 15 cm either side of it.
      const e = softPos(dmin - half, 0.15);
      const soft = Math.min(bank.soft, e);
      const c = hb + softClamp(h - hb, -bank.fill * e, bank.cut * e, soft);
      const fade = 1 - smooth(R - 2, R, dmin);
      const k = j * nx + i;
      D[k] = (c - h) * fade;
      const benchW = 1 - smooth(half - 0.1, half + 0.35, dmin);
      mask[k * 4] = Math.round(255 * benchW);
      mask[k * 4 + 1] = Math.round(255 * Math.min(Math.abs(D[k]) / 1.5, 1));
      // Distance to the middle of the path (0..8 m), for the trodden strip and plants.
      mask[k * 4 + 2] = Math.round(255 * Math.min(dmin / R, 1));
      mask[k * 4 + 3] = 255;
    }
  }

  // Bilinear lookup of the change in height (0 outside the grid).
  function at(x, y) {
    const fi = (x - x0) / CELL, fj = (y - y0) / CELL;
    if (fi < 0 || fj < 0 || fi >= nx - 1 || fj >= ny - 1) return 0;
    const i = Math.floor(fi), j = Math.floor(fj), u = fi - i, v = fj - j, k = j * nx + i;
    return (D[k] * (1 - u) + D[k + 1] * u) * (1 - v) + (D[k + nx] * (1 - u) + D[k + nx + 1] * u) * v;
  }
  // How close to the path a point is (0 far off, 1 on the bench), for the mesh builder, which
  // must not carve the rock faces across it.
  function near(x, y) {
    const fi = (x - x0) / CELL, fj = (y - y0) / CELL;
    if (fi < 0 || fj < 0 || fi >= nx - 1 || fj >= ny - 1) return 0;
    const k = Math.round(fj) * nx + Math.round(fi);
    return 1 - smooth(2, 5, (mask[k * 4 + 2] / 255) * R + (mask[k * 4 + 3] ? 0 : R));
  }
  return { at, near, D, mask, x0, y0, nx, ny, cell: CELL, cells, ms: Math.round(performance.now() - t0) };
}

// max(x, 0), rounded over +-q.
function softPos(x, q) {
  if (x <= -q) return 0;
  if (x >= q) return x;
  return ((x + q) * (x + q)) / (4 * q);
}
// clamp(x, lo, hi) with its corners rounded over r (polynomial smooth min and max).
function softClamp(x, lo, hi, r) {
  if (r <= 1e-4) return Math.min(Math.max(x, lo), hi);
  const smax = (a, b) => { const h = Math.max(r - Math.abs(a - b), 0) / r; return Math.max(a, b) + (h * h * r) / 4; };
  const smin = (a, b) => { const h = Math.max(r - Math.abs(a - b), 0) / r; return Math.min(a, b) - (h * h * r) / 4; };
  return smin(smax(x, lo), hi);
}
const smooth = (a, b, x) => {
  const t = Math.min(Math.max((x - a) / (b - a), 0), 1);
  return t * t * (3 - 2 * t);
};
