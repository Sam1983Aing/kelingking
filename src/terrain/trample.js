// Trampled sand (v10), made at load as one more layer of the ground's texture arrays, where the
// shader reads it like a scan: a tile of dry beach sand trodden all over, from
// beach-people-scale.jpg and beach-under-cliff.jpg. Overlapping footprints (oval pits with
// pushed-up rims, fresh and slumped, a child's to a big adult's, some only a heel or a toe,
// some scuffed long, some in lines where people walked the same way), over lumps of a few
// decimetres.
//
// Worked out in the shader first, the prints looked right but made the whole ground shader
// slower everywhere, even from a kilometre up where none of them is drawn: that much code costs
// that shader's every pixel. A texture costs two reads.
//
// The normal layer: red and green the normal's x and y (map east and north, as a scan's), blue
// how far down into a print a spot is (0 to 1), for the shader's occlusion. The colour and mask
// layers are flat.

export const TRAMPLE_TILE = 6;   // metres across the tile

function mulberry32(a) {
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Heights (metres) and how deep in a print (0..1), size x size texels over the tile, wrapping.
function relief(size, seed = 5) {
  const T = TRAMPLE_TILE, px = T / size;
  const H = new Float32Array(size * size), C = new Float32Array(size * size);
  const rand = mulberry32(seed);
  // Periodic value noise for the lumps and for where the trails run.
  const lattice = (n) => { const g = new Float32Array(n * n); for (let i = 0; i < g.length; i++) g[i] = rand(); return g; };
  const vnoise = (g, n, x, y) => {
    const fx = (x / T) * n, fy = (y / T) * n;
    const i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    const su = u * u * (3 - 2 * u), sv = v * v * (3 - 2 * v);
    const at = (a, b) => g[(((b % n) + n) % n) * n + (((a % n) + n) % n)];
    return (at(i, j) * (1 - su) + at(i + 1, j) * su) * (1 - sv) + (at(i, j + 1) * (1 - su) + at(i + 1, j + 1) * su) * sv;
  };
  const lumpA = lattice(30), lumpB = lattice(14), trailN = lattice(3), trailA = lattice(2);
  // (The lumps on a grid of 128 and spread over the texels by bilinear reads: the lumps are
  // decimetres across, and the full-size loop took seconds.)
  const G = 128, lumps = new Float32Array(G * G);
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    const x = (i / G) * T, y = (j / G) * T;
    lumps[j * G + i] = (vnoise(lumpA, 30, x, y) - 0.5) * 0.012 + (vnoise(lumpB, 14, x, y) - 0.5) * 0.02;
  }
  const k = G / size;
  for (let j = 0; j < size; j++) {
    const fy = j * k, gj = Math.floor(fy), v = fy - gj, gj1 = (gj + 1) % G;
    for (let i = 0; i < size; i++) {
      const fx = i * k, gi = Math.floor(fx), u = fx - gi, gi1 = (gi + 1) % G;
      H[j * size + i] = (lumps[gj * G + gi] * (1 - u) + lumps[gj * G + gi1] * u) * (1 - v) + (lumps[gj1 * G + gi] * (1 - u) + lumps[gj1 * G + gi1] * u) * v;
    }
  }
  // Prints, splatted over their own box, in three layers: fresh ones, the next size, and old
  // slumped ones between them.
  const layers = [
    { cell: 0.27, keep: 0.62, depth: 0.06 },
    { cell: 0.4, keep: 0.5, depth: 0.045 },
    { cell: 0.22, keep: 0.45, depth: 0.02, old: true },
  ];
  for (const L of layers) {
    const n = Math.round(T / L.cell), cell = T / n;
    for (let cj = 0; cj < n; cj++) for (let ci = 0; ci < n; ci++) {
      if (rand() > L.keep) { rand(); rand(); rand(); rand(); rand(); rand(); continue; }
      const cx = (ci + 0.25 + 0.5 * rand()) * cell, cy = (cj + 0.25 + 0.5 * rand()) * cell;
      const r1 = rand(), r2 = rand(), r3 = rand(), r4 = rand();
      // Where people walked one way, the prints line up (with a little wander).
      const inTrail = !L.old && vnoise(trailN, 3, cx, cy) > 0.62;
      const ang = inTrail ? vnoise(trailA, 2, cx, cy) * Math.PI * 4 + (r1 - 0.5) * 0.6 : r1 * Math.PI * 2;
      const ca = Math.cos(ang), sa = Math.sin(ang);
      const age = L.old ? 0.6 + 0.4 * r2 : r2 * r2;
      const foot = 0.7 + 0.55 * r3;   // (not "size": that is the tile's, for the wrapping)
      const kind = r4;
      const grow = (1 + 0.35 * age) * foot;
      const a = 0.135 * grow * (kind > 0.88 ? 1.7 : kind < 0.18 ? 0.6 : 1), b = 0.058 * grow * (kind > 0.88 ? 1.2 : 1);
      const shift = kind < 0.18 ? (kind < 0.09 ? 0.07 : -0.07) * foot : 0;
      const D = L.depth * (L.old ? 1 : 1 - 0.65 * age);
      const R = Math.ceil((1.6 * a) / px);
      const i0 = Math.floor(cx / px), j0 = Math.floor(cy / px);
      for (let dj = -R; dj <= R; dj++) for (let di = -R; di <= R; di++) {
        const x = (i0 + di) * px - cx, y = (j0 + dj) * px - cy;
        let u = ca * x + sa * y, v = -sa * x + ca * y;
        u += shift;
        const r2e = (u * u) / (a * a) + (v * v) / (b * b);
        if (r2e > 2.4) continue;
        const rr = Math.sqrt(r2e);
        const depth = D * (0.8 + 0.25 * Math.abs(u / a));
        let h = 0;
        if (r2e < 1) { const k = 1 - r2e; h = -depth * k * k; }
        const rimW = 0.2 + 0.15 * age, xr = rr - 1.12;
        h += 0.3 * depth * Math.exp(-(xr * xr) / (rimW * rimW));
        const ii = (((i0 + di) % size) + size) % size, jj = (((j0 + dj) % size) + size) % size;
        const k = jj * size + ii;
        H[k] += h;
        if (r2e < 1) C[k] = Math.max(C[k], (1 - r2e) * (L.old ? 0.4 : 1 - 0.6 * age));
      }
    }
  }
  return { H, C, px };
}

// The layer as RGBA bytes: normal x, y (0.5 = flat), and the cavity in blue.
export function trampleNormal(size) {
  const { H, C, px } = relief(size);
  const out = new Uint8Array(size * size * 4);
  const inv = 1 / (2 * px);
  for (let j = 0; j < size; j++) {
    const jm = ((j - 1 + size) % size) * size, jp = ((j + 1) % size) * size, jr = j * size;
    for (let i = 0; i < size; i++) {
    const im = (i - 1 + size) % size, ip = (i + 1) % size;
    const hx = (H[jr + ip] - H[jr + im]) * inv, hy = (H[jp + i] - H[jm + i]) * inv;
    const l = Math.sqrt(hx * hx + hy * hy + 1);
    const o = (j * size + i) * 4;
    out[o] = Math.round(127.5 + 127.5 * (-hx / l));
    // (Rows run south, as the shader lays the tile out; green points north, as a scan's.)
    out[o + 1] = Math.round(127.5 + 127.5 * (hy / l));
    out[o + 2] = Math.round(255 * Math.min(1, C[j * size + i]));
    out[o + 3] = 255;
    }
  }
  return out;
}
