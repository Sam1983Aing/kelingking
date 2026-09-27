# v11: speed and the shareable build

(This was v9 until 2026-09-27, when Sam added a final pass on the look as v9, and v10 until
later that day, when he asked for a polish pass as v10. Earlier sections of `PROCESS.md` call
it the v9 or the v10 brief.)

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

**From v5 (sand).**

- Anything in the ground's vertex shader is paid for by every vertex of the island, every
  frame (the mesh is one draw of 2 to 4 million vertices). Working the swash out per vertex on
  the wet sand, a few thousand of them, made `beach` 1.2 ms slower. A map made once per frame
  (`swash-map.js`, 1024 square) costs next to nothing. A level of detail for the ground mesh
  would help every version after this.
- The sea's shaders are at 16 texture units, the limit WebGL guarantees. v5 took one back in
  the vertex shader (`uOceanV`, three displacement cascades instead of four). Anything else
  the sea needs to read will have to share a texture.
- `tools/parts.mjs` times parts of a frame in one page (compile switches on the ground's and
  the sea's materials, alternated over many rounds). It found the costs above.
- Frame times after v5 against v4: within 10% everywhere except `beach` (+13% in `hero.mjs`,
  +16% in `ab.mjs`), whose camera moved to 14 m from the water and now sees mostly close
  sand. At v4's camera the same frame is +5% (`ab.mjs beach --set="cam=124,200,4.4,208,-3.8,40"`).
  What that frame pays for: the close-range sand scans (up to three samplings of two scans,
  about 1 to 1.7 ms), the swash's foam and sheet on the sea (0.5 to 0.9 ms). Levers: one
  sampling of the trampled scan instead of two blended, or baking the sand's close-range
  detail into fewer textures.
- The foam simulation now also works out the swash each step (`surf-sim.js`), which makes
  its step dearer (not measured separately; it runs when the clock moves).

**From v6 (trail).**

- The path adds two meshes (the concrete and the dirt, about 30,000 triangles) and six
  instanced meshes (posts, rails, logs, rope: about 1,500 instances), all drawn into the
  ground's depth pass first. Without that the ground's shader ran under the treads: +18% at
  `trailTop`, +6% with it.
- Its surfaces are a texture array of their own (four scans, 2048 colour, 1024 normal and
  mask; about 9 MB of JPEG, about 130 MB on the GPU with mipmaps: 4 layers of 2048 RGBA8 is 64 MB before them). The page waits for them
  before a capture is ready.
- The ground's shader is v5's. A read of the path's mask in it (one small texture behind a
  rectangle test) cost 2.2 ms at `overview` and was taken out: anything added to that shader
  costs, whether it runs or not (v2's finding, again).
- Generating the terrain: the route and the carve add about 0.4 s in the worker at 2048
  (a grid of 25 cm over the path's box), and every `heightAt` call after it pays one more
  bilinear lookup. The path's geometry is about 35 ms.

**From v7 (plants).**

- Over budget at the end of v7, against v6 in `ab.mjs` (24 rounds, a busy Mac): `trailTop`
  +22%, `trailLow` +16%, `sideFromSea` +13%, `viewpoint` +12%. Across the day's runs these
  swung from +4% to +23%, and `hero.mjs` put them all within budget once. `overview` and
  `stairs` are about 10 to 20% faster (fewer, cheaper impostors than v1's scanned trees).
- What the extra is, as far as it was pinned down: the plants cost almost nothing on their
  own, and a lot in combination with the ground. Measured in one page with `ab.mjs --a=self`
  and page switches (removed after, see PROCESS.md v7):
  - All plants hidden: 16 to 19% faster. Only the near plants hidden: 2 to 5%. Only the
    impostors hidden: 0%. Every other near plant, or every other impostor: 0%. With the
    ground hidden, the plants cost 0 to 5% over the sea.
  - the ground's depth pass (`terrain-mesh.js`, renderOrder -2) saves 34% at `viewpoint`
    with no plants, and 8% with them. The plants sit between it and the ground's colour pass
    (renderOrder -1), and most of them cut out their shape in the shader (discard, alpha to
    coverage). On Apple's tile-based GPUs that is known to stop hidden surfaces being
    skipped for what is drawn after, in the tile.
  - Tried without a gain: the plants after the ground's colour pass (11% worse, the ground
    is then shaded under every plant), the plants before its depth pass, a depth-only pass
    for the impostors with their colour drawn at equal depth, no alpha to coverage, a stencil
    mark from the plants that the ground's colour pass tests, the ground's colour pass on
    front faces only, half the triangles in the near leaves, half-precision varyings.
  - Not tried: moving the ground's expensive shading into a pass of its own (shade the
    ground once per pixel from a thin G-buffer, or a visibility buffer), which would make it
    independent of what is drawn in front of it. Or a Safari/Chrome GPU capture (Xcode's
    Metal debugger on Chrome's GPU process) to see what the tile does.
- Loading: the plants are grown in the page, about 0.8 to 1.2 s of JavaScript at load
  (`createVegetation`, `growMs` on `__app.plants`), and their impostors baked on the GPU in
  about 0.1 s. Nothing to download, but the first frame waits for it. It could run in a
  worker (the growers are plain JavaScript over arrays, and only `geometry()` touches three.js).
- 183,000 plants in the scatter (the worker, about 2.4 s at 2048), 173,000 impostors drawn
  as one instanced draw per species and variant, all of them every frame (off-screen ones stop
  in the vertex shader). A grid of chunks culled on the CPU would save the vertex work, which
  measured as small here.

**From v8 (the scroll).**

- **Loading is the slow part now.** The landing page takes about 14 to 16 s from opening to the
  loader lifting (headless Chrome, M1 Max): the terrain in the worker (3.3 to 3.7 s at q=1024,
  plus 1.3 s for the mesh), growing the plants on the main thread (2.2 to 2.6 s, during which
  the loader's counter freezes), 26 MB of textures, then every shader compiling while the
  loader draws one frame at fifteen points down the path (`warmUp()` in `scroll.js`, which
  also times four of them to pick the pixel ratio). Shipping the generated terrain, and growing
  the plants in a worker, would take most of it away. One warm-up frame on the sand once took
  96 ms (a first use of something there, never seen again).
- **Frame times along the path** (`tools/path-bench.mjs`, 21 cameras, 1400 x 788 at pixel
  ratio 1): 5 to 13 ms a frame, still or moving. The slowest stretch is the start of the
  flight (tau 0 to 0.5, 10 to 13 ms), then the water's edge at the end. The page itself held
  60 fps scrolling top to bottom at 2268 x 1417 (pixel ratio 1.5; `--pace --dpr=2
  --size=1512x945`), 3 frames of 2,479 over 25 ms, none over 50. The same as v7 drawing the
  same cameras (median +1 to +3%, inside the noise).
- **The standalone build has new dependencies**: GSAP 3.15 (`index.js` and `SplitText.js` as
  ES modules), Lenis 1.3.26 (`dist/lenis.mjs`, `export { Lenis as default }`), and the fonts
  from Google Fonts (Instrument Serif, Inter). `scroll.js` imports `buildPanel` from
  `debug.js` for `?debug`, which pulls in lil-gui and OrbitControls, and `debug.js` has the
  tools' dynamic imports (`measure.js`, `fit.js`); a standalone build can leave the tools out.
  No top-level await was added.
- **Phones have not run it.** The layout was checked at 390 x 844 in headless Chrome. The scene
  is the desktop's: 3.4 M terrain triangles at q=1024 and 215,000 plants. A phone will need a
  lighter scene (q=512, fewer and simpler plants), picked before loading.
- **The opening is limited by the terrain's extent.** It is 1.6 km across, so on a wide screen
  the flight has to start low enough that the frame stays on it: about 670 m at 16:9 and 570 m
  at 21:9 (`startHeight()` in `path.js`), not the overview's 1.1 km. A coarse ring of far
  terrain around the model (the rest of the island) would let it start higher, and would also
  give the far coast the drone photos have.

**From v9 (the final pass).**

- **The budget is spent.** Side by side with v8 (`ab.mjs --hero`, 20 to 24 rounds) every hero
  frame is within 10%, but `stairs` sits right on the line: +9 to +12% over five runs, +10% in
  the last. Bisecting it over v9's commits (`ab.mjs stairs --a=v8 --b=<commit>`, new in v9)
  puts it in three small pieces, none of them one thing to take out: the foam seen from above
  (+4%), the white water at eye level (+2%), the plants on the faces (+3%). Anything v10 adds
  should come with a saving.
- **The clouds are amortised.** They are marched one pixel in sixteen per frame and carried over
  with reprojection (`clouds.js`); a whole march is 0.5 to 4 ms, the per-frame one 0.4 to 1.3
  ms, on par with v8's march of simpler clouds (`tools/cloud-bench.mjs`). A jump or a still
  frame pays for a whole one. The weather map is 1024 square with a third channel now, and
  the noise textures (64^3 and 32^3) are made on the CPU at load: both could ship as files.
- **More plants to grow at load.** A seventh species (the face scrub) adds two variants to grow
  and bake. The count went down (205,000 against 215,000), so drawing them costs about the
  same.
- **The scroll is longer**: 18.8 screens, from 16.7. The switchbacks got 2.1 more so the view
  can turn with the path without spinning.
- **Drag to look around** adds pointer handlers and `touch-action: pan-y` on the stage; nothing
  per frame when nobody drags.
