# v3: rock

**Goal.** Limestone that reads as real rock at every distance, from the drone at 1 km to
standing on the sand under the wall.

**Sam, after v2:** the lighting feels good; the most important thing now is the detail on the
objects. Put the effort into how the rock looks up close and at every distance: relief,
bedding, texture, staining. The light is settled (v2), so judge the rock under it and do not
retune the light to flatter it.

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

**From v2 (light).**

- The light is now physical and calibrated to the viewpoint photo's own exposure (see v2 in
  `PROCESS.md`). Under it the limestone comes out 0.6 to 0.7 stops brighter than the photos.
  The `marble_cliff_05` target in `surfaces.js` (0.74, 0.72, 0.67 sRGB, about 0.52 reflectance)
  was picked under v1's dimmer light. A throwaway test with the limestone gains at 0.6 of
  their value (about 0.31 reflectance) put the sunlit face of the islet within 0.06 stops of
  the photo. Measure with `node tools/capture.mjs viewpoint --measure` (the `islet sunlit
  face` rectangle) and `eastCove` (same phone, same hour).
- Sunlit faces in the two same-day photos read neutral grey, (134 to 149, 137 to 150, 127 to
  142) sRGB, not cream. The warm cream of `aerial-side-from-sea.jpg` is that photo's grade and
  a different day.
- The sun has moved: it is now where it was when the viewpoint photo was taken, 73.7 degrees
  up from just east of north, not v1's 64 degrees from north-north-west. Vertical faces only
  get grazing sun now, and some faces v1 lit are in shade. Judge the shape and the bedding
  under it.
- Shaded faces get sky light plus light bounced up from what is below them (sand, sea, scrub),
  in `groundBounce()` in `terrain-shader.js`. The sand under the overhang lights its ceiling
  warm, as in `beach-under-cliff.jpg`, once the overhang exists.
- Not rock, but shape, and it needs a home: the terrain stops 1.6 km out, so there is no far
  coast. In `aerial-side-from-sea.jpg` the ridges 1.5 to 3 km away fall back into the haze
  (about 75 to 80% of their colour left at 2 km), and the render has nothing there to haze.
  A low-detail ring of coast from the OpenStreetMap coastline would do. Not part of v3 unless
  Sam asks for it: his priority is the detail on the rock.

