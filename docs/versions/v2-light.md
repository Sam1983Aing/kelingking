# v2: light and atmosphere

**Goal.** A clear late-morning day in Bali: the sun, the sky, the haze and the exposure right,
so every material after this is judged under real light.

**Why first.** Rock, water, sand and plants are all tuned by eye against photos. Tune them
under the flat v1 light and they get redone once the light changes.

## Photos to match

- `references/02-viewpoint/viewpoint-midday-a.jpg` and `-b`: the colour and light target.
  Clear sky, strong sun, deep shadows on the head, bright turquoise.
- `references/01-overview/aerial-side-from-sea.jpg`: clouds, haze on the far cliffs.
- `references/01-overview/aerial-coastline.jpg`: haze along the coast with distance.
- `references/04-beach/beach-white-sand-cliff.jpg`: exposure on bright sand. It was shot on
  film and is warm and washed out, so match its brightness, not its colour.

## What is wrong in v1

- The sky is a plain gradient: no clouds, no sun glow, and a hard, pale line at the horizon.
- No haze with distance. The far coast and the islet are as crisp and saturated as the
  foreground, which is the biggest single tell that it is a render.
- Sun and sky strength are guesses, so exposure drifts from shot to shot.
- Shadows on the cliffs lack the cool blue fill from the sky.
- The sea far out mirrors the flat sky and looks like plastic.
- Plants look very dark. Part of that is the lighting (little sky light reaches them). Fix
  the light here and leave their colours to v7.

## In scope

- Sun direction, colour and strength (time of day to match the shadows in the viewpoint photo).
- A sky model with real scattering, the sun disc and glow, and clouds (at least a convincing
  layer, cumulus near the horizon like the photos).
- Aerial perspective: haze and colour shift with distance, for ground, sea and plants alike.
- Sky light (ambient) that is consistent across the ground, sea and plants.
- Exposure, tone mapping and a colour grade matched to the photos. Subtle bloom or glare if
  it helps, nothing stylised.
- Optional, if time allows: cloud shadows drifting over the sea and the land.

## Not in scope

- The colours of the rock, sand, water and plants themselves (v3 to v7). They only receive
  the new light.
- Anything about shape or geometry.

## Files

`src/main.js` (renderer, lights, fog, sky dome), the sky function `SKY_GLSL` in
`src/water/water-shader.js` (move it to a new `src/sky/` shared by everything), new
`src/sky/` and `src/post/`, and the light inputs of `src/terrain/terrain-mesh.js`,
`src/water/water.js`, `src/veg/impostors.js`.

## Done when

- `viewpoint` and `sideFromSea` side by side read as the same kind of day as the photos: sky
  gradient, horizon haze, shadow depth, overall brightness.
- The average colour of the sky and of the open sea in the render is close to the photo
  (measure it, do not eyeball it).
- The far coast in `sideFromSea` falls back into the haze like in the photo.
- Frame budget holds (`node tools/hero.mjs v2`).

## Found by other versions

**From v4 (water).**

- With the sea measured against the photos (v4 in `PROCESS.md`), the open sea from 400 m to
  15 km is within about 0.25 stops of `viewpoint-midday-a.jpg`, and beyond 15 km it stays
  0.6 stops dark. The sky just above the horizon is 0.3 dark in the same photo. That band is
  the haze and the sky at the horizon, not the water: the sea there is mostly reflected sky.
  Worth a look if the light is ever revisited.
- Clouds are still not in the sea's reflection.
