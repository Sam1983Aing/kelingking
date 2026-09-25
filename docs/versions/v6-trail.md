# v6: trail and stairs

**Goal.** The way down: the viewpoint platform, the concrete steps at the top, and the steep
dirt and rock path to the beach with its handrails. The scroll follows it in v8.

## The real thing

- About 156 concrete steps from the viewpoint platform down the top of the ridge.
- Then an unbuilt path, dirt and loose rock, steep (up to 70 to 80 degrees in places, with
  rough steps cut in), zigzagging down the slope to the beach.
- A low handrail all the way: wooden posts with bamboo or wooden rails, bits of blue rope.
- Leave out the unfinished glass lift and its crane.
- OpenStreetMap already has the route: `TRAIL` in `src/terrain/geo.js` (`approach`,
  `pavedSteps`, `ridgeSteps`, `zigzag` down to the beach, and `ridgePath` along the spine
  towards the head, which visitors do not walk down to the beach).

## Photos to match

All of `references/03-trail/`, especially `trail-top-railing.jpg`, `trail-stairs-viewpoint.jpg`,
`trail-mid-descent-a.jpg` and `trail-mid-descent-b.jpg`. Also
`references/02-viewpoint/viewpoint-wide.jpg` for the platform railing.

## What is wrong in v1

There is no trail. Plants are only kept off the mapped route by a placeholder clearance
(`plants.trailClear` in `layout.js`), and the `stairs` and `trailLow` cameras are
placeholders.

## In scope

- Carve the path into the terrain: flattened treads and terraces along the route.
- Geometry for the concrete steps, the rough lower steps and the handrails, with scanned CC0
  materials (concrete, weathered wood, dirt and gravel). Ask Sam before downloading.
- Replace the placeholder clearance with the real path corridor for the plants.
- Match the `stairs`, `trailTop` and `trailLow` cameras to their photos, then freeze them.
- A walkable camera line along the path for v8 (continuous, sensible eye height).

## Not in scope

The plants themselves (v7), the rock and sand materials, the light.

## Files

New `src/trail/`, the path carve in `src/terrain/heightfield.js`, the clearance in
`src/veg/scatter.js`, the trail cameras in `src/shots.js`.

## Done when

- `stairs`, `trailTop` and `trailLow` side by side read like their photos.
- The path is continuous from the platform to the sand.
- Frame budget holds.

## Found by other versions

- (from stage 0) At the placeholder `stairs` camera the head looks closer and wider than in
  `trail-mid-descent-a.jpg`. That is terrain shape, logged for v3. Recheck once v3 is in.
- (from v3) Rechecked: see "From v3" below.

**From v3 (rock).**

- The `trailLow` placeholder moved: v1's camera on the mapped zigzag looked past the overhang,
  so it is now framed like its photo on the overhang at the south end of the beach, 65 m up
  in the air at (115, 140, 70). Put it back on the path when the path exists. Frame times for
  it are not comparable across that change.
- The neck from the `stairs` camera: the brief for v3 asked whether the neck should be
  narrower and lower with the head further away. Side by side, most of the difference is the
  camera: `trail-mid-descent-a.jpg` is taken from higher up the steps, looking down more
  steeply, with the head further off and smaller in the frame. The neck passes the outline
  checks on `viewpoint` and `overview`, which are calibrated from EXIF and a registered drone
  photo, so v3 left its shape alone. Match the `stairs` camera to its photo first; if the
  neck still reads wide and high, the spine points at (109, 70) and (70, 38) in `layout.js`
  (h 94 and 92, w 46 and 50) are the ones to lower and narrow, and the outline checks say
  how far.
- The faces are separate strips of mesh now (`mesh-builder.js`), and the ground grid is
  pushed back into the rock under them. A path cut into a steep slope will need to cut the
  strips too, or be its own mesh laid over them.
