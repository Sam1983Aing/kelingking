# v23: clouds, clifftop platform, persistent grass and attached cord

**Goal.** Preserve the larger cloud silhouettes Sam likes, sharpen their resolved detail during motion, and replace isolated white dots with connected, naturally shaded small cumulus.

## Judge it against

- Sam's three September 30 screenshots at the clifftop: the larger forms are accepted; blur and detached bright flecks are the defects.
- Frozen before/after cameras looking east and southwest, plus the coast and the moving scroll.
- Keep cloud sunlight and haze consistent with the atmosphere. All nine hero frames must stay within the 10% paired frame budget against checkpoint `6463322`; also measure the moving cloud pass.

## Scope

Cloud weather morphology, density detail, sun sampling, and temporal reconstruction. Sam then requested a black foreground fix at the clifftop scroll stop: inspect and correct the platform shading and verify the nearby scroll positions. No external assets.

## Found by other versions

None.

## Further user steering

Sam requested consistent vegetation coverage from the overview through the ridge approach. Grass had no distant impostor and existed only within 22 m of the route. Add matched distant grass and a sparse open-ground fill while preserving existing shrubs, trees, path clearances, cliff rock and sand. Judge coverage from above and at the same world positions along the scroll.

## Implementation

- Resolve clouds at three quarters of the drawing buffer, capped at 1920 pixels, with a faster temporal refresh and bounded cubic history reconstruction.
- Start fine ray samples at the weather envelope, give small cumulus a continuous body, preserve parent cloud height for distance filtering, and fade undersized independent sites and isolated opaque flecks.
- Keep the accepted broad large-cloud shapes while adding secondary surface relief and stronger internal light contrast.
- Mark the platform top as a separate concrete face. Its old stair tag gave every vertex a zero riser distance, suppressing direct sunlight across the entire pad.
- Bake grass impostors from the existing close grass. Append a separate seeded sparse scatter in open headland areas outside the existing trail corridor, preserving earlier plants and clearances.

## Validation

All nine hero views rendered with zero console messages. Twelve alternating rounds of eight
complete frames against checkpoint `6463322` pass the 10% budget at every camera; the final
close stair geometry passes a separate sixteen-round check at +1.5%. Moving-cloud checks
measure +4.8% for large clouds and -3.2% for the horizon. See the v23 gallery for all results.

Scroll stills cover tau 0.4, 0.94, 1.012, 1.18, 1.7 and 2 for grass and the platform, and
2.6, 3.65, 3.8 and 3.9 for the bamboo descent. The final stair movement clip covers tau
3.58 to 3.68. Macro joint views inspect both sides and the lowest landing. All 502 wood
interfaces are seated within about half a millimetre.

The terrain bake is current (13.38 MB compressed). Decoded headland positions, normals and
triangle indices match v22 exactly. Local reference photographs were unavailable; supplied
screenshots and stored v22 renders support visual comparisons. No assets were downloaded.
The local standalone was rebuilt and opened with the network blocked, generating terrain
without console errors.

## Rope steering

Sam's next four close stair screenshots expose visibly detached blue cord and rail ends.
Rebuild joints against the actual bowed, tapered wood: both overlapping rail spans touch
posts, cord follows their combined surfaces, and compact knots/short tails read at arm's
length. Preserve the walking path and retain efficient distance culling. Procedural braided
relief supplies fibre direction, wear and roughness without another downloaded asset.

## Review state

Implementation and verification are complete on `codex/v23-cloud-detail`, ready for Sam’s
review. Fine cloud wisps intentionally remain soft; extremely close bamboo surfaces are
still procedural. The larger cloud silhouettes and the established headland geometry are
preserved.
