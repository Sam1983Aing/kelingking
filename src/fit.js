// Fitting a camera to a photo by its outlines (v6). Points traced on the photo where land
// meets the sea or the sky (u, v from 0 to 1, top left) are scored against the render's own
// land mask: for each point, the distance in pixels to the nearest edge of the mask. The
// camera stands on the path (src/trail/) at eye height, or anywhere, and a Nelder-Mead search
// moves it and turns it to bring the edges onto the points.
//
//   __app.fitCamera({ points, s: [from, to], eye: [1.45, 1.75], side: 0.4, start, iters })
//
// Returns the best camera and its score (mean pixel distance at 480 px wide).

export function makeFitter({ THREE, renderer, scene, camera, maskMaterial, hide, route }) {
  const W = 480;
  let rt = null, px = null, H = 0;
  const deg = THREE.MathUtils.degToRad;

  function renderMask() {
    H = Math.round(W / camera.aspect);
    if (!rt || rt.height !== H) { rt?.dispose(); rt = new THREE.WebGLRenderTarget(W, H); px = new Uint8Array(W * H * 4); }
    const restore = hide();
    scene.overrideMaterial = maskMaterial;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0x000000, 1);
    renderer.clear();
    const tm = renderer.toneMapping; renderer.toneMapping = THREE.NoToneMapping;
    renderer.render(scene, camera);
    renderer.toneMapping = tm;
    renderer.setRenderTarget(null);
    scene.overrideMaterial = null;
    restore();
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, px);
    // Edges of the land mask, then their distance field (two-pass chamfer), rows top down.
    const D = new Float32Array(W * H).fill(1e4);
    const land = (x, y) => px[((H - 1 - y) * W + x) * 4] > 127;
    for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
      const l = land(x, y);
      if (l !== land(x + 1, y) || l !== land(x, y + 1)) D[y * W + x] = 0;
    }
    const a = 1, b = 1.414;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let d = D[y * W + x];
      if (x > 0) d = Math.min(d, D[y * W + x - 1] + a);
      if (y > 0) d = Math.min(d, D[(y - 1) * W + x] + a);
      if (x > 0 && y > 0) d = Math.min(d, D[(y - 1) * W + x - 1] + b);
      if (x < W - 1 && y > 0) d = Math.min(d, D[(y - 1) * W + x + 1] + b);
      D[y * W + x] = d;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
      let d = D[y * W + x];
      if (x < W - 1) d = Math.min(d, D[y * W + x + 1] + a);
      if (y < H - 1) d = Math.min(d, D[(y + 1) * W + x] + a);
      if (x < W - 1 && y < H - 1) d = Math.min(d, D[(y + 1) * W + x + 1] + b);
      if (x > 0 && y < H - 1) d = Math.min(d, D[(y + 1) * W + x - 1] + b);
      D[y * W + x] = d;
    }
    return D;
  }

  // The path at s: position, height of the tread, direction.
  function onRoute(s) {
    const L = route, n = L.s.length, f = Math.min(Math.max(s / (L.s[1] - L.s[0]), 0), n - 1.001);
    const i = Math.floor(f), u = f - i, lerp = (A) => A[i] + (A[i + 1] - A[i]) * u;
    const j = Math.min(n - 1, i + 4), k = Math.max(0, i - 4);
    const tx = L.x[j] - L.x[k], ty = L.y[j] - L.y[k], tl = Math.hypot(tx, ty) || 1;
    return { x: lerp(L.x), y: lerp(L.y), h: lerp(L.ht), tx: tx / tl, ty: ty / tl };
  }

  function place(p) {
    let x = p.x, y = p.y, h = p.h;
    if (p.s !== undefined && route) {
      const r = onRoute(p.s);
      x = r.x - r.ty * p.side; y = r.y + r.tx * p.side; h = r.h + p.eye;
    }
    camera.position.set(x, h, -y);
    camera.rotation.set(deg(p.pitch), -deg(p.yaw), deg(p.roll), 'YXZ');
    camera.fov = p.fov;
    camera.updateProjectionMatrix();
    camera.updateMatrixWorld();
    return [x, y, h];
  }

  // Points on the sea's horizon in the photo count too: how far (pixels) the render's
  // horizon (the ray just grazing the sea, a little below level from up here) is from them.
  const ray = new THREE.Vector3();
  function score(p, points, horizon = []) {
    place(p);
    const D = renderMask();
    let sum = 0;
    for (const [u, v] of points) {
      const x = Math.min(W - 1, Math.max(0, Math.round(u * W))), y = Math.min(H - 1, Math.max(0, Math.round(v * H)));
      sum += Math.min(D[y * W + x], 40);
    }
    const dip = Math.sqrt(2 * Math.max(camera.position.y, 1) / 6.371e6);
    const pxPerRad = H / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
    for (const [u, v] of horizon) {
      ray.set(u * 2 - 1, 1 - v * 2, 0.5).unproject(camera).sub(camera.position).normalize();
      sum += Math.min(Math.abs(Math.asin(ray.y) + dip) * pxPerRad, 40);
    }
    return sum / (points.length + horizon.length);
  }

  // Nelder-Mead over the named parameters, each with a starting step and bounds.
  function fit({ points, horizon = [], start, vary, iters = 160 }) {
    const keys = Object.keys(vary);
    const toP = (v) => { const p = { ...start }; keys.forEach((k, i) => { const [lo, hi] = vary[k].range; p[k] = Math.min(hi, Math.max(lo, v[i])); }); return p; };
    const f = (v) => score(toP(v), points, horizon);
    let simplex = [keys.map((k) => start[k])];
    keys.forEach((k, i) => { const v = keys.map((q) => start[q]); v[i] += vary[k].step; simplex.push(v); });
    let vals = simplex.map(f);
    for (let it = 0; it < iters; it++) {
      const order = vals.map((v, i) => i).sort((a, b) => vals[a] - vals[b]);
      simplex = order.map((i) => simplex[i]); vals = order.map((i) => vals[i]);
      const n = keys.length;
      const c = keys.map((_, d) => simplex.slice(0, n).reduce((a, v) => a + v[d], 0) / n);
      const at = (t) => c.map((ci, d) => ci + t * (simplex[n][d] - ci));
      const xr = at(-1), fr = f(xr);
      if (fr < vals[0]) {
        const xe = at(-2), fe = f(xe);
        if (fe < fr) { simplex[n] = xe; vals[n] = fe; } else { simplex[n] = xr; vals[n] = fr; }
      } else if (fr < vals[n - 1]) { simplex[n] = xr; vals[n] = fr; }
      else {
        const xc = at(0.5), fc = f(xc);
        if (fc < vals[n]) { simplex[n] = xc; vals[n] = fc; }
        else for (let i = 1; i <= n; i++) { simplex[i] = simplex[i].map((v, d) => simplex[0][d] + 0.5 * (v - simplex[0][d])); vals[i] = f(simplex[i]); }
      }
    }
    const best = toP(simplex[0]);
    const pos = place(best);
    return { score: +vals[0].toFixed(2), params: best, pos: pos.map((v) => +v.toFixed(2)) };
  }

  return { fit, score, place, onRoute };
}
