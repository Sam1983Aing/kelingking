// The open sea as a wave spectrum, turned into surfaces on the GPU with an inverse FFT
// (after Jerry Tessendorf, "Simulating Ocean Water", 2001).
//
// Four cascades, each a square patch that tiles, from a 760 m patch that carries the swell and
// the long wind waves down to a 2.2 m patch of ripples. Each one holds a band of the spectrum
// so nothing is counted twice. Per cascade, every time the clock moves:
//   1. evolve    the starting spectrum turns with time (deep water: omega = sqrt(g k))
//   2. FFT       16 passes (8 across, 8 down) of a radix-2 Stockham FFT, all cascades at once
//   3. assemble  the fields, into two half-float textures per cascade, with mipmaps:
//                  A  displacement east, height, displacement north, Jacobian
//                  B  slope east, slope north, slope squared (its mipmaps give the slope
//                     spread of everything too small to draw), whitecap foam
// The foam is carried from one update to the next and fades, so whitecaps leave patches.
//
// The passes are plain WebGL2 on three.js's context (a three.js render call per pass costs
// more than the pass). The output textures belong to three.js render targets, so materials
// can use them like any texture.
//
// Map convention as everywhere: x east, y north (world z = -north).

import * as THREE from 'three';

const N = 256;
const LOG2N = 8;
const G = 9.81;

export const OCEAN_DEFAULTS = {
  cascades: [757, 107, 15.3, 2.21],   // patch sizes (m), ratios near 7 so the tiles do not line up
  wind: 7,             // wind speed at 10 m (m/s)
  fetch: 60000,        // m
  windHeading: 300,    // compass direction the wind blows toward
  windSeaHs: 0.9,      // significant height of the local wind sea (m): JONSWAP for 7 m/s over 60 km
  swellHs: 1.2,        // and of the swell
  swellPeriod: 13,     // s
  swellHeading: 40,    // compass direction the swell travels
  swellSpread: 28,     // cos^2s spreading exponent (bigger = longer crests)
  choppy: [0.6, 0.9, 0.9, 0.8],   // horizontal displacement per cascade (sharpens crests)
  foamDecay: 2.6,      // seconds for whitecap foam to fade to a third
  foamJ: 0.35,         // Jacobian below which a crest is breaking
  seed: 5,
};

