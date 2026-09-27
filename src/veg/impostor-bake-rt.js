// Bakes a grown plant (grow/species.js) into impostor atlases, in the page, at load, on the
// GPU: nothing to download and never out of date with the plant it stands for.
//
// For each of GRID x GRID view directions over the upper hemisphere (impostor-common.js)
// the plant is drawn orthographically into its own frame of two atlases:
//   colour  RGB albedo (stored as its square root), A coverage
//   data    RG the surface normal in plant space (octahedral), B depth along the view
//           (0 = far side of the bounding sphere, 1 = near side), A shade (how deep in the
//           crown: 1 on the outside)
// Empty texels then take the colour of the nearest covered texel in their frame (a jump
// flood), so mip levels do not pull the empty background into the edges of the leaves.

import * as THREE from 'three';
import { hemiOctDecode } from './impostor-common.js';
import { ATLAS_GLSL } from './grow/leaves.js';

const OCT = /* glsl */ `
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 p = n.xz;
  if (n.y < 0.0) p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  return p * 0.5 + 0.5;
}`;

const BAKE_VERT = /* glsl */ `
attribute vec4 aColor;
attribute vec4 aLeaf;
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
varying vec4 vCol;
varying vec4 vLeaf;
void main() {
  vUv = uv; vN = normal; vPos = position; vCol = aColor; vLeaf = aLeaf;
  gl_Position = projectionMatrix * viewMatrix * vec4(position, 1.0);
}`;

const BAKE_FRAG = /* glsl */ `
uniform sampler2D uLeafTex;
uniform vec3 uViewDir;
uniform vec3 uCenter;
uniform float uRadius;
uniform float uMode;     // 0 colour, 1 data
varying vec2 vUv;
varying vec3 vN;
varying vec3 vPos;
varying vec4 vCol;
varying vec4 vLeaf;
${OCT}
${ATLAS_GLSL}
void main() {
  float kind = floor(vLeaf.x * 255.0 + 0.5);
  vec3 c = vCol.rgb;   // square root of the albedo
  if (kind == 1.0) {
    vec4 t = texture2D(uLeafTex, leafAtlasUv(vUv, floor(vLeaf.z * 255.0 + 0.5)), -1.0);
    if (t.a < 0.5) discard;
    c *= sqrt(t.rgb * 2.0);
  }
  if (uMode < 0.5) {
    gl_FragColor = vec4(c, 1.0);
  } else {
    vec3 n = normalize(vN);
    if (dot(n, uViewDir) < 0.0) n = -n;          // two-sided: face the viewer
    float depth = clamp(dot(vPos - uCenter, uViewDir) / uRadius * 0.5 + 0.5, 0.0, 1.0);
    gl_FragColor = vec4(octEncode(n), depth, max(vLeaf.y, 1.0 / 255.0));
  }
}`;

// Jump flood: each texel ends up holding the coordinates of the nearest covered texel in its
// own frame.
const QUAD_VERT = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';
const SEED_FRAG = /* glsl */ `
uniform sampler2D uColor;
uniform vec2 uSize;
varying vec2 vUv;
void main() {
  float a = texture2D(uColor, vUv).a;
  gl_FragColor = a > 0.0 ? vec4(floor(vUv * uSize), 0.0, 1.0) : vec4(-1.0, -1.0, 0.0, 1.0);
}`;
const JFA_FRAG = /* glsl */ `
uniform sampler2D uSeeds;
uniform vec2 uSize;
uniform float uStep;
uniform float uFrame;
varying vec2 vUv;
void main() {
  vec2 px = floor(vUv * uSize);
  vec2 cell = floor(px / uFrame);
  vec2 best = texture2D(uSeeds, vUv).xy;
  float bd = best.x < 0.0 ? 1e9 : dot(best - px, best - px);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 q = px + vec2(float(i), float(j)) * uStep;
    if (any(lessThan(q, cell * uFrame)) || any(greaterThanEqual(q, (cell + 1.0) * uFrame))) continue;
    vec2 s = texture2D(uSeeds, (q + 0.5) / uSize).xy;
    if (s.x < 0.0) continue;
    float d = dot(s - px, s - px);
    if (d < bd) { bd = d; best = s; }
  }
  gl_FragColor = vec4(best, 0.0, 1.0);
}`;
const FILL_FRAG = /* glsl */ `
uniform sampler2D uSrc;
uniform sampler2D uSeeds;
uniform sampler2D uCover;
uniform vec2 uSize;
uniform float uIsColor;
varying vec2 vUv;
void main() {
  vec4 own = texture2D(uSrc, vUv);
  float cover = texture2D(uCover, vUv).a;
  vec2 s = texture2D(uSeeds, vUv).xy;
  vec4 near = s.x < 0.0 ? own : texture2D(uSrc, (s + 0.5) / uSize);
  // Covered texels keep their own values; empty ones take the nearest covered one's, with
  // no coverage (colour) or its shade (data).
  vec4 v = cover > 0.0 ? own : near;
  if (uIsColor > 0.5) v.a = cover;
  gl_FragColor = v;
}`;

