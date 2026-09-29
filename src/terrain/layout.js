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
      // (v6 raised 233,224 from 127 and 228,200 from 101: see the platform in `dips`.)
      { at: [233, 224], h: 136, w: 52, p: 1.6 },
      { at: [228, 200], h: 108, w: 50, p: 1.6 },
      { at: [221, 184], h: 92, w: 50, p: 1.6 },
      { at: [175, 131], h: 93, w: 48, p: 1.5 },
      { at: [109, 70], h: 94, w: 46, p: 1.4 },
      { at: [70, 38], h: 92, w: 50, p: 1.5 },
      { at: [25, 11], h: 105, w: 62, p: 1.7 },
      // The crown peaks just behind the head, then holds a high, sharper ridge to its blunt
      // ocean-facing brow. The old rounded dome fell away too early toward the tip.
      { at: [0, 0], h: 112, w: 68, p: 1.45 },
      { at: [-40, -22], h: 105, w: 69, p: 1.45 },
      { at: [-100, -28], h: 96, w: 70, p: 1.55 },
      { at: [-150, -30], h: 82, w: 70, p: 1.6 },
    ],

    // Where the finger leaves the plateau (top of the unpaved ridge steps).
    root: [221, 184],

    // Side ridges off the main spine, merged with it by taking the higher surface.
    spurs: [
      // The jaw: the lip of the head that curls over the south end of the beach.
      { path: [[0, 0], [17, 48], [28, 93]], h: [110, 84, 58], w: 38, p: 1.45 },
    ],

    // Local lowering of the plateau. The corner where the paved steps run down to the
    // ridge slopes away south-west, so the view from the platform is open.
    // v6: and a rise for the platform at the top of the steps, where the viewpoint photo was
    // taken. Its camera (calibrated in stage 1) stood 10 m above v5's ground, and the photo
    // nine minutes later (eastCove) has a GPS altitude of 110 m at (223, 197), 8 m above it:
    // the ground there was low, not the camera. Centred just behind the camera, so the ground
    // still falls away in front of it.
    dips: [{ at: [220, 178], r: 50, dh: -55 }, { at: [231.5, 239.5], r: 15, dh: 9.6 }],

    // Island plateau height away from the finger: a base plus the OSM hills.
    // Near a cliff top the plateau rounds down by shoulder (fraction) over shoulderW metres.
    plateau: { base: 148, sigma: 190, noise: 6, shoulder: 0.84, shoulderW: 55 },

    // near: roughly the middle. sheer: how much of the height is a sheer face, varying by
    // sheerVar around the islet (most on the side facing sheerAz, degrees counterclockwise
    // from east). R: how far in from the waterline the crown takes to round over.
    islets: [
      // Batu Satu: a wooded south-east shoulder falls away from an off-centre crest;
      // the north-west face keeps its exposed, bedded limestone wall.
      { near: [80, -100], h: 72, sheer: 0.52, sheerVar: 0.34, sheerAz: 115, R: 38,
        summit: [94, -112], crownDrop: 0.17 },
      { near: [706, -629], h: 24, sheer: 0.6, sheerVar: 0.15, sheerAz: 90, R: 20 },
    ],

    // Cliff face and seabed parameters, blended between control points.
    //   sand  1 = beach zone: the face drops from the OSM cliff-top line and sand fills the
    //         gap to the water. 0 = rock: the face drops right at the waterline.
    //   face  horizontal width of the drop (small = sheer)
    //   pf    face profile (< 1 bulges and stays sheer, > 1 is a slope that flattens out)
    //   L, D  seabed: how far out it takes to get deep, and how deep
    //   murk  sand hanging in the water, which turns shallow bays milky turquoise
    //   surf  (water only) more white water where the swell hits the rock than its exposure gives
    //   btop  (beaches) how high the sand gets toward the back of the beach (default beach.top)
    defaults: { sand: 0, murk: 0, face: 12, pf: 0.8, L: 18, D: 34 },
    zones: [
      { name: 'kelingking beach', at: [120, 215], r: 95, sand: 1 },
      { name: 'beach south', at: [118, 135], r: 28, sand: 1 },
      // The south end of the beach is low: the swash runs up to the foot of the rock under the
      // overhang and leaves it wet (beach-white-sand-cliff.jpg, the viewpoint and trailLow photos).
      { name: 'beach south, low', at: [78, 92], r: 45, btop: 1.6 },
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
      // Keep the sloping beak local to the jaw tip. Spreading this gentler face toward the
      // beach-wall overhang pulled its cave into a blocky cone at sand level.
      { name: 'jaw', at: [14, 89], r: 20, face: 24, pf: 1.15 },
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
      // Extra white water at the rock (surf only, read by the water in worker.js): the swell
      // wraps round the jaw and runs right into the arch under it (aerial-side-from-sea.jpg,
      // and the white round the jaw's tip from the viewpoint).
      { name: 'surf into the arch', at: [8, 86], r: 40, surf: 1 },
      { name: 'surf round the jaw tip', at: [35, 105], r: 30, surf: 0.7 },
    ],

    // The beach. The sand rises from the waterline (shifted `shift` metres out from the mapped
    // coast): a steep face toward the berm (`berm` m high, over `face` m, about 1 in 6 at the
    // water, where the swash runs) and then toward `top` over `spread` metres. `back` is the foot of the wall behind it, north
    // to south, traced from the registered drone photo (aerial-high-whole-bay.jpg): the walls
    // come down to it, steep to the bottom (profile at most `backProfile`). Its south end runs
    // along the foot the zones already give there, so it hands over without a corner; the
    // overhang beyond is the mesh builder's.
    beach: { top: 4.0, spread: 40, berm: 1.35, face: 8.5, shift: 8, backProfile: 0.6,
      back: [[119, 322], [126, 294], [150, 279], [161, 250], [161, 227], [141, 219], [129, 210], [128, 187],
        [132, 163], [130, 141], [121, 119], [114, 102], [106, 95], [100, 89], [95, 82], [92, 76]] },

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
      { name: 'beach south end', at: [54, 63], r: 34, bulge: 16, lipH: 17, cave: 7, caveH: 5 },
      { name: 'jaw arch', at: [5, 84], r: 26, notch: 11, notchTop: 20 },
    ],

    // The way down (src/trail/, v6), from the top of the concrete steps to the sand.
    //   width  of the tread; rise  the usual riser; going  the shortest tread; grade  the
    //   steepest the design line may get (rise over run); rails  what the handrail is made of.
    // The steps and the ridge path are the mapped ones (geo.js). The descent is not the
    // mapped zigzag: on this model's slope its legs ran straight down the fall line at 50 to 70
    // degrees, and its bottom climbed a bump and dropped 32 m to the sand. It was laid out
    // again across the slope at about 1 in 2, in the same corridor: the first leg a long
    // diagonal from the neck, where the viewpoint photo shows it (its pixels traced onto this
    // ground), three switchbacks, and a steep last stretch reaching the sand at the foot of
    // the wall, where the drone photo shows the path (aerial-high-whole-bay.jpg, traced).
    trail: {
      smooth: 1.5, clearance: 0.05,
      // bank: the cut and fill slopes (rise over run), how soft their edges are, how far the
      // level shelf reaches past each edge of the tread (wider than the tread by more than
      // one cell of the ground grid, so no triangle that touches the tread reaches the bank),
      // and how far out the carve can reach.
      bank: { cut: 2.2, fill: 2.6, soft: 0.3, shoulder: 0.7, reach: 8, clearanceUnder: 0.03 },
      // The viewpoint platform: a level concrete pad beside the top of the steps, where the
      // viewpoint photo was taken (its camera is 1.6 m over it, near its south-west edge).
      // at, half sizes (m), heading of the long side, corner radius, height of its surface.
      // It stops at the west edge of the steps, which come down beside it to its level and on,
      // and the camera stands at its south-west corner: in the photo the ground drops away
      // below the lens (the slab across the bottom of the frame was the first try).
      pads: [{ name: 'viewpoint', at: [229.5, 237.95], half: [2.8, 1.95], heading: 175, round: 0.7, h: 150.4 }],
      sections: [
        { kind: 'concrete', rails: 'timber', path: TRAIL.pavedSteps, width: 1.3, rise: 0.21, going: 0.26, grade: 1.15, flat: 0.03, jitter: 0 },
        { kind: 'ridge', rails: 'timber', path: [...TRAIL.ridgeSteps, [160.57, 121.87], [155.5, 118.2]],
          // (1.2 m: the handrails in trail-top-railing.jpg are about 1.4 m apart.)
          width: 1.2, rise: 0.24, going: 0.34, grade: 0.75, flat: 0.16, jitter: 0.25 },
        // (It leaves the ridge in a hairpin of 1.5 m radius, turning right onto the slope.)
        { kind: 'descent', rails: 'bamboo', width: 1.05, rise: 0.27, going: 0.27, grade: 1.25, flat: 0.13, jitter: 0.3, path: [
          [155.5, 118.2], [154.6, 117.9], [153.74, 118.17], [153.19, 118.89], [153.15, 119.79], [153.28, 120.1],
          [154.4, 122.6], [156.2, 126.0], [158.3, 130.0], [160.8, 132.6], [163.9, 139.9], [165.3, 147.8],
          [167.9, 155.4], [168.4, 159.3], [167.8, 163.0], [166.6, 166.5], [166.2, 169.3], [165.0, 171.0],
          [160.7, 171.4], [156.0, 171.2], [151.5, 171.0], [149.0, 170.6], [148.3, 172.5], [149.5, 174.8],
          [153.0, 176.5], [156.5, 178.4], [158.2, 181.0], [157.3, 183.8], [155.3, 185.6], [152.8, 184.4],
          [149.6, 181.8], [146.0, 180.5], [142.0, 180.0], [138.6, 179.3], [135.6, 180.6], [132.6, 183.6],
          [129.8, 186.3], [127.4, 188.2]] },
      ],
    },

    // Plants (src/veg/scatter.js). Spacing and scale blend from near to far with distance
    // from focus. Scale multiplies the scanned tree (3.4 to 5 m tall), so 0.35 is a bush.
    plants: {
      seed: 11, focus: [60, 60],
      nearRadius: 260, farRadius: 520,
      nearSpacing: 0.95, farSpacing: 3.6,
      nearScale: 0.45, farScale: 0.95,
      // trailClear: metres kept clear beyond the handrail per unit of the biggest scale a plant
      // can have there (about its canopy's radius), v6.
      density: 0.95, ledgeChance: 0.35, trailClear: 1.4,
      // Grass tussocks (v7), drawn only near the camera, so only within `reach` metres of the
      // path: on a grid `spacing` apart, kept with a chance of up to `density`.
      grass: { reach: 22, spacing: 0.42, density: 1, vergeScrub: 0.22 },
      // Scrub down the sheer faces (v7): a clump every `step` metres up the face where its
      // patches are, kept with a chance of up to `density`.
      // (v9: a clump every 1.3 m, kept with a chance of up to 0.75, mostly face scrub in streaks
      // along the beds; it was every 1.8 m at 0.9, hanging scrub in round patches.)
      face: { step: 1.3, density: 0.75 },
    },
    noise: { seed: 7, broad: 5, fine: 1.4, faceJitter: 0.35, edgeJitter: 2.5 },
  };
}
