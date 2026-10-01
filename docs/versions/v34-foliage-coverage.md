# v34 — Resolve remaining foliage pixelation

## Goal

Remove the remaining dotted and patterned foliage in Sam's October 1 screenshots at
27 m, 63 m and 95 m, preserving the accepted scene and wind.

## Judge against

- Reproduce all three evening descent views and isolate resolution, leaf masks and
  geometry/impostor transitions before editing.
- Check thin grass and leaf edges in stills and moving approaches at 1× and 2×.
- Preserve foliage density and avoid a visible replacement pop or transparent crowns.
- Nine hero renders, paired performance against `af278c3`, accepted land outlines,
  bake check and local/offline standalone verification.

## Scope

Branch `codex/v34-foliage-coverage` from the accepted current checkpoint `af278c3`.
Foliage rendering only, plus a resolution fix if diagnostics demonstrate a need.
No asset downloads, uploads or publication.

## Found by other versions

Preserve v33's cliff line fix and v32's removal of whole-pixel stippling. Keep the
v26 water-level performance exception; no new exception is assumed.

## Result

The remaining grid came from correlated MSAA masks during whole-plant opacity fades.
Stable leaf/blade selection with a narrow tip reveal keeps interiors solid. The lighter
grass level retains real curved blades, preventing the tuft's texture mask from breaking
up at the transition.

All three reported views pass at 0.85×, 1× and 2×. Four lighting presets and 360 moving
frames were reviewed with no console errors. Nine hero limits pass against `af278c3`
(−9.5% to +6.6%). Accepted land outlines are unchanged; bake and standalone checks are
recorded in PROCESS.md. See [gallery and readbacks](../gallery/v34/README.md).
