# v5: sand and the waterline

**Goal.** The beach where the scroll ends, seen closest of all: white sand, wind ripples,
wet sand that shines, and the sheet of water that runs up the beach and slides back.

## Photos to match

- `references/04-beach/beach-white-sand-cliff.jpg`, `beach-white-sand-surf.jpg`,
  `beach-headland-waves.jpg`, `beach-people-scale.jpg`, `beach-vertical.jpg`.
- `references/05-water/topdown-foam-sand.jpg`, `aerial-shore-waves.jpg`.
- `references/03-trail/trail-low-beach-close.jpg`: the beach from above, the dark shade under
  the overhang.

## What is wrong in v1

- In the `beach` frame the sand reads as a smooth dune that climbs to the left. The real
  beach is flat and wide, rising gently to the cliff foot.
- The sand is slightly yellow. Photos show near-white sand (keep the film photos' warm cast
  in mind, and cross-check with the drone shots).
- The ripple texture is the wrong scale close up.
- No shine on the wet sand where the swash has just pulled back.
- The swash edge is a thin line. In the photos it is a lacy, bubbly front that leaves a
  darker wet band behind.
- Nothing where the sand meets the rock: no darker sand in the shade, no debris.

## In scope

The beach shape (`beach` settings in `src/terrain/layout.js`), the sand material, wet sand,
and the swash: the film of water on the sand and its edge line, which live in the water
shader. v5 owns those parts of `src/water/water-shader.js`.

## Not in scope

The waves out past the break (v4), the rock (v3), the light (v2).

## Files

The sand section of `src/terrain/terrain-shader.js`, `src/terrain/surfaces.js`, the `beach`
settings in `src/terrain/layout.js`, the swash parts of `src/water/water-shader.js`.

## Done when

- `beach` and `shoreBreak` side by side read as the photos' beach.
- A clip of a wave running up the sand and back reads as real to Sam.
- Frame budget holds.

## Found by other versions

(nothing yet)
