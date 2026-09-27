// Foam and churned sand with a memory, over the bay and the headland's coasts.
//
// A heightfield shader can say where a wave is breaking now, but not what the last one left
// behind. So the white water lives in a texture that is stepped forward in time:
//   R  foam cover (1 = solid white; above about 0.3 it is fresh, thick foam, below it lace)
//   G  sand stirred up into the water (the beige clouds in the break)
//   BA how far the foam has been carried since it was made (m, east and north): the shader
//      draws its lace at the position it started from, so the lace stretches into streaks
//      along the backwash and the rips instead of sliding through a fixed pattern
// Each step carries the old values along with the water (semi-Lagrangian), lets them fade,
// and adds new foam where waves break on the sand (the surf in water-shader.js) and where a
// swell crest reaches the foot of the rock (the ocean's swell cascade, so the bursts come
// with the waves you see, in sets). The water moves:
//   up the beach with each bore, back out in the backwash, harder in rip channels,
//   out from the rock after each hit,
//   downwind (the trade wind blows offshore here, so foam streams out to sea),
//   and in slow eddies (the curl of a noise field, so it swirls without bunching up).
//
// Frozen captures replay the last half minute on the first frame, so a still frame has the
// same trails a running page would. Plain WebGL2 passes on three.js's context, like ocean.js.

import * as THREE from 'three';
import { COMMON } from './water-shader.js';

