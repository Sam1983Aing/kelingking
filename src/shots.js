// Camera shots, each matched to a reference photo.
// pos is local metres [east, north, height]. yaw is a compass heading in degrees
// (0 = north, 90 = east), pitch is degrees up from level, roll in degrees, fov is vertical.
// Numbers are tuned by eye with the photo overlaid (press O, use the Camera panel).

export const SHOTS = {
  viewpoint: {
    label: 'Clifftop viewpoint',
    ref: 'references/02-viewpoint/viewpoint-midday-a.jpg',
    pos: [228, 236, 152], yaw: 220.7, pitch: -25.6, roll: 0, fov: 57,
    // Patches where the model and the photo agree on what is there (src/measure.js).
    rois: {
      'horizon sky': [0.52, 0.042, 0.73, 0.059],
      'far sea': [0.1, 0.076, 0.36, 0.097],
      'mid sea': [0.1, 0.17, 0.31, 0.24],
      // v3 reshaped the islet: its bare north-west face sits a little lower in the render.
      'islet sunlit face': { photo: [0.3, 0.36, 0.33, 0.41], render: [0.29, 0.4, 0.33, 0.45] },
      // The head's sunlit north face above the beach (the photo's is stained ochre in places).
      'head face': { photo: [0.595, 0.3, 0.64, 0.36], render: [0.64, 0.29, 0.685, 0.35] },
      'sand': { photo: [0.515, 0.64, 0.555, 0.75], render: [0.565, 0.7, 0.61, 0.79] },
    },
  },
  overview: {
    label: 'Overview, straight down',
    ref: 'references/01-overview/aerial-high-whole-bay.jpg',
    pos: [167, 194, 1096], yaw: 9.1, pitch: -90, roll: 0, fov: 57,
  },
  sideFromSea: {
    label: 'Head from the sea',
    ref: 'references/01-overview/aerial-side-from-sea.jpg',
    pos: [-170, 230, 85], yaw: 128, pitch: -14, roll: 0, fov: 57,
  },
  trailTop: {
    label: 'Top of the trail',
    ref: 'references/03-trail/trail-top-railing.jpg',
    pos: [178, 134, 96], yaw: 233, pitch: -13, roll: 0, fov: 54,
  },
  stairs: {
    label: 'On the stairs',
    ref: 'references/03-trail/trail-mid-descent-a.jpg',
    // Placeholder until the trail version builds the steps and matches this photo.
    pos: [232, 238, 146.7], yaw: 228, pitch: -36, roll: 0, fov: 62,
  },
  trailLow: {
    label: 'Low on the trail',
    ref: 'references/03-trail/trail-low-beach-close.jpg',
    // Placeholder until v6. Framed like the photo on the overhang at the south end of the
    // beach (v3), which puts it in the air 65 m above the sand: v1's camera on the mapped
    // zigzag looked past the overhang. The trail version puts it back on the path.
    pos: [115, 140, 70], yaw: 225, pitch: -50, roll: 0, fov: 60,
  },
  surfTop: {
    label: 'Surf from above',
    ref: 'references/05-water/topdown-foam-sand.jpg',
    pos: [100, 232, 55], yaw: 180, pitch: -90, roll: 0, fov: 72,
  },
  cove: {
    label: 'Cove from the cliff',
    ref: 'references/05-water/waves-from-cliff.jpg',
    pos: [170, 262, 146], yaw: 232, pitch: -58, roll: 0, fov: 55,
  },
  shoreBreak: {
    label: 'Shore break, eye level',
    ref: 'references/05-water/wave-breaking-closeup.jpg',
    // v4 moved it into the water, about 10 m from where the waves break and level with their
    // crests, as the photo was taken (it stood on the sand 20 m back until v3).
    pos: [88, 223.3, 1.3], yaw: 282, pitch: -4, roll: -2, fov: 26,
  },
  eastCove: {
    label: 'East cove, same hour',
    ref: 'references/04-beach/cove-from-east-cliff.jpg',
    // The same phone, day and hour as the viewpoint photo (12:06, EV100 14.05), looking
    // south-east with the ultrawide lens. From its EXIF: position, height and heading; the
    // pitch from the horizon. The coast it shows is off the map; it is here for its sky,
    // which it shows from the horizon up to 38 degrees.
    pos: [223, 197, 110], yaw: 137.2, pitch: -4.8, roll: 0, fov: 85.7,
    rois: {
      'sky 5 deg': [0.65, 0.393, 0.91, 0.401],
      'sky 8 deg': [0.65, 0.356, 0.91, 0.364],
      'sky 12 deg': [0.65, 0.308, 0.91, 0.316],
      'sky 18 deg': [0.65, 0.231, 0.91, 0.239],
      'sky 25 deg': [0.65, 0.132, 0.91, 0.14],
      'sky 32 deg': [0.65, 0.019, 0.91, 0.027],
      'sea near horizon': [0.68, 0.462, 0.94, 0.479],
      'sea 1-3 km': [0.73, 0.555, 0.94, 0.625],
    },
  },
  beach: {
    label: 'On the sand',
    ref: 'references/04-beach/beach-white-sand-cliff.jpg',
    // v5 refitted it (v1's was by eye, 27 m from the water, and after v5 narrowed the beach it
    // stood 6 m from the wall). The people in the photo give their distances by their size and
    // the eye's height above their feet: the man at the water's edge is about 14 m off and
    // 3.5 m below the eye, so the photographer stood on the upper beach, 2 m up. The head's
    // edge against the sky sets the heading, the horizon the pitch. The lens is wider than
    // v1 had it (a film camera, about 28 mm).
    pos: [115, 220, 3.55], yaw: 208.3, pitch: -4.85, roll: 0, fov: 46,
  },
  swash: {
    label: 'At the water\'s edge',
    ref: 'references/04-beach/beach-white-sand-surf.jpg',
    // v5: standing on the sand where the swash runs, looking at the break by the rock at the
    // south end of the beach, as the photo was taken.
    pos: [99, 164, 2.25], yaw: 222.5, pitch: -3.6, roll: 0, fov: 46,
  },
};

// The hero frames: the shots every version is judged on, in the order the scroll passes
// through them, plus the head from the sea. tools/hero.mjs renders and times these.
export const HERO = ['overview', 'viewpoint', 'stairs', 'trailTop', 'trailLow', 'beach', 'shoreBreak', 'sideFromSea'];
