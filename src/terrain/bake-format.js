// The terrain baked to a file (v11): what the terrain worker sends the page, packed so it
// downloads in about a second instead of taking 8 s to generate (tools/bake-terrain.mjs writes
// it, app.js reads it). Plain JavaScript over arrays, so node can write it and the page read it.
//
// The file: gzip of a container. The container: "KLB1", a uint32 length, a JSON header (the
// message with every typed array replaced by { $a: n }, plus how each array is coded), then the
// arrays one after another, each padded to 4 bytes.
//
// Codecs, chosen per array by its path in the message (CODECS below), anything else raw:
//   raw    the bytes as they are
//   q16    Float32 quantized to 16 bits over its own range, in planes (all x, then all y ...)
//          and each plane delta coded, which gzip packs tightly (mesh positions: 24 mm across,
//          4 mm up; heights 4 mm)
//   oct8   unit normals as two signed bytes (octahedral), in planes
//   d16    16-bit values (half floats too) in planes, delta coded, exactly
//   d32    32-bit integers delta coded, exactly (the mesh's index: 14 MB to 70 kB)

const CODECS = {
  'mesh.positions': { c: 'q16', planes: 3 },
  'mesh.normals': { c: 'oct8' },
  'mesh.index': { c: 'd32' },
  heights: { c: 'q16', planes: 1 },
  water: { c: 'd16', planes: 4 },
  coast: { c: 'd16', planes: 4 },
  // Plants: x, height, z, scale, yaw, species, variant, tint (scatter.js). Positions to a few
  // millimetres, the rest to 16 bits over their range; species and variant come back exact.
  'plants.data': { c: 'q16', planes: 8, round: [5, 6] },
};

const MAGIC = 0x31424c4b;   // "KLB1"

export function encodeBake(msg) {
  const arrays = [];
  // Walk the message, swapping typed arrays for references.
  const walk = (o, path) => {
    if (!o || typeof o !== 'object') return o;
    if (ArrayBuffer.isView(o)) {
      const spec = CODECS[path] ?? { c: 'raw' };
      const { bytes, meta } = encodeArray(o, spec);
      arrays.push(bytes);
      return { $a: arrays.length - 1, type: o.constructor.name, length: o.length, ...meta };
    }
    if (Array.isArray(o)) return o.map((v, i) => walk(v, path));
    const out = {};
    for (const k of Object.keys(o)) out[k] = walk(o[k], path ? `${path}.${k}` : k);
    return out;
  };
  const tree = walk(msg, '');
  const json = new TextEncoder().encode(JSON.stringify(tree));
  const pad = (n) => (4 - (n % 4)) % 4;
  let size = 8 + json.length + pad(json.length);
  for (const a of arrays) size += a.length + pad(a.length);
  const out = new Uint8Array(size);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, MAGIC, true);
  dv.setUint32(4, json.length, true);
  out.set(json, 8);
  let o = 8 + json.length + pad(json.length);
  for (const a of arrays) { out.set(a, o); o += a.length + pad(a.length); }
  return out;
}

export function decodeBake(buf) {
  const u8 = new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (dv.getUint32(0, true) !== MAGIC) throw new Error('not a terrain bake');
  const jl = dv.getUint32(4, true);
  const tree = JSON.parse(new TextDecoder().decode(u8.subarray(8, 8 + jl)));
  const pad = (n) => (4 - (n % 4)) % 4;
  // The arrays' offsets, in order.
  const refs = [];
  const collect = (o) => {
    if (!o || typeof o !== 'object') return;
    if ('$a' in o) { refs[o.$a] = o; return; }
    for (const v of Array.isArray(o) ? o : Object.values(o)) collect(v);
  };
  collect(tree);
  let off = 8 + jl + pad(jl);
  const views = refs.map((r) => {
    const v = u8.subarray(off, off + r.bytes);
    off += r.bytes + pad(r.bytes);
    return v;
  });
  const build = (o) => {
    if (!o || typeof o !== 'object') return o;
    if ('$a' in o) return decodeArray(views[o.$a], o);
    if (Array.isArray(o)) return o.map(build);
    const out = {};
    for (const k of Object.keys(o)) out[k] = build(o[k]);
    return out;
  };
  return build(tree);
}

// ---------------------------------------------------------------- codecs

const TYPES = { Float32Array, Float64Array, Uint8Array, Int8Array, Uint16Array, Int16Array, Uint32Array, Int32Array, Uint8ClampedArray };

