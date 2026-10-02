# v32: Clean foliage edges and pixelation

## Goal

Remove the speckled/pixelated plant effect reported along the ridge and switchbacks,
especially in evening lighting. Verify the cause before changing render resolution.
Keep the accepted camera, lighting, landscape and water.

## Judge against

- Reproduce the 94 m, 88 m and 61 m evening views, checking foliage silhouettes,
  grass and the transitions between detailed plants and distant representations.
- Clean the plant handoffs and any camera-proximity fading without opening coverage
  holes or making nearby plants fill the camera.
- Check the actual main drawing-buffer size and multisample support on desktop/Retina.
- Compare matched stills and moving approaches at 1× and Retina resolution; preserve
  plant coverage from overview through the trail and all four light settings.
- Nine hero renders, paired median timing limit against `5cd561d`, accepted-outline
  regression, terrain bake check, local standalone compilation and offline checks.

## Scope

Branch `codex/v32-foliage-edge-cleanup` from `5cd561d`. Foliage rendering and necessary
resolution handling only. No asset downloads or publication.

## Found by other versions

Preserve v31 camera/time-of-day controls, v30 water and v29 lower cliff/sand contact.
The existing v26 close water-level performance exception remains.

## Result

Replaced whole-pixel stochastic fading with MSAA coverage in both near plant geometry and
distant impostors, with a mild bias to retain the crown through overlap. Culled empty near
coverage intervals. Reproduced the three evening views and checked 0.75×, 1×, 2×, all four
lighting choices, resizing, and two moving approaches. Main targets have four MSAA samples.
The existing automatic resolution policy is preserved. Nine incremental hero limits pass
against `5cd561d` (−2.8% to +4.6%, stairs from a targeted noise recheck). Land silhouettes
are unchanged, the bake is current, and the local standalone compiles and works offline.

See [gallery and raw evidence](../gallery/v32/README.md). This remains an authored LOD
cross-fade with finite MSAA coverage; extremely thin blades can still soften at reduced
resolution. No temporal post-processing or texture/geometry asset changes were required.
