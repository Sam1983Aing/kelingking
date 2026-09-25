// The scanned surfaces the ground is made of, in texture-array layer order. The shader
// refers to them by these layer numbers (see the defines in terrain-shader.js).
//   scan    real-world width of one tile in the scan, metres
//   tile    width used here (bigger than the scan stretches it, for bigger features)
//   avg     average colour of the colour map (sRGB), measured
//   target  average colour it should come out at on this island (sRGB), from the photos
// The shader multiplies each map by target / avg in linear light, so the detail of the
// scan survives and the overall colour matches Kelingking.

export const SURFACES = [
  { id: 'marble_cliff_05', scan: 20, tile: 16, use: 'grey-white limestone faces',
    avg: [0.578, 0.550, 0.513], target: [0.60, 0.585, 0.54] },
  { id: 'cliff_side', scan: 1.83, tile: 5.5, use: 'bedding relief on the faces, and the ochre stain',
    avg: [0.482, 0.322, 0.194], target: [0.60, 0.46, 0.30] },
  { id: 'seaside_rock', scan: 2, tile: 2.5, use: 'the dark band at the waterline and in the notch',
    avg: [0.271, 0.251, 0.215], target: [0.30, 0.27, 0.21] },
  { id: 'aerial_beach_01', scan: 30, tile: 24, use: 'the beach',
    avg: [0.568, 0.523, 0.479], target: [0.90, 0.86, 0.78] },
  { id: 'aerial_grass_rock', scan: 15, tile: 12, use: 'the ground under the plants',
    avg: [0.448, 0.382, 0.141], target: [0.30, 0.36, 0.14] },
];

// target / avg in linear light, per surface.
export const surfaceGains = () =>
  SURFACES.map((s) => s.target.map((t, i) => Math.pow(t, 2.2) / Math.pow(s.avg[i], 2.2)));