function encodeArray(a, spec) {
  const n = a.length;
  if (spec.c === 'q16') {
    const P = spec.planes, m = n / P;
    const lo = [], hi = [];
    for (let d = 0; d < P; d++) {
      let l = Infinity, h = -Infinity;
      for (let i = 0; i < m; i++) { const v = a[i * P + d]; if (v < l) l = v; if (v > h) h = v; }
      if (!(h > l)) h = l + 1;
      lo.push(l); hi.push(h);
    }
    const q = new Uint16Array(n);
    for (let d = 0; d < P; d++) {
      const s = 65535 / (hi[d] - lo[d]);
      let prev = 0;
      for (let i = 0; i < m; i++) {
        const v = Math.round((a[i * P + d] - lo[d]) * s);
        q[d * m + i] = (v - prev) & 0xffff;
        prev = v;
      }
    }
    return { bytes: new Uint8Array(q.buffer), meta: { codec: 'q16', planes: P, lo, hi, round: spec.round ?? [], bytes: q.byteLength } };
  }
  if (spec.c === 'oct8') {
    const m = n / 3, o = new Int8Array(m * 2);
    for (let i = 0; i < m; i++) {
      let x = a[i * 3], y = a[i * 3 + 1], z = a[i * 3 + 2];
      const s = Math.abs(x) + Math.abs(y) + Math.abs(z) || 1;
      x /= s; y /= s; z /= s;
      if (z < 0) { const ox = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1), oy = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1); x = ox; y = oy; }
      o[i] = Math.round(x * 127); o[m + i] = Math.round(y * 127);
    }
    return { bytes: new Uint8Array(o.buffer), meta: { codec: 'oct8', bytes: o.byteLength } };
  }
  if (spec.c === 'd16') {
    const P = spec.planes, m = n / P, q = new Uint16Array(n);
    const src = new Uint16Array(a.buffer, a.byteOffset, n);
    for (let d = 0; d < P; d++) {
      let prev = 0;
      for (let i = 0; i < m; i++) { const v = src[i * P + d]; q[d * m + i] = (v - prev) & 0xffff; prev = v; }
    }
    return { bytes: new Uint8Array(q.buffer), meta: { codec: 'd16', planes: P, bytes: q.byteLength } };
  }
  if (spec.c === 'd32') {
    const q = new Int32Array(n);
    let prev = 0;
    for (let i = 0; i < n; i++) { const v = a[i]; q[i] = v - prev; prev = v; }
    return { bytes: new Uint8Array(q.buffer), meta: { codec: 'd32', bytes: q.byteLength } };
  }
  const bytes = new Uint8Array(a.buffer.slice(a.byteOffset, a.byteOffset + a.byteLength));
  return { bytes, meta: { codec: 'raw', bytes: bytes.length } };
}

function decodeArray(v, r) {
  const T = TYPES[r.type];
  const n = r.length;
  // (Copied to an aligned buffer first: a view into the file need not start on a 4-byte
  // boundary once the header is decompressed elsewhere.)
  const al = (Ctor, count) => new Ctor(v.slice().buffer, 0, count);
  if (r.codec === 'q16') {
    const P = r.planes, m = n / P, q = al(Uint16Array, n), out = new T(n);
    for (let d = 0; d < P; d++) {
      const s = (r.hi[d] - r.lo[d]) / 65535, lo = r.lo[d], round = r.round?.includes(d);
      let acc = 0;
      for (let i = 0; i < m; i++) {
        acc = (acc + q[d * m + i]) & 0xffff;
        const val = lo + acc * s;
        out[i * P + d] = round ? Math.round(val) : val;
      }
    }
    return out;
  }
  if (r.codec === 'oct8') {
    const m = n / 3, o = al(Int8Array, m * 2), out = new T(n);
    for (let i = 0; i < m; i++) {
      let x = o[i] / 127, y = o[m + i] / 127;
      let z = 1 - Math.abs(x) - Math.abs(y);
      if (z < 0) { const ox = (1 - Math.abs(y)) * (x >= 0 ? 1 : -1), oy = (1 - Math.abs(x)) * (y >= 0 ? 1 : -1); x = ox; y = oy; }
      const l = Math.hypot(x, y, z) || 1;
      out[i * 3] = x / l; out[i * 3 + 1] = y / l; out[i * 3 + 2] = z / l;
    }
    return out;
  }
  if (r.codec === 'd16') {
    const P = r.planes, m = n / P, q = al(Uint16Array, n), out = new T(n), u = new Uint16Array(out.buffer);
    for (let d = 0; d < P; d++) {
      let acc = 0;
      for (let i = 0; i < m; i++) { acc = (acc + q[d * m + i]) & 0xffff; u[i * P + d] = acc; }
    }
    return out;
  }
  if (r.codec === 'd32') {
    const q = al(Int32Array, n), out = new T(n);
    let acc = 0;
    for (let i = 0; i < n; i++) { acc += q[i]; out[i] = acc; }
    return out;
  }
  return new T(v.slice().buffer, 0, n);
}
