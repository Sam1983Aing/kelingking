# v26 — Continuous shore break

## Goal

Sam accepts the approaching water movement, colour and texture. His September 30 15:39 screenshots show the crest becoming a disconnected blue shape, followed by foam with a separate motion. Refine the near-shore crest, its falling lip, impact and advancing whitewater so one incoming wave carries through the entire sequence.

## Judge against

- Match the screenshot's lower stair view at approximately 20 m, plus the sand and waterline views.
- Record complete wave cycles with a fixed clock and camera against v25 checkpoint `51e68d3`. Inspect crest formation, fall, impact, foam transport and handoff frame by frame.
- Measure column continuity, crest/lip/foam positions and stage changes; no detached patches, abrupt profile switch or foam appearing ahead of impact.
- Retain the accepted incoming water texture, open-ocean spectrum, cliffs, sand, vegetation, ropes and clouds.
- Render all nine hero cameras and run paired median frame timings; no camera more than 10% slower.
- Keep the terrain bake current, rebuild the local standalone and verify offline rendering.

## Scope

Near-shore wave geometry, shared surf timing, breaker shading, impact spray and foam transport in `src/water/`. This is a new focused pass on the remaining weakness in v18.

## Found by other versions

The v18 profile uses a separate ribbon over the heightfield. Diagnose their positions, normals and ownership through the break before increasing detail.

## Verification

Ready for review on `codex/v26-wave-continuity`. [Gallery and motion comparisons](../gallery/v26/README.md).

- Matched 18 s stair and sand clips, clock 13–31 s at 24 fps; close audit at 4 fps. No console
  errors. Crest, falling lip, impact and foam remain joined through the next incoming wave.
- Largest adjacent active crest gap: 6.404 → 1.384 m; gaps over 4 m: 19 → 0. Largest same-wave
  quarter-second travel: 6.000 → 1.457 m; steps over 2 m: 239 → 0. No non-finite active columns.
- All nine final hero renders have zero console messages. Headland land-label masks match
  v25 at overview and viewpoint exactly. References unavailable; regression check only.
- Eight heroes pass the 10% timing gate (−7.7% to +6.8%). The close water-level hero is an
  explicit realism exception: +131.6%, paired ratio 2.316, middle half +90.4% to +164.0%.
  Recorded in PROCESS.md and the v11 speed brief; no claim that this camera passes.
- Bake current. Final local standalone: 3.16 MB, 55 modules, classic scripts parse. Offline
  test loaded in 22.2 s, generated terrain, rendered four scroll stops, zero console errors.
  No downloads or external publication.
- Authored surf model; verification is limited to the recorded cameras and sea state.
  A 1.3 m water-level camera can enter the taller crest; underwater rendering is outside scope.
