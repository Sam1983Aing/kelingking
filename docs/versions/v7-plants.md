# v7: plants

**Goal.** Vegetation that feels alive. Sam's words: it does not need to match the photos
exactly and can be imagined, but the grass, the leaves and the branches must feel real.

## Photos to match, loosely

- `references/02-viewpoint/*`: the ridge and the head covered in dense green scrub, sheer
  faces bare, clumps hanging off the ledges.
- `references/01-overview/aerial-high-whole-bay.jpg`: the plateau texture from the air.
- `references/03-trail/*`: bushes along the path close up (mostly dry season in these).
- `references/04-beach/beach-white-sand-cliff.jpg`: bushes clinging to the wall.

Season: green, wet season. It is the version people picture.

## What is wrong in v1

- Too dark and too uniform. Three temperate tree scans, and nothing else.
- From the viewpoint they read as dots, not a canopy.
- Up close (`stairs`) they are flat, dark cards.
- No wind.
- No grass, shrub, fern or creeper layer. The plants on the ledges are blobs painted into the
  rock.
- From 1 km (`overview`) the plateau is too even and too dark.

## In scope

- More species that fit a dry tropical island: shrubs, grasses, pandanus, coconut palms on the
  plateau, creepers on the ledges. CC0 scans, ask Sam before downloading.
- Real 3D plants near the camera, the baked impostors only far away, with a clean blend.
- Wind: leaves and branches moving, gusts moving across the slope.
- Better impostor lighting (the dark crowns), density and clumping like the photos, the edge
  along the trail, and the ground under the plants.

## Not in scope

The rock (including the bare faces between the ledges), the trail geometry, the light.

## Files

`src/veg/*`, `tools/bake-impostors.*`, `tools/fetch-assets.mjs`, the ground-under-plants part
of `src/terrain/terrain-shader.js`, the `plants` settings in `src/terrain/layout.js`,
`assets/veg/`.

## Done when

- The `stairs` foreground holds up close.
- `viewpoint` and `overview` coverage reads like the photos' scrub.
- A clip with wind reads as alive to Sam.
- Frame budget holds (plants are the likeliest to break it).

## Found by other versions

(nothing yet)
