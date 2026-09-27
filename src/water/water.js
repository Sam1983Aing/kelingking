// The sea: one mesh that follows the camera, with rings spaced exponentially so it is dense
// at your feet on the beach and still reaches the horizon. All the look is in the shader.

import * as THREE from 'three';
import { WATER_VERT, WATER_FRAG } from './water-shader.js';
import { createOcean } from './ocean.js';
import { createSurfSim } from './surf-sim.js';
import { createSwashMap } from './swash-map.js';
import { createBreaker } from './breaker.js';
import { createSpray } from './spray.js';

export function createWater(renderer, atmosphereUniforms = {}, gradeUniforms = {}, oceanOpts = {}, simOpts = {}) {
  const params = {
    period: 9,          // seconds between waves
    swell: 1.1,         // wave height at sea (m)
    breakAt: 20,        // where waves break on the beach (m offshore)
    runup: 0.85,        // how high an average wave's swash runs up the sand (m above still water)
    swashT: 2.6,        // seconds its uprush takes (the backwash takes 1.8 times as long)
    swellHeading: 40,   // direction the swell travels, compass degrees
    foam: 1.0,
    whitecaps: 1.0,
    turbidity: 1.0,
    murk: 1.0,
    // Water optics per metre, roughly pure sea water at 610, 550 and 465 nm plus a little
    // plankton: red is gone within a few metres, blue carries.
    absorb: [0.30, 0.06, 0.04],
    backscatter: [0.004, 0.0045, 0.0085],
    gordonF: 0.3,
    // Suspended sand, per unit: backscatters (0.15 makes the milky turquoise of the plumes in
    // the drone photo), and the coarse sand in the surf absorbs a little blue.
    sedAbsorb: [0.02, 0.04, 0.08],
    sedBack: 0.1,
    sandAlbedo: '#8f9894',
    reefAlbedo: '#2a3a2c',
    // Gusts: patch size (m), drift (m/s east, north), strength 0..1.
    gustSize: 380, gustDrift: [-3, 1.5], gust: 0.8,
    reflSpread: 0.7, waveMask: 0.5,
  };
  const ocean = createOcean(renderer, oceanOpts);

  const uniforms = THREE.UniformsUtils.merge([
    {
      uData: { value: null },
      uShoreDir: { value: null },
      uCoast: { value: null },
      uSunShadow: { value: null },
      uExtent: { value: new THREE.Vector3(-700, -700, 1600) },
      uTime: { value: 0 },
      uPeriod: { value: 9 },
      uSwell: { value: 0.9 },
      uBreakAt: { value: 16 },
      uRunup: { value: 0.85 },
      uSwashT: { value: 2.6 },
      uWetSandAlb: { value: new THREE.Color(0.3, 0.26, 0.2) },
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
      uReflSpread: { value: 1 },
      uWaveMask: { value: 0.35 },
      uDebug: { value: 0 },
      uGridScale: { value: 1 },
      uGridK: { value: 0.0076 },
      uGridRot: { value: new THREE.Vector2(1, 0) },
      uBreakerOn: { value: 0 },
    },
  ]);
  // The ocean's textures are swapped every update, so share its uniform objects.
  Object.assign(uniforms, ocean.uniforms);
  // The sea's vertex shader takes only the three coarse displacement cascades (see uOceanV).
  const ov = [];
  uniforms.uOceanV = { get value() { const a = ocean.uniforms.uOceanA.value; for (let i = 0; i < 3; i++) ov[i] = a[i]; ov.length = 3; return ov; } };
  const sim = createSurfSim(renderer, uniforms, simOpts);
  Object.assign(uniforms, sim.uniforms);
  const swashMap = createSwashMap(renderer, uniforms);
  Object.assign(uniforms, swashMap.uniforms);
  // The sun, the sky and the haze come from the atmosphere (src/sky/), shared, not copied.
  Object.assign(uniforms, atmosphereUniforms, gradeUniforms);

  const material = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: WATER_VERT,
    fragmentShader: WATER_FRAG,
    transparent: true,
  });

  // Dense grid for eye level, lighter one once the camera is up in the air. (v4: 480 rings
  // near the camera instead of 960. The vertices do more work now, and side by side at the
  // shore break the two could not be told apart.)
  const dense = radialGrid(480, 960, 0.8, 14000, 150, 0.72);
  const light = radialGrid(640, 720, 0.8, 14000, 150, 0.6);
  const mesh = new THREE.Mesh(dense, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = 1;
  // The breaking lip on the beaches (its own mesh; the sea tucks its breaking crests under it).
  const breaker = createBreaker(renderer, uniforms);
  mesh.add(breaker.mesh);
  // Spray off the breakers and bursts of white water at the rock.
  const spray = createSpray(uniforms);
  mesh.add(spray.points);

  function applyParams() {
    const u = uniforms;
    u.uPeriod.value = params.period;
    u.uSwell.value = params.swell;
    u.uBreakAt.value = params.breakAt;
    u.uRunup.value = params.runup;
    u.uSwashT.value = params.swashT;
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
    u.uReflSpread.value = params.reflSpread;
    u.uWaveMask.value = params.waveMask;
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
    sim,
    swashMap,
    breaker,
    spray,
    applyParams,
    setBreakers(lines, rockSites) {
      const r = breaker.setLines(lines);
      spray.setBeach(r.cols);
      if (rockSites) spray.setRock(rockSites);
      uniforms.uBreakerOn.value = r.columns > 0 ? 1 : 0;
      return r;
    },
    setData(texture, shoreDir, extent, coast) {
      uniforms.uData.value = texture;
      uniforms.uShoreDir.value = shoreDir;
      uniforms.uCoast.value = coast;
      uniforms.uExtent.value.set(extent.x0, extent.y0, extent.size);
      sim.reset();
      swashMap.reset();
    },
    update(time, camera, renderer) {
      uniforms.uTime.value = time;
      if (renderer) spray.update(camera, renderer);
      // Keep the rings about as dense on screen from 1 km up as from the beach.
      const h = Math.max(camera.position.y, 1);
      uniforms.uGridScale.value = Math.max(1, h / 12);
      mesh.geometry = h > 40 ? light : dense;
      // Only the wedge of the rings the camera can see (the vertex shader is not cheap and
      // runs for every vertex, seen or not). The grid is turned so its middle segment faces
      // the way the camera looks, and drawn from there out to both sides.
      const g = mesh.geometry, segs = g.userData.segments, per = g.userData.perSegment;
      const fwd = camera.getWorldDirection(tmpV);
      const yaw = Math.atan2(fwd.z, fwd.x);
      const a = yaw - Math.PI;   // segment 0 at a, so segment segs/2 faces the camera's heading
      uniforms.uGridRot.value.set(Math.cos(a), Math.sin(a));
      const pitch = Math.asin(THREE.MathUtils.clamp(fwd.y, -1, 1));
      const vHalf = THREE.MathUtils.degToRad(camera.fov) / 2;
      const hHalf = Math.atan(Math.tan(vHalf) * camera.aspect);
      // A ray at the frame's edge reaches out horizontally by cos(pitch) - tan(vHalf)|sin(pitch)|
      // for each unit it goes sideways by tan(hHalf); where that reach runs out the camera
      // sees straight down and needs the whole ring.
      const reach = Math.cos(pitch) - Math.tan(vHalf) * Math.abs(Math.sin(pitch));
      const half = reach > 0.08 ? Math.min(Math.PI, Math.atan(Math.tan(hHalf) / reach) + 0.2) : Math.PI;
      const n = Math.min(segs, Math.ceil((half / Math.PI) * segs / 2) * 2 + 4);
      const s0 = Math.max(0, Math.floor(segs / 2 - n / 2));
      g.setDrawRange(s0 * per, Math.min(n, segs - s0) * per);
      // Vertex spacing per metre from the camera, near the camera (radial and around).
      uniforms.uGridK.value = h > 40 ? 0.0138 : 0.0152;
      // The foam simulation moves the ocean along with it (the rock bursts follow the swell).
      sim.update(time, (t) => ocean.update(t));
      swashMap.update(time);
      ocean.update(time);
      breaker.update(time);
      breaker.sortChunks(camera);
    },
  };
}

const tmpV = new THREE.Vector3();

// Polar grid centred on the origin (the shader adds the camera position). Rings are spaced
// exponentially, with a share `nearShare` of them packed inside `rMid`, where close-up
// waves need the detail, and the rest spread out to the horizon.
export function radialGrid(rings, segments, rMin, rMax, rMid, nearShare) {
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
  // Segment by segment (all the rings of one wedge, then the next), so a range of the index
  // buffer is a wedge of the grid.
  const idx = new Uint32Array(rings * segments * 6);
  let n = 0;
  for (let j = 0; j < segments; j++) {
    for (let i = 0; i < rings; i++) {
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
  g.userData = { segments, perSegment: rings * 6 };
  return g;
}
