# v29 — Lower cliff texture and sand contact

## Goal

Refine the residual odd lower-wall shape in Sam’s September 30 21:15 screenshots and
make the cliff-to-sand junction continuous and natural through adjacent beach views.

## Judge against

- Reproduce both reported views, compare the textured and clay surfaces, and trace
  discontinuities to their geometry or material inputs.
- Keep limestone bedding and weathering continuous through the lower wall. Avoid
  isolated colored polygons, sharp apron wedges and artificial stripes at the sand.
- Seat sand smoothly against the rock without painting sand up vertical walls or
  opening holes beside the final stairs.
- Inspect adjacent cameras and a short moving contact view. Keep the accepted sand
  texture, water, foliage, rope and headland silhouette.
- Render nine heroes, pair frame timings against `3f1978c`, keep the bake current,
  and rebuild and verify the local standalone at four offline stops.

## Scope

The lower cliff surface and its connection with the beach. Reuse existing CC0 maps;
no downloads or publication. Work on `codex/v29-cliff-contact` from `3f1978c`.

## Found by other versions

Preserve v24’s terrain closure, v25’s continuous beach floor, v27’s lower-wall lighting,
and v28’s deposited sand surface.

## Review checkpoint

Five matched textured/clay cameras and two three-second camera sweeps are in
[the v29 gallery](../gallery/v29/README.md). The lower gully uses one rounded recess,
and the stair-side sand bank follows the actual carved toe with a bounded material mask.
Nine heroes, all paired timing gates (−4.0% to +3.8%), current bake and the four-stop offline
standalone pass. Water, coast, trail and plant arrays are unchanged from `3f1978c`.
Outline regression: viewpoint zero pixels, overview one pixel (0.00020% of baseline land).
This remains an authored geological approximation, ready for Sam's visual review.
