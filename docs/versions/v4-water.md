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

**From v2 (light).**

- Everything is in physical units now: sun about 110 klux at the ground, sky light about 10
  klux on flat ground, radiance in kcd/m2. The exposure (EV100 14.2, from the photo's EXIF)
  turns 1 kcd/m2 into about 0.08 before the tone curve. The water's colour settings were tuned
  under v1's dimmer light and now give about twice the photo's blue from under the surface.
  A throwaway test with `scatter` at 0.45 of its value put the mid sea within 0.2 stops of
  the viewpoint photo, and the sea 1.5 to 15 km out within 0.1. The shallows (turquoise) come
  out 0.7 stops too bright and the near sea (under 400 m) 0.8. `capture.mjs viewpoint
  --measure` and `eastCove --measure` give these per region.
- The water now reads its light from the atmosphere: `skyRadiance(dir)` (sky view table),
  `uSunIrr`, `uSkyIrr` (sky light on flat water), the per-vertex haze (`vApT`, `vApIns`) and
  `cloudShadow()`. Keep those inputs.
- Clouds are not in the sea's reflection (they are marched in screen space). If the far sea
  needs them, a low-resolution cloud panorama from `src/sky/clouds.js` (it has the weather map
  and the density function) would do.
- Far out, `Rd.y = abs(Rd.y) + ch.z * 1.4` and the Fresnel cut at grazing angles make the far
  sea reflect the deep blue sky 10 to 20 degrees up. The sea beyond 15 km measures 0.6 stops
  darker than the photo, mostly the horizon haze (v2's), partly this. Worth a look with the
  new sky.
- The sea surface curves with the Earth beyond 2 km from the camera (water vertex shader), so
  the horizon sits where it really is. Keep it.

