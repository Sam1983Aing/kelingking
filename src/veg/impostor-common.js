// Shared between the impostor baker and the runtime: how view directions map onto the
// atlas. Views cover the upper hemisphere with a hemi-octahedral layout: direction d
// (y up) goes to a point in the unit square, and the square is cut into GRID x GRID frames
// whose corners are the baked views (so the horizon views sit on the square's edge).

export const IMPOSTOR = { grid: 8, frame: 256 };

export function hemiOctDecode(u, v) {
  const ex = u * 2 - 1, ey = v * 2 - 1;
  const px = (ex + ey) * 0.5, pz = (ex - ey) * 0.5;
  const y = 1 - Math.abs(px) - Math.abs(pz);
  const l = Math.hypot(px, y, pz);
  return [px / l, y / l, pz / l];
}

export const HEMI_OCT_GLSL = /* glsl */ `
vec2 hemiOctEncode(vec3 d) {
  d.y = max(d.y, 0.0);
  vec3 a = abs(d);
  vec2 p = d.xz / (a.x + a.y + a.z);
  return vec2(p.x + p.y, p.x - p.y) * 0.5 + 0.5;
}
vec3 hemiOctDecode(vec2 uv) {
  vec2 e = uv * 2.0 - 1.0;
  vec2 p = vec2(e.x + e.y, e.x - e.y) * 0.5;
  return normalize(vec3(p.x, 1.0 - abs(p.x) - abs(p.y), p.y));
}
`;
