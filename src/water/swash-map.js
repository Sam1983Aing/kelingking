// The swash, worked out once per frame into a map over the beach (swash.js has the model).
// Working it out per vertex in the ground and the sea cost more than a millisecond at the
// beach: the ground's vertex shader runs for every vertex of the island, and carrying the
// swash made all of them slower, not only the few on the wet sand. A 1024 square map over the
// beach is 27 cm a texel, and the values in it change smoothly (the edge of a sheet is where
// a linear height crosses zero), so reading it back bilinearly draws the same edge.
//
//   R  how far above this spot the highest running sheet's edge is (m; negative: dry)
//   G  the same for the sheets running up (their foamy front)
//   B  the water's thickness where it is covered (m), or minus the seconds since the water
//      left (where it is not): the two are never both there
//   A  how fast the water moves up the beach (m/s, negative in the backwash)
//
// Plain WebGL2 on three.js's context, like surf-sim.js.

import * as THREE from 'three';
import { COMMON } from './water-shader.js';

export function createSwashMap(renderer, waterUniforms, opts = {}) {
  const P = {
    N: 1024,
    rect: [70, 60, 280],   // x0, y0, size (m): Kelingking beach and the little one east of the neck
    ...opts,
  };
  const N = P.N;
  const gl = renderer.getContext();
  gl.getExtension('EXT_color_buffer_float');
  const target = new THREE.WebGLRenderTarget(N, N, {
    type: THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
    wrapS: THREE.ClampToEdgeWrapping, wrapT: THREE.ClampToEdgeWrapping,
    depthBuffer: false, generateMipmaps: false,
  });
  renderer.initRenderTarget(target);
  const fbo = () => renderer.properties.get(target).__webglFramebuffer;
  const texOf = (t) => { if (!renderer.properties.get(t).__webglTexture) renderer.initTexture(t); return renderer.properties.get(t).__webglTexture; };

  const VERT = `#version 300 es
  void main() {
    vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
    gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
  }`;
  const FRAG = `#version 300 es
  precision highp float;
  #define texture2D texture
  ${COMMON}
  uniform vec3 uRect;
  out vec4 oSwash;
  void main() {
    vec2 p = uRect.xy + gl_FragCoord.xy / ${N}.0 * uRect.z;
    vec4 d = dataAt(p);
    oSwash = vec4(-1.0, -1.0, -60.0, 0.0);
    if (d.b < 0.25 || d.r < SW_RUNDOWN - 0.3 || d.r > uRunup * 1.6 + 0.3) return;
    Swash sw = swashAt(p, d.r, uTime, uPeriod, 2);
    oSwash = vec4(sw.edgeZ, sw.frontZ, sw.film > 0.0 ? sw.film : -sw.dry, sw.vel);
  }`;
  const prog = gl.createProgram();
  for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, FRAG]]) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error('swash map shader: ' + gl.getShaderInfoLog(s));
    gl.attachShader(prog, s);
  }
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error('swash map program: ' + gl.getProgramInfoLog(prog));
  const u = {};
  const n = gl.getProgramParameter(prog, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(prog, i).name; u[name] = gl.getUniformLocation(prog, name); }
  const vao = gl.createVertexArray();
  const W = waterUniforms;

  const uniforms = {
    uSwashMap: { value: target.texture },
    uSwashRect: { value: new THREE.Vector3(...P.rect) },
  };
  let lastT = null;
  return {
    params: P,
    uniforms,
    update(t) {
      if (!W.uData.value || t === lastT) return;
      lastT = t;
      gl.bindVertexArray(vao);
      gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE); gl.disable(gl.SCISSOR_TEST);
      gl.colorMask(true, true, true, true);
      gl.bindFramebuffer(gl.FRAMEBUFFER, fbo());
      gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, N, N);
      gl.useProgram(prog);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, texOf(W.uData.value));
      gl.uniform1i(u.uData, 0);
      const e = W.uExtent.value;
      gl.uniform3f(u.uExtent, e.x, e.y, e.z);
      gl.uniform1f(u.uTime, t);
      gl.uniform1f(u.uPeriod, W.uPeriod.value);
      gl.uniform1f(u.uRunup, W.uRunup.value);
      gl.uniform1f(u.uSwashT, W.uSwashT.value);
      gl.uniform3f(u.uRect, ...P.rect);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      renderer.resetState();
    },
    reset() { lastT = null; },
  };
}
