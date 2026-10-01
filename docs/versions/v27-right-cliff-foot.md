# v27 — Right beach wall foot

## Goal

Sam's September 30 18:40 screenshot shows the right side of the beach looking less natural
than the left, especially the lower wall. Refine the bottom rock shape, its weathering and
its contact with the sand. Retain the accepted wave polish and other scene elements.

## Judge against

- Reproduce the reported beach head turn and compare both cove directions.
- Inspect textured and plant-free clay views to distinguish geometry from material defects.
- Remove artificial stepped edges and flat or stretched lower-wall texture; keep natural
  limestone bedding, recesses and erosion rather than a uniform smooth strip.
- Check adjacent beach and descent angles for openings, overlaps and sand-contact seams.
- Preserve overview and viewpoint land outline against checkpoint `e31c8b0`. Local reference
  photographs are unavailable; report regression checks without a new photo-match claim.
- Render all nine hero cameras and compare paired frame timings against `e31c8b0`.
- Keep the terrain bake current, rebuild the local standalone and verify four offline stops.

## Scope

Lower beach-wall geometry and rock material. Water, ropes, trail, vegetation, upper cliffs
and sand appearance are outside this focused pass except where contact requires seating.

## Found by other versions

Preserve v24's closure beside the lower stairs, v25's curved sand contact and v26's accepted
continuous wave and refined forming lip.

## Verification

Ready for review on `codex/v27-right-cliff-foot`.

- Matched textured and clay views isolated the blue staircase to a lighting discontinuity:
  rows without an outward overhang retained full sky/ground defaults next to occluded rows.
- Low beach walls now account for inward rock in the sky horizon and use the actual sand
  floor for ground bounce. The correction blends out between 18 and 32 m without changing
  open-wall defaults at the upper end.
- The lower right wall reuses scanned bedding and pitted grain at metre scale, softens the
  oversized marble crack colour and varies the ochre stain with runoff and bedding.
- Positions, normals, indices, heightfield, vegetation, water and coast data are identical
  to `e31c8b0`. Only 18,133 lighting vertices change, none above 32 m.
- All nine hero cameras and four paired close-up/clay views render without console errors.
  Overview and viewpoint land-label masks have zero changed pixels.
- All nine paired median frame gates pass (−2.5% to +5.3%, twelve alternating rounds).
  No new exception; v26's original close water-level exception remains.
- Final bake is current. The 55-module local standalone parses and passes four offline
  scroll stops with no console errors, loading in 23.7 s using generated fallbacks.
- No new assets or reference photographs were downloaded. Local photo references remain
  unavailable; no new photo-match or resolved geological reconstruction claim is made.

See [gallery and measurements](../gallery/v27/README.md) for the matched views and readbacks.

