# Process log

Notes on how this was built, what went wrong and what fixed it. Written as I go, so the
method can be reused for another real place.

## Stage 1: terrain shape (2026-09-24)

### Gather before building

- 34 reference photos sorted by the stops on the scroll (overview, viewpoint, trail,
  beach, water). Straight-down drone shots and one wide aerial matter most, because they
  pin the layout.
- OpenStreetMap through the Overpass API. For this spot it had far more than a coastline:
  cliff-top lines on both sides of the ridge, the trail as steps and paths, and spot heights.
  Worth checking what OSM has before inventing anything.
- The satellite view, only to sanity check OSM. Drawing the OSM lines straight onto the
  Google satellite page (a canvas injected over the map) showed the coastline is accurate to
  a few metres.

### Build the checking tools first

- Shots tied to photos, with position, heading, pitch, roll and lens as plain numbers.
- A headless capture script so every change can be looked at next to the photo without a
  human in the loop. Chrome's DevTools protocol over Node's built-in WebSocket is enough.
- Outline mode. A 50% blend of grey clay over a colour photo is hard to read. Tracing the
  render's coastline and silhouettes as lines on top of the untouched photo made every
  mismatch obvious, and each one pointed to a specific cause.

### Getting the camera from the photo

For the viewpoint photo, the camera came from geometry rather than guessing:

- Horizon height in the frame gives the pitch (the lens was known: an iPhone main camera,
  about 57 degrees vertical for 4:3).
- How far the summit sits below the horizon, with its known height and distance, gives the
  camera height.
- The angle between the summit and the islet gives the heading.

First render with those numbers had the head and islet within a few pixels.

### Mistakes that the outline caught

1. **Fins on the beach wall.** The plateau "shoulder" switched on sharply at the cliff line,
   leaving one-pixel columns 25 m taller than their neighbours. Make every blend continuous.
2. **A trench beside the stairs.** The ridge profile was applied from the viewpoint onward,
   so the plateau next to it got carved down. The finger now starts at its root.
3. **Fake sand on the head.** Between the mapped cliff top and the waterline the generator
   put beach everywhere. Real sand only lives in beach zones. On rock the cliff drops at
   the waterline.
4. **A seam across the beach.** Heights below a cliff were taken from the nearest point on
   the ridge spine, which jumps. Taking them from the nearest cliff-top pixel (the distance
   transform reports it for free) fixed it.
5. **Land that was actually shallow water.** The east bay seabed was so shallow that noise
   poked above sea level. Clamp the seabed.
6. **The flank that hides the shore.** In the photo, the land edge beside the neck is the
   skyline of a bulky flank, not the waterline, which is hidden below it. A raycast from the
   render's pixels to the terrain showed exactly what was being seen and proved the ground
   just below the platform drops about 60 m within 80 m.
7. **Overview rotation.** Solved as a 2D similarity from two points I was sure of (the tip
   of the head and the islet): scale sets the height, the angle sets the heading.

### Known limits after stage 1

- Sheer cliffs smear in close-up shots, because a heightfield has almost no texels on a
  vertical face. Needs triplanar texturing and real wall geometry (stage 3).
- The trail and beach shots have the right composition but not a tight match. They get
  refined with the descent path.
- The terrain only covers 1.6 km, so the overview sees its edges. Needs a low-detail ring
  around it.
- The viewpoint camera sits about 10 m above the modelled platform. Either the OSM summit
  height (111 m) is a little low or the platform is. Worth settling when the descent path is
  built, since the scroll starts standing there.
- The overview photo is CC BY 4.0 and now registered to the map. It could guide the
  vegetation and rock masks in stage 3, with credit.

## Stage 2: water (2026-09-24)

### Targets

Four water photos, each for one thing: straight down on the surf (foam texture and colour
over sand), from the cliff into the cove (the break line and the bands), a backlit breaking
wave at eye level, and the high drone shot (the milky plumes). Two new shots were set up to
match them, `surfTop` and `cove`, plus `shoreBreak` at eye level.

### What the comparisons caught

1. **Rings around the headland.** The first wave train followed the coast everywhere, so
   concentric rings wrapped the rock. Real surf only forms off beaches. On rock the swell
   runs straight into the cliff.
2. **Brown water.** Stirred-up sand first came out muddy brown. The fix is physical: the
   light it scatters back has already lost its red on the way down, so it glows turquoise.
3. **A beige seabed.** The first sand colour was the dry beach colour. Under water the
   reference sand is close to white, and that is what makes the turquoise.
