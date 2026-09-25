# v9: speed and the shareable build

**Goal.** Smooth along the whole descent on a laptop, a single file Sam can double-click, and
the repo ready to go public.

## Speed

At v1 (see `docs/gallery/v1/README.md`) every hero frame renders in well under 30 ms at
1400 px on an M1 Max with nothing else on the GPU. The 1 km overview is the slowest, and the
ground shader and the sea cost the most per pixel. Versions v2 to v8 will add cost. Measure
back to back against the previous tag, never against old numbers (see CLAUDE.md). Ideas:

- Cheaper shading far away: fewer texture samples, baked far-field colour for the ground.
- Cheaper water beyond a few hundred metres.
- Plant level of detail and culling, fewer instances far away.
- Ship the generated terrain data instead of generating it at load (about 3 s now), which
  also helps the standalone build.
- Target: at least 60 fps at 1080p on an M1 Max along the path, and 30 fps on a mid-range
  laptop.

## The standalone build

Follow Sam's workspace notes, `../CLAUDE.md` (the folder above this project):

- Assets (textures, tree atlases, terrain data) go to `Sam1983Aing/aura-assets` under a
  project folder, served by jsDelivr, pinned to a tag. Reference photos never go there.
- It runs from `file://`, so no ES module imports in the build. Bundle to a classic script.
  The terrain worker is a module worker today. Shipping pre-generated terrain removes the need
  for it at runtime.
- Inline the stylesheet and font. Degrade without network.
- Verify the bundle with `node --check`.

## Going public

- A licence for the code (ask Sam). OpenStreetMap data stays under the ODbL, credited.
- README written for strangers: what it is, how it was made, the gallery, how to run it.
- Check nothing private is in the history (paths, emails beyond the commit author).

## Found by other versions

**From v2 (light).**

- New per-frame work: the aerial-perspective froxels (256 x 128) and the cloud march (half
  resolution, sky pixels only). Both are skipped when the view, the sun and the clock have
  not changed, so the still hero frames do not pay for them. Along the scroll they will: 0 to
  0.6 ms a frame on the M1 Max, most where the sky fills the frame (`shoreBreak`). The sky
  view table is only redrawn when the camera height or the sun changes.
- The ground shader is at the point where anything added to it costs about the same,
  whatever it does: a vertex output, a value kept alive through the lighting, an unused
  branch (see v2 in `PROCESS.md`). Budget new ground features by what stays alive, not by
  their maths. Measure with `capture.mjs <shots> --benchpage --eval=...`, interleaving
  configurations in one page and taking medians; runs a few minutes apart differ by more
  than most changes.
- New load-time work: the cloud weather map (1024 x 1024) and billow noise (64^3) are made on
  the CPU in `src/sky/clouds.js`, and the atmosphere tables and the sky light on the GPU with
  one read-back. The noise and the weather map could ship as files for the standalone build.
- `tools/capture.mjs --bench` now times `window.__app.renderFrame()` (sky tables and clouds
  included) when the page has one.

**From v3 (rock).**

- The terrain mesh is now a grid (denser over the headland) plus strips for the faces: about
  3.6 M grid and 1.7 M face triangles at q=2048, down from 8.4 M, because cells under the sea
  and cells a face covers are left out. Building it takes 5 to 7 s in the worker at 2048
  (plus about 8 s for the heightfield); at q=1024, 2 to 3 s.
- Per strip vertex the mesh carries two more RGBA8 attributes (`aRock`, `aHorizon`).
- The ground shader reads three small textures more for the bedding (`uStrataA`, `B`, `C`,
  4096 texels wide), only on faces.
- `hero.mjs` times each version with its own `shots.js`, so a frame whose camera moved
  (`trailLow` in v3) is not comparable across that version.
- Frame budget after v3, three `hero.mjs` runs on a busy machine: `overview` and `viewpoint`
  6 to 28% faster than v2, `stairs`, `trailTop` and `beach` +3 to +16% (over 10% in at least
  one run each). The cost is the fine face strips near the beach and trail (`mesh.detail`
  in `layout.js`: 55 cm there, 85 cm on the rest of the headland) and the bedding reads on
  faces. Levers: coarser strips farther from the camera path once v8 fixes it, or a second,
  coarser terrain mesh for distant views.

**From v4 (water).**

- New work when the clock moves (none of it shows in the still hero frames, which freeze the
  sea): the wave spectrum (`src/water/ocean.js`, 4 cascades of 256, 8 FFT passes, about
  0.3 to 0.4 ms), the foam simulation (`surf-sim.js`, 1024 by 1024 at 15 steps a second, so
  a step every fourth frame at 60 fps, 0.11 ms a step), and the breaker's column pass
  (`breaker.js`, one texel per half metre of beach, 0.1 ms). A moving frame came out 1.7 to
  2.3 ms slower than a still one at `beach` and `viewpoint`, so the water's passes are only
  part of it: the sky tables and clouds redraw too when the clock moves (v2's note above),
  and the textures change under the caches.
- A jump of the clock replays 30 s of foam (450 steps): about 440 ms on the M1 Max. A cut in the
  scroll that sets the clock will hitch by that much.
- The sea's vertices do much more work than in v3 (three ocean texture reads, the surf and
  its slope, the wave weights), and at eye level the sea is bound by its vertices, not its
  pixels: half the resolution did not make it cheaper at `beach`. v4 draws only the wedge of
  the ring grid the camera sees and cut the near grid from 960 to 640 rings. More levers: fewer
  segments round the ring far from the view direction, or move the surf's slope back to the
  pixels only where the surf is.
- The breaker ribbon is about 80 k vertices (827 columns of 96) and the spray 21 k points,
  both drawn whenever the sea is. Columns and particles where the beach is not breaking bail
  out early. The ribbon is drawn opaque in 8 m chunks sorted near to far (seen along the
  beach its columns stack up on the same pixels), and its foam patterns only run where
  there is foam. What is left is a few tenths of a millisecond at `beach`, its visible pixels
  (the sea's underwater light, and foam where it breaks).
- `tools/ab.mjs` times two builds open side by side in one browser, alternating, so
  background load falls on both alike. On this Mac it agreed with itself far better than
  `hero.mjs` runs minutes apart (see v4 in `PROCESS.md`).
- Frame budget after v4: the official `hero.mjs` check passed in its final run (every frame
  within +10%), but `tools/ab.mjs --hero` put viewpoint, stairs, trailTop and trailLow at
  +16 to +19% and beach at +26% against v3 (overview +7%, the others about level). The
  water's own share at `beach` measured +0.3 ms over v3 with the sea switched on and off in
  turns. Levers, in order: a cheaper shading path for breaker pixels far away, the surf's
  slope back to the pixels only near the camera, fewer ring segments away from the view
  direction. Single runs of either tool swung by 10 to 40 points for the same frame on this
  Mac, so compare with several rounds.
