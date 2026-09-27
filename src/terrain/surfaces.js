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
  // v5: about 0.5 reflectance (v1's 0.72 was picked under v1's dimmer light) and pinker, as
  // coral sand with red foraminifera is: the midday photos have green/red about 0.93 and
  // blue/red 0.80 to 0.87 on sunlit sand.
  { id: 'aerial_beach_01', scan: 30, tile: 24, use: 'the beach',
    avg: [0.568, 0.523, 0.479], target: [0.78, 0.725, 0.65] },
  // v7: greyer, as grass really is (about 0.07 red, 0.09 green, 0.03 blue in the wet season);
  // v1's was a saturated lawn green.
  { id: 'aerial_grass_rock', scan: 15, tile: 12, use: 'the ground under the plants',
    avg: [0.448, 0.382, 0.141], target: [0.33, 0.38, 0.135] },
  // v5, close range on the beach (the aerial scan above is only right from further off): the
  // dry sand trampled by people, and the firm sand the swash packs down. Both come out at the
  // beach's own colour; being wet is added on top.
  { id: 'sand_02', scan: 2.14, tile: 2.14, use: 'trampled dry sand up close',
    avg: [0.379, 0.337, 0.281], target: [0.78, 0.725, 0.65] },
  { id: 'damp_beach_sand', scan: 2.0, tile: 2.0, use: 'firm sand where the swash runs, up close',
    avg: [0.425, 0.379, 0.301], target: [0.78, 0.725, 0.65] },
  // v10: trodden dry sand, made at load (trample.js), not a scan: only its normal layer is used.
  { id: 'trampled', gen: 'trampled', tile: 6, use: 'footprints and lumps in the dry sand, made in code',
    avg: [0.5, 0.5, 0.5], target: [0.5, 0.5, 0.5] },
];

// Wet sand: what water in the pores does to the sand's colour (a little darker in blue, as
// the photos' wet band is warmer). Shared by the ground and the swash sheet over it.
export const WET_SAND = [0.6, 0.575, 0.53];

// target / avg in linear light, per surface.
export const surfaceGains = () =>
  SURFACES.map((s) => s.target.map((t, i) => Math.pow(t, 2.2) / Math.pow(s.avg[i], 2.2)));
