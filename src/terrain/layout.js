// Hand-authored shape of the headland, layered on top of the OSM geometry in geo.js.
// Local metres, x = east, y = north, origin at the T-Rex summit. Heights in metres.
// Everything here is a starting guess, tuned by overlaying reference photos.

import { TRAIL } from './geo.js';

export function defaultLayout() {
  return {
    // Heightfield covers this square. 2048 texels over 1600 m is ~0.78 m per texel.
    extent: { x0: -700, y0: -700, size: 1600 },

    // Spine of the finger: from the viewpoint down the paved steps, along the ridge
    // path to the summit, then on to the tip of the head (the coast trims it).
    spinePath: [
      ...TRAIL.pavedSteps,
      ...TRAIL.ridgeSteps.slice(1),
      ...TRAIL.ridgePath.slice(1),
      [-100, -28],
      [-160, -32],
    ],
    // Heights along the spine. w = half-width of the ridge cross-section,
    // p = crest shape (low = sharp crest, high = rounded dome).
    spine: [
      { at: [233, 262], h: 151, w: 60, p: 1.8 },
      { at: [231, 246], h: 150, w: 58, p: 1.9 },
      { at: [233, 224], h: 127, w: 52, p: 1.6 },
      { at: [228, 200], h: 101, w: 50, p: 1.6 },
      { at: [221, 184], h: 92, w: 50, p: 1.6 },
      { at: [175, 131], h: 93, w: 48, p: 1.5 },
      { at: [109, 70], h: 94, w: 46, p: 1.4 },
      { at: [70, 38], h: 92, w: 50, p: 1.5 },
      { at: [25, 11], h: 105, w: 62, p: 1.7 },
      { at: [0, 0], h: 111, w: 70, p: 1.9 },
      { at: [-40, -22], h: 107, w: 74, p: 2.0 },
      { at: [-100, -28], h: 94, w: 76, p: 2.1 },
      { at: [-150, -30], h: 78, w: 76, p: 2.0 },
    ],

    // Where the finger leaves the plateau (top of the unpaved ridge steps).
    root: [221, 184],

    // Side ridges off the main spine, merged with it by taking the higher surface.
    spurs: [
      // The jaw: the lip of the head that curls over the south end of the beach.
      { path: [[0, 0], [12, 48], [16, 96]], h: [111, 92, 76], w: 48, p: 2.2 },
    ],

    // Local lowering of the plateau. The corner where the paved steps run down to the
    // ridge slopes away south-west, so the view from the platform is open.
    dips: [{ at: [220, 178], r: 50, dh: -55 }],

    // Island plateau height away from the finger: a base plus the OSM hills.
    // Near a cliff top the plateau rounds down by shoulder (fraction) over shoulderW metres.
    plateau: { base: 148, sigma: 190, noise: 6, shoulder: 0.84, shoulderW: 55 },

    islets: [
      { near: [80, -100], h: 66 }, // Batu Satu, the rock off the head
      { near: [706, -629], h: 24 },
    ],

    // Cliff face and seabed parameters, blended between control points.
    //   sand  1 = beach zone: the face drops from the OSM cliff-top line and sand fills the
    //         gap to the water. 0 = rock: the face drops right at the waterline.
    //   face  horizontal width of the drop (small = sheer)
    //   pf    face profile (< 1 bulges and stays sheer, > 1 is a slope that flattens out)
    //   L, D  seabed: how far out it takes to get deep, and how deep
    //   murk  sand hanging in the water, which turns shallow bays milky turquoise
    defaults: { sand: 0, murk: 0, face: 12, pf: 0.8, L: 18, D: 34 },
    zones: [
      { name: 'kelingking beach', at: [120, 215], r: 95, sand: 1 },
      { name: 'beach south crescent', at: [70, 95], r: 30, sand: 1 },
      { name: 'emboo beach', at: [390, 205], r: 45, sand: 1 },
      { name: 'neck root south-east', at: [195, 92], r: 30, sand: 1 },
      { name: 'trail slope', at: [165, 185], r: 45, face: 62, pf: 1.5 },
      { name: 'beach back north', at: [150, 290], r: 45, face: 28, pf: 1.2 },
      { name: 'neck wall', at: [110, 85], r: 38, face: 9, pf: 0.7 },
      { name: 'jaw', at: [30, 80], r: 35, face: 5, pf: 0.6 },
      { name: 'head', at: [-70, -10], r: 85, face: 7, pf: 0.7 },
      { name: 'neck south-east', at: [110, 35], r: 40, face: 9, pf: 0.8 },
      { name: 'kelingking cove', at: [30, 230], r: 130, L: 220, D: 14, murk: 0.35 },
      { name: 'east bay shelf', at: [430, 10], r: 150, L: 260, D: 12, murk: 1 },
      { name: 'channel along the neck', at: [175, 25], r: 85, L: 22, D: 32 },
    ],

    beach: { top: 4.6, spread: 24, shift: 8 },
    noise: { seed: 7, broad: 5, fine: 1.4, faceJitter: 0.35, edgeJitter: 2.5 },
  };
}
