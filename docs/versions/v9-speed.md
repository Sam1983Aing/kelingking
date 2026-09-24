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

