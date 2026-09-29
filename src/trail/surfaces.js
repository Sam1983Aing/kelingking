// The scanned surfaces the path is made of (v6), in texture-array layer order, as the ground's
// are (src/terrain/surfaces.js): tile is the width of one tile in metres, avg the scan's average
// colour (sRGB, measured), target what it should average out at here (sRGB, from the photos).
// The shader multiplies each map by target / avg in linear light.

export const TRAIL_SURFACES = [
  // The steps and the platform: pale grey cement, stained (trail-stairs-viewpoint.jpg).
  { id: 'concrete_floor_02', scan: 2, tile: 2, use: 'the concrete steps and the viewpoint platform',
    // The exposed flight is dusty grey limestone concrete rather than a white pebble mosaic.
    avg: [0.467, 0.430, 0.354], target: [0.505, 0.485, 0.455] },
  // The path: dusty pale limestone dirt and gravel on the ridge (trail-top-railing.jpg); the
  // shader browns it lower down.
  { id: 'rocky_trail', scan: 2, tile: 2, use: 'the dirt path',
    avg: [0.575, 0.503, 0.418], target: [0.64, 0.6, 0.53] },
  // Handrail posts and rails: grey-brown weathered timber, darker on the concrete steps.
  { id: 'weathered_planks', scan: 2, tile: 2, use: 'the timber handrail posts and rails',
    avg: [0.313, 0.264, 0.230], target: [0.4, 0.37, 0.33] },
  // Logs across the dirt steps.
  { id: 'bark_brown_02', scan: 1, tile: 1, use: 'the logs across the dirt steps',
    avg: [0.365, 0.331, 0.241], target: [0.33, 0.29, 0.23] },
];
