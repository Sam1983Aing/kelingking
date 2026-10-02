# v33 — Remove the artificial cliff line

## Goal

Fix the thin dark horizontal line across the cliff behind the final stairs in Sam's
October 1 screenshot. Keep the accepted rock texture, sand contact and landscape.

## Judge against

- Reproduce the beach look back toward the stairs in evening lighting and isolate the
  material, geometry and depth passes before editing.
- Remove the line through both sides of the stair bank, nearby beach positions and
  all four lighting settings, with a short camera sweep and Retina check.
- Keep terrain geometry, coast, vegetation, trail and water unchanged.
- Nine hero renders, paired performance against `6cf2940`, accepted land-outline
  regression, bake check and local/offline standalone verification.

## Scope

Branch `codex/v33-cliff-line` from the current accepted checkpoint `6cf2940`.
Terrain rendering only; no downloads, uploads or publication.

## Found by other versions

Preserve v29 cliff/sand contact, v30 water, v31 camera and lights and v32 foliage fades.
The existing v26 water-level performance exception remains.

## Result

The dark line came from fine limestone ledge shadowing. Its unscaled table margin was
compared against a world-space softness and bias. Multiplying that margin by the local
relief strength removes the artificial seam while retaining bedding texture and shadows.
No depth-pass or geometry changes were needed.

Three beach headings in all four lighting presets, a 2× Retina render and a 72-frame
camera sweep show a continuous wall. Nine heroes render without console errors. Paired
performance passes against `6cf2940` (−12.8% to +3.1%), and accepted silhouettes are
unchanged. The bake and local standalone are current; offline verification is recorded
in PROCESS.md. See [gallery and raw evidence](../gallery/v33/README.md).
