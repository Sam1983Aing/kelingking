# v17: more natural clouds

**Goal.** Make the clouds in the scrolling Kelingking scene feel more like real tropical fair-weather cumulus. Keep the scene's clear interval over the island and its existing sunlight, horizon haze, and ocean color coherent.

## Judge it against

- The sky in the local `viewpoint`, `eastCove`, `overview`, and `sideFromSea` reference photos: varied, connected cumulus bodies with distinct sunlit tops and darker undersides, plus softer distant clouds along the horizon.
- Compare the same frozen sky moments before and after at the clifftop and coast views, then inspect moving scroll footage for popping, streaks, or repeated shapes.
- Preserve terrain, plants, head silhouette, beach, and waves. No hero frame more than 10% slower than v16 in a paired run. Time the cloud march separately too.

## Current weakness

The distant clouds in the clifftop hero read as small bright dashes and flecks; larger forms can appear similarly lit across their tops and bases. The sky has less depth and natural variation than the photos even though the scene already has a volumetric cloud marcher.

## Scope

Cloud placement, density profile, lighting, and their integration with the sky renderer. Keep the sun direction and the wider atmospheric color model consistent with the existing scene. No new external assets.

## Found by other versions

None yet.
