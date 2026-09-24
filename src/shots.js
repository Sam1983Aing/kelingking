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
  beach: {
    label: 'On the sand',
    ref: 'references/04-beach/beach-white-sand-cliff.jpg',
    pos: [128, 186, 4.6], yaw: 206, pitch: 3, roll: 0, fov: 40,
  },
};
