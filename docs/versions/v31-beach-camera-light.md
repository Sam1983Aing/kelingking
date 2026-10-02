# v31: Beach camera and time of day

## Goal

Give Sam a wider, composed view of the cove after leaving the stairs, and selectable
morning, noon, evening and night lighting. Keep the accepted stair descent and waves.

## Judge against

- Preserve every guided camera pose through the foot of the stairs (tau ≤ 4).
- Ease into a beach panorama with a level horizon and comfortable lens, then approach
  the wave. Let a dragged beach view remain until reset or returning to the stairs.
- Four accessible lighting options update direct light, sky, clouds, shadows and water
  together, with a readable moonlit night. Retain selection during scroll and resize.
- Verify beach approach forward/backward, camera clearance, look/reset, rapid lighting
  switches, keyboard, portrait layout, reduced motion and restored URL selection.
- Render nine noon heroes, compare paired timings against `8310f05`, preserve land
  outlines, check terrain bake and rebuild/test the local standalone offline.

## Scope

Camera composition after the final stairs and coordinated lighting/UI. Work on
`codex/v31-beach-camera-light` from `8310f05`. Reuse the existing scene; no downloads
or publication. Night lighting is an authored moonlit setting, not a lunar ephemeris.

## Found by other versions

Preserve v30's accepted wave and swash sequence and v29's lower cliff/sand contact.
The historical v26 water-level performance exception remains.

## Verification: 1 October 2026

Ready for review. Eight camera stills and a 377-frame, 24 fps recording cover the last
stairs, beach panorama and water approach. Returning to the stairs clears the persistent
look. A 1,001-sample comparison against `8310f05` reports zero stair pose or camera position
changes, minimum ground clearance 1.498 m and no terrain hits inside 0.6 m at the reviewed
beach cameras (closest hit 3.103 m).

Desktop drag holds the chosen heading across beach scroll; reset restores the guided view.
Eight rapid lighting choices retain the last selection and allocate at most one temporary
dissolve canvas. Phone checks cover 44 px controls without horizontal overflow, restored
night URL, native radio keyboard selection, reduced-motion reset, vertical touch scroll
with the heading retained, and route position/lighting retained through rotation.
All recorded renders and interaction checks have zero console errors.

All nine paired median performance gates pass against `8310f05` (12 alternating rounds,
eight frames each): −0.4% to +5.1%. No new exception. Water-hidden overview/viewpoint land
masks have zero changed pixels. Photo references remain unavailable, so this verifies the
accepted outline rather than a new photo match. Terrain bake is current. The local
standalone compiles 56 modules; networking-blocked testing renders four scroll stops and
the night option with zero console errors, using generated fallback materials.

Review images, camera clip, timing and outline records are in `docs/gallery/v31/`.
Night is an authored moonlit exposure. Light changes dissolve for 850 ms; reduced motion
switches immediately. Moving or scrolling dismisses a dissolve so an old frame does not
cover the moving view. No assets were downloaded or published.
