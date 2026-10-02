# v5: sand and the waterline

**Goal.** The beach where the scroll ends, seen closest of all: white sand, wind ripples,
wet sand that shines, and the sheet of water that runs up the beach and slides back.

## Photos to match

- `references/04-beach/beach-white-sand-cliff.jpg`, `beach-white-sand-surf.jpg`,
  `beach-headland-waves.jpg`, `beach-people-scale.jpg`, `beach-vertical.jpg`.
- `references/05-water/topdown-foam-sand.jpg`, `aerial-shore-waves.jpg`.
- `references/03-trail/trail-low-beach-close.jpg`: the beach from above, the dark shade under
  the overhang.

## What is wrong (seen at v1, still true after v4)

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

- `beach` side by side reads as the photos' beach, and a new shot standing on the sand at
  the water's edge (v4 moved `shoreBreak` into the water, 10 m from the break) reads as
  `beach-white-sand-surf.jpg`.
- A clip of a wave running up the sand and back reads as real to Sam.
- Frame budget holds.

## Found by other versions

**From v2 (light).**

- Under the calibrated light the sand comes out 0.3 to 0.5 stops brighter than the viewpoint
  photo. The `aerial_beach_01` target in `surfaces.js` (0.9, 0.86, 0.78 sRGB, about 0.79
  reflectance) was picked under v1's dimmer light. A throwaway test at 0.62 of it (about 0.49)
  put the sunlit sand within 0.13 stops of the photo. The photo's sand is also warmer, (239,
  222, 188) against the render's (242, 232, 212).
- `beach-white-sand-cliff.jpg` is film, warm and washed out: match its brightness, not its
  colour. The same exposure is used for every shot now (the photo's EV100 14.2), so the beach
  cannot be brightened on its own.
- The sand's colour also sets the light it bounces onto the cliff foot and the overhang
  (`uBounceAlb` reads the sand target from `surfaces.js`), so changing it changes those.

**From v3 (rock).**

- The sand now runs on in under the overhang at the south end of the beach: the floor of the
  cave is part of the face strip, flagged as sand per vertex (`vRock.x` in
  `terrain-shader.js`), and it is in shadow most of the day. Its light is sky plus a second
  bounce off the rock overhead. Check it when the sand changes.
- The light bounced onto the rock from the sand uses the sand target from `surfaces.js`, so
  retuning the sand (v2 suggested about 0.49 reflectance, down from 0.79) will darken the
  overhang's ceiling and the cliff foot by the same factor. That is right; just expect it.
- The beach at the south end is narrower than the photos show from the viewpoint: in
  `viewpoint-midday-a.jpg` the sand disappears under the overhang's shadow much closer to the
  water. The overhang now covers part of it; the rest is the beach's own shape.

**From v4 (water).**

- The swash is still v1's: the water level surges up the sand (`surge` in `surfAt`,
  `src/water/water-shader.js`) and a thin bright line marks its edge (`edge`, near the end of
  the sea's fragment shader). Both are v5's. The bore that feeds the swash is now v4's
  breaker and foam simulation: the bore front arrives as a thick white band and the foam it
  leaves is carried up the beach and back by `surf-sim.js` (`push`, `surfZone`, the backwash
  and the rip channels). A swash that runs up and slides back should move that foam with it,
  so change the simulation's water motion there rather than drawing a second foam.
- The foam simulation zeroes itself above the swash's reach (`wet` in `surf-sim.js`, from
  `uSurge`). If the swash runs further up the sand, raise that too, or the foam will stop short
  of the water's edge.
- The seabed sand seen through the water is its own colour (`sandAlbedo` in
  `src/water/water.js`, now greyer, about 0.35 reflectance under water) and does not read the
  terrain's sand texture. Where the swash film is thin the terrain's own wet sand shows through
  (the sea fades out over its last 12 cm). A darker wet band behind the swash would be on the
  terrain side.
- `shoreBreak` now stands in the water about 10 m from the break (v4 moved it). A shot for
  the swash will want its own camera on the sand.
- At noon the bore and the foam on the sand clip to white under the photo's exposure, as they
  do in `beach-white-sand-surf.jpg`. Only the shadowed crevices give foam any shape.

**From v15 (shore wave).**

- At the `swash` camera, a sharp tan triangular patch remains visible through the shallow
  water and in a `--hide=water` render. It belongs to the beach terrain or sand material,
  not the moving wave. Check the wet and dry sand transition there in a future sand pass.
