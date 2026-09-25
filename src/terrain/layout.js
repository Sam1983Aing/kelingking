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

    // near: roughly the middle. sheer: how much of the height is a sheer face, varying by
    // sheerVar around the islet (most on the side facing sheerAz, degrees counterclockwise
    // from east). R: how far in from the waterline the crown takes to round over.
    islets: [
      { near: [80, -100], h: 68, sheer: 0.62, sheerVar: 0.12, sheerAz: 115, R: 29 }, // Batu Satu, the rock off the head
      { near: [706, -629], h: 24, sheer: 0.6, sheerVar: 0.15, sheerAz: 90, R: 20 },
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
      { name: 'beach south end', at: [60, 66], r: 20, sand: 1 },
      { name: 'emboo beach', at: [390, 205], r: 45, sand: 1 },
      { name: 'neck root south-east', at: [195, 92], r: 30, sand: 1 },
      { name: 'trail slope', at: [165, 185], r: 45, face: 62, pf: 1.5 },
      { name: 'beach back north', at: [150, 290], r: 45, face: 28, pf: 1.2 },
      { name: 'neck wall', at: [110, 85], r: 38, face: 9, pf: 0.7 },
      // The wall at the south end of the beach drops sheer from its rim; the mesh builder
      // then cuts it back underneath into the overhang (overhangs, below).
      { name: 'beach south wall', at: [58, 58], r: 26, face: 3, pf: 0.55 },
      { name: 'jaw', at: [30, 80], r: 35, face: 5, pf: 0.6 },
      { name: 'head', at: [-70, -10], r: 85, face: 7, pf: 0.7 },
      { name: 'neck south-east', at: [110, 35], r: 40, face: 9, pf: 0.8 },
      { name: 'kelingking cove', at: [30, 230], r: 130, L: 220, D: 14, murk: 0.12 },
      { name: 'east bay shelf', at: [430, 10], r: 150, L: 260, D: 12, murk: 0.55 },
      { name: 'channel along the neck', at: [175, 25], r: 85, L: 22, D: 32 },
      // Milky plumes over deep water (murk only): sand from the east bay drifting south-west,
      // and a faint one past the islet. The drone photo
      // (aerial-high-whole-bay.jpg, 2026) has a big plume right past the islet; none of the
      // five viewpoint photos, on other days, show one there, so it stays faint where the
      // viewpoint looks and strong in the east bay, which the viewpoint cannot see.
      { name: 'east bay plume', at: [420, -50], r: 150, murk: 1 },
      { name: 'plume past the islet', at: [260, -260], r: 120, murk: 0.25 },
    ],

    beach: { top: 4.6, spread: 24, shift: 8 },

    // Mesh (mesh-builder.js). The ground is a grid whose rows and columns are `density`
    // times closer inside the focus ranges (metres east and north: the headland, the islet
    // and the beach). The faces are strips of their own, from `below` metres out from the
    // middle of the face to `above` metres in from it, with vertices faceStep metres apart
    // up the face (in the focus, and outside it), detail.step within detail.r of detail.at
    // (the beach and the trail, where the camera comes close), and faceStepAlong times that
    // along it (weight scales how much the vertical counts in the spacing). Anything
    // entirely below `cull` metres is left out (the sea is opaque).
    mesh: { below: 16, above: 34, weight: 1, cull: -4, faceStep: [0.85, 1.6], faceStepAlong: 1,
      detail: { at: [110, 155], r: 125, step: 0.55 },
      focus: { x: [-235, 330], y: [-175, 345], density: 1.6, soft: 60 } },
    // The wave-cut notch at the foot of the rock: how deep, and how high it reaches.
    notch: { depth: 2.6, top: 5 },
    // Carving the faces: buttresses (metres in and out), the big beds (strata.js, as a
    // fraction of their table relief), and the low undercut all along the back of the beach.
    faces: { buttress: 2.4, beds: 1, undercut: { depth: 3, height: 6 } },
    // Overhangs. Rock standing on sand (mesh-builder.js, overhang()): the face bulges out
    // over the sand by `bulge` metres at a lip lipH metres up, and under the lip a cave runs
    // back `cave` metres behind the line of the wall, caveH metres high at the back. Rock in
    // the sea: a deeper notch (notch metres deep, notchTop high).
    overhangs: [
      { name: 'beach south end', at: [54, 63], r: 34, bulge: 20, lipH: 17, cave: 10, caveH: 5 },
      { name: 'jaw arch', at: [5, 84], r: 26, notch: 11, notchTop: 20 },
    ],

    // Plants (src/veg/scatter.js). Spacing and scale blend from near to far with distance
    // from focus. Scale multiplies the scanned tree (3.4 to 5 m tall), so 0.35 is a bush.
    plants: {
      seed: 11, focus: [60, 60],
      nearRadius: 260, farRadius: 520,
      nearSpacing: 1.35, farSpacing: 3.6,
      nearScale: 0.45, farScale: 0.95,
      density: 0.95, ledgeChance: 0.07, trailClear: 5.5,
    },
    noise: { seed: 7, broad: 5, fine: 1.4, faceJitter: 0.35, edgeJitter: 2.5 },
  };
}
