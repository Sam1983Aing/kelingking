# v30 — Final water texture and wave polish

## Goal

Polish the accepted continuous swell, folding lip, impact and shore foam. Sam wants
one final pass over water texture and smoothness, preserving the motion he approved.

## Judge against

- Review complete matched beach and lower-stair cycles against `fe00f69`.
- Remove residual shading joins, unstable small detail and abrupt texture motion.
- Preserve the wave timing, crest travel, accepted lip shape and coherent foam handoff.
- Check grazing swash and distant water as well as the breaking crest.
- Render nine heroes, pair frame timings against `fe00f69`, preserve the land outline,
  check the bake and rebuild/test the local standalone at four offline stops.

## Scope

Water materials and their shared motion. Work on `codex/v30-water-polish` from
`fe00f69`. Reuse existing assets; no downloads or publication.

## Found by other versions

- v28 saw a thin straight blue join across the swash film at camera
  `[110,203,3.8]`, yaw 295, pitch −8, clock 17. Reproduce during this review.
- Keep v26's accepted crest/lip timing and bubble correction. Its documented original
  water-level performance exception remains; this pass must meet the incremental gate.

## Review checkpoint

[Gallery and recorded cycles](../gallery/v30/README.md): accumulated travel carries
ripples and caustics; wash thickness blends through reversal; the bore/sheet normal
and reflection transition are smoother. Fine foam fades by pixel footprint.
The shared crest data are unchanged across 933,976 finite values in two full cycles.
The thin blue shore stripe is softened into the reflective wash; a broad shoulder remains.

Nine heroes, paired timing gates (−2.5% to +7.6%), current bake, both unchanged land masks,
module parsing and four offline standalone stops pass. The GPU sheet test removes the
centimetre thickness jump at reversal. No new performance exception; the historical
v26 water-level exception remains. Ready for Sam's visual review.
