// Bakes a plant scan into impostor atlases. Runs in the page tools/bake-impostors.html,
// driven by tools/bake-impostors.mjs.
//
// For each of GRID x GRID view directions over the upper hemisphere (impostor-common.js)
// the plant is rendered orthographically into its own frame of two atlases:
//   colour: RGB albedo (sRGB, unlit), A coverage
//   normal: RG the surface normal in the plant's own space (octahedral), B depth along the
//           view (0 = far side of the bounding sphere, 1 = near side), A canopy shading
//           (how deep inside the crown a point is, which is what makes a tree read as a
//           volume and not a flat cut-out)

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { IMPOSTOR, hemiOctDecode } from './impostor-common.js';

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
renderer.setPixelRatio(1);
renderer.setSize(64, 64);
document.body.append(renderer.domElement);

const OCT = /* glsl */ `
vec2 octEncode(vec3 n) {
  n /= abs(n.x) + abs(n.y) + abs(n.z);
  vec2 p = n.xz;
  if (n.y < 0.0) p = (1.0 - abs(p.yx)) * vec2(p.x >= 0.0 ? 1.0 : -1.0, p.y >= 0.0 ? 1.0 : -1.0);
  return p * 0.5 + 0.5;
}`;

function colorMaterial(src) {
  const map = src.map ?? null;
  if (map) map.colorSpace = THREE.NoColorSpace;   // keep the file's sRGB values as they are
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: { uMap: { value: map }, uColor: { value: src.color ?? new THREE.Color(1, 1, 1) }, uHasMap: { value: map ? 1 : 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D uMap; uniform vec3 uColor; uniform float uHasMap; varying vec2 vUv;
      void main(){ vec4 c = uHasMap > 0.5 ? texture2D(uMap, vUv) : vec4(uColor, 1.0); if (c.a < 0.5) discard; gl_FragColor = vec4(c.rgb, 1.0); }`,
  });
}

function dataMaterial(src, frame) {
  const map = src.map ?? null;
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    uniforms: frame.uniforms,
    defines: map ? { HAS_MAP: 1 } : {},
    vertexShader: `varying vec3 vN; varying vec3 vPos; varying vec2 vUv;
      void main(){ vUv = uv; vN = normalize(mat3(modelMatrix) * normal); vPos = (modelMatrix * vec4(position, 1.0)).xyz;
        gl_Position = projectionMatrix * viewMatrix * vec4(vPos, 1.0); }`,
    fragmentShader: `${OCT}
      uniform vec3 uViewDir; uniform vec3 uCenter; uniform float uRadius; uniform vec3 uCanopyC; uniform vec3 uCanopyR; uniform sampler2D uMap;
      varying vec3 vN; varying vec3 vPos; varying vec2 vUv;
      void main(){
        #ifdef HAS_MAP
        if (texture2D(uMap, vUv).a < 0.5) discard;
        #endif
        vec3 n = normalize(vN);
        if (dot(n, uViewDir) < 0.0) n = -n;          // leaves are two-sided: face the viewer
        float depth = clamp(dot(vPos - uCenter, uViewDir) / uRadius * 0.5 + 0.5, 0.0, 1.0);
        float r = length((vPos - uCanopyC) / uCanopyR);
        float shade = mix(0.28, 1.0, smoothstep(0.3, 1.0, r));
        shade *= mix(0.75, 1.0, smoothstep(uCanopyC.y - uCanopyR.y, uCanopyC.y + 0.5 * uCanopyR.y, vPos.y));
        gl_FragColor = vec4(octEncode(n), depth, shade);
      }`,
  });
}

// Push colour out from covered pixels into empty ones, frame by frame, so mipmapping does
// not pull the black background into the edges of the leaves.
function dilate(px, size, frame, passes) {
  const covered = new Uint8Array(size * size);
  for (let k = 0; k < size * size; k++) covered[k] = px[k * 4 + 3] > 0 ? 1 : 0;
  for (let p = 0; p < passes; p++) {
    const next = covered.slice();
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const k = y * size + x;
        if (covered[k]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= size || yy >= size) continue;
          if (((xx / frame) | 0) !== ((x / frame) | 0) || ((yy / frame) | 0) !== ((y / frame) | 0)) continue;
          const q = yy * size + xx;
          if (!covered[q]) continue;
          r += px[q * 4]; g += px[q * 4 + 1]; b += px[q * 4 + 2]; n++;
        }
        if (n) {
          px[k * 4] = r / n; px[k * 4 + 1] = g / n; px[k * 4 + 2] = b / n; px[k * 4 + 3] = 0;
          next[k] = 1;
        }
      }
    }
    covered.set(next);
  }
}

const b64 = (u8) => {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
};

window.bake = async (id) => {
  const { grid: G, frame: F } = IMPOSTOR;
  const size = G * F;
  const gltf = await new GLTFLoader().loadAsync(`../assets-src/polyhaven/${id}/${id}.gltf`);
  const root = gltf.scene;
  root.updateMatrixWorld(true);

  // Bounds: the whole plant, and the crown (the biggest mesh part by triangles, the leaves).
  const box = new THREE.Box3().setFromObject(root);
  const sphere = box.getBoundingSphere(new THREE.Sphere());
  let crown = null, most = 0;
  root.traverse((o) => {
    if (!o.isMesh) return;
    const tris = (o.geometry.index ? o.geometry.index.count : o.geometry.attributes.position.count) / 3;
    if (tris > most) { most = tris; crown = new THREE.Box3().setFromObject(o); }
  });
  const canopyC = crown.getCenter(new THREE.Vector3());
  const canopyR = crown.getSize(new THREE.Vector3()).multiplyScalar(0.5);

  const uniforms = {
    uViewDir: { value: new THREE.Vector3() }, uCenter: { value: sphere.center.clone() }, uRadius: { value: sphere.radius },
    uCanopyC: { value: canopyC }, uCanopyR: { value: canopyR }, uMap: { value: null },
  };
  const colorMats = new Map(), dataMats = new Map();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (const m of mats) {
      if (!colorMats.has(m)) {
        colorMats.set(m, colorMaterial(m));
        const dm = dataMaterial(m, { uniforms: { ...uniforms, uMap: { value: m.map ?? null } } });
        dataMats.set(m, dm);
      }
    }
  });
  const originals = new Map();
  root.traverse((o) => { if (o.isMesh) originals.set(o, o.material); });
  const useMats = (which) => root.traverse((o) => {
    if (!o.isMesh) return;
    const src = originals.get(o);
    o.material = Array.isArray(src) ? src.map((m) => which.get(m)) : which.get(src);
  });

  const scene = new THREE.Scene();
  scene.add(root);
  const R = sphere.radius;
  const cam = new THREE.OrthographicCamera(-R, R, R, -R, 0.01, R * 4);
  const target = new THREE.WebGLRenderTarget(size, size, { samples: 4, depthBuffer: true });
  const targetData = new THREE.WebGLRenderTarget(size, size, { samples: 0, depthBuffer: true });

  const renderAll = (rt, mats) => {
    useMats(mats);
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    rt.scissorTest = true;
    for (let j = 0; j < G; j++) {
      for (let i = 0; i < G; i++) {
        const d = new THREE.Vector3(...hemiOctDecode(i / (G - 1), j / (G - 1)));
        cam.position.copy(sphere.center).addScaledVector(d, R * 2);
        // Same camera basis the runtime rebuilds: world up, or north for straight down.
        cam.up.set(0, 1, 0);
        if (Math.abs(d.y) > 0.999) cam.up.set(0, 0, -1);
        cam.lookAt(sphere.center);
        cam.updateMatrixWorld();
        for (const m of dataMats.values()) m.uniforms.uViewDir.value.copy(d);
        // three.js reads a target's viewport when the target is bound, so bind per frame.
        rt.viewport.set(i * F, j * F, F, F);
        rt.scissor.set(i * F, j * F, F, F);
        renderer.setRenderTarget(rt);
        renderer.render(scene, cam);
      }
    }
    rt.scissorTest = false;
    const px = new Uint8Array(size * size * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    renderer.setRenderTarget(null);
    return px;
  };

  const color = renderAll(target, colorMats);
  const data = renderAll(targetData, dataMats);
  // Coverage from the anti-aliased colour pass. The data pass has no alpha of its own, so
  // mark its empty pixels from colour coverage before dilating.
  for (let k = 0; k < size * size; k++) if (color[k * 4 + 3] === 0) data[k * 4 + 3] = 0; else if (data[k * 4 + 3] === 0) data[k * 4 + 3] = 1;
  dilate(color, size, F, 12);
  dilate(data, size, F, 12);

  // Rows come back bottom-up from WebGL. Flip so row 0 is the top, like an image file.
  const flip = (px) => {
    const row = size * 4, out = new Uint8Array(px.length);
    for (let y = 0; y < size; y++) out.set(px.subarray((size - 1 - y) * row, (size - y) * row), y * row);
    return out;
  };

  return {
    size, grid: G, frame: F,
    radius: R, center: sphere.center.toArray(),
    base: [sphere.center.x, box.min.y, sphere.center.z],
    height: box.max.y - box.min.y,
    color: b64(flip(color)), data: b64(flip(data)),
  };
};
window.bakeReady = true;
