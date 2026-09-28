# v14: the T-Rex head silhouette

**Goal.** From the clifftop viewpoint, make the end of the headland read as the distinct
T-Rex head in the reference: a peaked crown, a high brow that ends abruptly over the sea,
and a separate tapering jaw over the south end of the beach.

**Sam, after v13:** the head in the landing-page viewpoint looks too rounded and does not
have the iconic shape at that angle. Edit the head's shape only.

## Photos to match

- Sam's 2026-09-28 screenshots of the landing-page viewpoint and Kelingking reference photos.
- `references/02-viewpoint/viewpoint-midday-a.jpg` and `viewpoint-classic.jpg` for the
  camera-matched head silhouette.
- `references/01-overview/topdown-cove.jpg` and `aerial-high-whole-bay.jpg` for the jaw's
  footprint and the beach arch.

## In scope

- The head crown, brow, and jaw in `src/terrain/layout.js`, and a local geometry adjustment
  if the layout controls cannot shape the jaw independently.
- Rebuilding the terrain bake and checking the established camera views.

## Out of scope

Textures, colour, lighting, vegetation, water, the stairs, and the rest of the coastline.

## Done when

- The `viewpoint` render has a sharper crown, a flatter, higher brow, and a readable jaw
  over the beach when compared with the photo.
- The beach arch and the head's footprint still read correctly in `overview`, and the
  head still works from `stairs` and `sideFromSea`.
- The bake is current and hero frame times stay within the project's budget.

## Found by other versions

None yet.
