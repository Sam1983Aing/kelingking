# v3: rock

**Goal.** Limestone that reads as real rock at every distance, from the drone at 1 km to
standing on the sand under the wall.

## Photos to match

- `references/01-overview/aerial-side-from-sea.jpg`: warm cream faces with strong horizontal
  bedding, the dark band and notch at the waterline, the overhang at the back of the beach.
- `references/02-viewpoint/viewpoint-midday-a.jpg`: the head's face and the islet.
- `references/03-trail/trail-low-beach-close.jpg` and `trail-mid-descent-a.jpg`: the deep
  overhang above the beach, almost a cave.
- `references/04-beach/beach-white-sand-cliff.jpg`, `beach-under-cliff.jpg`,
  `beach-from-overhang.jpg`: the wall close up, the ochre and grey staining.

## What is wrong in v1

- Faces read as smooth grey render. The photos show warm cream rock with deep, shadowed
  horizontal layers, some sticking out, some cut back.
- The overhang behind the beach is missing. It is one of the most recognisable features.
- Sheer faces look extruded: straight vertical walls, no buttresses, no undercuts.
- The cliff rims show a comb of small spikes in several views.
- The islet is a flat-topped cylinder. The real one is rounder on top and more irregular.
- Shape seen from the `stairs` frame: the neck should be narrower and lower, with the head
  further away. Check it against `trail-mid-descent-a.jpg` and the drone shots before changing
  anything, and keep the outline check passing.
- The dark band at the waterline is thin and even all the way round.

## In scope

- Terrain shape near the cliffs: the undercut behind the beach, buttresses, the islet, the
  neck (in `src/terrain/layout.js`, `heightfield.js`, `mesh-builder.js`).
- Real relief up close: displacement or parallax on the faces near the camera.
- The rock material: scans, how they blend, colour, bedding, staining, the wet band. More
  CC0 scans are fine, ask Sam before downloading.
- The comb on the rims.

## Not in scope

The sand, the water, the plants (including the plants on the ledges), the light.

## Files

`src/terrain/*` (the limestone parts of `terrain-shader.js`, `surfaces.js`, `heightfield.js`,
`layout.js`, `mesh-builder.js`), `tools/fetch-assets.mjs`, `tools/prepare-assets.mjs`,
`assets/textures/`.

## Done when

- `sideFromSea`, `viewpoint` and `beach` side by side read as layered limestone, with the
  overhang behind the beach.
- `trailLow` shows the undercut like its photo.
- No spikes on the rims in any hero frame.
- The outline check on `viewpoint` and `overview` still passes.
- Frame budget holds.

## Found by other versions

(nothing yet)