4. **Voronoi foam.** Cell noise read as crackle glaze, not foam. Domain-warped noise for the
   swirls and ridged noise for the filaments works much better.
5. **Pixel steps on the waterline.** The distance-to-shore field was built from a
   rasterised outline and carried its staircase into every wave front. A small blur fixed it.
6. **A row of grey teeth along every crest.** This one took three wrong guesses (mesh
   density, texture resolution, the crest lean) before a hide-one-object test showed it
   came from the water mesh and the normals view showed steep patches. The real cause was
   each wave picking a random size and switching to the next wave's size exactly at the
   crest, a vertical step of up to a metre that a grid can only draw as teeth. Handing the
   size over in the trough, blended, fixed it. Lesson: when a pattern repeats with the mesh,
   look for a discontinuity in the function before blaming the mesh.

### Speed

First version: 16 to 27 fps. Hiding objects showed the water was about three quarters of
the frame, and a half-resolution test showed it was the per-pixel cost. What helped:
direction to the coast baked into a texture instead of sampled four times per pixel,
forward differences for the normal, a shorter shadow march that skips open water, foam
and caustics only computed where they can show, the ring grid scaled with camera height,
and a resolution governor. Now 50 to 68 fps.

### Known limits after stage 2

- The eye-level wave has no curl and no spray. A heightfield cannot fold over, so a
  plunging lip needs its own mesh plus a spray particle layer. That fits stage 5.
- The milky plume in the east bay is patchier and dimmer than in the drone photo.
- Open sea from 1 km up is a little smooth next to the photo's texture.
- Cliff faces still streak, which is stage 3.

## Stage 3: surfaces (2026-09-24)

### Geometry first

The clay renders showed the real blocker before any material could work: cliff faces drawn
from a regular grid come out as vertical stripes and saw teeth along the waterline.

- `heightAt(x, y)`: the generator now builds smooth fields and applies the sharp steps per
  point, so the mesh can ask for the true height anywhere.
- Vertices near a cliff slide along the slope direction to even out their spacing over the
  ground. A few triangles fold where the face is very compressed. Two ways of removing them
  were tried and both made it worse (a blur of the slide field washed out the cliffs;
  halving the slide on folded triangles cascaded into combs of fins). They are left as tiny
  facets and the ground is drawn two-sided.
- Triangle normals zigzag across a rim, so steep vertices take their normal from
  `heightAt` instead. Lesson: the mesh only needs to be good enough for the silhouette, the
  shading can come straight from the smooth surface.

### Materials, against the photos

1. First pass: scrub only on gentle slopes. The photos show the 60 to 70 degree flanks of the
   finger fully covered, and only the sheer faces bare. Threshold moved.
2. Bedding drawn as dark lines read as a barcode, and as dashes on the beach close-up. The
   dashes came from a step in the bump height, which turns into dashes once it is
   differentiated per 2x2 pixel block. Relief must be continuous. Beds now vary in
   thickness, show as ledges only in stretches, and crags do most of the work up close.
3. Vegetation on the faces follows the bedding (clumps stretched sideways), which is what
   the drone photo from the sea shows.
4. Tree crowns 5 to 8 m across in the forest patches give the plateau its texture from 1 km.

### Two bugs worth remembering

- A backtick inside a comment inside a GLSL template string ends the JavaScript string. The
  capture tool now prints the page's console errors when a page never becomes ready, which
  turned an hour of guessing into one line.
- A scripted text replacement matched the same line twice and put code in the wrong place.
  `node --check` passed because it treated the file as a script, not a module. Check module
  files by giving them a `.mjs` name.

### Speed, and measuring it

The new ground material took the clifftop view from about 50 fps to under 20. Measuring was
the hard part:

- The browser pane stops animating when it is hidden, so it cannot be used unattended.
- Frame-to-frame timing in headless Chrome mostly measures the compositor.
- GPU timer queries through ANGLE on Metal return nonsense (negative differences).
- What worked: render, read back one pixel to force the GPU to finish, repeat, average.
  Still about 20% noise on a machine with other apps on the GPU, so it is good for big
  effects only.
- Hiding the ground to measure its cost is misleading: the sea then fills the screen, and
  the sea is expensive per pixel.

What was found and fixed:

- **The logarithmic depth buffer turned off early depth testing.** It writes depth from the
  fragment shader, so every hidden layer of ground behind a cliff was fully shaded. Switched
  to a reversed float depth buffer, which keeps the precision without that cost, and added a
  depth-only pre-pass so the ground shader runs once per pixel.
- Noise octaves smaller than a pixel are now skipped, not faded, and each material is only
  worked out where it shows.