export function bakeImpostor(renderer, geometry, leafTex, { grid = 8, frame = 128 } = {}) {
  const size = grid * frame;
  const bs = geometry.boundingSphere ?? (geometry.computeBoundingSphere(), geometry.boundingSphere);
  const center = bs.center.clone(), R = bs.radius;

  const uniforms = {
    uLeafTex: { value: leafTex },
    uViewDir: { value: new THREE.Vector3() },
    uCenter: { value: center },
    uRadius: { value: R },
    uMode: { value: 0 },
  };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: BAKE_VERT, fragmentShader: BAKE_FRAG, side: THREE.DoubleSide });
  const mesh = new THREE.Mesh(geometry, mat);
  mesh.frustumCulled = false;
  const scene = new THREE.Scene();
  scene.add(mesh);
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, R * 4);

  const make = (opts) => new THREE.WebGLRenderTarget(size, size, { depthBuffer: true, ...opts });
  const rtColor = make({ samples: 4 });
  const rtData = make({ samples: 0, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

  const prev = { target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    toneMapping: renderer.toneMapping, autoClear: renderer.autoClear };
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.autoClear = false;

  const renderAll = (rt, mode) => {
    uniforms.uMode.value = mode;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    rt.scissorTest = true;
    for (let j = 0; j < grid; j++) for (let i = 0; i < grid; i++) {
      const d = new THREE.Vector3(...hemiOctDecode(i / (grid - 1), j / (grid - 1)));
      cam.position.copy(center).addScaledVector(d, R * 2);
      // Same camera basis the runtime rebuilds: world up, or north for straight down.
      cam.up.set(0, 1, 0);
      if (Math.abs(d.y) > 0.999) cam.up.set(0, 0, -1);
      cam.lookAt(center);
      cam.updateMatrixWorld();
      cam.updateProjectionMatrix();
      uniforms.uViewDir.value.copy(d);
      // three.js reads a target's viewport when the target is bound, so bind per frame.
      rt.viewport.set(i * frame, j * frame, frame, frame);
      rt.scissor.set(i * frame, j * frame, frame, frame);
      renderer.setRenderTarget(rt);
      renderer.render(scene, cam);
    }
    rt.scissorTest = false;
  };
  renderAll(rtColor, 0);
  renderAll(rtData, 1);

  // Jump flood over the colour's coverage.
  const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2));
  quad.frustumCulled = false;
  const qScene = new THREE.Scene();
  qScene.add(quad);
  const qCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const seedsOpts = { type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, depthBuffer: false };
  let A = new THREE.WebGLRenderTarget(size, size, seedsOpts), B = new THREE.WebGLRenderTarget(size, size, seedsOpts);
  const vSize = new THREE.Vector2(size, size);
  const pass = (material, target) => {
    quad.material = material;
    renderer.setRenderTarget(target);
    renderer.render(qScene, qCam);
  };
  const qmat = (frag, u) => new THREE.ShaderMaterial({ uniforms: u, vertexShader: QUAD_VERT, fragmentShader: frag, depthTest: false, depthWrite: false });
  pass(qmat(SEED_FRAG, { uColor: { value: rtColor.texture }, uSize: { value: vSize } }), A);
  const jfa = qmat(JFA_FRAG, { uSeeds: { value: null }, uSize: { value: vSize }, uStep: { value: 0 }, uFrame: { value: frame } });
  for (let step = frame / 2; step >= 1; step /= 2) {
    jfa.uniforms.uSeeds.value = A.texture;
    jfa.uniforms.uStep.value = step;
    pass(jfa, B);
    [A, B] = [B, A];
  }
  // Fill into the final atlases, with mip levels.
  const out = (src, isColor) => {
    const rt = new THREE.WebGLRenderTarget(size, size, {
      depthBuffer: false, generateMipmaps: true, minFilter: THREE.LinearMipmapLinearFilter, magFilter: THREE.LinearFilter,
    });
    rt.texture.anisotropy = 4;
    pass(qmat(FILL_FRAG, { uSrc: { value: src }, uSeeds: { value: A.texture }, uCover: { value: rtColor.texture }, uSize: { value: vSize }, uIsColor: { value: isColor ? 1 : 0 } }), rt);
    return rt;
  };
  const color = out(rtColor.texture, true);
  const data = out(rtData.texture, false);

  renderer.setRenderTarget(prev.target);
  renderer.setClearColor(prev.clear, prev.alpha);
  renderer.toneMapping = prev.toneMapping;
  renderer.autoClear = prev.autoClear;
  for (const t of [rtColor, rtData, A, B]) t.dispose();
  mat.dispose();

  return { color: color.texture, data: data.texture, center: center.toArray(), radius: R, grid, frame, targets: [color, data] };
}
