# v28 — Natural beach sand

## Goal

Sam's September 30 18:41 screenshot shows the beach from the lower stairs looking too
flat, uniform and perfect. Study real sand references and refine the surface texture
so it reads as deposited, weathered and lightly walked rather than a smooth floor.

## Judge against

- Compare the lower-stair view, a beach-level grazing view and a close sand view.
- Combine shallow irregular hummocks, broken wind ripple patches, granular material and
  sparse natural fragments. Keep quiet areas and the earlier five walking lines.
- Wet packed sand should remain smoother than dry backshore sand. Retain the accepted
  wave and swash timing and prevent detail from looking like repeated corduroy.
- Filter small detail at its pixel footprint; avoid sparkle, tiling and abrupt distance fades.
- Preserve the headland silhouette and the accepted cliff junctions from `7ca785b`.
- Render nine hero cameras, check paired frame timings, keep the bake current, and rebuild
  and verify the standalone at four offline stops.

## Scope

The sand material and its surface relief. Preserve rock, water, clouds, ropes, plants,
trail and camera choreography. Reuse existing CC0 scans and authored procedural detail.

## References

- [Natural sand ripple photograph](https://wordpress.org/photos/photo/685663641b/):
  branching, irregular ridges with interruptions and sparse fragments; viewed in browser.
- [Fiji sand sample](https://scienceofsand.info/sand/countries/fiji/fijiout.htm): varied
  pale coral, shell and darker mineral fragments; viewed in browser at macro scale.
- [NPS beach profile changes](https://www.nps.gov/articles/beach-profile-changes.htm):
  wave deposition and erosion shape a berm and a distinct beach face.

References inform the material; they are not shipped or committed as image assets.

## Found by other versions

Preserve v20's sparse footprints, v25's sand/cliff contact and broad geometric relief,
v26's continuous wave and v27's corrected cliff-foot lighting.

## Verification

Work on `codex/v28-natural-sand`, baseline `7ca785b`.

### Material decisions

The first normal-only relief pass was too faint under the scene's nearly overhead sun.
Shader readbacks confirmed the tested sand was dry (`firm = 0`), had surface relief and
was not being smoothed by the wet-material mask. The final material strengthens the
scanned grain normal, adds two elongated relief scales, and couples broken 31 cm ripple
patches to cavity shading. A stronger intermediate pore tint read as smudges; the final
pass reduces it and filters both the second ripple harmonic and small pores.

Surface positions are in world space. Sparse 1–3 cm fragments and micro detail fade before
falling below a pixel. Quiet deposits remain, and all additions become gentler on packed
sand. The existing five walking lines, broad geometric relief and swash wetness remain.
No new texture allocations or downloads are required.

### Result

[Gallery and comparison](../gallery/v28/README.md).

- Four matched sand views and 145 approach/head-turn frames: zero console errors.
- All nine hero renders: zero console messages. Overview and viewpoint land masks have
  zero changed pixels against `7ca785b`; regression check only, local photos unavailable.
- Geometry, scatter, coast, water and the terrain bake are unchanged; bake check passes.
- Paired final medians −6.9% to +4.7%. The first beach measurement was +10.14%; a focused
  16-round repeat was −0.28%. Both runs are retained in the gallery. No new exception.
- Local standalone rebuilt, 55 modules, classic-script parse passed; four offline stops
  passed with zero console errors after loading in 23.0 s. Offline textures use fallbacks.
- No downloads or additional texture allocations. The existing thin blue join across the
  swash film in the grazing view is documented in the v26 brief.

Ready for review; no merge, tag or publication. The material remains an authored surface
approximation, verified from these cameras rather than a claim of perfect realism.
