// Camera shots, each matched to a reference photo.
// pos is local metres [east, north, height]. yaw is a compass heading in degrees
// (0 = north, 90 = east), pitch is degrees up from level, roll in degrees, fov is vertical.
// Numbers are tuned by eye with the photo overlaid (press O, use the Camera panel).

export const SHOTS = {
  viewpoint: {
    label: 'Clifftop viewpoint',
    ref: 'references/02-viewpoint/viewpoint-midday-a.jpg',
    pos: [228, 236, 152], yaw: 220.7, pitch: -25.6, roll: 0, fov: 57,
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
    pos: [101, 222, 1.9], yaw: 282, pitch: -1.5, roll: -2, fov: 26,
  },
  beach: {
    label: 'On the sand',
    ref: 'references/04-beach/beach-white-sand-cliff.jpg',
    pos: [124, 200, 4.4], yaw: 208, pitch: -3.8, roll: 0, fov: 40,
  },
};
