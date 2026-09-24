# v4: water

**Goal.** Sea that reads as real water in every frame: the colour bands from the air, the
texture of the open sea, white water where the swell hits the rock, and the wave breaking in
front of you on the beach.

## Photos to match

- `references/01-overview/aerial-high-whole-bay.jpg`: turquoise to navy, the milky plumes in
  the east bay, foam on the exposed coasts.
- `references/02-viewpoint/viewpoint-midday-a.jpg`: the sea from the clifftop.
- `references/05-water/topdown-foam-sand.jpg`, `topdown-colour-bands.jpg`,
  `aerial-shore-waves.jpg`: foam and colour over sand, from above.
- `references/05-water/waves-from-cliff.jpg`: the surf in the cove.
- `references/05-water/wave-breaking-closeup.jpg`: the breaking wave at eye level.

## What is wrong in v1

- The open sea far out is too flat and even. No wind texture, no whitecaps.
- The turquoise is less saturated and less bright than in the drone photo.
- The milky plume in the east bay is patchy and dim.
- The surf lines in the cove are too regular and parallel. Real sets are irregular, and the
  foam spreads and streaks.
- No spray or burst of white water where waves hit the base of the rock.
- The eye-level wave has no lip, no curl, no spray. A height field cannot fold over, so this
  needs its own geometry or particles.
- Foam does not leave trails behind a wave.

## In scope

Everything in `src/water/`: colour, waves, foam, spray, the far-field detail, wave timing.

## Not in scope

- The sand, and the thin sheet of water running up the sand with its edge line (v5 owns the
  swash).
- The sky and its reflection (v2), apart from how the water uses it.

## Files

`src/water/*`, `waterData` in `src/terrain/worker.js`, the water settings in the cliff zones
of `src/terrain/layout.js` (`murk`, `D`, `L`).

## Done when

- `overview`, `viewpoint`, `cove` and `surfTop` side by side read as the photos' water.
- A 10 second clip at `shoreBreak` and one at `viewpoint` read as real water to Sam.
- Frame budget holds.

## Found by other versions

(nothing yet)