- The per-pixel shadow march (up to 26 dependent texture reads, in both the ground and the
  sea) became one read from a baked shadow-height texture.

Still not fast enough in the overview. See the README.

## Real textures and plants (2026-09-24)

Sam looked at stage 3 and asked whether that was the final texture. It was the right
question: procedural noise read as a 2010 game. His bar, in his words: water, sand and rock
must feel like real life; vegetation can be imagined but must feel alive.

- **Scanned surfaces.** Five CC0 scans from Poly Haven (limestone, layered rock, wet rock,
  rippled beach sand, scrub ground), repacked into three texture arrays and mapped from three
  directions so vertical faces do not smear. Each scan is recoloured by a single measured
  gain (target average / scan average, in linear light) so its detail survives and its
  colour matches Kelingking. The layered-rock scan is used for relief only, except for the
  ochre stain over the beach.
- **Trees as impostors.** Three tree scans (1 to 2 million triangles each) are baked into
  64 views each, colour plus normal, depth and canopy shading, and drawn as one card per plant
  that picks the nearest view and is lit live. 118,000 plants.
- Bug worth remembering: the first bake put all 64 views in one frame. three.js reads a
  render target's viewport when the target is bound, so it has to be bound again per frame.

Better, but not there yet. See the plan in the reply of this date: plants are too uniform
and too dark close up, the rock faces still read as smooth, the sea is too flat far out.

## Stage 0: versions, history and hero frames (2026-09-24)

Sam wants each element worked on in its own chat session, and v1 split into its stages.

- **The history was rebuilt from the session log.** The project had no git. Every file edit
  (tool writes, and the inline Python and sed edits run from the shell) is in the session
  transcript, in order, with the messages that ended each stage. A replay script ran only the
  file-editing parts into a scratch folder and snapshotted it at each stage boundary. The
  check that made it trustworthy: the full replay reproduces all 34 source files byte for
  byte. Generated files (map data, texture and tree atlases) were copied in. Each stage is a
  commit, dated to when it really ended, tagged `stage-1`, `stage-2`, `stage-3` and `v1`.
  Checking out each tag and rendering it proved they all still run.
- **Hero frames.** Eight shots along the scroll path plus the head from the sea, listed in
  `HERO` in `src/shots.js`. Two new placeholder cameras on the mapped trail (`stairs`,
  `trailLow`). The first try put the stairs camera inside a tree, because the scatter planted
  trees on the path. Plants now keep a small clearance from the mapped route until v6 builds
  the real one.
- **`tools/hero.mjs`** renders the hero frames for a version into `docs/gallery/<v>/`, times
  them against the previous version, and keeps side by sides with the photos local.
- **Briefs** for v2 to v9 in `docs/versions/`, and a project `CLAUDE.md` so every new session
  starts with the workflow and the known traps.

- **The frame times were wrong, by a lot.** Rendering the v1 hero frames on a quiet machine
  gave 5 to 14 ms per frame, where stage 3 had measured 30 to 100 ms. Nothing in the
  rendering had changed. During stage 3 the browser pane was showing the page, rendering it
  continuously at full size, and competing for the same GPU. Two back-to-back runs a few
  minutes apart still differed by 30 to 100%. So `tools/hero.mjs` now checks out the
  previous version from its git tag and times both, alternating, in the same run. Only that
  difference counts toward the frame budget.

## v2: light and atmosphere (2026-09-24)

### The photo knew what time it was

