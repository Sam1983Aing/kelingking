// The sea: one mesh that follows the camera, with rings spaced exponentially so it is dense
// at your feet on the beach and still reaches the horizon. All the look is in the shader.

import * as THREE from 'three';
import { WATER_VERT, WATER_FRAG } from './water-shader.js';

export function createWater(atmosphereUniforms = {}, gradeUniforms = {}) {
  const params = {
    period: 9,          // seconds between waves
    swell: 1.1,         // wave height at sea (m)
    breakAt: 20,        // where waves break on the beach (m offshore)
    surge: 0.55,        // swash run-up (m)
    swellHeading: 40,   // direction the swell travels, compass degrees
    windHeading: 300,
    chop: 1.0,
    foam: 1.0,
    turbidity: 0.6,
    absorb: [0.36, 0.062, 0.046],   // per metre, red dies first
    scatter: '#134282',
    sandAlbedo: '#eee5d0',
    reefAlbedo: '#2a3a2c',
  };

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
      uWindAngle: { value: 0 },
      uSkyIrr: { value: new THREE.Color(0.5, 0.6, 0.7) },   // sky light on flat ground (klux)
      uAbsorb: { value: new THREE.Vector3() },
      uScatter: { value: new THREE.Color() },
      uSandAlbedo: { value: new THREE.Color() },
      uReefAlbedo: { value: new THREE.Color() },
      uTurbidity: { value: 0.6 },
      uChop: { value: 1 },
      uFoam: { value: 1 },
      uDebug: { value: 0 },
      uGridScale: { value: 1 },
    },
  ]);
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
    const wh = THREE.MathUtils.degToRad(params.windHeading);
    u.uWindAngle.value = Math.atan2(Math.cos(wh), Math.sin(wh));
    u.uChop.value = params.chop;
    u.uFoam.value = params.foam;
    u.uTurbidity.value = params.turbidity;
    u.uAbsorb.value.fromArray(params.absorb);
    u.uScatter.value.set(params.scatter);
    u.uSandAlbedo.value.set(params.sandAlbedo);
    u.uReefAlbedo.value.set(params.reefAlbedo);
  }
  applyParams();

  return {
    mesh,
    uniforms,
    params,
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