export function createOcean(renderer, opts = {}) {
  const P = { ...OCEAN_DEFAULTS, ...opts };
  const C = P.cascades.length;
  const gl = renderer.getContext();
  gl.getExtension('EXT_color_buffer_float');

  // ---------------------------------------------------------------- starting spectrum (CPU)
  const h0 = buildSpectrum(P);

  // ---------------------------------------------------------------- GL resources
  const W = N * C;   // the working atlas holds the cascades side by side
  function floatTex(w, h, data = null) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, w, h, 0, gl.RGBA, gl.FLOAT, data);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }
  function fbo(textures) {
    const f = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    textures.forEach((t, i) => gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0));
    return f;
  }
  const spectrumTex = floatTex(W, N, h0.data);          // h0(k).re, h0(k).im, conj h0(-k).re, .im
  const kTex = floatTex(W, N, h0.kdata);                // kx, ky, omega, band weight
  // Two ping-pong pairs of two RGBA32F each: four complex fields per texel.
  const work = [0, 1].map(() => { const t = [floatTex(W, N), floatTex(W, N)]; return { t, f: fbo(t) }; });
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);

  // Outputs: per cascade two ping-pong sets (the foam carries over), each an MRT pair A, B.
  const outputs = [];
  for (let c = 0; c < C; c++) {
    const sets = [0, 1].map(() => {
      const rt = new THREE.WebGLRenderTarget(N, N, {
        count: 2, type: THREE.HalfFloatType, format: THREE.RGBAFormat,
        wrapS: THREE.RepeatWrapping, wrapT: THREE.RepeatWrapping,
        minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
        generateMipmaps: true, depthBuffer: false, anisotropy: 4,
      });
      rt.textures.forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.generateMipmaps = true; t.anisotropy = 4; });
      renderer.initRenderTarget(rt);
      return rt;
    });
    outputs.push(sets);
  }
  const glOf = (rt) => ({
    f: renderer.properties.get(rt).__webglFramebuffer,
    a: renderer.properties.get(rt.textures[0]).__webglTexture,
    b: renderer.properties.get(rt.textures[1]).__webglTexture,
  });

  // ---------------------------------------------------------------- programs
  const VERT = `#version 300 es
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;
  const EVOLVE = `#version 300 es
  precision highp float;
  uniform sampler2D uH0;
  uniform sampler2D uK;
  uniform float uTime;
  layout(location = 0) out vec4 o0;
  layout(location = 1) out vec4 o1;
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    vec4 s = texelFetch(uH0, px, 0);
    vec4 kk = texelFetch(uK, px, 0);
    vec2 k = kk.xy;
    float kl = length(k);
    if (kl < 1e-6 || kk.w <= 0.0) { o0 = vec4(0.0); o1 = vec4(0.0); return; }
    float ph = kk.z * uTime;
    vec2 e = vec2(cos(ph), sin(ph));
    // h(k, t) = h0(k) e^(-i w t) + conj(h0(-k)) e^(i w t): travels along +k.
    vec2 h = cmul(s.xy, vec2(e.x, -e.y)) + cmul(s.zw, e);
    vec2 ih = vec2(-h.y, h.x);          // i h
    vec2 kn = k / kl;
    vec2 Dx = ih * kn.x, Dn = ih * kn.y;
    vec2 sx = ih * k.x, sn = ih * k.y;
    vec2 Dxx = -h * (k.x * k.x / kl), Dnn = -h * (k.y * k.y / kl), Dxn = -h * (k.x * k.y / kl);
    // Two real fields per complex number: F + iG.
    vec2 c0 = Dx + vec2(-h.y, h.x);
    vec2 c1 = Dn + vec2(-sx.y, sx.x);
    vec2 c2 = sn + vec2(-Dxx.y, Dxx.x);
    vec2 c3 = Dnn + vec2(-Dxn.y, Dxn.x);
    o0 = vec4(c0, c1);
    o1 = vec4(c2, c3);
  }`;
  const BUTTERFLY = `#version 300 es
  precision highp float;
  precision highp int;
  uniform sampler2D uIn0;
  uniform sampler2D uIn1;
  uniform int uNs;
  uniform int uVertical;
  layout(location = 0) out vec4 o0;
  layout(location = 1) out vec4 o1;
  vec2 cmul(vec2 a, vec2 b) { return vec2(a.x * b.x - a.y * b.y, a.x * b.y + a.y * b.x); }
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    int c = px.x / ${N};
    int o = uVertical == 1 ? px.y : px.x - c * ${N};
    int r = (o / uNs) & 1;
    int jm = o % uNs;
    int j = (o / (2 * uNs)) * uNs + jm;
    float ang = 3.14159265358979 * float(jm) / float(uNs);
    vec2 w = vec2(cos(ang), sin(ang));
    ivec2 p0 = uVertical == 1 ? ivec2(px.x, j) : ivec2(c * ${N} + j, px.y);
    ivec2 p1 = uVertical == 1 ? ivec2(px.x, j + ${N / 2}) : ivec2(c * ${N} + j + ${N / 2}, px.y);
    vec4 a0 = texelFetch(uIn0, p0, 0), b0 = texelFetch(uIn0, p1, 0);
    vec4 a1 = texelFetch(uIn1, p0, 0), b1 = texelFetch(uIn1, p1, 0);
    b0 = vec4(cmul(b0.xy, w), cmul(b0.zw, w));
    b1 = vec4(cmul(b1.xy, w), cmul(b1.zw, w));
    float sg = r == 0 ? 1.0 : -1.0;
    o0 = a0 + sg * b0;
    o1 = a1 + sg * b1;
  }`;
  const ASSEMBLE = `#version 300 es
  precision highp float;
  uniform sampler2D uIn0;
  uniform sampler2D uIn1;
  uniform sampler2D uPrevB;
  uniform int uCascade;
  uniform float uChoppy;
  uniform float uDecay;     // foam kept since the last update
  uniform float uFoamJ;
  layout(location = 0) out vec4 oA;
  layout(location = 1) out vec4 oB;
  void main() {
    ivec2 px = ivec2(gl_FragCoord.xy);
    ivec2 q = ivec2(px.x + uCascade * ${N}, px.y);
    vec4 f0 = texelFetch(uIn0, q, 0), f1 = texelFetch(uIn1, q, 0);
    float Dx = f0.x, h = f0.y, Dn = f0.z, sx = f0.w;
    float sn = f1.x, Dxx = f1.y, Dnn = f1.z, Dxn = f1.w;
    float J = (1.0 + uChoppy * Dxx) * (1.0 + uChoppy * Dnn) - uChoppy * uChoppy * Dxn * Dxn;
    float prev = texelFetch(uPrevB, px, 0).w;
    float foam = max(prev * uDecay, smoothstep(uFoamJ, uFoamJ - 0.45, J));
    oA = vec4(uChoppy * Dx, h, uChoppy * Dn, J);
    oB = vec4(sx, sn, sx * sx + sn * sn, foam);
  }`;

  function program(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('ocean shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('ocean program: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  const evolve = program(EVOLVE);
  const butterfly = program(BUTTERFLY);
  const assemble = program(ASSEMBLE);
  const vao = gl.createVertexArray();
  const DRAW2 = [gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1];

  function bindTex(unit, tex, loc) {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.uniform1i(loc, unit);
  }

  // ---------------------------------------------------------------- one update
  let current = 0;          // which output set is live
  let lastT = null;
  function step(t, dt) {
    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.viewport(0, 0, W, N);

    gl.useProgram(evolve.p);
    gl.bindFramebuffer(gl.FRAMEBUFFER, work[0].f);
    gl.drawBuffers(DRAW2);
    bindTex(0, spectrumTex, evolve.u.uH0);
    bindTex(1, kTex, evolve.u.uK);
    gl.uniform1f(evolve.u.uTime, t);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    gl.useProgram(butterfly.p);
    let src = 0;
    for (let dir = 0; dir < 2; dir++) {
      gl.uniform1i(butterfly.u.uVertical, dir);
      for (let s = 0; s < LOG2N; s++) {
        const dst = 1 - src;
        gl.bindFramebuffer(gl.FRAMEBUFFER, work[dst].f);
        gl.drawBuffers(DRAW2);
        bindTex(0, work[src].t[0], butterfly.u.uIn0);
        bindTex(1, work[src].t[1], butterfly.u.uIn1);
        gl.uniform1i(butterfly.u.uNs, 1 << s);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        src = dst;
      }
    }

    const next = 1 - current;
    gl.useProgram(assemble.p);
    gl.viewport(0, 0, N, N);
    bindTex(0, work[src].t[0], assemble.u.uIn0);
    bindTex(1, work[src].t[1], assemble.u.uIn1);
    gl.uniform1f(assemble.u.uDecay, Math.exp(-Math.max(dt, 0) / P.foamDecay));
    gl.uniform1f(assemble.u.uFoamJ, P.foamJ);
    for (let c = 0; c < C; c++) {
      const out = glOf(outputs[c][next]), prev = glOf(outputs[c][current]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, out.f);
      gl.drawBuffers(DRAW2);
      bindTex(2, prev.b, assemble.u.uPrevB);
      gl.uniform1i(assemble.u.uCascade, c);
      gl.uniform1f(assemble.u.uChoppy, P.choppy[c]);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    for (let c = 0; c < C; c++) {
      const out = glOf(outputs[c][next]);
      for (const tex of [out.a, out.b]) {
        gl.bindTexture(gl.TEXTURE_2D, tex);
        gl.generateMipmap(gl.TEXTURE_2D);
      }
    }
    current = next;
  }

  const uniforms = {
    uOceanA: { value: [] },
    uOceanB: { value: [] },
    uOceanL: { value: new THREE.Vector4(...P.cascades) },
    uOceanTail: { value: h0.tailSlopeVar },   // slope variance of ripples shorter than the last cascade
  };
  function publish() {
    uniforms.uOceanA.value = outputs.map((s) => s[current].textures[0]);
    uniforms.uOceanB.value = outputs.map((s) => s[current].textures[1]);
  }
  publish();

  return {
    params: P,
    uniforms,
    stats: h0.stats,
    // Advance to time t (seconds). A still clock costs nothing. A jump (the first frame, a
    // capture frozen at some time) replays the last few seconds so the whitecap foam has
    // built up as it would have.
    update(t) {
      if (t === lastT) return false;
      const jump = lastT === null || t < lastT || t - lastT > 0.5;
      if (jump) {
        const t0 = t - 3 * P.foamDecay, dt = 0.1;
        let prevT = t0 - dt;
        for (let s = t0; s < t; s += dt) { step(s, s - prevT); prevT = s; }
        step(t, t - prevT);
      } else {
        step(t, t - lastT);
      }
      lastT = t;
      renderer.resetState();
      publish();
      return true;
    },
    // Debugging: statistics of one output texture (cascade c, 0 = A, 1 = B), read back.
    read(c, which) {
      const o = glOf(outputs[c][current]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, o.f);
      gl.readBuffer(gl.COLOR_ATTACHMENT0 + which);
      const px = new Float32Array(N * N * 4);
      gl.readPixels(0, 0, N, N, gl.RGBA, gl.FLOAT, px);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      renderer.resetState();
      const st = [0, 1, 2, 3].map((ch) => { let mn = 1e9, mx = -1e9, s2 = 0, nan = 0; for (let i = ch; i < px.length; i += 4) { const v = px[i]; if (!isFinite(v)) { nan++; continue; } mn = Math.min(mn, v); mx = Math.max(mx, v); s2 += v * v; } return { min: +mn.toFixed(4), max: +mx.toFixed(4), rms: +Math.sqrt(s2 / (N * N)).toFixed(4), nan }; });
      return { err: gl.getError(), st };
    },
    dispose() {
      outputs.flat().forEach((rt) => rt.dispose());
    },
  };
}

// ---------------------------------------------------------------- the spectrum

// Seeded normal deviates (Box-Muller over a small xorshift).
function rng(seed) {
  let s = (seed * 2654435761) >>> 0 || 1;
  const u = () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return (s + 0.5) / 4294967296; };
  return () => Math.sqrt(-2 * Math.log(u())) * Math.cos(2 * Math.PI * u());
}

function jonswap(w, wp, alpha, gamma) {
  if (w <= 0) return 0;
  const sigma = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) ** 2) / (2 * sigma * sigma * wp * wp));
  return (alpha * G * G / w ** 5) * Math.exp(-1.25 * (wp / w) ** 4) * gamma ** r;
}

// Donelan-Banner directional spreading, normalised over the circle.
function donelanBanner(theta, w, wp) {
  const r = w / wp;
  let b;
  if (r < 0.95) b = 2.61 * Math.max(r, 0.56) ** 1.3;
  else if (r < 1.6) b = 2.28 * r ** -1.3;
  else b = 10 ** (-0.4 + 0.8393 * Math.exp(-0.567 * Math.log(r * r)));
  const x = b * theta;
  const sech = 1 / Math.cosh(x);
  return (b / (2 * Math.tanh(b * Math.PI))) * sech * sech;
}

function buildSpectrum(P) {
  const C = P.cascades.length;
  const W = N * C;
  const data = new Float32Array(W * N * 4);
  const kdata = new Float32Array(W * N * 4);
  const gauss = rng(P.seed);
  // Wind sea (JONSWAP, fetch limited) and swell (a narrow JONSWAP peak).
  const U = P.wind, F = P.fetch;
  const wpW = 22 * Math.cbrt((G * G) / (U * F));
  const alphaW = 0.076 * Math.pow((U * U) / (F * G), 0.22);
  const wpS = (2 * Math.PI) / P.swellPeriod;
  const dirW = (P.windHeading * Math.PI) / 180, dirS = (P.swellHeading * Math.PI) / 180;
  const vW = [Math.sin(dirW), Math.cos(dirW)], vS = [Math.sin(dirS), Math.cos(dirS)];
  const kCut = 2 * Math.PI / 0.03;   // nothing shorter than 3 cm
  // Band edges: cascade c keeps waves at least 8 texels long, the next takes the rest.
  const edge = P.cascades.map((L) => (Math.PI * N) / (4 * L));
  const spreadNorm = (() => { let s = 0; const n = 2000; for (let i = 0; i < n; i++) { const t = -Math.PI + (2 * Math.PI * (i + 0.5)) / n; s += Math.pow(Math.cos(t / 2), 2 * P.swellSpread); } return 1 / (s * (2 * Math.PI / n)); })();

  // Two passes: raw amplitudes per component, then scale each to its significant height.
  const amp = { wind: new Float32Array(W * N * 2), swell: new Float32Array(W * N * 2) };
  let varW = 0, varS = 0;
  const idx = (c, i, j) => j * W + c * N + i;
  const kOf = (L, i) => (2 * Math.PI / L) * (i < N / 2 ? i : i - N);
  for (let c = 0; c < C; c++) {
    const L = P.cascades[c], dk = 2 * Math.PI / L;
    const kLo = c === 0 ? 0 : edge[c - 1], kHi = c === C - 1 ? kCut : edge[c];
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const k = idx(c, i, j);
        const kx = kOf(L, i), ky = kOf(L, j);
        const kl = Math.hypot(kx, ky);
        const w = Math.sqrt(G * kl);
        // Nyquist row and column cannot keep Hermitian symmetry; leave them empty.
        const inBand = i !== N / 2 && j !== N / 2 && kl > 0 && kl >= kLo && kl < kHi;
        kdata[k * 4] = kx; kdata[k * 4 + 1] = ky; kdata[k * 4 + 2] = w; kdata[k * 4 + 3] = inBand ? 1 : 0;
        if (!inBand) continue;
        // S(k, theta) dk^2 = S(w) D(theta) (dw/dk) / k dk^2, deep water dw/dk = g / (2 w).
        const jac = (G / (2 * w)) / kl * dk * dk;
        const dir = [kx / kl, ky / kl];
        const thW = Math.acos(Math.max(-1, Math.min(1, dir[0] * vW[0] + dir[1] * vW[1])));
        const thS = Math.acos(Math.max(-1, Math.min(1, dir[0] * vS[0] + dir[1] * vS[1])));
        // Capillary tail damping below 1.5 cm is handled by kCut; a gentle roll-off before it.
        const damp = Math.exp(-((kl / (kCut * 0.7)) ** 2));
        const pw = jonswap(w, wpW, alphaW, 3.3) * donelanBanner(thW, w, wpW) * jac * damp;
        const ps = jonswap(w, wpS, 1, 7) * Math.pow(Math.cos(thS / 2), 2 * P.swellSpread) * spreadNorm * jac;
        const g1 = gauss(), g2 = gauss();
        const aw = Math.sqrt(pw / 2), as = Math.sqrt(ps / 2);
        amp.wind[k * 2] = g1 * aw; amp.wind[k * 2 + 1] = g2 * aw;
        amp.swell[k * 2] = g1 * as; amp.swell[k * 2 + 1] = g2 * as;
      }
    }
  }
  // Variance of the surface at t = 0 from each component (Parseval), to scale them.
  const hAt = (a, c, i, j) => {
    const k = idx(c, i, j), km = idx(c, (N - i) % N, (N - j) % N);
    return [a[k * 2] + a[km * 2], a[k * 2 + 1] - a[km * 2 + 1]];
  };
  for (let c = 0; c < C; c++) for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const w = hAt(amp.wind, c, i, j), s = hAt(amp.swell, c, i, j);
    varW += w[0] * w[0] + w[1] * w[1];
    varS += s[0] * s[0] + s[1] * s[1];
  }
  const sW = P.windSeaHs / 4 / Math.sqrt(varW || 1), sS = P.swellHs / 4 / Math.sqrt(varS || 1);
  let slopeVar = [0, 0, 0, 0];
  for (let c = 0; c < C; c++) {
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
      const k = idx(c, i, j), km = idx(c, (N - i) % N, (N - j) % N);
      const re = amp.wind[k * 2] * sW + amp.swell[k * 2] * sS, im = amp.wind[k * 2 + 1] * sW + amp.swell[k * 2 + 1] * sS;
      const rem = amp.wind[km * 2] * sW + amp.swell[km * 2] * sS, imm = amp.wind[km * 2 + 1] * sW + amp.swell[km * 2 + 1] * sS;
      data[k * 4] = re; data[k * 4 + 1] = im;
      data[k * 4 + 2] = rem; data[k * 4 + 3] = -imm;   // conj(h0(-k))
      const kl = Math.hypot(kdata[k * 4], kdata[k * 4 + 1]);
      slopeVar[c] += (re * re + im * im + rem * rem + imm * imm) * kl * kl;
    }
  }
  // Slope variance of what lies beyond the last cascade's band edge would go here; the band
  // runs to 3 cm, so the rest is the capillary tail: a small constant.
  const tailSlopeVar = 0.004;
  return { data, kdata, tailSlopeVar,
    stats: { wpWind: wpW, lambdaPeakWind: (2 * Math.PI * G) / (wpW * wpW), alphaW, slopeVar: slopeVar.map((v) => +v.toFixed(4)) } };
}