The viewpoint photo's page on Wikimedia Commons still carries its EXIF: an iPhone 16 on
6 April 2025 at 11:57:37, ISO 50, f/2.2, 1/1927 s, with GPS on the clifftop and a heading of
222.6 degrees (the shot's yaw was 220.7, set by eye in stage 1). So the sun stopped being a
guess. NOAA's solar position equations put it 73.7 degrees up at a heading of 20.7, just east
of north. v1 had it at 64 degrees from the north-north-west, so some faces v1 lit are in shade
now, and vertical faces only get grazing sun.

The exposure stopped being a guess too: EV100 14.2. And the same photographer's img_05, nine
minutes later on the same phone (EV100 14.05), looks the other way and shows the sky from the
horizon up to 38 degrees. It became a new shot, `eastCove`, kept for its sky.

Worth doing for any real place: check the photo's source page for EXIF before estimating
anything by eye.

### One model for the sky, the haze and the light

- Sebastien Hillaire's 2020 atmosphere (`src/sky/`): lookup tables for transmittance,
  multiple scattering, the sky around the camera and the haze in front of everything
  (32 x 32 x 32 froxels in one 2D atlas), for a sun of unit strength. Real units: 127 klux of
  sun above the atmosphere, kcd/m2 for radiance.
- The same tables give the sun's colour at the ground and the sky light on every surface.
  The sky is rendered once from 50 m, read back, and projected onto spherical harmonics for
  three.js's light probe and for the sea's and the plants' own shaders.
- White balance like a camera: sunlight plus skylight on flat ground comes out neutral, set
  for the photo's noon and then held, so a late afternoon still comes out golden.
- Exposure like a camera: a reflected-light meter puts 12.5 x 2^EV100 / 100 cd/m2 at middle
  grey. One exposure for every shot.
- First render with nothing tuned: the sky matched the same-day photo within 0.3 stops at
  every elevation from 5 to 32 degrees, and at 32 degrees the colour was (54, 100, 162)
  against the photo's (54, 99, 165).

The sea's old flat horizon had a real bug behind it: the camera's far plane was 30 km, so
from the clifftop the sea stopped short of the horizon (44 km away) and a strip of pale sky
showed below it. The far plane is 400 km now, and the sea curves with the Earth beyond 2 km.

### A tool that compares numbers, not pictures

`capture.mjs --measure` renders the shot twice more: once with every material drawing a flat
class label (sky with its elevation, sea with its distance, sand, rock and ground cover in sun
or shade, plants), once into a float target before the tone curve. Then it averages the same
pixels in the render and the photo. The model and the photo never line up exactly, so pixels
near a class boundary are dropped and medians are reported too. Shots can also carry
rectangles, placed separately on the render and the photo where the shapes differ.

`--set` passes any page switch and `--eval` reads anything back (a PNG data URL is saved as an
image). The first haze sweep came back identical for three different values: the flag parser
split `--set=haze=10` at the second `=`, so every run had no haze at all.

### What the numbers said about haze

- More aerosol greyed the high sky and did not lift the low sky. The photo's sky gets brighter
  toward the horizon faster than any setting of the physics gives. The rest is most likely the
  phone: Apple processes skies separately, and the ultrawide's corners may keep a little
  vignetting. I stopped chasing it at about 0.25 stops.
- The far headlands in the same-day photo keep about 80% of their colour at 1.5 to 2 km, so
  the air by the sea is much hazier than the sky above says. Two aerosol layers fixed that: a
  light background, and a dense sea haze in the lowest 350 m.
- The first sea haze made the horizon darker and grey. With a single forward lobe the haze
  scatters very little to the side, and the viewpoint looks away from the sun. Measured
  aerosol phase functions have a backward lobe, and small droplets scatter blue more than red.
  Both together brought the horizon back part way.
- Where it ended: sky within 0.25 stops from 12 to 32 degrees, the far sea at 5 to 15 km
  within 0.1 to 0.3, the horizon band 0.35 stops dim and less blue than the phone makes it.

### The materials were tuned to the old light

Under the physical light the rock, the sand and the shallow water came out 0.3 to 0.8 stops
too bright. v1's sun was about 1.5 stops weaker relative to its sky than the real one, and
every colour had been picked to look right under it. A throwaway test with plausible
reflectances (limestone about 0.31 instead of 0.52, sand about 0.49 instead of 0.79, the sea's
scattering at 0.45 of its value) put the sunlit islet face within 0.06 stops of the photo,
the sand within 0.13, the mid sea within 0.2 and the far sea within 0.03. So the light is
right and the materials are next. That test is not committed: the numbers are in the v3, v4
and v5 briefs, where the work belongs.

The plants went the other way. v1 gave them sky light at about 27% of the sun; the real sky
gives about 10%, so shaded foliage got darker. Their leaves average about 0.04 reflectance in
the atlases, and real leaves are 0.08 to 0.12. That is in the v7 brief.

### Clouds, in four goes

1. A fixed 44-step march: a wall of big identical domes on the horizon, and grainy, because
   steps of 400 m cannot resolve billows of 140 m.
2. Steps that grow with distance, detail left out where the step is too long, fewer and
   smaller clouds: the right sizes, but a regular pattern of dashes. Each coarse step either
   missed a cloud or landed deep inside it, and the lighting jumped from step to step.
3. On the first hit, back up one step and go on in fine steps: dashes gone, but smooth domes
   with blocky edges. Hard edges at half resolution show the texel grid.
4. Shape from billow noise kept where the weather map says there is cloud (how production
   cloud renderers do it), soft edges, a B-spline upsample: small, lumpy fair-weather cumulus
   with flat bases.

Clouds on the horizon seen from the clifftop are 100 to 140 km away, so the march and the
haze froxels had to reach 150 to 160 km before the band on the horizon filled in like the
photo's. The sky over the island is kept clear, as it was that day, so cloud shadows fall
on the open sea.

### Light between surfaces

- `beach-under-cliff.jpg` shows the overhang's ceiling glowing ochre, lit by the sunlit sand
  below. Each ground pixel now looks down and out along its normal, reads what is there from
  the terrain data (sea, sand or scrub), checks whether the sun reaches it, and takes that
  light. The sky probe on the ground carries the sky alone, so nothing is counted twice.
- Leaves pass light through (yellower) and have a waxy sheen. The first version mirrored
  downward reflections back up into the sky and the trees went frosted blue-grey, like olive
  trees. Downward reflections see ground and other leaves, whose light is already in the
  diffuse terms.

### Speed

The first full timing had six of the eight hero frames 14 to 24% slower than v1. Getting
back under 10% took most of an afternoon, and most of what I tried first did nothing.

- The bench timed `renderer.render` only, so the new passes were invisible to it. It now
  times `window.__app.renderFrame()`, the whole frame.
- Frame times on this Mac drift by 10 to 60% between runs (the desktop app's GPU process was
  busy). What finally gave steady numbers: in one page, switch things on and off in turn,
  six or seven rounds, and take the median (`--benchpage --eval`), and compare v1 and v2
  with the same harness.
- Ablating each new piece of the ground shader on its own (the haze, the bounce, the cloud
  shadow, the sky probe) saved almost nothing, yet swapping v1's ground shader back in saved
  1.5 ms at the overview. And the haze cost the same with its texture reads removed, with
  its maths skipped but its vertex outputs kept, and done per pixel instead of per vertex.
  So it was not the work. The ground shader is already heavy, and anything that stays alive
  through it (a vertex output, a value worked out early and used late, a branch that is
  never taken) costs about the same: the GPU fits fewer copies of the shader at once.
- What worked, by that logic: the haze packed into one vertex output instead of two (within
  2 km one transmittance serves all three colours), the bounce worked out at the end from
  the final normal instead of early and carried through, the measuring labels made a
  compile-time switch instead of a branch, cloud shadows on the island only compiled in when
  clouds can get over it, and the bounce faded out beyond 800 m. The ground's extra cost went
  from about 1.4 ms to 0.4 ms at the overview.
- The sky tables and the cloud march are only redrawn when the view, the sun or the clock
  changes. A still frame reuses them. Moving (as along the scroll) they add 0 to 0.6 ms, the
  most where the sky fills the frame (`shoreBreak`); the hero frames, being still, do not show
  that, so it is in the v9 brief.
- Three official `hero.mjs` runs against v1, with other apps busy on the machine the whole
  time. Each frame's change moved by up to 8 points from one run to the next:

  | Frame | Run 1 | Run 2 | Run 3 | Average |
  |---|---|---|---|---|
  | overview | +8% | +12% | -3% | +6% |
  | viewpoint | +9% | +3% | -3% | +3% |
  | stairs | +12% | +9% | -4% | +6% |
  | trailTop | +6% | -5% | 0% | 0% |
  | trailLow | 0% | +1% | +13% | +5% |
  | beach | +6% | +2% | +11% | +6% |
  | shoreBreak | +6% | +6% | +10% | +7% |
  | sideFromSea | +4% | +4% | +16% | +8% |

  No frame was over 10% in more than one run, and the last run (in `docs/gallery/v2`) had the
  most background load. Worth a clean rerun on a quiet machine at the start of v3, as its
  baseline.

### Beyond the photo's hour

Nothing in the light is tuned to noon: the sun follows the real date and place, the air is
the same air, and the white balance stays where the camera had it. So
`capture.mjs viewpoint --clip=10 --hours=6.42:17.92` runs the photo day from just after
sunrise to golden hour, with the headland's shadow swinging across the bay, and each frame
comes out plausible without touching a setting. That is the best check I have that the model
is physical rather than fitted to one photo.

### Still weak

- The horizon band is 0.35 stops dimmer and less blue than the phone renders it.
- No clouds in the sea's reflection (they are marched in screen space).
- No far coast to fall back into the haze in `sideFromSea`: the terrain stops 1.6 km out.
- One exposure for every shot, so the shade under the overhang will read dark next to the
  sunlit beach, as a camera would. The descent (v8) may want the eye to adapt.
- Until v3 to v7 retune the materials under this light, the hero frames look brighter than
  the photos in rock, sand and shallow water, and darker in the plants.
