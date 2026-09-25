// The sea: one mesh that follows the camera, with rings spaced exponentially so it is dense
// at your feet on the beach and still reaches the horizon. All the look is in the shader.

import * as THREE from 'three';
import { WATER_VERT, WATER_FRAG } from './water-shader.js';
import { createOcean } from './ocean.js';

export function createWater(renderer, atmosphereUniforms = {}, gradeUniforms = {}, oceanOpts = {}) {
  const params = {
    period: 9,          // seconds between waves
    swell: 1.1,         // wave height at sea (m)
    breakAt: 20,        // where waves break on the beach (m offshore)
    surge: 0.55,        // swash run-up (m)
    swellHeading: 40,   // direction the swell travels, compass degrees
    foam: 1.0,
    whitecaps: 1.0,
    turbidity: 0.6,
    murk: 1.0,
    // Water optics per metre, roughly pure sea water at 610, 550 and 465 nm plus a little
    // plankton: red is gone within a few metres, blue carries.
    absorb: [0.30, 0.075, 0.065],
    backscatter: [0.004, 0.005, 0.012],
    gordonF: 0.33,
    // Suspended sand, per unit: backscatters (0.15 makes the milky turquoise of the plumes in
    // the drone photo), and the coarse sand in the surf absorbs a little blue.
    sedAbsorb: [0.02, 0.04, 0.08],
    sedBack: 0.1,
    sandAlbedo: '#a6a293',
    reefAlbedo: '#2a3a2c',
    // Gusts: patch size (m), drift (m/s east, north), strength 0..1.
    gustSize: 380, gustDrift: [-3, 1.5], gust: 0.8,
    reflLift: 1.2, reflCut: 0.6,
  };
  const ocean = createOcean(renderer, oceanOpts);

  const uniforms = THREE.UniformsUtils.merge([
    {
      uData: { value: null },
      uShoreDir: { value: null },
      uSunShadow: { value: null },
      uExtent: { value: new THREE.Vector3(-700, -700, 1600) },
      uTime: { value: 0 },
      uPeriod: { value: 9 },
      uSwell: { value: 0.9 },
      uBreakAt: { value: 16 },
      uSurge: { value: 0.5 },
      uSwellDir: { value: new THREE.Vector2(0.64, 0.77) },
      uSkyIrr: { value: new THREE.Color(0.5, 0.6, 0.7) },   // sky light on flat ground (klux)
      uAbsorb: { value: new THREE.Vector3() },
      uBackscatter: { value: new THREE.Vector3() },
      uSedAbsorb: { value: new THREE.Vector3() },
      uSedBack: { value: 0.05 },
      uGordonF: { value: 0.33 },
      uSandAlbedo: { value: new THREE.Color() },
      uReefAlbedo: { value: new THREE.Color() },
      uTurbidity: { value: 0.6 },
      uMurk: { value: 1 },
      uWhitecaps: { value: 1 },
      uFoam: { value: 1 },
      uGust: { value: new THREE.Vector4() },
      uReflLift: { value: 0.8 },
      uReflCut: { value: 0.4 },
      uDebug: { value: 0 },
      uGridScale: { value: 1 },
      uGridK: { value: 0.0076 },
    },
  ]);
  // The ocean's textures are swapped every update, so share its uniform objects.
  Object.assign(uniforms, ocean.uniforms);
  // The sun, the sky and the haze come from the atmosphere (src/sky/), shared, not copied.
  Object.assign(uniforms, atmosphereUniforms, gradeUniforms);

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
  });

  // Dense grid for eye level, lighter one once the camera is up in the air.
  const dense = radialGrid(960, 960, 0.8, 14000, 150, 0.72);
  const light = radialGrid(640, 720, 0.8, 14000, 150, 0.6);
  const mesh = new THREE.Mesh(dense, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;

  function applyParams() {
    const u = uniforms;
    u.uPeriod.value = params.period;
    u.uSwell.value = params.swell;
    u.uBreakAt.value = params.breakAt;
    u.uSurge.value = params.surge;
    const sh = THREE.MathUtils.degToRad(params.swellHeading);
    u.uSwellDir.value.set(Math.sin(sh), Math.cos(sh));
    u.uFoam.value = params.foam;
    u.uWhitecaps.value = params.whitecaps;
    u.uTurbidity.value = params.turbidity;
    u.uMurk.value = params.murk;
    u.uAbsorb.value.fromArray(params.absorb);
    u.uBackscatter.value.fromArray(params.backscatter);
    u.uSedAbsorb.value.fromArray(params.sedAbsorb);
    u.uSedBack.value = params.sedBack;
    u.uGordonF.value = params.gordonF;
    u.uReflLift.value = params.reflLift;
    u.uReflCut.value = params.reflCut;
    u.uGust.value.set(1 / params.gustSize, params.gustDrift[0], params.gustDrift[1], params.gust);
    u.uSandAlbedo.value.set(params.sandAlbedo);
    u.uReefAlbedo.value.set(params.reefAlbedo);
  }
  applyParams();

  return {
    mesh,
    uniforms,
    params,
    ocean,
    applyParams,
    setData(texture, shoreDir, extent) {
      uniforms.uData.value = texture;
      uniforms.uShoreDir.value = shoreDir;
      uniforms.uExtent.value.set(extent.x0, extent.y0, extent.size);
    },
    update(time, camera) {
      uniforms.uTime.value = time;
      // Keep the rings about as dense on screen from 1 km up as from the beach.
      const h = Math.max(camera.position.y, 1);
      uniforms.uGridScale.value = Math.max(1, h / 12);
      mesh.geometry = h > 40 ? light : dense;
      // Vertex spacing per metre from the camera, near the camera (radial and around).
      uniforms.uGridK.value = h > 40 ? 0.0138 : 0.0076;
      ocean.update(time);
    },
  };
}

// Polar grid centred on the origin (the shader adds the camera position). Rings are spaced
// exponentially, with a share `nearShare` of them packed inside `rMid`, where close-up
// waves need the detail, and the rest spread out to the horizon.
function radialGrid(rings, segments, rMin, rMax, rMid, nearShare) {
  const pos = new Float32Array((rings + 1) * segments * 3);
  const nNear = Math.round((rings - 1) * nearShare);
  const radius = (i) => {
    if (i === 0) return 0;
    const k = i - 1;
    if (k <= nNear) return rMin * Math.pow(rMid / rMin, k / nNear);
    return rMid * Math.pow(rMax / rMid, (k - nNear) / (rings - 1 - nNear));
  };
  for (let i = 0; i <= rings; i++) {
    const r = radius(i);
    for (let j = 0; j < segments; j++) {
      const a = (j / segments) * Math.PI * 2;
      const k = (i * segments + j) * 3;
      pos[k] = r * Math.cos(a);
      pos[k + 2] = r * Math.sin(a);
    }
  }
  const idx = new Uint32Array(rings * segments * 6);
  let n = 0;
  for (let i = 0; i < rings; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * segments + j;
      const b = i * segments + ((j + 1) % segments);
      const c = a + segments;
      const d = b + segments;
      idx[n++] = a; idx[n++] = b; idx[n++] = c;
      idx[n++] = b; idx[n++] = d; idx[n++] = c;
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(new THREE.BufferAttribute(idx, 1));
  return g;
}
