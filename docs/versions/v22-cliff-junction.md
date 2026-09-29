# v22 — Continuous beach cliff junction

## Goal

Rebuild the lower cliff mesh where it meets the beach. Sam's 2026-09-29 15:15–15:16 screenshots show blue triangular teeth under the overhang and a faceted limestone apron along the nearby wall. Replace those artifacts with a continuous weathered lower wall and a gently graded sand contact.

## Judge against

- The supplied beach views facing both ends of the cove and the nearby wall.
- Neutral geometry, separated grid and cliff surfaces, and finished materials at walking height.
- The beach and low-trail hero views, with the established headland outline and frame budget preserved.

## Found by other versions

- v21 did not remove the lower-wall overlap artifacts from both ends of the beach.

## Implementation

Separated grid and cliff renders traced the blue teeth to partial ground cells protruding
through the carved wall. The grid now carries a continuous sand floor under the cave, while
the cliff strip carries the rising rock. Shared floor vertices close the cells removed from
behind the wall and retain the submerged beach slope at the shoreline.

Lower cliff rows join by physical elevation; the wall's lower positions are smoothed
over neighbouring columns, with the buried toe retained. Shortened profiles at concave
corners find the actual beach foot before the undercut is calculated. The bottom of each
rock strip is seated below the sand instead of leaving a faceted apron, and the strip no
longer paints sand onto itself.

At the preview resolution: 1,202,293 vertices and 1,175,130 triangles, compared with
1,190,189 vertices and 1,170,373 triangles in v21 (+1.0% vertices, +0.4% triangles).

Checkpoint branch: `codex/v22-cliff-junction`. Sam's review is pending; no merge or tag.

## Verification

- Separated grid and cliff surfaces identified the overlap; close neutral and finished
  views checked the rebuilt wall at both ends of the beach and beside the last stairs.
- Nine hero frames rendered with zero console messages. Viewpoint and overview silhouettes
  were compared with the v21 renders; the local reference photos were unavailable.
- Eight alternating rounds of six frames against `e03424b`: median paired changes from
  -5% to +5%, all within the 10% limit. See [gallery](../gallery/v22/README.md).
- Terrain bake current, indices exact on packing round trip, local standalone rebuilt.
- Offline standalone opened without console errors; four scroll stops checked.
