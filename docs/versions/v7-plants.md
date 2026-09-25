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

**From v2 (light).**

- The sky light that reaches the plants is now physical: about 10% of the sun on a surface
  facing up (it was about 27% in v1, which was too much). So shaded foliage got darker, and
  the dark crowns are mostly the leaf colour, not the light.
- Measured on `viewpoint`: sunlit canopy averages about 1.7 kcd/m2, an effective reflectance
  of about 0.045, against about 0.06 for the photo's scrub (the `plants, sun` region reads
  about 1 stop dark). The leaves in the atlases average about 0.04 linear reflectance (times
  1.45 in the shader); real leaves are 0.08 to 0.12 in the green.
- v2 changed how the impostors take light (`impostors.js`): light through the leaves from
  behind (TRANS 0.6, yellower), a waxy sheen (GGX, F0 0.034, roughness 0.45) that mirrors the
  sky and catches the sun, and sky light from the spherical harmonics on the side each leaf
  faces. Keep the inputs (`uSunIrr`, `skyIrradiance()`, `skyRadiance()`, `cloudShadow()`, the
  per-vertex haze) if the shading is rebuilt.
- The `plants, shade` region of `--measure` is not comparable: the photo has scrub, not
  shaded trees, at those pixels.

**From v3 (rock).**

- Plants follow the carved faces: `scatterPlants` gets a `surfaceShift` from the mesh builder
  and moves each plant in or out with the face; nothing grows where the face is cut in more
  than 2.5 m (under the overhang).
- The ground cover on the faces is still the scrub texture in bands along the ledges. From
  `sideFromSea` and `viewpoint` those bands read as painted green stripes. In the photos the
  ledges carry clumps of real bushes, and the islet's east side and the head's flanks are
  green at 60 to 70 degrees, steeper than the cover rule allows (bare above about 72
  degrees, `smoothstep(0.3, 0.46, up)`).
- The ledges are the tops of the hard beds now (`uStrataB.g`, hardness, in the shader), so
  plants on ledges can use the same table.