export function createSurfSim(renderer, waterUniforms, opts = {}) {
  const P = {
    N: 1024,
    rect: [-260, -230, 640],   // x0, y0, size (m): the beach, the head, the islet
    foamLife: 18,              // seconds for lace to fade to a third
    thin: 0.42,                // solid foam thins toward lace at this rate (per second; v9 had 0.3,
                               // v10 went back toward v8's 0.45: there was too much white)
    sandLife: 25,
    wind: [-0.17, 0.1],        // surface drift (m/s east, north): about 3% of a 7 m/s wind toward 300 degrees
    eddies: 0.45,              // m/s
    warmup: 30,                // seconds replayed on a jump
    dt: 1 / 15,
    ...opts,
  };
  const N = P.N;
  const gl = renderer.getContext();
  gl.getExtension('EXT_color_buffer_float');

  const targets = [0, 1].map(() => {
    const rt = new THREE.WebGLRenderTarget(N, N, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat,
      minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
      depthBuffer: false, generateMipmaps: false,
    });
    renderer.initRenderTarget(rt);
    return rt;
  });
  const fboOf = (rt) => renderer.properties.get(rt).__webglFramebuffer;
  const texOf = (t) => { if (!renderer.properties.get(t).__webglTexture) renderer.initTexture(t); return renderer.properties.get(t).__webglTexture; };

  const VERT = `#version 300 es
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;
  const STEP = `#version 300 es
  precision highp float;
  #define texture2D texture
  ${COMMON}
  uniform sampler2D uPrev;
  uniform sampler2D uSwell0;    // ocean cascade 0, A: displacement and height
  uniform vec3 uRect;
  uniform float uDt;
  uniform vec2 uWind;
  uniform float uEddies;
  uniform vec3 uLife;           // foam, -, sand
  uniform float uClear;         // 1 on the first step: start from nothing
  uniform float uThin;          // how fast solid foam thins to lace (per second)
  out vec4 oState;

  // Eddies: the curl of a drifting noise field, so the flow swirls without piling up.
  vec2 eddy(vec2 p) {
    vec2 q = p * 0.035 + vec2(uTime * 0.013, -uTime * 0.009);
    float e = 0.4;
    float a = fbm3(q), bx = fbm3(q + vec2(e, 0.0)), by = fbm3(q + vec2(0.0, e));
    vec2 g = vec2(bx - a, by - a) / e;
    // A second, smaller scale for the lace to tear along.
    vec2 q2 = p * 0.13 + vec2(-uTime * 0.02, uTime * 0.017);
    float a2 = vnoise(q2), bx2 = vnoise(q2 + vec2(e, 0.0)), by2 = vnoise(q2 + vec2(0.0, e));
    g += 0.8 * vec2(bx2 - a2, by2 - a2) / e;
    return vec2(g.y, -g.x);
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / ${N}.0;
    vec2 p = uRect.xy + uv * uRect.z;
    vec4 d = dataAt(p);
    vec4 c = coastAt(p);
    Surf sf = surfAt(p, d);
    vec2 off = offshoreAt(p);
    float s = d.g;
    float nearBeach = smoothstep(0.25, 0.85, d.b);

    // How the surface water moves (m/s, map).
    vec2 u = uWind + eddy(p) * uEddies;
    // The bore carries its foam up the beach; between bores the backwash takes it back out,
    // hardest in the rip channels.
    // (The water in a bore moves at about half the speed of its front, so the foam made at
    // the front is left behind it as a trail.)
    u -= off * 1.6 * sf.push;
    float surfZone = smoothstep(uBreakAt * 1.35 + 25.0, uBreakAt * 0.5, s) * nearBeach;
    float rip = smoothstep(0.5, 0.8, vnoise(p * 0.02 + 3.7));
    u += off * (0.3 + 1.1 * rip) * surfZone * (1.0 - sf.push);
    // Off the rock after a hit.
    u += off * 0.55 * smoothstep(18.0, 0.0, c.r) * c.a;
    // On the sand the swash sheet moves it (swash.js): up the beach and back, the same sheet
    // the sea draws.
    Swash sw = Swash(-1e3, 0.0, 0.0, 0.0, 0.0, 60.0, -1e3, -1e3, -1e3, -1e3);
    float onSand = nearBeach * smoothstep(0.5, -0.5, s);
    if (nearBeach > 0.0 && d.r > SW_RUNDOWN - 0.6 && d.r < uRunup * 1.6 + 0.3) {
      sw = swashAt(p, d.r, uTime, uPeriod, 1);
      float covered = smoothstep(0.0, 0.004, sw.film);
      u = mix(u, -off * sw.vel * covered + eddy(p) * 0.15 * covered, onSand);
    }

    vec2 src = p - u * uDt;
    vec2 suv = (src - uRect.xy) / uRect.z;
    vec4 prev = uClear > 0.5 ? vec4(0.0) : texture(uPrev, suv);
    // A little spreading.
    vec2 px = vec2(1.0 / ${N}.0);
    vec4 around = texture(uPrev, suv + vec2(px.x, 0.0)) + texture(uPrev, suv - vec2(px.x, 0.0))
                + texture(uPrev, suv + vec2(0.0, px.y)) + texture(uPrev, suv - vec2(0.0, px.y));
    if (uClear < 0.5) prev = mix(prev, around * 0.25, 0.04);
    float foam = prev.r, sand = prev.g;
    // Carried along: the travel grows by this step's motion, and relaxes slowly (so a patch
    // that has drifted far does not stretch forever).
    vec2 travel = (prev.ba + u * uDt) * exp(-uDt / 25.0);

    // Fading: a solid white patch thins to lace within a few seconds (the big bubbles pop),
    // then the lace lingers and fades slowly. Sand settles.
    foam -= uDt * uThin * max(foam - 0.17, 0.0);
    foam *= exp(-uDt / uLife.x);
    sand *= exp(-uDt / uLife.z);

    // New white water where waves break on the sand...
    float make = sf.fresh * nearBeach;
    // ...and where a swell crest reaches the foot of the rock. The swell is the ocean's own,
    // so the bursts come with the waves, in sets, and are biggest on the exposed rock.
    float swellH = texture(uSwell0, p / uOceanL.x).y;
    // (Exposed rock throws the white water further out: up to 20 m, which also covers the
    // mouth of a notch or an arch whose foot lies deep under the rock.)
    float reach = 3.0 + 17.0 * c.g * c.g + 5.0 * vnoise(p * 0.05);
    float hit = smoothstep(-0.05, 0.4, swellH + 0.35 * (vnoise(p * 0.04 + uTime * 0.05) - 0.5))
              * mix(0.5, 1.2, c.g) * smoothstep(reach, reach * 0.3, c.r) * c.a;
    // And the wash that is always running up and down the foot of the rock.
    float wash = c.a * smoothstep(2.0 + 7.0 * c.g * c.g, 0.0, c.r) * (0.45 + 0.3 * vnoise(p * 0.3 + uTime * 0.3));
    make = max(make, max(hit, wash));
    // The front of each uprush is a band of foam and bubbles, which it leaves behind as it
    // slows; foam left on bare sand drains into it and is gone within a few seconds.
    make = max(make, sw.front * 0.75 * nearBeach);
    float bare = onSand * (1.0 - smoothstep(0.0, 0.003, sw.film));
    foam *= exp(-uDt * bare / 2.5);
    // New foam starts its own pattern where it is made.
    travel *= 1.0 - smoothstep(foam, foam + 0.3, make);
    foam = max(foam, make);
    float depth = max(-d.r, 0.0);
    sand += (sf.fresh + 0.4 * sf.push) * nearBeach * smoothstep(3.5, 0.3, depth) * uDt * 0.35;
    sand = min(sand, 1.0);

    // Nothing lives on dry land (above where the swash reaches).
    float wet = 1.0 - smoothstep(uRunup * 1.5 + 0.1, uRunup * 1.5 + 0.4, d.r);
    oState = vec4(foam * wet, sand * wet, travel);
  }`;

  function program(fs) {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('surf sim shader: ' + gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('surf sim program: ' + gl.getProgramInfoLog(p));
    const u = {};
    const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name; u[name] = gl.getUniformLocation(p, name); }
    return { p, u };
  }
  const prog = program(STEP);
  const vao = gl.createVertexArray();
  const W = waterUniforms;

  let current = 0, lastT = null, first = true;
  function step(t, dt) {
    const next = 1 - current;
    const u = prog.u;
    gl.bindVertexArray(vao);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, fboOf(targets[next]));
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, N, N);
    gl.useProgram(prog.p);
    const tex = [['uPrev', renderer.properties.get(targets[current].texture).__webglTexture],
      ['uData', texOf(W.uData.value)], ['uShoreDir', texOf(W.uShoreDir.value)], ['uCoast', texOf(W.uCoast.value)],
      ['uSwell0', texOf(W.uOceanA.value[0])]];
    tex.forEach(([name, t], i) => { gl.activeTexture(gl.TEXTURE0 + i); gl.bindTexture(gl.TEXTURE_2D, t); gl.uniform1i(u[name], i); });
    const e = W.uExtent.value;
    gl.uniform3f(u.uExtent, e.x, e.y, e.z);
    gl.uniform1f(u.uTime, t);
    gl.uniform1f(u.uPeriod, W.uPeriod.value);
    gl.uniform1f(u.uSwell, W.uSwell.value);
    gl.uniform1f(u.uBreakAt, W.uBreakAt.value);
    gl.uniform1f(u.uRunup, W.uRunup.value);
    gl.uniform1f(u.uSwashT, W.uSwashT.value);
    gl.uniform2f(u.uSwellDir, W.uSwellDir.value.x, W.uSwellDir.value.y);
    const L = W.uOceanL.value;
    gl.uniform4f(u.uOceanL, L.x, L.y, L.z, L.w);
    if (u.uGust) { const g = W.uGust.value; gl.uniform4f(u.uGust, g.x, g.y, g.z, g.w); }
    gl.uniform3f(u.uRect, ...P.rect);
    gl.uniform1f(u.uDt, dt);
    gl.uniform2f(u.uWind, ...P.wind);
    gl.uniform1f(u.uEddies, P.eddies);
    gl.uniform3f(u.uLife, P.foamLife, 0, P.sandLife);
    gl.uniform1f(u.uClear, first ? 1 : 0);
    gl.uniform1f(u.uThin, P.thin);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    first = false;
    current = next;
  }

  const uniforms = {
    uSim: { value: targets[0].texture },
    uSimRect: { value: new THREE.Vector3(...P.rect) },
    uSimOn: { value: 0 },
  };
  return {
    params: P,
    uniforms,
    ready: () => !!(W.uData.value && W.uCoast.value && W.uShoreDir.value),
    // Advance to time t. The ocean has to be at the same time for the rock bursts, so the
    // caller passes a function that moves it (used while replaying).
    update(t, advanceOcean) {
      if (!this.ready()) return;
      if (t === lastT) return;
      const jump = lastT === null || t < lastT || t - lastT > 0.5;
      if (jump) {
        first = true;
        const t0 = t - P.warmup;
        for (let s = t0; s < t - 1e-6; s += P.dt) { advanceOcean(s); step(s, P.dt); }
        advanceOcean(t);
        step(t, P.dt);
      } else {
        const n = Math.max(1, Math.ceil((t - lastT) / P.dt - 1e-6));
        const h = (t - lastT) / n;
        for (let i = 1; i <= n; i++) { if (n > 1) advanceOcean(lastT + h * i); step(lastT + h * i, h); }
      }
      lastT = t;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      renderer.resetState();
      uniforms.uSim.value = targets[current].texture;
      uniforms.uSimOn.value = 1;
    },
    // Invalidate after the terrain changes (the next update replays from scratch).
    reset() { lastT = null; },
  };
}
