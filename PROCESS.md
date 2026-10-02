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

## v3: rock (2026-09-24)

### The rims: stop sliding grid vertices, build the faces as strips

v1 slid grid vertices along the slope towards each cliff so the faces got more of them. Two
neighbouring vertices could pick slightly different lines across a rim, and that left a comb
of teeth along every rim and at the foot of the walls. Clay renders with flat triangles
(`clay=2`) showed it was the triangulation, not the surface: the grid simply cannot follow a
curved rim.

What replaced it:

- **A face field.** One signed distance to the middle of every face (where the ground is at
  half the height of the top it falls from), for rock and beach walls alike. Its gradient
  crosses every face at right angles.
- **Strips.** The zero line of that field is traced (marching squares) into chains, smoothed,
  and resampled every 55 cm where the camera comes close (the beach and the trail), 85 cm on
  the rest of the headland. Each point is a column: a line across the face,
  from 16 m out to 34 m in, sampled from `heightAt`, and vertices shared out evenly along it.
  Neighbouring columns are zipped into triangles by how far up their profile each vertex is.
- **The grid stays for the ground**, 1.6 times denser over the headland, and wherever a strip
  covers it, it is pushed back into the rock by the carving plus a margin, or left out where
  the cover is complete. Triangles wholly under the sea are left out too.
- **Rounded creases.** Rims and wall feet in `heightAt` are averaged over about 2 m across the
  face, and the rock faces follow a coastline blurred over 6 m, so a sharp corner in the
  map does not come out as a sharp vertical edge (the jaw's tip looked extruded).

Mistakes on the way, each one found with `clay=2` and a raycast from the offending pixel:

1. Sliding every vertex along its own line was 56 s at 2048 and still folded. Sharing one
   profile per 25 cm of face made it 7 s, and the strips 5 to 7 s.
2. A plate of grid floating over the neck: the grid was pushed out by carving that was
   negative there. Push in only, never out.
3. A green shelf in front of the cave: the grid's big triangles cut across the bend of the
   ceiling. Push by the deepest carving within 2.5 m above or below, and not down under a
   ceiling (down is out into the cave there).
4. Fins at the jaw's waterline: some columns reached the sea and some stopped short, so their
   rows did not line up. The window ends are now smoothed along the face (lowest within 4 m,
   then averaged). And the rows are shared out by the uncarved profile: sharing them along
   the carved one shifted every row above a notch that was a little deeper in one column than
   the next.
5. A lone pillar in the cave: the limit on how deep the carving may go (so the jaw cannot be
   cut through from both sides) came from a curvature, which is noisy. Now the lowest within
   4 m, averaged, and taken from how far the middle of the rock is.

### Carving

Carving moves points across the face only, never up or down, so the ground keeps its height
and can hang over itself.

- **Bedding, one table for mesh and shader** (`strata.js`). Packages of 3 to 14 m, massive or
  thin-bedded; beds with rounded noses; a recessed parting between every two, which from a
  distance is the line you see. The mesh carries the packages (up to 0.9 m in or out), the
  shader the rest. Both read the same bed coordinate (height plus a gentle warp across the
  island, written with sines only so JavaScript and GLSL agree), so a ledge in the geometry
  and its band of colour line up.
- **Buttresses and bays**, 2.4 m in and out over tens of metres, changing with height.
- **The notch** varies in depth and height along the coast, and is 11 m deep and 20 m high
  under the jaw, which is the arch in `aerial-side-from-sea.jpg`.
- **The overhang at the south end of the beach.** First try: cut the foot back (recess and a
  cave). From the sand it read as a scoop, but from the viewpoint there was no dark mouth at
  all. Projecting the photo's drip line onto the beach (a raycast through its pixels to the
  sand's height) showed the real lip reaches 15 to 20 m further out over the sand than the
  wall's foot. So the face now bulges out 20 m to a lip 17 m up, and under it a cave runs 10
  m back behind the line of the wall. The rows are shared out along the bulge so the ceiling
  gets them.
- **The islet**: a steep thumb whose sides bend over into a rounded crown, sheerest on the
  north-west side it shows the viewpoint. Was a flat-topped cylinder. Three tries: a low
  sheer foot under a dome read as a mushroom; a flat sheer wall with a crown on top read as
  a cup; bending the wall over into the crown (steepest at the bottom) matched the outline.
- **Surface, in the shader**: each bed its own shade, grey to creamy; partings that come and
  go along the face (ruled lines right across a face looked like a barcode from `trailTop`);
  dark grey and ochre weathering zones tens of metres across; near-vertical joints; runoff
  streaks in some stretches; a dirty band along the foot of the beach walls; ochre and brown
  staining under the overhang; a ragged waterline band whose height changes along the coast,
  olive-brown rather than black.

### The ground never had cast shadows

Looking into the new cave from the viewpoint, the floor under the overhang was as bright as
the open beach. A debug view of the shadow term said it was 0 there. Switching the sun off
made the floor dark, so the sun was reaching it anyway. The compiled shader explained it: the
line that multiplies the sun by the shadow was patched into `getDirectionalLightInfo(...)`,
which only exists after three.js expands its `#include`s, and `onBeforeCompile` runs before
that. The replace matched nothing. It had been that way since v1: the ground's only shading
was faces turned from the sun, and the baked shadow texture only ever darkened the sea (which
has its own shader) and the measuring labels.

Fixed by expanding the light loop chunk before patching it, and every patch of the ground
material now has to match exactly once or the page throws. Worth checking in any three.js
project that patches shaders: a `.replace()` that misses fails silently.

With shadows actually on, two more things showed up:

- **Every bedded face was half in shadow.** The ledge-shadow table stores how far the
  highest ledge above pokes through the line to the sun; for a face that is simply tangent to
  the sun that margin is about zero, and the soft edge was centred on zero. Shifted it.
- **Double shadows.** The table included the coarse beds, which the mesh also carries and now
  shadows itself. The table is fine relief only.

### Light under the rock

The baked shadow is exact for a heightfield, and a carved face is not on the heightfield. So
the mesh builder works out, for every strip vertex, in the face's own vertical section:

- the elevation above which rock of the same face hides the sun (the shader compares the sun's
  angle against it, and uses the baked shadow just out from the uncarved face for the rest),
- how much of the sky it sees (cuts the sky light),
- how much sunlit ground lies in view past the drip line (the light bounced up from the
  sand; the old bounce looked down at the map, which under an overhang is rock all the way),
- which way is out, which a floor's own normal cannot say (the first floor lookups went in
  random directions).

A second bounce off the rock overhead (rock albedo times the light it gets from the sand)
turned the cave's floor from sky blue to warm grey, as in `beach-under-cliff.jpg`.

### Colour, measured

`--measure` on `viewpoint`. The islet's rectangle had to move (the reshaped islet puts its
bare face a little lower), and a new one sits on the head's bare north face, each placed on
bare rock in both the render and the photo.

| Region | Render sRGB | Photo sRGB | Render against photo |
|---|---|---|---|
| islet sunlit face | 155 159 153 | 140 139 131 | +0.40 stops |
| head face | 120 127 114 | 132 133 126 | -0.18 stops |
| rock in shade (class) | 130 131 123 | 117 127 113 | +0.16 stops |

The limestone target is 0.60, 0.585, 0.54 sRGB, about 0.33 reflectance (v2 suggested 0.31),
a little warmer than before. The two bare patches straddle the photo. The class average for
sunlit rock (+0.7) is not comparable: the photo has scrub where the render has bare face,
which is v7's.

### Speed

The mesh went from 8.4 M triangles (a full 2049 grid) to about 4.2 M: 3.2 M of ground grid,
the cells under the sea and under the faces left out, and 1 M in the face strips. The strips
are 55 cm apart within 125 m of the beach and the trail, 85 cm on the rest of the headland,
1.6 m elsewhere. The first version had 55 cm everywhere on the headland and a grid three
times denser there; timing faceStep 0.55 against 0.8 in one page showed the small triangles
were what cost (1 to 2.5 ms at `beach`, `sideFromSea`, `stairs`), so the fine strips went
only where the camera comes close.

The machine was busy the whole time (ChatGPT's renderer and the window server using a lot of
it), and medians came out at twice the minimums. Three official `hero.mjs` runs:

| Frame | Run 1 | Run 2 | Run 3 |
|---|---|---|---|
| overview | -16% | -11% | -6% |
| viewpoint | -28% | -19% | -25% |
| stairs | +4% | +6% | +16% |
| trailTop | +5% | +13% | +10% |
| trailLow (camera moved) | +15% | +33% | +19% |
| beach | +18% | +3% | +16% |
| shoreBreak | -1% | -16% | -12% |
| sideFromSea | +20% | -2% | +6% |

Run 1 was the first mesh (55 cm strips everywhere on the headland, grid three times denser);
runs 2 and 3 are what is committed. The gallery holds run 3.

`trailLow` is not comparable: v3 moved its placeholder camera onto the overhang. Timed
with v2's camera, six alternating rounds, minimums: v2 8.7 ms, v3 9.7 ms (+11%). `trailTop`
in the same rounds: 6.3 against 7.1 ms (+13%). Both look at the ridge and the beach, the
area with the fine face strips and the bedding.

In-page ablation (one page, configurations interleaved, medians of nine) put the cost at
those two views in the faces and the bedding textures, each about 0.3 to 0.5 ms, within the
noise of any single measurement.

So the frames seen from far off got faster (the overview and the viewpoint by 6 to 28%, from
the lighter mesh), and the frames close to the rock are between +3 and +16% from run to run:
`stairs`, `trailTop` and `beach` are over the 10% budget in at least one run. The cost is
the detail near the camera, the fine face strips and the bedding, which is the point of this
version. Per the rules this is logged in the v9 brief rather than taken back out. A clean
rerun on a quiet machine would settle whether it is really over.

### Tools added

- `cam=e,n,h,yaw,pitch[,fov]` puts the camera anywhere in the frame of a shot.
- `clay=2` draws the triangles' own normals: the mesh itself, faceted.
- `terrainDebug=1..5`: sun shadow, sky share, overhang horizon, lit ground share, carved
  depth.
- `faceStep=` sets the face strips' spacing near the headland.
- `SKIP_WEATHER` and `SKIP_STRATA` for `--bench --ablate`.
- Every patch of the ground material must match exactly once, or the page throws.

Inspecting the faces from node was the most useful habit of this version: build the mesh
with `buildTerrainMesh` in a scratch script, find the column nearest a map point
(`mesh.strips`), print its rows. Every one of the mesh bugs above was found that way after a
raycast from the offending pixel gave the map point.

### Still weak

- The ground cover on the faces is scrub texture in bands along the ledges, which reads as
  painted green stripes from `sideFromSea` and `viewpoint`. In the photos those ledges carry
  real bushes, and the flanks are green at 60 to 70 degrees. That is v7's (noted there).
- The rock is still grey next to the warm cream of `aerial-side-from-sea.jpg`. v2 found that
  photo's warmth is its grade and a different day; the same-day photos read neutral grey, so
  I left it grey-cream, but the overall colour is a judgement call worth a second look.
- Up close (`beach`) the faces are right in shape but the scanned texture is stretched over
  large areas, and there is no rubble or fallen blocks at the foot of the walls, which the
  photos have.
- The white water at the rock still follows the map's coastline, not the carved foot (v4).
- Sand under the overhang meets the floor of the face strip with a visible change of shading
  in some views (v5).
- Frames close to the rock (`stairs`, `trailTop`, `beach`) came out +3 to +16% against v2
  on a busy machine (see Speed). Logged in v9.

## v4: water (2026-09-25)

### The open sea is a wave spectrum now

v1's open sea was three sine swells with fourteen wind wave trains as a slope field. From the
air that read as a smooth sheet with a regular sheen, and it never broke. Now it is a spectrum
turned into surfaces by an inverse FFT on the GPU (Tessendorf, "Simulating Ocean Water"):

- A 13 s swell from the south-west (1.2 m significant height, long crests) and the local wind
  sea (JONSWAP for 7 m/s over 60 km, 0.9 m, Donelan-Banner spreading), in four cascades with
  patches of 757, 107, 15 and 2.2 m. The ratios are near 7 so the tiles never line up, and
  each cascade keeps its own band of the spectrum so nothing is counted twice.
- Choppy displacement sharpens the crests, and where it folds the surface (the Jacobian
  drops) the crest is breaking: whitecaps, carried from one update to the next and fading
  over a few seconds.
- The mipmaps of the squared slopes give, for any pixel, the spread of the slopes too small
  to draw (mean of the squares minus the square of the mean). That spread is what makes a
  distant rough sea look rough: it widens the sun glint and it tilts the reflection.
- Gusts, drifting patches a few hundred metres across where the small waves are stronger or
  weaker. They are what the drone photo's sea texture is made of, and they hide the tiles.

I checked the FFT on the CPU before writing any shader: the gather form of a Stockham FFT
against a plain DFT, to 1e-15, and radix 4 the same way later. An FFT bug on the GPU looks
like plausible noise, so this is worth the ten minutes. The passes are plain WebGL2 on
three.js's context (a three.js render call per pass costs more than the pass). All four
cascades update in about 0.35 ms, only when the clock moves.

### Colour, measured

v2 found the sea giving twice the photo's blue from under the surface. The old model had one
hand-picked "scatter colour". It is now absorption and backscattering per metre, close to
pure sea water (red 0.30, green 0.06, blue 0.04 absorbed, and 0.004 to 0.0085 scattered back), and
the brightness of deep water from Gordon's relation, F times backscatter over absorption plus
backscatter. Sand in the water is two kinds: coarse sand stirred up in the surf backscatters
and absorbs a little blue (beige), fine silt in the plumes only backscatters (pale turquoise).
The seabed sand under water is greyer than the dry beach.

The reflection far out took two goes:

1. v2's trick (lift the reflected ray by the unseen slope spread, cut the Fresnel at grazing
   angles) could be made to match, but only by tuning two numbers per distance band.
2. Four little mirrors per pixel instead: the corners of the unseen slope spread, each
   weighted by how much of it faces the camera, each with its own Fresnel and its own patch
   of sky, and the ones that would reflect below the horizon see other waves. One number
   (the spread's scale) sets it, and it holds from 400 m to 15 km.

Region by region on `viewpoint` and `eastCove` (`--measure`, render against photo):

| Region | v3 | v4 | Photo sRGB | v3 sRGB | v4 sRGB |
|---|---|---|---|---|---|
| viewpoint, sea under 400 m | +0.86 | -0.13 | 37 98 122 | 4 124 207 | 18 92 134 |
| viewpoint, sea 0.4 to 1.5 km | +0.28 | -0.11 | 55 104 153 | 30 111 197 | 53 100 146 |
| viewpoint, sea 1.5 to 5 km | +0.14 | 0.00 | 75 124 182 | 71 130 199 | 80 125 173 |
| viewpoint, sea 5 to 15 km | -0.29 | -0.26 | 110 161 221 | 103 147 199 | 110 149 191 |
| viewpoint, sea beyond 15 km | -0.63 | -0.57 | 135 184 237 | 112 151 193 | 119 154 190 |
| viewpoint, shallows | +0.75 | +0.25 | 99 161 163 | 107 208 225 | 118 172 184 |
| eastCove, sea 0.4 to 1.5 km | +0.13 | -0.06 | 59 111 163 | 35 114 197 | 62 109 154 |
| eastCove, shallows | +0.46 | 0.00 | 138 171 177 | 82 206 237 | 102 176 191 |

The stops only compare brightness. The colours say more: v3's near sea was a saturated royal
blue (4, 124, 207) where the photo has a dark teal (37, 98, 122).

Beyond 15 km it is still 0.6 stops dark, which is v2's horizon band (the sky just above the
horizon is 0.3 dark too).

A sweep of the reflection settings came back with three identical answers. zsh does not split
a variable into words, so `set -- $cfg` in the loop saw one argument, and every run used the
same broken values. And `--set=o.halfFFT=false` turned `false` into the string "false",
which is true. The page's parser knows `true` and `false` now.

### Plumes

The milky plumes are drifting, warped noise inside zones on the map, billowing at their edges
and thicker in the middle, instead of a noise threshold. One judgement call: the drone photo
(2026) has a big plume running past the islet, and none of the five viewpoint photos (other
days) show one there. So the strong plume stays in the east bay, which the viewpoint cannot
see, and only a faint one reaches past the islet.

### Surf, foam and the coast

- **Wavelengths.** v1's surf had a wavelength of 10 m plus a fifth of the distance offshore,
  which put three or four parallel crests in the surf zone. For 9 s waves the depth gives
  about 23 m in 0.7 m of water and 44 m at 2.5 m, so one or two crests, as in
  `waves-from-cliff.jpg`. Each crest also wobbles along the shore on its own, the gaps between
  waves vary, the heights come in sets, and bigger waves break further out.
- **Foam with a memory.** A heightfield shader knows where a wave is breaking now, not what
  the last one left. A 1024 by 1024 simulation over the bay carries foam and stirred-up sand
  with the water (semi-Lagrangian): up the beach with each bore, back out with the backwash
  and harder in rip channels, off the rock after each hit, downwind, and in eddies (the curl
  of a noise field, so it swirls without piling up). Thick foam thins to lace within a few
  seconds, lace lingers for twenty. A frozen capture replays the last 30 s first.
- **Lace that moves with the water.** The first lace was a fixed pattern that the foam
  amount thresholded, and it read as marbled paper and then as crackle glaze. The
  simulation now also carries how far each bit of foam has travelled, and the lace is drawn
  where the foam started from, so it stretches into streaks along the backwash and the rips.
- **The rock's real foot.** v3 carved a notch and an arch, and the white water still followed
  the map's coastline, in places metres in front of the rock. The worker now reads the foot
  off the mesh itself (where the face strips cross sea level) into a distance field, with how
  exposed each bit of foot is: facing the swell, and open to it along rays 1.5 km out to sea.
  Bursts of white water come when a crest of the ocean's own swell reaches the foot, so they
  arrive with the waves you see, in sets. Two zones in `layout.js` (`surf`, water only) add
  white water where the swell wraps round the jaw into the arch, as
  `aerial-side-from-sea.jpg` shows.
- **Wind rows.** Off the exposed rock, old foam lies in streaks along the wind, as it does in
  the drone photo.

Bugs worth remembering:

- A band of brown speckles along every waterline in the cove, seen from above. It looked like
  stirred-up sand. It was the foam's relief shading (dark crevices between lumps) at a
  distance where the lumps are smaller than a pixel. Relief now fades with pixel size.
- Bright blocks in the foam up close: value noise rotated between octaves stops its grid from
  showing.

### The breaking wave

A height per map point cannot fold over, so the lip is its own mesh: a ribbon along each
beach's waterline, a column every half metre, each column a cross-section of the wave from its
back to a little in front. Each column finds the crest of the wave breaking there and bends
into that wave's stage: steepening, the lip thrown forward, the tube, the lip landing, the
collapse. Neighbouring columns are at slightly different stages, so the wave peels along the
beach. While a wave breaks, the sea tucks its own crest under the ribbon.

I plotted the cross-section in node at six stages (a PNG, no browser) before writing the
shader. The first shape had the face as a tube from the start and a floor that crossed it.

What went wrong:

1. **A dark slab where the wave should be.** Each column stepped along the waterline's normal
   to find its crest. On a curved beach the shore distance grows along a different line, so
   the search landed on the phase of another wave. A CPU copy of the surf function, run for
   one column at 70 moments, printed the stage and the crest position and showed it at once.
   The search now steps along the direction the shore distance grows.
2. **Test views that showed nothing.** I set a "side view" camera assuming the beach ran
   east to west. It faces 276 degrees. Read the direction off the geometry first.
3. **A straight seam at the foot of the wave.** The ribbon's floor lay on a flat trough while
   the sea in front of it still carried the last bore. First fix: clamp the foot above the
   sea and fade the ribbon out at its edges. Later (see Speed) the ribbon became opaque and
   the clamp drew flat water over the bore, so now the foot simply goes under the sea in
   front where that is higher, as water in front of a breaking wave does.
4. **Triangles stretched across the beach** where neighbouring columns found different waves.
   Dropped when their crests are more than 4 m apart.
5. **The crest search ran 96 times per column** (once per vertex) and again per spray
   particle. It runs once per column per frame now, into a small float texture.

6. **A pale, blotchy patch on the rising face** for a moment at the start of every break. It
   took five wrong guesses: the ribbon's reflection being smoother than the sea's, light
   seen through the back of the wave, sand in the water, the milky plume, the spray. Each
   fix was real but changed nothing there. What found it was switching things off one at a
   time (foam off: gone), then the foam debug view: the sea was still drawing v1's white lip
   on its own crest, which the breaker has replaced, and at low strength it laid a veil over
   the crest just before the breaker took over. On the way the ribbon and the sea came to
   share one surface function (slopes, roughness, the four-mirror reflection), the spray lost
   most of its haze (dozens of overlapping puffs up close were adding up to a sheet), and the
   sand in the water thins out with height, as it does on a real rising face. Lesson: when a
   patch looks wrong, turn things off until it goes, before theorising about why.
7. **A flat pane after the collapse,** the top of the landed lip lying over a sea that had
   not yet put its crest back. The sea now untucks sooner and the ribbon's top sinks with it.

Debug views went through the exposure and the tone curve, so I spent a while reading a stage
off colours that were compressed. They skip it now. And the spray was invisible at first
because 2 to 7 cm droplets 30 m away are smaller than a pixel. They are puffs of droplets now.

The `shoreBreak` camera moved into the water, about 10 m from where the waves break and level
with their crests, as `wave-breaking-closeup.jpg` was taken. v3's camera stood on the sand 20 m
back and could not see the lip. So `shoreBreak` is not comparable across v3 and v4 in the
frame times.

### Speed

The first full `hero.mjs` run had `beach` at +49% against v3, and three runs gave numbers
that swung by 20 to 40 points for the same frame (`sideFromSea` -16% in one, +36% in the
next). So two new ways of measuring before changing anything:

- **Parts, in one page.** Switch one thing off at a time (the sea, the breaker, the spray,
  a define that skips the ocean displacement or the surf in the vertices, a flat colour for
  the sea's pixels), alternate the variants, take medians.
- **Both builds side by side** (`tools/ab.mjs`): v3 and v4 open in one headless Chrome at
  the same time, their animation loops stopped, timed in alternation, the median of the
  per-round ratios reported. Timed against itself it comes out within 2%. Two things
  mattered: a page that is not in front gets no animation frames (so it never reports
  ready), and each page is brought to the front before its turn.

What the parts said at `beach`, and what was done about it:

1. **The breaker cost 1.75 ms, all in its pixels,** for a small patch of wave. The camera
   looks along the beach, so the ribbon is seen edge on and hundreds of its columns stack on
   the same pixels. It was blended, in whatever order the columns run, so every layer was
   shaded. Now it is opaque, drawn in 8 m chunks sorted near to far each frame, and hidden
   layers fail the depth test before they are shaded. Its soft edges could not stay blended,
   and a dither showed as a halftone band over the water, so the ribbon now hands over to
   the sea by sinking under it: at its back, its front, and the start and end of each break.
   Where the two are the same shape, whichever is higher shows. Its foam patterns only run
   where there is foam. Columns that are not breaking bail out at the top of the vertex
   shader. From 1.75 ms to below what this measure can tell apart (a few tenths).
2. **The vertices.** Half the resolution did not make the sea any cheaper at `beach`, so it
   was the vertices: the ring grid is drawn only in the wedge the camera sees, with 480 rings
   near the camera instead of 960 (side by side at the shore break I could not tell them
   apart), a cascade is fetched only where it adds detail (the swell is gone in the surf
   zone), and the surf's slope is worked out per vertex instead of per pixel.

The water's own share, v3 and v4 side by side, sea on and off: `beach` 1.90 against 2.18 ms,
`trailTop` 1.02 against 1.19 ms.

Whole frames. Side by side (`tools/ab.mjs --hero`, 16 rounds) twice, the second after the
breaker came to share the sea's surface and reflection, and the official `hero.mjs` runs:

| Frame | Side by side, final | Side by side, before | `hero.mjs` final (gallery) | Earlier `hero.mjs` runs |
|---|---|---|---|---|
| overview | +7% | +6% | -8% | -5, +9, +2, +14% |
| viewpoint | +16% | +9% | +5% | -23, -37, -20, -27% |
| stairs | +19% | +2% | -4% | -11, -18, -19, -15% |
| trailTop | +19% | +22% | +10% | +2, +9, +33, +13% |
| trailLow | +19% | +13% | -32% | -24, -25, -1, -21% |
| beach | +26% | +8% | -7% | +49, +33, -1, +12% |
| shoreBreak (camera moved) | -1% | -11% | +1% | -6, -19, +40, +8% |
| sideFromSea | 0% | +16% | -26% | -16, +36, +6, +31% |

The first two official runs were before the breaker and vertex work above.

So the official check passes in its final run, and the side-by-side tool, which agrees with
itself better but not well (`stairs` went from +2% to +19% with no change near it), puts
five frames at +16 to +26%. Taken together: the water now costs a few tenths of a
millisecond to about a millisecond more than v3's, most where the camera is near the surf
(`beach`, `trailLow`), which is the breaking wave's pixels and the surf's work per vertex.
The first burst of frames in a fresh page also came out up to 60% slower than the same frame
a minute later (the GPU warming up), another reason single runs disagree. That cost is the
realism this version is for, and it is logged in the v9 brief with the tool and the
breakdown.

Moving (the clock running, which the still hero frames never pay for): the spectrum 0.3 to
0.4 ms, a foam step 0.11 ms every fourth frame, the breaker's columns 0.1 ms. A moving frame
came out 1.7 to 2.3 ms slower than a still one, the rest being the sky and clouds redrawing.
A jump of the clock replays 30 s of foam, about 440 ms.

### Still weak

- The eye-level photo is backlit by a low sun, and ours is noon with the sun behind the
  camera, so the wave's face is bluer and brighter. The lip's white edge reads a little cut
  out, and up close the droplets look a little like bokeh.
- The bore is lumpy in its shading, not in its shape (it is still the heightfield).
- The foam simulation covers a 640 m square around the bay. Outside it, the rock gets the
  simpler band of white water and the wind rows.
- The sea beyond 15 km is 0.6 stops dark, with v2's horizon band. Clouds are still not in the
  reflection.

## v5: sand and the waterline (2026-09-25 and 26)

### The shape of the beach, from the drone photo

At v4 the `beach` frame showed the sand climbing to the left as a smooth dune. Two causes:

- The camera. v1 had set it by eye, 27 m from the water. The people in the photo say
  otherwise: from their size and how far their feet sit below the eye, the man at the water's
  edge is about 14 m away and 3.5 m below the eye. A search over camera positions, scored on
  those distances and on the head's edge against the sky, put the photographer on the upper
  beach 2 m above the water, with a wider lens than v1 had (46 degrees, a film camera at
  about 28 mm).
- The ground. Behind the beach the walls came down with the zones' gentle profiles, so they
  ended in long toes, and the sand ran up them as ramps.

The foot of the wall is now traced from the registered drone photo: the sand's edge,
clicked on the photo and projected onto the map through the `overview` camera
(`beach.back` in `layout.js`, smoothed). Behind the beach each wall comes down to that line,
steep at the bottom. A trace of the render's sand over the drone photo and over the viewpoint
photo lines up now. The south end of the beach is low (a zone sets how high the sand gets,
`btop`), so the swash reaches the rock there, as in the photos, and the beach has a steep face
up to a berm and a gentler rise behind it. The outline checks on `viewpoint` and `overview`
still pass.

What went wrong on the way:

1. **Folds on the sand from above** (`trailLow`): dark specks and thin lines. With the water
   switched off they showed as holes, and a rasterisation of the mesh from above as full
   cover, so they were not holes: they were strips of face folded over, their back faces
   shaded dark. Round a concave wall the lines across the face converge going out over the
   sand and cross. The strips on the beach now stop before the lines cross, and a few metres
   past the foot (more under the overhang, whose cave floor they carry).
2. **A pillar and two recesses at the wall's foot** where the traced line ended short of the
   zones' own foot. The line now runs on along the zones' foot to the south, so it hands over
   without a corner.
3. **The south end's lower sand fooled the mesh builder**, which judged "standing on the
   beach" by how high the ground 3 m out was (0.8 to 2.4 m). It asks the zones now.

### The sand

- **Colour.** About 0.5 reflectance (v2 found v1's 0.72 too bright under the physical
  light) and a little pinker, as coral sand with red foraminifera is: the midday photos have
  green over red about 0.93 and blue over red 0.80 to 0.87 on sunlit sand. `viewpoint
  --measure`: sunlit sand +0.07 stops against the photo (it was +0.3 to 0.5). The drone photo
  still reads +0.27, a different day and haze.
- **Up close**, two CC0 scans from Poly Haven (Sam approved the 29 MB download): `sand_02`,
  trampled beach sand, and `damp_beach_sand`, the firm sand the swash packs down. v1 used the
  aerial scan at two scales, whose wind ripples came out half a metre apart, and the photos
  show trampled sand, not ripples. The aerial scan still gives the colour from further off.
- **Along the foot of the walls**, from how far each vertex is from the foot (worked out in the
  mesh builder from the carved faces): a narrow band of red grains where the swash reaches
  the rock (`beach-white-sand-surf.jpg`), grit and pebbles thinning out over a few metres,
  and greyer sand in under the overhangs.

### The swash

v1 to v4 raised the water level over the whole beach at once, like a tide, with a thin bright
line where it met the sand. Now each wave sends a sheet up the beach (`src/water/swash.js`):

- The edge moves like a ball thrown up the slope, fast then slowing, stops, and drains back
  down more slowly. The sheet is thin at its edge and thicker behind, a bore's worth at first
  and a few millimetres in the late backwash. Loosely after Shen and Meyer's solution for a
  bore collapsing on a beach.
- Each wave runs its own height (its size in the set, and lobes along the shore that change
  from wave to wave), so the next uprush meets the last backwash. The front runs up in lobes a
  metre or two across, and its edge is ragged at a few centimetres.
- **The sea** draws the sheet as a thin film: mostly the ground's wet sand seen through it,
  with the sky's reflection by its Fresnel, a little colour from the water, caustics from its
  ripples (streaks along the flow), and a foamy band at the front of each uprush. The ocean's
  waves do not ride on it.
- **The sand** under and behind it is soaked, a mirror for a couple of seconds after the water
  leaves (the film in the dimples reflects the sky and the sun), then dark and damp, drying
  over a minute, with a ragged damp line where the big waves of a set reach.
- **The foam simulation** moves with it: up in the uprush, back in the backwash. Foam left on
  bare sand drains away within a few seconds.

One function feeds all three, from the time, the place and the bed's height, so they cannot
disagree. It is worked out once per frame into a 1024 square map over the beach
(`swash-map.js`). Its values change smoothly (the edge of a sheet is where a linear height
crosses zero), so reading it bilinearly draws the same sharp edge.

What went wrong:

1. **Per vertex, it was expensive where it was not used.** The first version worked the swash
   out in the ground's vertex shader, for the few thousand vertices on the wet sand. `beach`
   got 1.2 ms slower: the ground is one draw of millions of vertices, and a heavier vertex
   shader slows all of them. The map costs next to nothing.
2. **Out of texture units.** The sea's shaders already used 16, the most WebGL promises. Its
   vertex shader now takes the three displacement cascades it uses as their own uniform
   (three.js allocates units by the length of the JavaScript array, not the shader's).
3. **A ternary choosing between two GLSL structs hung Chrome's GPU process**: the page never
   became ready and printed nothing. Plain if/else is fine.
4. **A spike of water standing up** where the map ended, on the sand under the overhang: the
   sheet on one side, the sea on the other. The map covers the whole beach now and fades at
   its edges.
5. **The white carpet.** In the uprush a flat white mass covers the lower beach. A debug view
   of the sheet (`debug=10`: sheet, foam, thickness) showed it is not the sheet but the bore's
   foam on the sea in front of it. It clips to white in full sun at the photo's exposure, as
   the photo's foreground does. Attempts to give it texture up close by modulating its
   brightness did nothing (it is above white anyway), and bubble cells cut into its cover read
   as honeycomb, so they were left out.

### Tools

- `tools/parts.mjs` times parts of a frame in one page: compile switches on the ground's and
  the sea's materials (`SKIP_x`, `WSKIP_x`, combinable with `+`), alternated over many rounds.
  The first version recompiled on every switch (three.js drops a program when no material
  uses it); it keeps one material per variant now.
- `tools/ab.mjs` defaulted to the second newest gallery folder, which before `docs/gallery/v5`
  existed was v3. It takes the newest tagged version now. It and `hero.mjs` skip shots the
  older build does not have (its page would fall back to another shot).
- New shot `swash` (a hero frame from v5), water debug view 10.

### Speed

The official run (`hero.mjs v5`, against v4 checked out from its tag) and the side by side
tool, which agrees with itself better:

| Frame | `hero.mjs` | `ab.mjs --hero`, 10 rounds |
|---|---|---|
| overview | +4% | +1% |
| viewpoint | -4% | -3% |
| stairs | -5% | -13% |
| trailTop | 0% | +3% |
| trailLow | 0% | +3% |
| beach | +13% | +16% |
| swash | new | new |
| shoreBreak | -4% | +3% |
| sideFromSea | -4% | -4% |

`beach` is over budget, and it is the camera: the same frame at v4's camera (`ab.mjs beach
--set="cam=124,200,4.4,208,-3.8,40"`, 16 rounds) is +5%, at v5's camera +17%. v5's camera
stands 14 m from the water, as the photo was taken, and most of its frame is close-range sand
and the swash, which is what this version is for. Switching parts off one at a time
(`parts.mjs`) put each of them (the second sampling of the sand scan, the scans at all, the
foot of the wall, the sheet) within the noise of about half a millisecond, so there is no one
thing to take out. Logged in the v9 brief.

On the way down from +43% at `trailLow` and +39% at `beach`: the swash moved from the
vertices to the map (1.2 ms at `beach`), the strips on the sand stopped a few metres past the
foot (`trailLow` had them reaching 12 to 30 m out over flat sand), the sea skips the ocean's
texture reads and the surf where the sheet lies on the sand, and the finest sand, bubbles and
caustics only run where a pixel is small enough to show them.

### Still weak

- The bore's foam up close is a flat, soft white carpet with grey smudges. The photo's is
  white too (film, overexposed), but real foam at a couple of metres shows bubbles.
- At noon the sun reaches deep into the cave under the overhang, where `beach-under-cliff.jpg`
  has its floor in shade. v4 does the same: it is the cave's sun horizon (v3), not v5's sand.
- Under the neck wall the undercut's edges zigzag across the rows of the face strips. The
  plain grey view shows it clearly; with textures it mostly hides.
- Seen along the beach, the sheet's backwash and the sea just offshore read a little glassy
  and turquoise, with the sea's streaky lace (v4) on top.
- Shaded sand from the viewpoint measures 1.7 stops darker than the photo at the same pixels,
  mostly because the photo's shadows fall differently there.

## v6: trail and stairs (2026-09-26)

### Where the path goes

OpenStreetMap has the whole route (`TRAIL` in `geo.js`), and the paved steps and the ridge
path sit well on this model. The mapped zigzag down to the beach did not: on this model's
slope its legs ran straight down the fall line at 50 to 70 degrees, and its bottom climbed a
bump and dropped 32 m to the sand within 6 m (v5's note). So the descent was laid out again
in the same corridor, on this ground:

- A small generator walks the model's slope at a set grade (it turns off the fall line by
  just enough), leg by leg, and turns at chosen places. About 1 in 2 on the legs.
- The first leg is a long diagonal from the neck down the slope facing the beach, which is
  what the viewpoint photo and `trail-stairs-viewpoint.jpg` show. Its pixels in the
  viewpoint photo were cast onto this ground (`__app.rayToGround`) to find the corridor.
- Three switchbacks, then a steep last stretch to the sand at the foot of the wall, where
  the drone photo shows the path (its marks cast onto the map through the `overview` camera).

The route is then one line, top to bottom (`src/trail/route.js`): the sections end to end,
corners cut, resampled every 25 cm. The walking height comes from the ground under it,
smoothed and held to each section's steepest grade (the average of the highest and the
lowest profiles within that grade of the ground: each is no steeper than the grade, and
where the ground is gentler both are the ground). Where the line is steeper than a
section's `flat` grade it becomes steps: level treads, each straddling the line to within
half a riser, at least a `going` long, risers growing where it is steep. The concrete steps
are regular; the dirt ones vary by up to 30% each, as steps cut by hand do.

304 m and 559 steps on the 2048 grid the captures use: 233 concrete, 38 on the ridge, 288 on
the way down (the page's default 1024 grid makes a few fewer). The real count is about 156
concrete steps; here the concrete falls 60 m, so either the real ones are
taller or the ground under them is gentler than the model's.

### The carve

The ground is cut to a level shelf under the tread, with a cut bank on the uphill side
(2.2 in 1) and a fill bank on the downhill side (2.6 in 1), their edges rounded, running out
within 8 m (`src/trail/carve.js`). It is worked out once on a 25 cm grid as the change it
makes to the height, and `heightAt` adds it, so the ground mesh, the faces, the plants and
the baked shadow all stand on the same carved ground. Across a hairpin the shelf's height is
a blend of the nearby samples, weighted by how much nearer each is than the nearest.

The first check went wrong in a way no picture would have caught cleanly: building the mesh
in node and taking the highest surface over 6090 points across the treads, the ground stood
up to 0.7 m above them on the lower legs. It was the face strips (v3). Their rows are zipped
column to column by how far up the face they are, and a shelf running diagonally across a
face sits at a different fraction of each column, so the triangles between two columns were
up to 2.5 m long and cut over the tread. Two changes fixed it: the strips stop 3 m short of
the path and the ground grid carries it, and the shelf reaches 0.7 m past each edge of the
tread, more than the diagonal of a grid cell, so no triangle that touches the tread reaches
the bank. The ground is now at least 2 cm under every tread. The faces' own carving
(buttresses, beds) is switched off across the path, so it cannot push the shelf sideways.

### The viewpoint platform

Stage 1 left a question: the viewpoint camera stood 10 m above the modelled ground. Either
the camera or the ground was wrong. The ground was. The photo nine minutes later (`eastCove`,
same phone) has a GPS altitude of 110 m at a point on the steps where v5's ground was 102,
and `trail-stairs-viewpoint.jpg` shows the viewpoint is simply the top of the steps.

Raising the spine's control points did nothing: the ridge profile only takes over about 30 m
before the root of the finger, and up there the plateau (and the dip that opens the view)
sets the height. A local rise centred just behind the camera does it (+9.6 m, 15 m across, in
`dips`), with a level concrete pad on it. The first pad put the camera in its middle, and the
slab filled the bottom third of the viewpoint frame; in the photo the ground drops away under
the lens, so the camera now stands at the pad's south-west corner. Where the pad meets the
steps the lower of the two wins, so the steps carry on down beside it. The outline checks on
`viewpoint` and `overview` came out the same as v5's.

### What stands on it

Built in the terrain worker from the route in about 35 ms (`src/trail/geometry.js`): concrete
steps as blocks with their sides running into the ground, dirt treads dished a little with a
skirt at each edge running 0.8 m out and down to the ground, risers, a log across 30% of the
dirt risers over 18 cm, and handrails. Sawn timber (square posts every 2 m, two plank rails) on the concrete steps and
the ridge, bamboo lashed with blue rope on the way down, no rail across the other leg of a
hairpin or on the platform. About 30,000 triangles and 1,500 instances.

Surfaces: four CC0 scans from Poly Haven (Sam approved the 42 MB download; 9 MB ships):
`concrete_floor_02` for the steps and platform, `rocky_trail` for the dirt (read twice at two
scales against each other, so the 2 m tile does not repeat down 300 m of path, and browned
lower down), `weathered_planks` for the timber (mapped in each piece's own frame with the
grain along its longest side, darker on the concrete steps as in the photo), `bark_brown_02`
round the logs (with gradients taken from the position, not the angle, which jumps where it
wraps round and left a seam). The bamboo and the rope are procedural. The procedural stand-ins
before the scans read as plaster with polka dots.

The edges of the path in `trail-top-railing.jpg` are trodden bare earth. The first go at that
was in the ground's shader: the carve's mask as a texture, bare earth on the shelf and the cut
banks. It looked right and cost 2.2 ms at `overview` (0.3 at `viewpoint`), timed with it on and
off in one page (`parts.mjs`): one texture read behind a rectangle test, in the most expensive
shader on screen, which v2 had already found adds cost whatever it does. So the verge is the
path's own now: the dirt's skirt runs 0.8 m out past the tread, over the carve's level
shoulder, and the ground's shader is v5's, unchanged.

The path is drawn into the depth pass that runs before the ground (renderOrder -2). Without it
the ground's shader, the heaviest on screen, ran under every tread only to be painted over:
`trailTop` measured +18% against v5 at the same camera, and +6% with it.

### Plants

The placeholder cleared 5.5 m around every mapped line, including the ridge path out to the
head that nobody walks and the approach. Now (`scatter.js`): nothing on the tread or its
verge, nothing on the platform, and the views from the path stay open. A plant's top stays
under the eye line of someone on the tread, falling away at about 12 degrees past 6 m, or it
is scrub (1.6 m) right beside the path. In the photos the slopes along the steps and the ridge
are scrub and dry grass, and the views down to the beach are open.

### Cameras

`src/fit.js` fits a camera to its photo by outlines. Points are traced on the photo where land
meets the sea or the sky (30 to 45 per photo, on a gridded copy), and the render's land mask is
turned into a distance field; the score is the mean distance in pixels at 480 wide. A
Nelder-Mead search moves the camera along the path (distance along it, side, eye height) and
turns it (heading, pitch, roll, lens), from a coarse sweep every few metres. Horizon points
count too.

- `stairs`: fits to 12 to 13 px anywhere from 18 to 38 m down the concrete steps. At the top
  the platform fills the bottom of the frame, so 32 m. What is left is the neck's west flank,
  3% of the frame too far out. v3 named the spine points to narrow if that happened
  (`(109, 70)` and `(70, 38)`); narrowing them from 46 and 50 m to 40 and 44 m moved the score
  by 0.2 px, so they were left alone.
- `trailTop`: on the ridge path, 147.5 m along, 9.7 px, a wide phone lens (about 24 mm).
- `trailLow`: nothing on the path fits better than 25 px, with any lens. The photo was taken
  from about 65 m over the south end of the beach (v3's placeholder), where there is no path;
  likely a drone. So the frame is set by eye low on the zigzag, 244 m along, looking over the
  handrail into the overhang.

Each of the three carries `s`, how far along the path it stands.

### The walk line

For the scroll (v8): `node tools/walk-line.mjs` writes `data/walk-line.json`, 565 points 0.5 m
apart from the viewpoint photo's spot on the platform, onto the steps 27 m down them, and
down to the sand, with the direction of travel and the grade at each. The eye is 1.4 to 1.8 m
over the tread (the steps are smoothed out of it); the largest change in height between
points is 0.68 m (the concrete steps), the sharpest turn 13 degrees (the hairpins).

### Tools

- `__app.traceOnPhoto(lines)`: map lines drawn over the shot's photo or render (the OSM route
  over the drone photo was the first look at where the path really runs).
- `__app.rayToGround(u, v)`: where a pixel of the frame lands on the ground.
- `__app.contactSheet(cams)`: several cameras in one PNG, on the path by `s` or anywhere.
- `__app.fitCamera(...)`: the fit above.
- `tools/parts.mjs` switches can be any `#ifdef` added to the ground's shader for the purpose;
  that is how the mask's cost above was found.
- `trail=0`: no path at all (no carve, geometry or clearing), for A/B checks. `SKIP_trail` for
  `capture.mjs --bench --ablate`. `cam=` takes a roll.

### A hole beside the path

A late look from the sand, where the path meets the beach, found a hole in the wall beside
the bottom steps, several metres tall, with the sea showing through. v5 had none there, and it
stayed with the path's geometry hidden, so it was the ground mesh. With the strips cut back
from the path, a grid cell next to the gap could still find a neighbouring column whose window
covered it, count itself covered, and be left out (v3's saving: a cell a strip fully covers is
dropped). Now no grid cell within 10 m of the path is dropped, and the grid right beside the
path is not pushed into the rock. A sweep of views with the sky and the sea hidden (holes show
black) found no others.

### Speed

`hero.mjs` was run five times and swung too far to judge by: `viewpoint` came out +11%, +6%,
+56% and +23%, `overview` -5%, +7%, +15% and +93% (with absolute times for both builds
doubling from one run to the next), `shoreBreak` -28% and -16%, with nothing changed that
those frames see between runs. One run crashed on a page that never became ready, the only
time in dozens of loads. The side by side timer (`ab.mjs`, both builds open in one
browser, timed in turns) is what the budget below rests on. The gallery holds the last
`hero.mjs` run.

| Frame | `ab.mjs --hero` (v5's cameras for the trail frames) | at v6's camera, both builds |
|---|---|---|
| overview | 0%, then -1% over 16 rounds | |
| viewpoint | +6%, then 0% over 20 rounds | |
| stairs | +11%, then +5% over 24 rounds, then +10% over 16 | -8% (twice) |
| trailTop | -7% | +2% |
| trailLow | -8% | +10% |
| beach | +6% | |
| swash | +5% | |
| shoreBreak | +27%, then -1% over 24 rounds (it looks out to sea, away from the path) | |
| sideFromSea | +1% | |

Two things were taken back to hold it:

- The path is drawn into the ground's depth pass first. Without it the ground's shader, the
  heaviest on screen, ran under every tread only to be painted over: `trailTop` was +18% at
  the same camera, +6% with it.
- The ground's shader has no path mask (above): 2.2 ms at `overview`.

### Still weak

- `trailLow` is on the path but not matched to its photo, which was taken from over the beach.
- The steps: 233 concrete ones where the real path has about 156, because the model's ground
  falls 60 m under them. And the treads are cleaner and more even than the real ones, which
  are chipped, patched and uneven in height at the bottom of each flight.
- Low on the descent the treads are 25 to 35 cm, so from above the steep bottom reads a little
  like a ladder, even with a log on only 30% of the risers over 18 cm.
- Where the path meets the sand the last treads and their skirts of dirt read as tiles laid on
  the beach from low down; the dirt and the sand do not blend.
- The edges of the dirt verge are ragged where each tread's skirt ends.
- The handrails are straight and tidy: real bamboo sags, leans, is patched with odd lengths
  and tied with more rope than here, and the timber posts lean too. At hairpins the rails stop
  short and leave a gap.
- The bamboo and the rope are procedural, not scanned.
- The platform's downhill side is a bare concrete face over its fill bank.
- In the viewpoint photo the descent's line meets the ridge about 15 m further towards the
  head and lower on the flank than here; the photo's crest there is higher than the model's.
- The dirt is one scan, browned lower down. The damp dark earth, leaf litter and roots of the
  shaded lower path are not there.
- Seen before v6 and not its own: thin dark lines down the face strips in the flat-triangle
  view (`clay=2`).


## v7: plants (2026-09-26)

### Grown, not scanned

The brief said CC0 scans. Poly Haven's plant scans are temperate or Karoo desert species,
the tropical ones are pot plants, and v1's three tree scans are what made the island read as
dots and dark cards. So the plants are grown in code when the page loads (`src/veg/grow/`),
about a second of JavaScript, and nothing is downloaded. The three tree scans and their
baking tools went (13 MB out of the repo).

Six species that grow on this limestone, each in two or three variants:

- **Beach naupaka** (*Scaevola taccada*): the low bush of the finger and the foreground of
  the viewpoint and stairs photos. Points are scattered through a mound, more of them near
  its surface, and a small grower joins them to the base: a stem per sector, each branch
  growing part of the way toward the middle of its group of points and splitting the group
  along its widest spread, until every point has a twig. Radii follow the pipe model (a
  branch carries the leaves above it). Every twig ends in a rosette of 11 to 17 spoon-shaped
  leaves on the golden angle, the young ones upright and brighter, the old ones spread flat,
  one in ten of the oldest yellowing.
- **Grass tussocks**: 110 to 150 arching blades from a tight base, green at the base, a
  third of them dried to straw from the tip down, and a few seed stalks.
- **Hanging scrub** for the ledges: the same grower with its points in a curtain out and
  below the foot, and sprays of small leaves hanging from the twig ends.
- **Pandanus** on stilt roots, with three-ranked spirals of keeled strap leaves. **Coconut
  palms** with ringed leaning trunks and fronds of drooping leaflets. A **broadleaf tree** with
  a short trunk and a crown of leaf sprays.

Leaves are painted into one small atlas at load (outline, pale midrib, side veins, darker
rim, as a multiplier: the colour is per leaf in the geometry). A spray (a twig with a dozen
leaves) is one card, for the crowns too big to build leaf by leaf.

### Where they grow

The v1 scatter kept its grid and its path rules (v6), and gained:

- **Scrub and grass.** Scrub patches tens of metres across with open grass between, twice as
  dense on the finger as v1's (0.95 m apart). On the plateau a mosaic hundreds of metres
  across of woodland and open grassland, and palm groves away from the cliff edge, a palm
  about every 8 m in them.
- **The faces.** Plants hold on to steeper ground than the ground cover (to about 70
  degrees, v3's note). On the sheer faces, clumps on the ledges: a point on a face slides
  down the fall line to the nearest shelf, and a shelf is where the bedding table
  (`strata.js`, the table the mesh is carved with) steps back going up. Runs along a ledge,
  and scrub spilling over the rim. Then scrub in patches down the faces, longer down than
  across (`beach-white-sand-cliff.jpg` has a whole stretch of wall green from the rim to near
  the sand). The first go was ledges only: from the sea it read as green stripes, the thing
  v3 wanted gone. Hanging scrub faces out from the rock.
- **Along the path.** Grass tussocks within 22 m of it on a 42 cm grid, up to the verge,
  shorter right beside the tread. Beside the concrete steps the verge is low leafy scrub
  instead (the stairs photos): the stairs frame lost its foreground bushes to a new random
  layout once, so it is a rule now, not luck.

### How they are drawn

- **Near: real geometry** (`near.js`, `plant-material.js`). Every frame the camera moves, the
  plants within reach are picked from a grid per species, checked against the view, and
  written nearest first into one instanced mesh per species, variant and level. The naupaka
  has leaves built to their outline (so no texture cut-out) up to 5 m, fewer and bigger ones
  to 10 m, and its impostor beyond. Grass is blades to 6 m and three crossed cards with a
  painted tuft to 15 m, and the ground's straw beyond. Each hand-over is a stipple
  dissolve over 2 to 7 m, each side keeping its band of the pattern, so no pixel is drawn
  twice or dropped.
- **Far: impostors** baked on the GPU at load from the same plants (`impostor-bake-rt.js`,
  about 0.1 s): 64 views over the upper hemisphere, colour, normal, depth and how deep in the
  crown. A jump flood fills the empty texels so mipmaps do not darken the edges. One card per
  plant, showing the nearest view, lit live.
- **One light for both** (`foliage-glsl.js`): light through the leaf, yellower. The waxy
  sheen (GGX and the sky in it). The sky from the atmosphere's harmonics on both sides of the
  leaf, with a warmer ground below than the harmonics' generic one. And the sunlight left after
  crossing the crown (the path from each point out of the crown's ellipsoid toward the sun,
  through a leaf density from the leaf area the grower made).

### Wind

One wind for the island, toward the west-north-west as the sea's gusts drift. Gusts are
patches 16 by 38 m, the long side across the wind, blowing downwind at 5.5 m/s. Three layers
move a plant: the whole plant leans and sways with the push where it stands (gusts
included), each branch sways on its own phase, leaves flutter along their normals, harder in
a gust. Seen from the viewpoint the sway is too small to see, so a gust also turns leaves
over: their undersides are paler and greyer, flickering leaf by leaf. That is what shows a
gust crossing a slope of scrub from 200 m.

### Colour, measured

- The first leaves were 0.25 green in linear reflectance, the colour they look. Real leaves
  are about 0.05 red, 0.11 green, 0.04 blue, and grass about the same. With those the
  viewpoint's scrub came out near the photo's, which is far greyer than its leaves.
- From 1 km the canopy was pale and silvery: every leaf mirroring the sky. A pixel covers
  many leaves there, turned every way, and their highlights average out. So the sheen
  broadens and dims with the pixel's footprint, and a soft sheen of the whole sky takes its
  place (the Fresnel reflectance averaged over the hemisphere, about 0.09 for a leaf's wax).
- The ground under the plants: the scrub texture greyer and yellower (lime grass, as the drone
  photo's slopes are), leaf litter and shade under the crowns (the worker works out how much
  of each texel the crowns cover and packs it into the data texture's spare channel on land),
  straw and earth under the near grass. v1's painted bands of scrub along the ledges are gone:
  the plants there are real.

### What went wrong

- **The first bushes were leggy sticks** with a few leaves: branches reached their points
  in long straight runs. A stem per sector, shorter steps, three to four times the points.
- **Leaves came out bluish and dark on one side**: two-sided leaves lit with the normal of
  the side facing away. The normal now flips toward the camera.
- **The palm groves went nearly black from 1 km.** The impostors kept their crisp edge at
  every distance, and at small mip levels a texel averages fine leaflets with the gaps
  between them to under the threshold: the fronds vanished and the shaded ground showed.
  Further off the average is now the coverage itself.
- **A page that never became ready**, silently: a variable declared `const` was reassigned
  in the worker, and errors in the worker do not reach the page's console. `main.js` reports
  them now.
- **Rosette cards** for the naupaka's middle distance read as green shingles on the ridge
  (`trailTop`). The impostor looked better from where they took over, so they went.

### Speed

The plants were the likeliest thing to break the budget, and did, twice:

- **Triangles, not pixels.** Low on the path the plants drew about a million triangles a
  frame, and halving the resolution did not make them cheaper. The naupaka's middle level
  lost its hidden rosettes and half its leaves (the rest bigger), its impostor took over from
  10 m instead of 22, the other species from much closer too, and the grass stops at 15 m.
- **What is left is not the plants' own work.** Measured in one page with the new switches
  (`ab.mjs --a=self`, `vegHide=`): hiding every plant makes `trailLow` 16 to 19% faster, but
  hiding only the near plants 2 to 5%, only the impostors 0%, half of either 0%, and with the
  ground hidden the plants cost nothing over the sea. The ground's depth pass saves 34% at
  `viewpoint` with no plants and 8% with them. Cut-out plants between the ground's depth pass
  and its colour pass take most of that pass's benefit away, which fits what is known of
  Apple's tile-based GPUs. Nine ways round it were tried and none helped (the list is in the
  v9 brief). It is left for v9.

| Frame | `ab.mjs` against v6 | across the day's runs |
|---|---|---|
| overview | -11% (16 rounds) | -25% to -11% |
| viewpoint | +12% (24 rounds) | +1% to +16% |
| stairs | -9% (16 rounds) | -23% to +3% |
| trailTop | +22% (24 rounds) | +4% to +22% |
| trailLow | +16% (24 rounds) | +11% to +23% |
| beach | -1% (16 rounds) | |
| swash | +2% (16 rounds) | |
| shoreBreak | +3% (16 rounds) | |
| sideFromSea | +13% (24 rounds) | -1% to +13% |

The Mac was busy with other apps for the last runs and the spreads were 15 to 20 points
wide. `hero.mjs`'s own run put every frame within budget (the gallery holds it). Four frames
are taken as over, and handed to v9 with the measurements.

### Tools

- `lab=x,y[,gap]`: one of every plant in a row instead of the scatter, to look at them.
- `vegDetail=` (how far the full plants reach, 0 for none) and `vegHide=` (leave out plant
  meshes by the start of their names).
- `tools/veg-parts.mjs`: what groups of plants cost, hidden one at a time in one page.
- `tools/ab.mjs --a=self --seta=... --setb=...`: this build against itself with a switch on
  one side. How every cost above was found.
- `__app.hf`: the worker's output (the plants, the heights) from the console.

### Still weak

- Four frames over budget (above), and the lead for v9 is not proved.
- Wet season only. Most trail photos are dry season, with brown grass and bare twigs.
- The patches of scrub on the faces are rounder and denser than the photos' finer texture of
  scrub on the rock, from the sea especially.
- The hand-overs between real leaves and baked views are soft dissolves, fine in still frames.
  In the scroll the camera sweeps them across the slope, which nobody has seen in motion yet.
- Up close the trees and palms are simpler than the naupaka, whose leaves are built one by
  one. Their bark is flat colour with streaks, not a scan.
- Leaf litter and roots on the path's banks are the ground's texture, not geometry (v6 asked
  for geometry from the carve's mask).
- The grass stops at 15 m, where the ground's straw takes over. From low angles the line
  between them can show.

## v8: the scroll descent (2026-09-26)

The landing page itself. `index.html` is now the page: scroll, and the camera comes down from
high over the bay, lands on the clifftop platform, walks the steps, the ridge and the
switchbacks, crosses the sand and stops at the water's edge in front of the break. The tools
that match the scene to photos are the same page with a shot in the URL (`?shot=viewpoint`).

### The split

`main.js` had grown to 760 lines of scene, tools and loop together. It is three files now:
`app.js` (the scene, its worker, the work done every frame, and nothing about where the camera
is or how big the canvas is), `debug.js` (the shots, the photo overlay and outline, the free
camera, the panel, the keys and the handles the capture scripts use) and `scroll/` (the page).
`main.js` picks one from the URL, and `index.html` sets a class on `<html>` from the same test
before anything draws, so neither flashes the other's layout. The hero frames came out
pixel-identical before and after the split (PSNR infinite on three of them), which is what
said it was a move and not a change.

### The way down

`src/scroll/path.js` turns the scroll into one number, `tau`, from 0 over the bay to 5 at the
water, through six stops. It is plain maths with no three.js in it, so node can check it
(`tools/descent.mjs`).

- **The flight** circles a point that slides from the bay to a spot 250 m out along the
  viewpoint's line of sight. The camera turns while it still looks straight down (the picture
  turns about its middle, which does not read as a pan), then tilts up to the horizon as it
  drops, and arrives on the platform exactly in the viewpoint frame, having come in along the
  line it looks down. The distance runs on a log scale, so the descent feels even from 700 m
  to 150.
- **The walk** follows v6's walk line at eye height, then a curve across the sand to where the
  `swash` frame stands. The look was the question. Following the path's heading would spin
  the view on every switchback (the path turns through every compass direction there). But
  from anywhere on the path the head's summit lies within about 20 degrees of south-west, so
  the camera looks at the head while it walks, and past the hairpin at the south end of the
  beach. The yaw changes by less than 30 degrees per screen of scroll from the platform to
  the sand. Pitch and lens are keyframed by metres walked; all three are smoothed over 3 m.
- **Pacing** is a monotone cubic through `PACE` knots (screens of scroll against `tau`): no
  overshoot, so the camera never backs up, and pairs of knots close in `tau` make beats where
  it slows almost to a stop while the words come in. About 17 screens top to bottom.
- **Comfort.** Roll is always zero. Hairpins are rounded off (the camera cuts up to a metre
  inside a 1.2 m bend, as a gimbal would), and on the switchbacks the eye is held a metre
  higher, over the tall verge. `descent.mjs` checks the least clearance over the ground (1.45
  m, at the stairs) and how far the camera ever leaves the path (under a metre).

### The page

- **One loop.** GSAP's ticker drives Lenis (the weighted smooth scroll), then the camera, the
  words and the frame, so the scene and the page cannot disagree by a frame. ScrollTrigger is
  not used, although Sam's conventions name it: every animation here keys off the camera's
  place on the path, which follows the scroll through a little extra smoothing (so a keyboard
  jump or a drag of the scrollbar still glides), and ScrollTrigger only knows the scroll.
- **Words** (`index.html`, one `data-tau` range per block) show while the camera is in their
  range: the line rises out of a mask (SplitText), the label, number and body follow, and the
  line drifts a little across the screen while it is up (the number the other way). The top
  bar gives the camera's live latitude, longitude and height; a rule down the right edge draws
  as the camera goes down, a dot per stop. The end is a cream card over the last frame, with
  the credits (OpenStreetMap's attribution among them) and a button that climbs the whole way
  back up in about eight seconds, the words out of the way until the top.
- **The copy is a draft** for Sam: the title, five short chapters (the air, the clifftop, the
  ridge, the switchbacks, the sand) and the end card.
- **Loading.** The loader counts through the real stages (the terrain from the worker, the
  textures, growing the plants, the path), creeping between them. Then, behind it, one frame
  at fifteen points down the path, so every shader compiles and every texture uploads before
  the page shows, and four of them timed to pick the pixel ratio (aiming at 13 ms a frame).
  It lifts from black onto the bay and the title comes up line by line.
- **Phones.** The lens widens on a tall screen (not all the way, or the head shrinks to a
  speck), the words sit at the bottom over a darker scrim, and a line across the top stands in
  for the rule. The layout was checked at 390 x 844; nothing has run on a real phone.
- **Reduced motion** keeps the camera (it is the content) but drops the smooth scroll and
  shows the words without animating them.
- **`?debug`** is the only way to the panel, the readout and the keys on the page.

### What went wrong

- **The switchbacks looked into the slope.** The first look keys matched the hero frames:
  `trailLow` looks 40 degrees down into the overhang. But that photo was taken from over the
  beach (v6); from the path the same look fills the frame with the slope and the grass. And
  past the hairpin the path runs north along the face above the beach, where looking at the
  head means looking along the slope. Fixed by turning the view to the south end of the beach
  there, looking out rather than down (about -24 degrees), and lifting the eye a metre.
- **The edge of the world at the start.** From 1.1 km on a 16:9 screen the frame is wider than
  the 1.6 km of modelled ground, and turning the view put a straight edge of coast in the top
  corner. The flight now starts as high as the screen's shape allows with every corner on the
  ground: about 670 m on 16:9, 810 m on a phone. So the page opens closer than the `overview`
  frame, and turned south-east up (which put the head beside the title, not under it).
- **Leaves in the lens.** On the switchbacks the camera walks under hanging scrub. Nudging the
  camera sideways did nothing useful: the scrub hangs in a curtain 1.7 m out from where it is
  rooted and up to 5 m wide, over the path. So a plant whose crown the lens is inside, or
  within a fifth of a radius of, now dissolves with the same stipple its hand-overs use
  (`near.js`, `LENS`). It only fires when the camera is in a plant, so the hero frames did not
  change (all nine hero frames match v7's).
- **Hairpins whipped.** A recording's frame-to-frame differences put the biggest jumps on the
  lower switchbacks: the camera ran round 1.2 m bends with the steps half a metre away. Rounder
  bends and a screen more of scroll for the switchbacks halved them.
- **A 1,800 degree spin** at the viewpoint, caught by `descent.mjs` before it was ever drawn:
  the look was unwrapped from `atan2`'s -139 degrees and blended with the viewpoint's 220.7.
- **The accent word vanished on the sand.** Terracotta over bright sand has no contrast, so the
  sand chapter is dark ink on the light scene, the light side of Sam's cream and ink.
- **The title showed through the loader** as it faded. The words now wait until it has mostly
  lifted.

### Tools

- `tools/descent.mjs`: the path worked out in node from the same heightfield: speed, turn,
  tilt and zoom rates per screen of scroll, clearance and distance from the path, per stretch.
  `--cams=N` or `--taus=` write cameras for `__app.contactSheet`.
- `tools/scroll-clip.mjs`: the page recorded frame by frame on the recording's clock (the page
  is stepped through `?record`, GSAP's own clock included), so the sea, the plants, the camera
  and the words move as they would at 30 fps however long a frame takes here. `--phone` for
  390 x 844, `--from= --to=` for part of it. `ffmpeg`'s scene score over its output finds pops.
- `tools/path-bench.mjs`: frame times at 21 cameras down the path, this build against the last
  tag side by side in one browser (still, and with the clock and camera moving); `--pace`
  times the real page scrolling itself.
- `__scroll` on the page: `jumpTo(screens)`, `pace`, `descent`, `cam`.

### Speed

v8 draws nothing new, so the question was whether the path finds somewhere slow that the
hero frames miss, and whether the page plays smoothly.

- **Along the path** (`path-bench.mjs`, 21 cameras from tau 0 to 5, 1400 x 788, pixel ratio 1,
  side by side with v7 drawing the same cameras, 6 rounds): 5.3 to 11.6 ms a frame still, 6.8
  to 12.9 ms with the clock and the camera moving (the sea's passes, the sky tables, the clouds
  and the near plants all redone every frame). The same as v7: median +3% still and +1%
  moving, every point within noise. The slowest stretch is the start of the flight (tau 0 to
  0.5, 10 to 13 ms), then the water's edge at the end.
- **The page itself** (`path-bench.mjs --pace`, 1512 x 945 at 2x, the canvas 2268 x 1417 at
  pixel ratio 1.5, scrolling itself top to bottom in 40 s): 2,479 frames, median interval
  16.7 ms, 99% under 20.5 ms, 3 over 25 ms and none over 50. No hitches when the camera first
  reaches the switchbacks or the sand: the warm-up behind the loader had already drawn there.
- **The hero frames**: `hero.mjs` put four over budget and one 42% faster, on frames that are
  bit-identical to v7's (eight of nine; `sideFromSea` differs in a handful of pixels); side by side (`ab.mjs --hero`, 16 rounds) all within budget, -7%
  to +10%.
- **Loading** is now the slowest part of the experience: 14 to 16 s before the loader lifts.
  The breakdown is in the v10 brief (speed was v9 until the final pass took that number).

### Still weak

- **The copy is mine, not Sam's**, and unapproved. It is all in `index.html`.
- **Loading takes 14 to 16 s** (the breakdown is in the v10 brief). The loader makes it bearable,
  it does not make it short.
- **Nothing has run on a real phone.** The layout holds at 390 x 844; the scene is the
  desktop's, which a phone will struggle with.
- **The switchbacks are the weakest stretch to look at.** Close slopes of ground texture and
  grass, steps sweeping past at arm's length. Hanging scrub that the lens goes into dissolves,
  and if the scroll stops in the middle of that (a fifth of a crown radius) the stipple shows.
- **The opening is not the `overview` frame**: 670 m and south-east up on 16:9, not 1.1 km
  and north up, because the modelled ground is only 1.6 km across.
- **Found along the path, belonging to versions that are done** (left as they are, the camera
  steers round them):
  - v6: the side of the viewpoint's concrete pad reads as a smooth pale block from a metre
    away. The camera now stands higher leaving the platform, so it passes below the frame.
  - v7: hanging scrub grows on the cut bank above the hairpin where the path leaves the
    ridge, six plants up to 5 m tall hanging over the tread. The scatter keeps plants off the
    path, but not what hangs from beside it.
  - v7's worry that the hand-over bands would shimmer when the camera sweeps them across a
    slope: I did not see it in the recordings at 1080p, but did not hunt for it frame by
    frame either.

## v9: the final pass (2026-09-27)

Sam watched the whole descent at v8 and named four things that still read as fake: the
clouds, the water close to the beach, the camera walking the switchbacks backwards, and the
green on the rock faces. One session for all four, by his choice. Each part was shown to him
as it was done, with v8 and v9 side by side and a clip.

### The camera on the path

v8 looked at the head all the way down. On the switchbacks' long northward leg that meant
walking backwards for fifty metres, 155 to 179 degrees off the way the camera moved.

- **The view follows the path.** The heading walked is unwrapped (so smoothing never averages
  across north), smoothed across 2.5 m and read 1.5 m ahead, so a hairpin's turn starts before
  the bend and ends after it. On top of that the view leans toward the scenery (the head on
  the ridge, the beach and the bay below the switchbacks) by up to 30 to 40 degrees, less on a
  tall screen, where the path ahead would leave the frame. When the scenery is straight behind,
  it does not pull at all, so the look cannot flip sides.
- **Short zigzags.** Two hairpins 7 m apart would swing the view 150 degrees one way and 180
  back. Where the path turns more than 60 degrees beyond its net turn within 10 m either
  side, the heading is smoothed across 6 m instead, so the view only swings part of the way
  with each short leg.
- **The scroll slows where the view turns.** Between stops, tau runs evenly in a cost of a
  metre walked plus the degrees turned over 1.8, not in metres. The switchbacks got 2.1 more
  screens (18.8 in all). The fastest turn is now 124 to 139 degrees per screen of scroll; the
  most the view ever turns from the way it walks is 63 degrees, on a bend (`descent.mjs`
  reports that now as "off heading").
- **The eye comes down** from 1 m over eye height to 0.4 on the steps and the switchbacks.
  Looking along the path, the verge is at the sides.
- **Drag to look around** (`scroll.js`). The scene under the pointer moves with it; on release
  the head holds for 0.6 s and then eases back on a critically damped spring. The scroll goes
  on underneath. A finger has `touch-action: pan-y`: a vertical swipe stays the page's, a
  sideways one looks, and the vertical part of a sideways drag still scrolls. `?record` never
  installs it; `scroll-clip.mjs --drag=12,-70` fakes one in a recording. Tested headless with
  synthetic mouse and touch events: a drag turns the head, a wheel while held scrolls on, a
  vertical swipe scrolls and does not look.

### The clouds

Before: small round puffs all alike, flat white, hard edges, only near the horizon.

- **Shape.** Each cloud is a heap of blobs in the weather map, and each blob is a dome (its top
  comes down to the base at its edge), so a cloud is a heap of rounded turrets on a flat base.
  The billow noise is kept where it clears a threshold that rises to the dome's surface, with a
  short ramp to full density, so a cumulus has an edge. The body is Perlin-Worley; finer
  Worley eats into the edges, billows up top and wisps toward the base, churning upward at
  2.5 m/s. Bases curve up toward a cloud's edge and vary by up to 120 m between clouds.
- **Field.** Clusters from a slow noise field; big cumulus near the island, small trade
  cumulus out at sea; a low bank of flat sheets 25 to 60 km out; a thin high veil. The photo
  day's big cumulus stands about 3 km east of the viewpoint, where `eastCove` shows it. The
  clear radius came down from 4 km to 1.5, so clouds come close, and the island stays in sun.
- **Light.** Four steps toward the sun, each twice the last, then the dome above; three octaves
  of multiple scattering; light diffused through the cloud; the powder term; a forward lobe
  for the silver edge. Grey bases from the sea's light and less sky light low down.
- **Cost.** On the page the clock always runs, so the clouds were marched every frame. Now one
  pixel in sixteen is marched each frame (a 4 x 4 Bayer cycle) and the rest are carried over,
  reprojected for the camera and the drift, blended with each fresh sample as the jitter moves
  on. A still frame, a jump or new settings get a whole march. Mip levels are picked by
  distance, since the GPU cannot pick them inside a march (it guessed per block of four and
  drew squares along the edges). The sky reads the clouds with a Catmull-Rom filter now (the
  B-spline blurred them by two pixels).

What went wrong: the first bench said the new clouds were free, because it forced the march
while the page's frame marched again. Then CPU timing around a burst gave negative costs.
What worked: a burst of marches back to back, then one pixel read from the clouds' own
texture, which waits for all of them (`tools/cloud-bench.mjs`). The reprojection first used
three.js's `matrixWorldInverse`, which is only refreshed when the scene is drawn, after the
clouds: last frame's view, so the clouds swam as the camera turned. And a Python edit matched
the wrong `void main()` in the sky shader and pasted a copy of the file into itself; the page
never became ready and `capture.mjs --console` said why.

### The water close to the beach

- **From above,** the foam was marbled white swirls. The lace is now foam gathered on the
  walls between cells of clear water: two cell sizes in patches, bent by a warp at the scale
  of a cell (a finer warp sheared them into hairs), broken into clumps, thin where there is
  little foam and letting the water through. Far off, the foam's average cover is mostly holes
  (it was 80% of the amount, a white carpet from the clifftop), and thick white water is broken
  into lumps and shaded gaps a metre to a few across. Dimming lit foam did nothing: at this
  exposure it is well over white, so the texture has to be shade and water.
- **The breaking wave.** The torn lip showed navy teeth. Debug views said it was the breaker's
  own face in the tube: the light model looked for a sea bed or the back of the wave and found
  neither. The lip and tube are lit now as bubbly water with daylight all round (clear water
  there would still be navy), and reflections pointing down under the lip see the water, not
  the dark horizon. The foam on the face was the sea's lace laid on it, which read as stained
  glass and white flames; it is torn streaks down the face now.
- **White water at eye level** was polystyrene: centimetre grain lit hard. It is lit through
  itself (wrapped), its relief in lumps of a decimetre and up, with holes and shaded troughs.
  The bore stands up in heaps near the camera, its front is ragged, its roller band a fifth of
  a wavelength deep. Patches have thin borders. Spray is ragged mist with specks of droplets.
  A milky veil of bubbles hangs in the water under the foam.

### The green on the rock

The faces carried hanging scrub in round, dense, dark patches. Now there is a face scrub
(`grow/species.js faceScrub`): small, open, yellow-green, twigs showing. It grows in streaks
along the beds and down the gullies, sparse inside a streak, more toward the top of the faces.
The hanging scrub is lighter, sparser, and in shorter runs (3.5 either side drew ruled lines
along the beds). The broadleaf tree's crown is lobed and lighter, with bare twig ends. Plants
on the faces keep back from the path by as much as they hang, which cleared the six that hung
over the tread at the first hairpin (the v8 note).

### Speed

Side by side with v8 (`ab.mjs --hero`, 20 rounds):

| Frame | Change | Middle half |
|---|---|---|
| overview | +7% | +6 to +10% |
| viewpoint | +4% | +3 to +9% |
| stairs | +11% (+10% at 24 rounds) | +8 to +24% |
| trailTop | +1% | -3 to +10% |
| trailLow | +2% | -1 to +31% |
| beach | +6% | +3 to +12% |
| swash | +6% | +1 to +8% |
| shoreBreak | -15% | -28 to +12% |
| sideFromSea | +6% | +2 to +13% |

`hero.mjs` (the gallery's table) swung as it always does: `swash` +114% in its run, +5 to +10%
side by side in six. `stairs` sits on the line, +9 to +12% across five side-by-side runs.
Bisecting it over the commits (`ab.mjs stairs --a=v8 --b=<commit>`, new) splits it into three
small pieces: the foam seen from above (+4%), the white water at eye level (+2%), the plants
on the faces (+3%). The camera commit and the clouds commit are +0%.

Along the path (`path-bench.mjs`, 21 cameras, against v8 at the same cameras): the first run
had the still frames at a median of +11%. Bisecting its worst cameras found the same pieces,
and a look at what runs everywhere found three things doing work on every sea pixel near the
beach whether or not there was foam: the far foam's breakup, the bubble veil (it tested the
simulation's square, not its foam), and the ragged front of the bore (two noise reads in the
surf function, which runs three times per vertex). All three now only run where they draw
something. The second run: median +5% still and +6% moving, the worst single cameras +16%
(8 rounds, with the GPU busy: the slowest camera read 25 ms where it had read 12).

The clouds: a whole march of the new clouds costs 0.5 to 4 ms, so on the page they are marched
a sixteenth at a time (above). Per frame that is 0.4 to 1.3 ms, against v8's 0.3 to 1.2 ms for
its simpler clouds, marched whole (`cloud-bench.mjs`, which times bursts of marches finished
by one read of the clouds' texture: CPU timing around a single march read noise).

### Tools

- `scroll-clip.mjs --stills=2.3,2.5` tiles stills from the real page (the shot tools render at
  a different terrain resolution and aspect, so their contact sheets did not match the page).
  `--drag=12,-70` turns the head in a recording as a drag would.
- `descent.mjs` reports "off heading": how far the view turns from the way the camera walks.
- `cloud-bench.mjs`: what the cloud march costs, per frame and whole.
- `ab.mjs --b=<commit>`: two commits against each other, for bisecting a slowdown.
- `?cloudDefines=LIGHT_STEPS:3,FINE_DIV:4.0` changes the cloud march's step counts, for timing.

### Still weak

- **The budget is spent.** `stairs` is at +10%, the rest within it, and the next version has to
  bring savings with anything it adds (logged in the v10 brief with the breakdown).
- **The lace from above is a little cellular** in places, where one size of cell covers a big
  patch. Seen moving it reads as foam; frozen, the polygons can show.
- **Old foam at eye level** still has a few bright shreds lying on the water before a wave, and
  old foam drawn up the rising face shows as streaks (the photo has them too).
- **The clouds are lit by the noon sun** and cast no shadows on the island (they stay 1.5 km
  off it). Up close, the big cumulus's base is a little too even.
- **The face scrub is one species** in two sizes. The photos' faces have grass in the cracks
  and bare dead twigs as well.
- **The drag has no hint.** Nothing tells a visitor they can look around; the cursor changes to
  a hand over the scene. Sam may want a word for it in the page (the page layer is not v9's).
- **The phone's look-around is sideways only**: a vertical drag scrolls, as it has to.

## v10: polish pass (2026-09-27)

Sam approved v9 after using the page (merged, tagged, pushed) and asked for a pass over
everything v1 to v9 built, self-checked, from seven notes with screenshots: a black line at
the horizon; clouds that could be more real; the foot of the cliff lacking polish up close;
too much foam; steps too perfect; the trees on the head still odd; and going down the steps,
the camera looking at the horizon instead of the steps. Speed and the shareable build moved
to v11.

### The black line at the horizon

A 1 to 4 pixel line of pure black between the sea and the sky, from anywhere high up. The
sky behind it was fine (`hide=water`), and the sea's debug views said the sea's far edge had
zero foam, zero light from under the surface and a blank normal. Cause: v4 lowers the sea with
the Earth's curvature in the vertex shader, so the horizon sits where it really is. The pixel
shader then measured the water's height over the bed after that drop, and beyond about 26 km
the drop is more than the 45 m default depth: the far sea counted as dry sand under the swash
sheet, went fully transparent, and drew the canvas's black. Heights are measured before the
drop now. (Read the pixel rows across the horizon: one row of 0,0,0 before, 114,147,184
after.)

### The camera on the steps

On a 50 degree flight every step ahead is more than 50 degrees below level, and with 0.3 of
the grade in the pitch the camera looked 27 degrees down: the flight grazed the bottom of the
frame. Now 0.6 of the grade (46 degrees at most), and on a steep flight the look leans toward
the view less, so the steps run down the frame. Pitch is smoothed over 5 m and counts fully in
the scroll's pacing (it nodded at the top and foot of each flight), and the grade fades out
over the last 14 m of path, or the sand chapter opened on a frame of plain sand (found in the
full recording, not in any still I had chosen).

### The steps

- Treads sit a little high or low and tilt; their front edges wander and are worn round; the
  odd one is broken away at a corner. Logs on about half the dirt risers, some knocked askew,
  broken, rotted to a stub or pegged. Posts lean and vary, the odd one snapped off; timber
  rails sag, a few missing or hanging from one end. Loose limestone on the verges and the odd
  tread.
- The concrete flight read as a smooth white ramp from above. Darkening it did almost
  nothing: at the photo's exposure it is well over white. A debug colour for the new
  back-of-tread distance showed it was right, and the fix was what the photo shows: looking
  down a flight the nosings hide the backs of the treads, so what shows each step is its dark,
  chipped front edge. The tread geometry now passes the distance to its front edge as well.

### The foot of the cliff

Up close the wall had only its big scans (a 20 m cliff in a 16 m tile): blurry, marbled. Within
about 20 m the layered scan comes in at its own size (1.8 m) with the pitted grain of the rough
rock scan. The sand was decided by the smoothed normal, which turns over a metre or two across
the corner triangle where a wall meets the beach, so the sand faded up the rock; now the
triangle's own slope decides as much, the contact is ragged but sharp, and just above it sand
sits in the rock's hollows. The same disagreement smeared the cut banks by the path (the view
from above projected down a vertical face): the triangle's slope picks the projection where the
two normals disagree a lot. The first look at the close grain showed nothing; a red debug
colour for its weight showed it was on and simply too weak.

### The foam

20% less, the lace thinning and fading at v8's pace again, a little greyer, and up close the
bubble walls cut holes in the white water so churned water shows between clumps.

### The head

Fewer and smaller trees on the headland (1 in 70 plants where it was 1 in 40). Dry-season
patches: some scrub olive to straw, more on the exposed and steep ground; a dry plant's tint
runs from 1.2 to 2, which both plant shaders read as dryness, so the full plants and their
impostors still match. The first dry colour kept the leaves' own low brightness and could not be
seen; dried leaves are lighter. The ground between the plants up there is olive and straw where
it was a lime lawn.

### The clouds

- **Far:** blocky edges and specks along the horizon. At 60 to 150 km one step through a cloud
  was all or nothing. Now the edge erosion stops where a pixel is wider than the billows, thin
  cloud past 4 km only takes as much light as it covers, puffs under a few pixels tall fade,
  and each re-march shoots its ray through a new point of the pixel (Halton), so edges average
  out over the frames.
- **Blur:** with the clock running the carried-over clouds are resampled every frame at a
  small offset; bilinear reads, repeated, blurred them to cotton wool. They are read with a
  Catmull-Rom filter now.
- **Near:** finer, stronger edge erosion and a sharper surface; the light diffused through the
  cloud falls off faster, so the shaded sides between turrets are grey, not the same white as
  the sunlit tops.

### Speed

Side by side with v9 (`ab.mjs --hero --a=v9`, 20 rounds): overview +2%, viewpoint +1%, stairs
-3%, trailTop +4%, trailLow +4%, beach +2%, swash +3%, shoreBreak +1%, sideFromSea +2%. Along
the path (`path-bench.mjs --a=v9`): medians +4% still and +2% moving. Its worst single points
(+31% and +32% still, at tau 2.25) are noise: the same cameras side by side in `ab.mjs` came
out +1% and +2%.

On the way there, overview was a steady +9%. Bisecting it over the branch's commits: the
steps +4% (the stones, 80 triangles each with a depth pass, now 20 and none), the cliff foot +2%,
the head +5% (a new noise over every ground pixel under plants, which is most of the overview;
it reuses the shader's own noise now). After: +2%.

### Tools

- `ab.mjs --a=v9 --b=<commit>` bisected the overview's cost; `scroll-clip.mjs --stills` with
  `--dpr=2` gave the pixel rows across the horizon.

### Second round: the sand, the foot of the rock, the leftovers

Sam looked at v10 on his Mac and sent a screenshot from the sand at the foot of the path: the
sand too even, one colour, no depth, like a flat surface; where the cliff starts, too polygon;
and the leftovers from the first round.

- **The sand.** The photos (`beach-people-scale.jpg`, `beach-under-cliff.jpg`) show dry sand
  trodden all over: overlapping oval pits with pushed-up rims, fresh and slumped, some in lines
  where people walked. First worked out in the ground shader: it looked right (a red debug
  colour for the pits confirmed they were there before the lighting could show them; at first
  they were too shallow to see in the noon sun), but the whole ground shader got 8 to 12%
  slower everywhere, even from a kilometre up where no print is drawn. Switching the relief off
  in copies of the build, one feature at a time, pinned it on the relief. So the footprints are
  now baked at load into one more layer of the ground's texture arrays (`trample.js`, a 6 m tile
  in 170 ms), read twice with a sharp hand-over (averaged half and half, two reliefs cancelled
  out flat) and a level sharper than the pixel asks for; the layer stores the tilt as a sine,
  which flattens the steep walls of a print, so it is scaled back up. Metre-scale lumps stay in
  the shader, with patches of whiter, creamier and duller sand and a mottle into the distance.
  The viewpoint's sand still measures +0.02 stops against its photo.
- **Where the cliff starts.** Two things. The strips of rock face had rows 1.1 m apart at the
  page's resolution and met the sand in a jagged line of big facets: low on walls standing on
  the sand, rows are now 35 cm apart up to 8 m over the foot (26,000 more triangles), placed
  along the profile and zipped between columns by their place along it rather than their index.
  And sand banks up against the foot in ragged drifts, lying at its angle of repose, covering
  the line where the rock meets the sand. At the side of the cave mouth a white sand pyramid
  with a sawtooth top turned out to be the mesh builder's per-vertex mask for sand under the
  overhang, following the columns' triangles; it has a noisy edge now and only lies where sand
  could.
- **Leftovers.** The concrete steps a little greyer. The lace: a warp at half a cell bends
  each wall, walls thicken, thin and break off, and in about a third of the foam they are drawn
  out into curving filaments (the crackle glaze is gone; the first try was all scratches). From
  50 m out the plants' stand-ins shift toward the photo's grey-green and the painted ground
  cover stops at a steeper slope, so the head's faces show white rock and plants, not olive
  smears.

### Speed, second round

Side by side with v9 (`ab.mjs --hero --a=v9`, 16 rounds): overview +6%, viewpoint +2%, stairs
-1%, trailTop +6%, trailLow +8% (24 rounds, after the trampled layer was limited to where a
print is a few pixels; +10% before), beach +8%, swash +8%, shoreBreak +1%, sideFromSea +5%.
Bisecting this round's cost used temporary builds with one file put back, or one feature
switched off, each timed against the current build in the same browser: `parts.mjs`, which
switches defines in one page, disagreed with itself from run to run with the Mac this busy.

### Still weak

- The head from the viewpoint is closer in colour, but still a blanket of round crowns; the
  photo's scrub is finer.
- Far clouds right on the horizon (100 km and more) are soft smudges rather than a crisp band
  of small cumulus.
- Beyond about 20 m the footprints give way to a mottle; from the switchbacks the beach is
  smooth pale sand with tone, as it is in the photos from up there, but the hand-over could show
  in motion.
- The budget is spent again: trailLow, beach and swash at +8% against v9.

## v11: speed and the shareable build (2026-09-27)

Sam merged v10 after the Safari fix and started v11 in the same session. His answers to the
brief's questions: MIT for the code, the repo stays private (he makes it public himself), and
yes to the downloads (three.js 0.186, GSAP 3.15 with SplitText, Lenis 1.3.26, Instrument Serif
and Inter).

### Loading

The landing page took 12.4 s from opening to the loader lifting (median of three warm loads in
headless Chrome, `tools/load-time.mjs`, new). The page's own marks (`kl:*`, one per loader step)
showed where: 3.2 s before anything started, most of it growing the plants on the main thread,
then 7.7 s of terrain in the worker, then the warm-up.

- **The terrain is baked.** `tools/bake-terrain.mjs` runs the terrain worker in node and packs
  what it sends the page (`src/terrain/bake-format.js`): mesh positions to 16 bits in
  delta-coded planes (24 mm across, 4 mm up), normals in two bytes (octahedral), the index delta
  coded (14 MB down to 70 kB), the plants to 16 bits with species and variant exact. 92 MB
  raw, 11.9 MB gzipped. The page downloads and unpacks it alongside the textures.
- **A stale bake cannot slip through unnoticed.** The file carries a hash of the layout and one
  of the nine source files the worker imports. The page always checks the layout, and on
  localhost the sources too. A stale bake is a console warning and the worker generates the
  terrain as before. Checked with a one-line change to `strata.js`: the page went back to
  11.5 s and said why.
- **The plants grow after the downloads have started**, one variant at a time with a pause
  between, so the loader's counter moves instead of freezing.
- Result: 6.7 s (median, with the loader's steps all done at 3.9 s). The rest is the warm-up,
  1.5 to 6 s depending on what else uses the GPU: drawing the first frames makes Chrome's
  Metal backend build its pipelines, not JavaScript. `compileAsync` before the warm-up made no
  difference and was taken out.

### The standalone file

`kelingking.html`, 3.1 MB, runs from a double-click (`tools/build-standalone.mjs`, after Sam's
notes on standalone builds in the folder above). A browser will not load ES modules or start a
module worker from `file://`, so:

- Every module, the page's 49 and three.js's two, becomes a function returning its exports,
  registered by path, and each import a lookup in that registry: one classic script. GSAP,
  SplitText and Lenis go in as their browser builds, `debug.js` (the tools) as an empty stub.
  The code already had the simple module surface this needs (no default exports, `export *`,
  `import()` or top-level await), and the build stops if that changes.
- The worker's generator is a plain export now (`generateAll`), so a page with no worker can
  run it itself: the standalone file does when the bake cannot be downloaded.
- The stylesheet and the three font files are inside the file. The textures and the bake are
  on jsDelivr from `aura-assets`, folder `kelingking/`, tags `1.10.0` and `kelingking-v1`
  (35 files, each checked for status 200 and its exact byte count, and for CORS open to
  `file://` pages). The earlier tags of that repo (1.4.0 to 1.9.0) answer jsDelivr's listing
  with "package size exceeded the configured limit of 50 MB", yet single files at 1.9.0 and all
  of 1.10.0 are served. The README has the swap procedure.
- **Offline** the page still runs: the terrain is generated on the page (it freezes for about 8
  s behind the loader) and the scans are flat. At first flat meant grey 128 in every layer,
  which the shader's gain (target over the scan's average) turned into white sand and white
  steps. Each flat layer is now its scan's own average colour, so the island keeps its colours.
- `node --check` would not have caught a stray `import` in the bundle: node 23 takes a `.js`
  file with module syntax for a module and passes it. The build compiles every inline script
  with `vm.Script` instead, which fails on `import`, `export` and top-level `await` (tried).
- **Polishing after v11.** Sam asked what happens to the file when there is more polishing
  later. The page from `file://` only checks the bake against the layout, not against the
  code, so a later change to the plants' scatter would have shipped the old plants without a
  word. The build now refuses: it runs the bake check, then fetches every asset from the CDN at
  `TAG` and compares its bytes with `assets/` (tried against tag 1.9.0, which has none: it
  stopped before writing anything). A change to code alone needs only a rebuild.
- `tools/test-standalone.mjs` opens the file from `file://` in headless Chrome, with the
  network cut if asked, and photographs four stops: from the CDN it loads in 10.7 s with the
  terrain from the bake, and with no errors in the console.

### Going public

- `LICENSE`: MIT for the code, with what it does not cover (the OpenStreetMap data and what is
  derived from it, under the ODbL, then `vendor/` and the CC0 textures).
- The README opens for a stranger now: what the piece is, how to see it, how to run it.
- The history: one author and email, no reference photo ever committed, no keys or tokens,
  every gallery image a render. One private detail: the first copy of the v9 brief (commit
  `03e2253`) named the full path `/Users/sam/Projects/Claude Code/CLAUDE.md`, and `b5b9d32` made
  it relative. Removing it from the history means rewriting every commit since, so that is
  left for Sam to decide before the repo goes public.

### Speed

- **The first timings were four to five times too slow, and it was the tools' own fault.**
  Along the path at 1080p the page came out at 35 to 53 ms a frame, and v10 side by side just
  as slow, where v8 had measured 5 to 13 ms. The GPU read 100% busy with nothing of this
  session running: four headless Chromes from earlier tool runs (an hour old) were still open,
  each drawing the scene. `tools/cdp.mjs` only closed Chrome when a tool reached its own
  `close()`, so a tool that threw or was interrupted left it running. It now kills every Chrome
  it started when node exits, however it exits (tried with a throw and with SIGTERM). The same
  leak had left 45 profile folders, 3.6 GB, in the temp directory.
- With those closed (Sam's own browsers were still drawing), the page scrolling itself top to
  bottom (`path-bench.mjs --pace`): at 1920 x 1080, pixel ratio 1 all the way, median 16.7 ms,
  none of 2,486 frames over 25 ms. At a 14-inch MacBook Pro's 1512 x 945 at 2x, the governor
  held pixel ratio 1.5 (2268 x 1417), one frame of 2,485 at 25.1 ms. The brief's 60 fps at
  1080p on the M1 Max holds along the whole path. A mid-range laptop was not tried.
- Side by side with v10 at the 21 cameras (`path-bench.mjs`, 6 rounds, while the leaked
  Chromes were still running): median +3% still and +1% moving. Nothing that draws changed in
  v11, so this is the noise (the bake's 16-bit positions and 8-bit normals draw the same mesh).
- The hero frames: `hero.mjs v11` put three over budget (overview +29%, viewpoint +16%,
  trailTop +84%) and swash at -45%, for two builds that draw the same thing (the hero shots
  do not even use the bake). Side by side in one browser (`ab.mjs --hero --a=v10`): overview
  +1%, viewpoint +1%, stairs -3%, trailTop -1%, trailLow -10%, beach +2%, swash -3%, shoreBreak
  +3%, sideFromSea -1%. The outline check on `viewpoint` and `overview` still sits on the
  photos.

### Tools

- `tools/load-time.mjs`: fresh loads of the landing page, the time of each loader step from the
  page's own marks, median of the runs.
- `tools/bake-terrain.mjs` (`--check`), `tools/build-standalone.mjs` (`--local`),
  `tools/test-standalone.mjs` (`--offline`).
- `tools/cdp.mjs` cleans up after itself on any exit.

### Still weak

- The warm-up is now most of the load: 1.5 to 6 s of the first frames being drawn behind the
  loader, while Chrome builds its GPU pipelines. Fewer shader variants would shorten it.
- Offline, the standalone file freezes for about 8 s while it generates the terrain, and the
  loader's counter stops during it.
- The bake is 12 MB of the 37 MB the page downloads. Heights and the plants could go to fewer
  bits, but the mesh already lands within 24 mm.
- Phones and slower laptops are untried. A phone would need a lighter scene chosen before
  loading (q=512, fewer plants).

## v12: the breaking wave, and the clouds (2026-09-27, overnight)

After v11 Sam said the waves and the water still felt weak. He pointed at the
`3d-ultra-realistic-water` skill. I read it, and it is one kind of water, a deep open sea from
a ship at sunset (eight Gerstner waves, wakes, buoyancy), with no seabed, no shallows and no
surf. Our sea already does more on its own ground (an FFT spectrum, the sub-pixel slope spread).
Sam said to leave the skill and fix the break itself: it does not feel smooth and natural when
a wave breaks. Then, from the sand stop of the standalone file: the clouds feel weird too.

### How the break was judged

In motion: `capture.mjs shoreBreak swash --clip=10`, then sheets of twelve frames 0.2 s apart
through one break, before and after each change. The landing page too, held at the sand stop
and at the water's edge (`scroll-clip.mjs --from=18.4 --to=18.6 --speed=0.02`), and the same
from v11 (`--url=` a `git archive v11` copy) for the side by side. And numbers:
`breaker.readColumns()` (new) reads each column's stage and wave height back from the column
pass.

### What was wrong, and what changed

- **Weak.** The waves broke at 0.4 to 1.3 m (median 1.2). Each started to shrink at the break
  point, while its lip was still in the air, so it lost height exactly as it broke. Now a wave
  keeps its height until the lip lands (stage 0.8), and the swell is 1.5 m where it was 1.1:
  1.3 to 1.9 m at the break, Kelingking's usual shore break. The beach is 1 in 10 there (1.6
  to 2.4 m deep where they break), so the depth limit does not bind.
- **It popped.** A second before breaking the wave already stood tall but in the flat water's
  pale cyan, and half a second later the breaker mesh took over with chrome glints. The glints
  were the sea's ripples laid at full slope on a lip, which is stretched smooth: at half slope
  and a little rougher there, the lip shows a thin glint line along its crest.
- **Cut out.** Holes in the tearing lip were blobs half a metre across. They are fingers a
  decimetre or two wide, only over the last few centimetres of the lip. The white water's
  crevices went to 30% of the light, so a third of it was grey in the noon sun. Now 62 to 78%,
  lit by the sky and the light through the foam.
- **A comb.** At the collapse the whole face turned white at once, drawn with the face's
  streaks. Now the white water starts where the lip lands and boils up the face over a few
  tenths of a second, its top edge a row of billows, never over the smooth back of the wave.
- **White panes.** Covered by that white water, the collapsed heap lying on the sea's own bore
  showed as flat white panes with straight edges. It sinks under the sea at the handover now.
- **Cracks.** Within a second of the bore the white water turned into a net of polygon cells.
  It stays heaped until it has thinned to a quarter (0.45 before), and in thicker foam the cell
  walls are faint, so it thins into patches with holes and only then into lace.
- **No impact.** Spray where the lip lands went up at 2 to 5.5 m/s and stayed a low fringe. Up
  to 8 m/s now (about 3 m up, a few puffs higher), 16 particles per metre of beach where there
  were 10, the finer part hanging in the air longer.
- **Snow.** Close to the camera a spray puff is over a hundred pixels, and the grid of specks
  drawn through it (for droplets) covered the wave behind in even white dots. Specks only in
  puffs a few dozen pixels across now, and sparser. Up close a puff is mist.

- **Lavender under the curl.** The white water in the lip and the tube was lit by its surface
  normal, which points down under the curl, so by the sky alone. It is a volume of bubbles and
  water with the sun on it from above, lit by the way up now, and bright.
- **Spikes.** Even as fingers, the holes cut in the lip's tip read from the front as a row of
  spikes. The tip is whole now and tears into foam instead.
- **Cut-paper swash.** The swash's ragged edge and holes only started under 3 cm a pixel,
  which the page never reaches. From 8 cm now, so the patches seen from the water's edge
  stop are a little more ragged. The front band is still a solid strip.

Tried and taken out: a band of froth where the lip comes within a few decimetres of the sea,
to hide a jagged line at eye level. The line was not the two meshes crossing but the sea's own
bore in the foreground, drawn by its grid at a grazing angle (v1's teeth). The band did nothing.

### The clouds

- **Pills and balls.** A small puff (100 to 300 m across) could be given 300 to 540 m of height:
  taller than wide. Now no puff is under 400 m across, and a small cloud is at most half as
  tall as it is wide, easing off from 0.3 to 0.5 km in radius, so the big heaps over the island
  still tower. The first try capped every blob, turrets too, and flattened the heaps into loaves.
  A second widened the small puffs by drawing their radius differently, which took more random
  numbers and put every cloud in the sky somewhere else (the comparison was of two different
  skies). The turret count now comes from the radius as drawn, so the sky is the same one.
- **No flat bases.** Each cloud's base curled up by 100 m toward its edge, which rounded every
  underside, and faded in over 60 m. Flat to the edge now, over 30 m.
- **Cotton wool.** The rim's density ramp is about half as wide, so the lobes are crisper.
- Tried and taken out: filling the core of each blob to close the few blue holes the edge noise
  ate into it. It lifted the whole lower body over the edge threshold and smoothed it into a
  bell.

### Speed

Side by side with v11 (`ab.mjs --hero --a=v11`, before the last two changes): overview -0%,
viewpoint +3%, stairs -1%, trailTop +2%, trailLow +2%, beach +2%, swash +1%, sideFromSea +2%.
shoreBreak came out -20%, but its frozen moment is now a different, bigger wave, so it is not
a comparison. `hero.mjs v12` then put swash at +26%. The same frame and beach side by side
after the swash change: +2% and +2%. The spray has 60% more particles where the lip lands,
most of them culled when no wave is breaking.

### Still weak

- At eye level in the surf (`shoreBreak`, which the page never shows) the lip's tip is a
  straight white edge for a moment, and the sea's own bore in the foreground has a jagged
  silhouette (v1's teeth, from its grid at a grazing angle).
- The swash's front band is a solid white strip with a hard inner edge, and in one place it
  steps (the swash map's texels).
- Cloud bases are flat now but only a little greyer than the tops. The shaded sides still read
  a touch soft, like cotton, up close.
- The small glitch smudge in Sam's screenshot was not found. With no puff under 400 m and the
  pills gone it may be gone too, but that is not checked.

## v13: the dirt steps and the bamboo handrail (2026-09-28)

From Sam, on a screenshot of the descent: the blue cord that joins the bamboo "does not look
good, very below average", and the stairs look "too polygon". He then approved v12 and v13 together,
and they were merged in that order (v13 was branched from v12).

### How it was judged

Close up, from where a person would look, at cameras on the route (`s` = metres along it, the
descent is 178 to 304): `contactSheet` through `capture.mjs --eval`, and cameras aimed at
single lashings (the instance matrices read back from the page, so they stand a half metre
off one, the plants hidden). No number can say a knot looks like a knot.

### The cord

It was one smooth blue cylinder 7 cm tall, a collar, at each end of each rail. The photo
(`trail-mid-descent-b.jpg`) has thin blue nylon cord: several turns round the post, a knot,
loose ends. Now, per joint, two instanced pieces (three variants of each, a turn or two
different):

- **On the post:** two or three turns above the rail and two or three below, each a little
  tilted and sized differently and not quite closed, the top one with a knot on the inside
  and two loose ends hanging from it.
- **On the rail:** a spiral of two or three turns on each side of the post.
- The cord itself is 5.6 mm across, drawn as a tube with three radial segments, with a
  twisted-strand pattern (a turn every 8 mm), sun-faded in some, dusty against the pole.
- Sized to the post and to the rail at that joint (`lashingMatrices`, geometry.js). The post
  tapers, so the turns are sized at their height on it.
- Things that went wrong on the way: the first try was one shape with tilted rings, which
  from the front read as a vertical stack of ribbons (the tilt is about the wrong axis for a
  rail that is not on the post's own axis). The rail turns lay inside the rail (the rail is
  wider than the post's radius I had assumed). The lower rail's cord ran through the upper
  rail (both on one line). Rails that meet at a post now run past it side by side, on
  alternate lanes.

### The bamboo

Straight even tubes with a faint ring. Now bowed a centimetre or two in a direction of its
own, tapered (1.1 at the foot, 0.9 at the top for a post), cut on a slant, with raised dark
node rings (a pale band above each), fibres along it and now and then a split. The bowing is in
the vertex shader, and the depth-only pre-pass draws poles as if straight, so for a while
the ground's own pass covered them where the real pole lay behind that depth: they came out
black. The bamboo is thin, so it has no pre-pass now.

### The steps

Five or six large flat quads a tread, a razor edge, a flat riser, a straight ramp down each
side, flat shaded: each read as a slab. Now, on the dirt (the concrete keeps its crisp edges):

- 11 columns across and rows every second route sample (50 cm) in the middle, closer at both
  ends (3, 7 and 14 cm from the edge).
- **The front edge rolled over**, a quarter circle up to 5 cm, less where a log lies along it.
- **Soil heaped at the foot of each riser**, up to 3.6 cm, sloping over 13 cm.
- **The riser** in four rows, hollowed under the nosing by 1.6 cm and lumpy.
- **The banks** ease into the ground in two steps that follow it (a straight ramp before).
- **Smooth shading** across all vertices at the same place, so the nosing shades round and
  the tread runs into its riser and bank with no crease (`mesh(true)`, geometry.js).
- Logs now lie on the highest point of the tread's edge (the tread is dished and its edges
  stand up: a log set to the middle was buried at both ends and came out a wedge).
- The black strip at the foot of every riser (the nosing's shadow, drawn as none of the sun
  at all) is a 70% shadow at most now.
- The dirt went from 20,618 triangles to 104,048: a first try with 17 columns and finer
  rows was 247,984, and cut to this it looks the same.

The terrain bake had to be rebaked (the path is in it): 11.9 to 13.0 MB gzipped.

### Speed

Side by side with v12 (`ab.mjs --a=v12-surf`): the first pass came out beach +14%,
trailLow +10%, shoreBreak +11%, stairs +7%. The beach frame does not stand near the path
but sees all of it, and hiding the lashings alone (a temporary switch) brought it back
10%: 756 lashing pieces of a few hundred tiny triangles each, all in view from the beach,
where a 5 mm cord is a tenth of a pixel. Culling in the vertex shader did nothing (the shader runs
for every vertex). The page now gives the GPU only the lashings within 43 m of the camera,
refreshed when it has moved 3 m (`cullLashings`, trail.js, called from `renderFrame`): beach
+1% against no lashings and +6% against v12.

`hero.mjs` then put shoreBreak at +25% (a frame that looks out to sea and cannot see the
path: side by side it was -3%) and trailTop at +7% to +13% over five side by side runs,
with spreads of -9% to +30% while Sam's own browsers held the GPU at 100%. The dirt mesh sent
every quad's four corners down as vertices of their own (about 208,000 for 104,000
triangles), each through the vertex shader with its haze lookup. Welding the corners that
share a position, normal and attributes makes it 79,000 vertices for the same triangles
and the same picture, and the bake 13.0 MB. On a quiet Mac after that, side by side
against v12: trailTop +4% (twice), stairs +3%, trailLow +5%, beach +5%.

The last full check, all nine hero frames side by side (`ab.mjs --hero --a=v12`, 20 rounds,
the GPU 83% busy with other things): overview +3%, viewpoint +8%, stairs +4%, trailTop +11%,
trailLow +3%, beach +4%, swash +1%, shoreBreak +0%, sideFromSea -0%. trailTop is the frame that
stands on dirt steps with the most of them in view, and the noisy one: +1%, +7%, +12%, +13%,
+7%, +4%, +4%, +11% over eight runs, about +7% on average and about 0.4 ms. The `hero.mjs`
table in the gallery, which times the two builds minutes apart, said trailTop +71%, viewpoint
+33% and trailLow +29% with the head from the sea (untouched) at -42%: not to be believed.

### Still weak

- The steps are smooth earth with one large-scale bump each: a real dirt path on a
  cliff has roots, stones set in it and washouts. The loose stones are v10's.
- The lower rail's lashing at a post where the lanes swap: the cord of the outer lane is
  only the spiral on its own rail.
- The bamboo's nodes are shaded, not modelled: seen edge on, a pole is a clean cylinder.

## v14: the T-Rex head silhouette (2026-09-28)

Sam's landing-page screenshot showed the head as a rounded block from the clifftop. His
reference screenshots show a pointed crown, a brow that holds its height before the vertical
sea face, and a lower, separate beak over the beach arch. This pass changed shape only.

### What changed

- The distal spine in `layout.js` has a sharper cross-section. Its crown peaks just behind
  the sea face and the outer ridge falls away less abruptly. A first pass held the outer brow
  too high; the viewpoint outline caught it, so its last two heights came back down.
- The jaw spur is narrower and tapers toward the beach. The old five-metre face width made
  its green ridge drop almost vertically into the same pale wall as the head. A 24 m face
  profile, centered on the jaw tip, lets that ridge descend into a distinct triangular beak
  while leaving the main head's sea face sheer. The first, broader jaw profile pulled the
  beach overhang into a blocky cone. Confining it to a 20 m radius restored the cave.
- The revised layout is included in the 1024 terrain bake.

### How it was judged

`viewpoint` was rendered beside and outlined over `viewpoint-midday-a.jpg`. The top-down
`overview` outline checks the land and beach footprint, while `stairs` and `sideFromSea`
check that the edit still reads from the other cameras. The reference photographs stayed
local and are not part of the gallery or the commit.

### Speed

With the final v13 merge as the base and the jaw's profile confined to its tip, the paired
`ab.mjs --hero --a=v13 --rounds=8` run completed all nine views: overview 0%, viewpoint
+3%, stairs +6%, trailTop -3%, trailLow +2%, beach 0%, swash -3%, shoreBreak -2%, and
sideFromSea +1%. All are within the 10% frame budget. `hero.mjs v14` refreshed the gallery
but its second swash timing page did not become ready within two minutes, so that sequence
stopped before writing its table. A separate swash timing retry loaded normally. The gallery
uses its one complete timed round for absolute milliseconds and the paired run for changes.

### Still weak

The photographed head has much denser fine vegetation on its sloping jaw than this render.
The material and vegetation were intentionally outside this shape pass. The background
sea-facing wall also remains paler and flatter than the reference at the stairs camera.

## v15: continuous breaking wave and shore foam (2026-09-28)

Sam asked for a smoother, more convincing shore break after the head pass. The opening of his
linked demo supplied the motion cue: a broad crest runs toward reflective shallow sand and
leaves an uneven lacy edge. The local Kelingking beach photographs remain the place and scale
reference.

### What changed

- The breaker keeps its open incoming face longer and pitches its lip through a smaller arc.
  Broad variation along the cove makes different parts of the lip spill at slightly different
  stages, and small changes along its foot soften the previously straight mesh intersection.
- The broad white strip on the early crest came from the breaker's lip rim, as a temporary
  foam-mask diagnostic showed. Narrowing that rim revealed the translucent face before the
  lip lands. Its whitewater now grows from broken billows as the lip falls, leaving pockets
  of water between them instead of covering the face as one slab.
- The breaker's foot and visible edge now share an irregular profile, so the edge follows
  the same place where the mesh submerges into the sea. Extending the sea's lace pattern up
  the face produced large cell outlines in the close camera and was discarded.
- The uprush receives a softer, scalloped foam front. Bubble cover thins into patches on the
  sand, with the simulation leaving less opaque foam at the leading edge. The wave then
  retreats and the next crest follows in the same cycle.
- `ab.mjs` and `hero.mjs` accept `--url` so a managed worktree preview can be measured and
  rendered from its own server.

### How it was judged

The `shoreBreak` and `swash` cameras were captured before and after the change. A ten-second
`swash` clip from 18 s shows the breaker arriving, spreading up the sand, draining away and
the next crest forming; the later preview used a 1280 px, 15 fps capture after a 2048-quality
Chrome preview timed out. An eight-second `shoreBreak` clip checks the steepening face, the
lip landing, and the handoff to the sea. The `viewpoint` and `overview` outline captures keep
the v14 headland silhouette. The terrain bake is up to date. The standalone HTML was rebuilt
without fetching assets and loaded with the network disabled, with no console errors.

### Speed

The final paired `ab.mjs --hero --a=735a8a6 --rounds=8` comparison against the v14 head
checkpoint reports overview +2%, stairs +4%, trailTop +2%, trailLow -1%, beach 0%, swash
-5%, shoreBreak -10%, and sideFromSea 0%. The viewpoint first read +21% with a wide spread;
24 alternating rounds put it at +2%. All nine views are within the 10% frame budget.
`hero.mjs v15 --prev=v14 --url=http://localhost:5180/` rendered all nine final frames and
the local photo comparisons. v14 has no tag yet, so the gallery shows absolute timings; the
paired check above supplies the before-and-after budget measurement.

### Still weak

From the close `shoreBreak` camera, the clear face remains unusually smooth and the splash
has less fine spray than the photograph. A bright boundary is still visible where the breaker
returns to the sea at some stages. The sharp tan triangle visible through the shallows
is a terrain or sand material feature: hiding water leaves it in place. It is recorded in the
v5 sand brief and remains outside this wave pass.

## v16: Batu Satu shape and greenery (2026-09-28)

Sam's close screenshot showed the little offshore rock as a peaked, uneven mass with green
running down its left shoulder and a layered pale face on its right. In v15 it read as a
mostly level green cap over a bare cylinder.

### What changed

- The first islet alone has a less sheer south-east shoulder, a more sheer north-west face,
  and an off-centre crest. Its summit is slightly higher to better meet the viewpoint
  photo's outline; its mapped shoreline stays fixed.
- A restrained, irregular ground-cover layer continues down that shoulder between the
  existing face shrubs. It fades before the wave-cut foot and does not paint over the pale
  limestone wall. The 1024 terrain bake includes the new shape.

### How it was judged

The clifftop and overview shots were checked with `--outline` against the local reference
photos, and the clifftop was compared with Sam's tighter islet screenshot. The new peak
lands close to the photo's summit height, although the model's footprint is slightly
narrower in the clifftop photo. An early attempt to scatter extra face shrubs changed the
shared random stream and placed unrelated plants elsewhere in the scene; that attempt was
removed. The final cover uses the existing vegetation material and local islet coordinates.
`hero.mjs v16` rendered all nine frames and local photo comparisons. The bake check passed;
the rebuilt standalone generated terrain offline and loaded without console errors.

### Speed

The final paired `ab.mjs --hero --a=f64598a --rounds=8` run was within the 10% budget on
overview (-2%), viewpoint (-1%), stairs (-13%), trailLow (+4%), beach (+3%), swash (+2%)
and sideFromSea (-8%). TrailTop first rounded to +10% and a steadier 18-round repeat read
+1%. ShoreBreak first read +31% with a wide spread even though this islet is out of frame;
a 24-round repeat read 0%. These paired checks are more useful than separate absolute
`hero.mjs` frame times while background GPU load changes.

### Still weak

The source image has a more continuous mix of low foliage and limestone across the small
rock's face than the distant procedural scrub can fully reproduce. The islet's plan-view
outline comes from OSM and remains a little narrow in the clifftop photo.

## v17: more natural clouds (2026-09-28)

The v16 sky had a large, slab-like cloud near the east-cove lens and white flecks along the
clifftop horizon. The reference photos have broad clear intervals, a partial cumulus at the
edge of the east view, and subdued distant clouds. The first still-image pass fixed the east
view but missed two oversized clouds directly over the ridge path; watching the scroll exposed
them. The trail photo is mostly clear, with cloud only at the far left edge.

### What changed

- The weather field is sparser and uses a seed that leaves a clear band over the sea. The
  authored cumulus east of the island has a narrower footprint and stays near the photo's
  left edge. A southwest clearing is shaped in the weather texture itself, so the sky and
  the cloud shadows use the same field as the camera travels down the trail.
- The cloud base varies across broad billows rather than sitting on a uniformly straight
  slab. Medium-distance edge detail survives farther from the camera; tiny puffs fade before
  becoming hard white pixels. Distant coverage tapers into haze.
- The high veil has less directional stretch and a softer, more visible broken pattern.

### How it was judged

The `eastCove`, `sideFromSea`, `viewpoint`, and `trailTop` cameras were rendered beside their
local reference photos. The scrolling page was also walked from the aerial opening to the
ridge. The first seed and coverage alone still produced a pair of cotton-like clouds over
the path; putting the southwest clear interval into the weather map removed them without
changing the east-cove cloud or separating cloud shadows from visible clouds.

`hero.mjs v17` refreshed all nine hero frames and local photo comparisons. The final bake
check passed, and the rebuilt standalone loaded offline without console errors. The cloud
pass alone measured 1.17 ms in `eastCove` and 0.86 ms in `viewpoint` in a short local run;
whole-frame times vary substantially with other GPU work.

### Speed

The final paired `ab.mjs --hero --a=b74593f --rounds=8` run had three noisy readings:
overview +10%, stairs +12%, and sideFromSea +14%. A 20-round repeat of those cameras
settled at +1%, +3%, and -1%. The other hero frames were within the 10% budget; trailTop
and trailLow, the views most affected by the southwest clearing, read -3% each in the
eight-round run.

### Still weak

The partial cloud in the east view remains more rounded and shaded than the wind-sheared
white edge in the photo. The thin high veil is procedural and can read as streaks at certain
angles. Cloud movement remains slow, matching the trade-wind speed set by the scene.

## v18: natural shore break (2026-09-28)

Sam found the first moments of the beach break unnatural from both the beach and the
aerial scroll. The v17 cross-section curled into a long, uniform blue tube, then handed
off to a broad white stripe. The water colour and small surface detail were already in
the right direction, so this version changes the geometry and foam's large-scale birth.

### What changed

- The breaking ribbon now throws a thin spilling lip down an open sloping face instead
  of forming an elliptical hollow tube. Its shape develops more gradually along the
  crest; the approaching face is a little broader before the lip forms.
- Fresh foam begins as the lip lands. Gaps in its source vary with the wave, and the
  source is less intense. The existing foam simulation still carries those patches
  toward shore and draws the same fine bubble texture; the shader no longer fills
  peak-density foam with a solid white override.

### How it was judged

Matched five-second `shoreBreak` clips from v17 and v18, both from 16 s on the sea clock,
show the old dark tube holding its shape before collapse. The v18 crest spills sooner
and the new white water separates into smaller patches. The five-second `swash` clip
shows the wash continuing onto and off the sand. The `shoreBreak`, `swash`, `beach` and
`surfTop` still cameras compiled without console errors. Two attempts to straighten the
whole cove wavefront were removed: an incoming phase skew caused a large white sweep on
the sand, while a smoothed shore-distance field and run-end taper had little visible
effect on the aerial corner.

### Speed

An alternating eight-round check against v17 commit `80b450a` measured `shoreBreak`
at -12%, `swash` at +6%, `beach` at -6% and `viewpoint` at -3%. The spread varied with
GPU load; all four median results are within the 10% frame budget. A full nine-view
eight-round pass also stayed within budget except `trailLow` at +13%. A focused
20-round repeat of that view measured +1%, so the isolated overage was not stable.
The gallery records the paired results.

### 2026-09-29: the break spreading sideways

Sam liked the approaching crest from the beach scroll, but the left and right sections
seemed to break on a different beat. The ribbon had its own alongshore stage offset of
up to 0.30 while the sea foam and spray used `surfAt`'s unshifted stage. That could put
the lip roughly three quarters of a second ahead of its white water at one end. The
ribbon now uses the same stage as the sea, foam and spray. A smaller broad peel uses the
crest's existing wave-specific wobble inside `surfAt`, so all four effects move together.
The ribbon's direction also blends toward the smoothed waterline normal where the
distance field fans around the headland. Landing spray is shorter, lower and less opaque;
the old tall puffs looked detached from the moving break.

Matched 9.1-second clips at the sand chapter's scroll camera (`tau` about 4.05) show one
wave cycle before and after these edits. Five-second fixed `shoreBreak` and `swash`
clips check the eye-level collapse and runup. The captured clips are local under
`captures/v18-feedback-*` and are not committed. The existing water colour and fine
surface texture were left alone.

An alternating eight-round, nine-camera frame check against the first v18 commit
`1092e1a` put every median change between -1% and +4%. The beach frame was +1%,
swash -1%, and shoreBreak +2%, within the 10% frame budget.

The 4 m beach camera exposed two further edge problems. The large diagonal lobe at the
left remained when the breaker mesh was hidden: the shore-distance field folds round
the rock, and a crest could cross that fold twice. A local, seaward-offset guide now
sets only the incoming wave's phase across the south end of the cove. It fades out
before the waterline, so depth, breaking strength and the swash still use the real
shore distance. The column-by-column ribbon then grows from a small fold while the
heightfield gradually hands over its crest, instead of exposing a full-height lip in
the first metre of the peel.

On the right, thin white hooks stayed visible with both spray and ribbon hidden and
disappeared when the foam simulation was disabled. Older simulated foam is now
thinned on the rising face; the direct fresh break and the simulation's sediment and
flow are still present. A matched nine-second capture at the sand chapter now shows
the left crest forming without the diagonal lobe, with a smoother spreading lip and
no tall foam hooks on the right. The fixed clip is `captures/v18-feedback-final-wave.mp4`.
The final alternating eight-round check against `1092e1a` kept all nine hero cameras
within the 10% frame budget: paired changes ranged from -3% to +7% (`beach` +5%,
`swash` -3%, `shoreBreak` +1%).

### Still weak

The wave remains a procedural surf model rather than a fluid simulation, and the
collapse can still read as a bright strip from some aerial moments. The old tan sand
triangle, visible with water hidden, remains the separate terrain/material issue
recorded under v5.
## v19: the stair path and blue rail lashings (2026-09-29)

Sam showed a close frame of the lower steps: the blue cord read as separate decorative loops,
and the stone path and first stair flight were too straight and clean. His photos show a wider,
weathered concrete start, then a narrow brown-earth route with uneven log risers, stones,
and grasses cutting into the margins. A close photo from [Let's Venture Out](https://www.letsventureout.com/kelingking-beach-hike-nusa-penida/)
shows the blue twine gripping intersecting poles with diagonal strands and small ends.

### What changed

- The paved flight starts about 1.85 m wide and tapers toward the 1.3 m ridge path. Its
  treads have modestly varied going and rise, rounded damage at some corners, settled top
  surfaces, and shorter exposed side walls. The concrete scan is darker, with broad dirt
  staining and a different weathering value for each tread instead of uniformly white
  aggregate. More corners break away than in v18, but the central walking line stays intact.
- The dirt track drifts slightly within the mapped route and gets shallow foot ruts, uneven
  verge reach, and patches of packed brown earth among the exposed limestone grit. It keeps
  its rounded nosings, heaped riser feet, and scattered logs from v13.
- Each bamboo rail end now has thin cord wrapping the post and rail, with two taut crossing
  strands over the actual interface. Both overlapping rail lanes have a post connection.
  The knot is compact, the tail is 2–4 cm, and the blue and bamboo colours are weathered.
  The old 7.5 cm arched ends are gone. The near-only lashing cull still keeps the rope cost
  out of distant hero views.

### Checks

Close contact sheets at four paved positions and four lower trail positions were compared
against the supplied photos. The terrain bake was rebuilt for the normal preview. All nine
hero frames rendered with zero console messages. Side-by-side timing against v18 commit
`11eabdd`, six rounds of six frames, came in between -6% and +3%; every hero view stays
within the 10% budget. The local standalone also loaded offline with no console errors,
generating its own terrain. The dark terrain patch beside the top stairs is present in the
v18 baseline contact sheet as well; this pass does not change that terrain surface.

## v20: final blue ties and sparse beach prints (2026-09-29)

Sam's last-stair closeups exposed a blue oval apparently hovering beside the bamboo post.
The original crossing strands made the projected loop, and the high upper rail allowed a
band to silhouette above the angled post cut near the beach. The cord now makes two short,
taut bridges between the post and snug rail turns. Over the final 20 m the upper rail eases
down 14 cm, and a broken stump carries a rail only when its cut leaves enough room for the
tie. Earlier stairs retain their layout.

The six-metre normal tile had repeated hundreds of overlapping footprints over the dry
beach. Five world-space walking lines now place alternating prints with varying stride,
size and lateral drift. The dry sand scan stays, with a little fine colour and roughness
variation at eye height. Removing the unused print texture also avoids its load-time
generation and texture-array layer.

Four close rail views from both sides and scroll stills at the last stairs and sand were
checked against Sam's screenshots. The bake was rebuilt and checked. All nine hero views
rendered without console messages; the standalone opened offline without errors. A paired
16-round beach timing check against `a245aee` measured +3% median, below the 10% frame
limit. The v20 gallery holds the close rail and sand views.

## v21: cliff foot and sand contact (2026-09-29)

Sam's beach and last-stair frames showed pale sand climbing the limestone in sharp wedges,
and a row of disconnected-looking rock triangles several metres in front of the wall. The
view from above also showed the south-end overhang breaking into stretched tan fins.

The traced beach wall now varies over broader distances, and the heightfield softly joins
the sand profile to the rock toe within about 20 cm of its previous height. The south-end
cave retains its lip but has a shallower, shorter recess. On the beach, the flat ground grid
now owns the floor while the face strip fades under it; the strip takes over as the wall
rises. The contact material keeps sand off steep triangles, lowers the painted sand bank,
and gives the toe a restrained dusty tint with scattered limestone chips rather than a
uniform field of bright pebbles. Ground-cover paint fades from the low beach wall.

The close camera at the last stair, the broad beach camera and overhead views were checked
in clay and finished lighting. The long exposed strip on the sand is no longer visible;
some attached limestone rubble remains at the base. The revised cave reads more clearly
from the beach, with the headland silhouette preserved.

All nine hero frames rendered without console messages. The viewpoint and overview outline
checks showed no new silhouette change. Alternating performance checks against the previous
`b3d3c8c` checkpoint kept eight hero views between -4% and +1%; a 20-round repeat of the
noisy stair result measured +2%. The bake is current, and the local standalone opened
offline with no console errors. The v21 gallery includes close and overhead contact sheets.

## v22: continuous lower cliff and beach junction (2026-09-29)

Sam's next screenshots showed that v21 still left a blue sawtooth band beneath the beach
overhang and a broad faceted limestone apron beside the sand. Rendering the ground grid
and the cliff strips separately traced the teeth to partially covered grid cells crossing
the recessed cliff face. Concave corners also shortened some face profiles above beach
height; using that first height as the cliff foot lifted their undercuts into hanging shelves.

The sand floor is now evaluated independently of the uncarved cliff ramp and continues
beneath the cave. Rising grid cells covered by a beach wall are replaced with shared floor
vertices; the submerged beach retains its sloping seabed. The rock strip is seated below
that floor, rather than carrying a second sand-painted surface across it. Lower strip rows
join by physical elevation and their positions are smoothed across neighbouring columns,
with the buried toe retained. Short profiles find the actual beach foot outside their window
before carving.

Walking-height views now show a continuous lower wall instead of the blue triangular comb,
and the near wall meets the beach without the detached pale apron. The inspection includes
both ends of the cove and the same contact from the trail above. Small geological ledges
remain, and the last stair's cut bank is retained around the walking route.

The preview mesh has 1,202,293 vertices and 1,175,130 triangles (+1.0% and +0.4% against
v21). The bake is 13.35 MB compressed; its round trip has at most 12.2 mm position error
and exact indices. The local standalone was rebuilt from the same source.

All nine final hero frames rendered without console messages. The viewpoint and overview
outline captures were generated, but the local reference photos were unavailable; the
established silhouette was checked against the stored v21 renders instead. Eight alternating
rounds of six full frames against `e03424b` measured median paired changes between -5% and
+5%, within the 10% limit at every hero camera. The v22 gallery records those timings.
The rebuilt local standalone opened offline with generated terrain and no console errors;
four scroll stops were captured, including the beach chapter.


## v23: connected blue cord, persistent grass and cloud detail (2026-09-30)

Sam accepted the larger cloud shapes but showed blurry edges and separate white dots. During
this pass he also reported a black platform at the clifftop, sparse vegetation from above,
and blue cord that appeared detached from the stair rails. These additions are recorded in
the same brief.

### Blue cord and wood contact

The previous outer rail lane was offset from its post, and a generic lashing did not follow
the poles’ bowed, tapered surfaces. Adjacent rail spans now alternate vertically against
the same post side. A shared bamboo cross-section function matches their rendered shape.
Joint descriptors identify the actual wood pair and contact heights. Their cord follows the
combined cross section, with two winding families, short leads into a compact locking knot,
and short gravity tails. The shader resolves braided carriers, fine fibres, subtle relief,
blue fading and roughness. Every one of 502 wood interfaces has about 0.5 mm of seating;
the measured range is -0.516 to -0.485 mm.

Full rope geometry initially added too much work. A shared vertex pool now submits nearby
joints in one draw call, with coarser ring indices beyond arm’s length and a distant fade.
Both sides, the lowest landing and the final scrolling descent were reviewed. The walking
path and irregular treads remain as they were. At extreme macro distance the bamboo still
reads as procedural; the cord texture is generated rather than scanned.

### Clouds, platform and vegetation

Clouds now resolve at three quarters of the drawing buffer, capped at 1920 px. Bounded
cubic temporal reconstruction refreshes detail sooner during motion. Small cloud bodies
retain their parent height and receive a continuous density core instead of isolated bright
sites. Secondary billows and internal light contrast retain the accepted larger shapes.
An early opaque-fleck filter also affected thin cirrus and produced visible contours; its
support filter is now blended only into opaque cloud pixels. Fine outside wisps stay soft.

The black clifftop patch came from marking the concrete platform as a stair tread: zero
riser distance removed sunlight across the whole pad. It now has its own concrete face tag,
verified at five adjacent actual scroll positions, including tau 1.012.

Grass had no distant representation and only occupied a 22 m route corridor. Its existing
43,365 positions are retained, with matched distant impostors and 5,927 extra seeded tussocks
in open headland ground. Path clearances, bare rock and sand are excluded. The first grass
impostor shader exceeded the frame budget at trailTop; averaging its matte blades instead
of applying a costly single-leaf sky reflection brought that view back under the limit.

### Checks

All nine final hero frames rendered with zero console messages. Twelve alternating rounds
of eight complete frames against `6463322` measured paired median changes from -7.9% to
+7.1%; all pass the 10% limit. After the final knot leads were added, a sixteen-round
trailLow repeat measured +1.5% (middle half +0.3% to +5.1%). Moving-cloud comparisons measured
+4.8% for the large-cloud view and -3.2% for the horizon. Timings and images are in v23’s
gallery, with a 4.8 s clip of the final stairs retained locally for review.

The 13.38 MB terrain bake is current. The headland’s decoded positions, normals and triangle
indices are unchanged from v22. The local reference photographs were unavailable, so shape
verification uses numerical identity and stored v22 renders, with no new photo-match claim.
No assets were downloaded. The local standalone was rebuilt and loaded with network access
blocked; it generated terrain and reached four scroll stops with no console errors.


## v24: solid supporting terrain beside the stairs (2026-09-30)

Sam showed a see-through opening beside the lower stairs at roughly 28 m elevation.
The terrain material was already opaque and double-sided. The defect came from the v22
beach-floor pass: it lowered the grid outside the narrow 2–5 m trail carving mask while
face-strip windows stopped short of the walking bank. Rock stayed above the lowered grid,
exposing the distant cliff and water beneath its edge.

Beach-floor lowering and rising-cell replacement now preserve the complete authored bank
reach plus mesh overlap (10 m from the route, transitioning into the floor over 6 m).
This follows the whole route and leaves the beach recess intact. The screenshot location
was reproduced at tau 3.665, height 28.03 m, then checked with and without vegetation.
A ray through the opening previously struck distant rock at 27.77 m; it now strikes the
supporting bank at 3.56 m. Five neighbouring rays also hit the near ground.

38 plant-free clay views cover the walking descent from tau 1.0 through 4.2, including
±35° head turns at seven lower-stair positions. No remaining see-through openings were
observed in those views. A 4.8 s actual scrolling clip includes a 25° turn through the
reported area. The gallery records before/after renders, both inspection sheets and
stills from that clip. The clip remains local in captures/v24-closure-motion.mp4.

The heightfield, 141,677 authored face-strip vertices, vegetation arrays, route line and
stair mesh arrays are identical to v23. Only 973 grid vertices change by more than 25 mm,
within the lower stair-bank region below 48.3 m. The mesh has 1,202,066 vertices and
1,175,084 triangles, 227 and 46 fewer respectively. Shape verification uses those numeric
checks and stored v23 renders: local reference photographs remain unavailable.

All nine final hero frames rendered with zero console messages. Twelve alternating rounds
of eight complete frames against v23 checkpoint bfafc01 measured paired median changes
from -6.5% to +7.2%; every hero camera passes the 10% limit. Raw timing ratios and
middle-half ranges are in docs/gallery/v24/bench.json. The 13.38 MB bake is current, with
exact triangle indices and at most 12.2 mm position error after packing. The local
standalone was rebuilt; with the network blocked it generated terrain, reached four
scroll stops and produced no console errors.


## v25: curved cliff toes and beach relief (2026-09-30)

Sam accepted the blue cord and asked for another close pass on the lower cliff: blue
angular facets, a pale rock apron, straight sand ribbons and flat-looking sand. The four
supplied screenshots were reproduced with fixed cameras looking into both ends of the
cove, back up the last stairs and down at the sand.

### Geometry and contact

A shortened cliff profile was still leaving its original grid ramp exposed. Its lower
carving taper now stays active only near beach level, and the seated profile owns that
rising surface. The original ramp continues beneath it as beach floor. Lower face
columns use a wider Gaussian smoothing window, with physical elevation matching and a
buried toe retained. This removes the pointed fan at the concave corner without changing
the upper cliff taper.

The v24 supporting bank remains around the higher descent. At beach level the ground
outside the actual tread can settle into the sand; keeping the entire 10 m bank there
had left the pale apron and a narrow terrace beside the last steps. A smooth, height-limited
relaxation removes that low terrace while preserving the higher support.

Only low rising beach-contact cells are subdivided into a 4 by 4 patch. Finite-difference
normals round the surface. An initial linear boundary with T junctions showed hairline
seams after the bake quantized positions. The final boundary uses shared vertex indices
and conforming fans in its coarse neighbours, and keeps clear of floor-cap ownership
changes. All packed vertices therefore meet at the same position. The mesh increases
from 1,175,084 to 1,180,372 triangles (+0.45%) and from 1,202,066 to 1,205,421 vertices.

### Sand and light

A shared dry-sand relief function adds broad, shallow wind-sorted drifts, fading out
before the wet sand. The exposed floor uses the same formula as the heightfield. The
heightfield changes by at most 16.7 cm. The route's horizontal coordinates, arc length
and width are identical; its settled elevations change by at most 27.4 mm. The five
walking lines are unchanged.

The sand shader adds filtered centimetre-scale slope, subtle colour and cavity variation
above the geometric relief, while reducing the old metre-scale shader lumps. Existing
CC0 scans remain in use. Deposited sand follows the smooth bank normal; the triangle-slope
cutoff had painted straight bands on that bank. Beach bounce under low overhangs now reads
the exposed beach floor instead of the high uncarved ramp. Actual sky-lit shade on rock
retains its cooler colour.

### Verification

The final 42 textured and plant-free clay views cover tau 3.665–4.3 and head turns up to
90 degrees in either direction. No new openings or contact seams were observed. The six
rays through the v24 opening still strike near supporting ground, at 2.89–3.51 m, rather
than the distant cliff. A 5.3 s scrolling recording crosses the last descent and turns
60 degrees toward the cove. Fixed-camera before/after images, clay views, audit sheets,
geometry measurements and motion stills are in the v25 gallery.

A dark rectangle in the first audit was a capture-script defect: a scripted pose change
had not refreshed the camera-centred ocean wedge. Refreshing the water after each head
turn removed the rectangle. The corrected audit was then rerun; the production ocean
was not changed.

Upper-grid positions above 100 m differ by no more than 7.6 mm after packing, below the
25 mm reporting threshold. Stored overview and viewpoint comparisons retain the outline.
Reference photographs remain unavailable, so this is a regression comparison, not a new
photo-match claim. Strong midday light still makes subtle sand drifts less visible when
looking straight down; their surface slope is clearer at grazing angles.

The terrain bake is current: 13,450,447 bytes, exact triangle indices after packing,
12.2 mm maximum position error and 1.9 mm maximum height error. No assets were downloaded.
All nine final hero frames rendered with zero console messages. Twelve alternating rounds
of eight complete frames against v24 checkpoint 5fa4370 measured median changes from
-7.3% to +7.9%; every camera passes the 10% limit. The local standalone was rebuilt
with the final material and opened with network access blocked. It generated terrain,
reached four scroll stops and produced no console errors.


## v26: one continuous incoming wave, falling lip and whitewater (2026-09-30)

Sam accepted the approaching water and asked for a major pass on the crest and break.
The screenshots showed clear blue sections separating from the incoming wave, followed by
foam with a different motion. This pass changes only the near-shore wave, lip, impact spray
and foam transport. The FFT ocean spectrum and accepted scene elements stay intact.

### Geometry and timing

The main surface previously lowered its crest while a separate ribbon rose over it.
That produced a trench around the ribbon and cut the incoming swell away from its break.
The swell now remains the solid body beneath a thin forward-pitching lip. A cubic outer
profile and a short underside take that lip down to its trough, then settle it into a
lower bore displaced shoreward. The root uses the actual swell crest height, rather than
an interpolated pair of trough heights. Impact starts around stage 0.76, shared with spray.

The old distance-gradient crest solver could find different waves in neighbouring sections
at the curved cove end. Five bounded Newton steps now use the wrapped phase gradient of the
actual incoming swell. The ribbon direction follows that gradient with a small contribution
from the smoothed waterline normal. This removed both the spatial cracks and the temporal
jumps in active crest columns.

Foam begins at the spilling crest, spreads down the falling lip and is born at the forward
landing point. The main surface's old impact source was behind the lip. It now follows the
same forward offset as the collapsing body. Persistent foam transport and ballistic spray
use the local wavelength and derivative of the existing irregular wave clock. The foam's
trail therefore advances with the bore instead of moving at a fixed unrelated speed.

### Iteration and overlap

Early versions raised impact heaps on the rear shoulder, leaving clear polygon-shaped caps
above the solid crest. The heaps now sit only on the landing water. The root is seated inside
the swell, and the sheet remains buried until its pitch and aeration are established. This
removed blue patches at 17 s and a premature dark sliver at 24 s in the close audit. Impact
foam retains its lace instead of becoming a completely opaque white pane.

Geometry derivatives provide the normal through onset and collapse, with the analytic
profile tangent smoothing the folded lip. This replaced four extra surf evaluations per
vertex from an intermediate version. Its ocean slope perturbation uses the same sign as the
main water. Narrow Gaussian sources also skip insignificant work outside their windows.

### Verification

Matched 18 s recordings, clock 13–31 s at 24 fps, cover incoming waves, peak, fall, impact,
advancing foam and the next incoming crest from the screenshot's roughly 20 m stair view
and from 4.8 m above the sand. A 3.5 m close view was inspected at quarter-second intervals.
Every sample explicitly updates the water after setting the clock before drawing: an early
capture that only set time had frozen geometry, and was discarded. The final clips and
one-second contact sheets are in the v26 gallery. The clips are simulation-time recordings,
not a claim of real-time frame pacing. All three final captures have zero console errors.

Across the matched 73 quarter-second samples, the largest gap between adjacent active
columns falls from 6.404 to 1.384 m, with gaps over 4 m falling from 19 to zero. The largest
same-wave column travel between samples falls from 6.000 to 1.457 m; steps over 2 m fall
from 239 to zero. Wave resets are excluded by the stage criterion. No active column contains
non-finite data. These are continuity checks, not a physical fluid simulation validation.

All nine final hero frames were rendered. Land-label comparisons at 1400 × 788 with water
hidden have zero changed pixels at both overview and viewpoint. Local reference photographs
are unavailable; this verifies regression against v25, with no new photo-match claim.
The terrain bake remains current. No assets were downloaded. The final local standalone
contains 55 bundled modules and parses as a classic script. With network access blocked it
loaded in 22.2 s, generated terrain, rendered all four validation scroll stops and produced
no console errors.

### Performance and remaining limits

The eight normal overview, trail, beach and swash heroes stay inside the 10% frame-time gate
against `51e68d3` (paired medians −7.7% to +6.8%, twelve alternating rounds of eight frames).
The close water-level hero is an explicit realism exception: +131.6%, middle half +90.4%
to +164.0%, separate medians 9.95 → 25.61 ms. The intact wave body exposes much more of the
main water shader at this camera. Diagnostics confirmed that restoring the old sink makes it
cheaper while also restoring the visual defect. A depth prepass did not help; simplifying
foam detail only recovered part of the cost. The wave and detail are retained, and this
remaining cost is recorded in the v11 speed brief. Absolute times vary with background load.

This is an authored continuous surf model, not a resolved fluid simulation. The 1.3 m
water-level camera can enter a tall crest; underwater rendering is outside this pass.
Verification covers the specified fixed-time range and cameras, not every possible sea state.


### v26 review polish: restrain the forming lip (2026-09-30, 18:39 report)

Sam accepts the wave's continuous motion and asks to polish an intermittent bubble-like
shape near the peeling crest. A matched beach camera at about 4.55 m reproduced it in the
larger incoming wave around clock 5–8 s. Thinner underside and normal diagnostics did not
resolve the shape. The actual profile developed its full forward reach while the tip was
still high, and its penultimate outer control overshot the tip. This made an inflated cap
and a rounded turnback along the crest.

Forward reach now grows with the squared fall envelope. The penultimate control remains
behind the tip, keeping all outer horizontal controls in order. At impact stage 0.76 the
reach and tip height are identical to accepted v26. Only these two profile expressions
change in production; the same profile also supplies the lip tangent and spray geometry.
No underside or shading diagnostic was retained. The clock, crest solver, incoming water,
foam transport and open ocean are unchanged.

Matched 18 s beach recordings at 24 fps, clock 1–19 s, show the refined forming lip and its
collapse. A second stair cycle at clock 13–31 s and a close quarter-second audit at 1–19 s
retain the continuous swell, fall and advancing foam. All three captures have zero console
errors. Across 73 paired beach samples, the crest and stage readbacks match `1e1cc0d` exactly:
zero changed components, maximum difference zero and no non-finite active columns.
Comparison clips, frames and measurements are in `docs/gallery/v26/polish/`.

All nine hero views were refreshed with zero console messages. Water-hidden land-label
masks at overview and viewpoint have zero changed pixels against `1e1cc0d`. References
remain unavailable, so this checks regression without a new photo-match claim. The terrain
bake is current. The local standalone was rebuilt with 55 modules, its scripts parse, and
it passed all four offline scroll stops with zero console errors after loading in 20.3 s.
No assets were downloaded.

Twelve alternating rounds of eight complete frames against `1e1cc0d` pass all nine paired
median timing gates, ranging from −3.4% to +5.9%. This polish adds no performance exception.
The original v25-to-v26 water-level exception above remains. The authored surf and existing
underwater-camera limits also remain; verification covers the recorded cameras and sea
state rather than every possible wave.


## v27: Right beach wall foot (2026-09-30, 18:40 report)

Sam reports that the bottom of the right beach wall looks much less natural than the
left, with an artificial blue stepped region and a broad ochre shelf. Four matched
beach cameras, with textured and plant-free clay pairs, reproduced the defect.
Unlit, shadow, sky-horizon and ground-bounce readbacks separated lighting from geometry:
disabling the sun shadow left the staircase, while the unlit mesh had a continuous curve.

The wall-column lighting pass skipped rows with no outward-projecting overhang. Those
vertices retained full sky, ground and sun-horizon defaults next to rows with occluded
cave lighting. Low beach rows now include inward rock above them in the sky horizon and
receive ground bounce from the actual continuous sand floor past the drip line. The old
uncarved heightfield toe was several metres above that floor. The correction fades out
between 18 and 32 m. An intermediate version recomputed open-wall ground values at the
upper blend edge; the final version preserves the original open defaults there.

The lower right wall uses a world-fixed, softly bounded region for finer surface detail.
Existing CC0 scans supply 1.83 m bedding and pitted grain up to 1.6 m, retaining pores,
normal relief, roughness and occlusion. Oversized marble-like crack colour is subdued.
Ochre weathering follows runoff and individual beds, leaving grey-beige worn patches
instead of one uniform orange stripe. Triplanar projection and footprint filtering
keep these details fixed to the rock across head turns. No new textures were downloaded
or allocated; existing colour maps are 2048², normal/mask maps 1024² with mipmaps and
anisotropy 8.

### Verification

Final close-up and clay pairs cover the reported beach direction, the opposite cove,
the formerly stepped recess and the sand contact. All have zero console errors. The
nine final hero renders also have zero console messages. Camera poses and terrain ray
readbacks are reproducible with `tools/cliff-foot-review.mjs`; before/after panels and
measurements are in `docs/gallery/v27/`.

Decoded bake comparisons against accepted checkpoint `e31c8b0` show identical positions,
normals, indices, heightfield, plants, water and coast data. The mesh remains 1,180,372
triangles and 1,205,421 vertices. Only 18,133 lighting vertices change; none is above
32 m. Water-hidden land-label masks at 1400 × 788 have zero changed pixels at overview
and viewpoint. Local photographs remain unavailable, so these are regression checks
without a new photo-match claim.

The final terrain bake is current at 13,493,108 bytes. The rebuilt local standalone
bundles 55 modules and parses as classic scripts. With networking blocked, it loaded
in 23.7 s, generated terrain and texture fallbacks, and rendered scroll stops 0.3, 1,
2.6 and 4.6 with zero console errors. The online preview remains the scan-material
review target. No assets or reference photographs were downloaded or uploaded.

Twelve alternating paired rounds of eight complete frames against `e31c8b0` pass all
nine hero median timing gates, from −2.5% to +5.3%. This pass adds no performance
exception; the original v25-to-v26 close water-level exception remains. The original
curved geometry is retained: this fixes its misleading lighting and refines weathering,
not a new geological reconstruction. The visibility approximation remains column-based,
and verification covers the specified cameras rather than every possible view.


## v28: Natural beach sand (2026-09-30, 18:41 report)

Sam reports that the sand feels flat and perfect from the lower stairs and requests a
pass grounded in real beaches. Browser-viewed sand references showed interrupted,
curved ripple ridges, quiet patches between deposits and mixed grain sizes. NPS beach
profile information informed the distinction between dry backshore and smoother packed
sand beside the swash. No reference images or other assets were downloaded or shipped.

The first shader revision strengthened surface normals and added broader relief, but
it remained too faint. Shader diagnostics from a close camera confirmed dry sand
(firm = 0), nonzero surface detail and the actual nearly overhead sun direction. The
final material combines elongated metre-scale hummocks and hollows with interrupted
31 cm ripples and shallow micro relief. Ridge shading follows the same profile as its
normal slope. An intermediate pore tint looked smudged; the final pass reduces it and
filters it into the middle distance. The second ripple harmonic filters earlier than
the main ridge, preventing fine stripes from persisting below a pixel.

Existing CC0 sand scans supply grain normals, roughness and occlusion; the dry normal
is stronger. Sparse 1–3 cm coral/shell chips appear only close enough to resolve them.
Patterns use world coordinates and a shared deposition field, leaving smoother patches.
The five walking lines, broad geometric drifts, wet-material transition and accepted
swash clock remain unchanged. This is material surface relief, not extra granular mesh
geometry. Existing 2048² colour and 1024² normal/mask arrays with mipmaps and anisotropy 8
are reused; there are no added texture allocations.

Four matched cameras cover the lower stairs, beach level, a grazing view and close sand.
A 145-frame, 24 fps approach with a head turn keeps the sea fixed at 17 s for the sand
review. The inspected approach frames retain world-fixed ridges and quiet deposits.
These captures and all nine final hero renders have zero console errors. Before/after
panels, cameras, clip and readbacks are in docs/gallery/v28/. The existing thin blue
swash-film join visible in the grazing camera is recorded in the v26 water brief.

Water-hidden land-label masks at overview and viewpoint (1400 × 788) have zero changed
pixels against 7ca785b. Geometry, scatter, coast, wave solver and bake are unchanged;
the bake check passes. Local photo references remain unavailable, so the outline check
is a regression check without a new photo-match claim. The local standalone was rebuilt
with 55 modules and its inline scripts compile as classic scripts. With networking
blocked, it loaded in 23.0 s, generated its terrain/texture fallbacks and rendered four
scroll stops with zero console errors. The online preview is the scan-material target.

Twelve alternating paired rounds of eight frames against 7ca785b pass eight heroes.
Beach was marginally over the gate at +10.14%; the required focused repeat (16 rounds)
measured −0.28%, with its middle half −9.5% to +6.4%. Both records are retained rather
than discarding the first. Final paired medians are −6.9% to +4.7% across all nine views.
No new performance exception is needed; the original v25-to-v26 close water-level cost
exception remains. The material is an authored approximation, judged from the matched
cameras and approach, without a claim of perfect photographic realism.


## v29: Lower cliff texture and sand contact (2026-09-30, 21:15 report)

Sam reports a residual odd lower-wall shape in the opposite cove and an unclean sand
contact beside the last stairs. Five fixed cameras, with textured and plant-free clay
pairs, reproduce the reported directions and adjacent contacts. Terrain ray readbacks
identify an exposed original-grid ramp between shortened carved windows; its normals
and material inputs differ from the strip behind it. Different column start heights
also leave the isolated ochre fin beside a blue vertical gap. The stair-side edge comes
from the ground staying recessed where the strip's carving fades out.

The local cove corner now continues from a shared 23 m bedding level into a rounded
lower recess. The beach floor closes the foreground ramp. At low beach strip ends,
the ground recession and culling fade with the face carving. A shallow bank follows
line segments on the final carved toe, rising at most 0.95 m over a three metre shoulder.
It clears the stair tread and leaves the packed wet sand unchanged. Existing adaptive
contact refinement supplies the curved shoulder; deposit masks use its final height.
Weathering now continues through the gully without stamping carving-attribute islands.

Several intermediate approaches were rejected. Extending the profile opened a gully
hole; widening the smoothing did not remove the underlying overlap. A broad material
mask painted sand up the wall. The final mask ends within 25 cm of the deposited bank,
and the ground's recess fade matches the strip. The first gully geometry pass also moved
buried vertices used to derive the coast map. The final correction is applied after the
existing smoothing and protects every sea-level crossing triangle. Coast, wave, shoreline
direction, breaker, rock-site, vegetation, trail and original field arrays now match
accepted v28 checkpoint `3f1978c` exactly, including non-finite values in breaker data.

### Verification

Five textured/clay pairs, two 73-frame moving-camera tracks at 24 fps, the earlier 28 m
closure camera, and all nine hero frames have zero console errors. Inspected approach
frames retain a seated contact without reopening the earlier terrain hole. The closure
ray still hits terrain 3.161 m away. Reproduction, comparisons, clips and ray evidence
are in `docs/gallery/v29/`, with `tools/cliff-contact-review.mjs` retaining the poses.
The sea stays at 17 s while those camera tracks review the geometry.

The mesh adds 17,476 triangles (+1.48%) and 8,814 vertices (+0.73%), for 1,197,848 triangles
and 1,214,235 vertices. The terrain bake is current at 13,561,329 bytes; round-trip errors
are at most 12.2 mm for positions and 1.9 mm for field heights, with exact indices and
water data. The overview land mask differs at one of 505,927 pixels (0.00020%); viewpoint
has no changed pixels. Reference photos remain unavailable, so this verifies regression
without a new photographic-match claim.

All nine paired median timing gates pass against `3f1978c`: 12 alternating rounds of
eight complete frames, −4.0% to +3.8%. There is no new performance exception; the earlier
v26 close water-level exception remains. The local standalone bundles 55 modules, its
inline scripts compile as classic scripts, and with networking blocked it loads in 20.1 s.
All four offline scroll stops (0.3, 1, 2.6, 4.6) render with zero console errors, using
generated texture fallbacks. The online preview is the scan-material review target.
ES-module parsing, bake freshness and whitespace checks pass. No downloads or reference
uploads. The lower geometry and column visibility remain approximations; the check covers
the specified cameras and approaches rather than a claim of perfect realism everywhere.


## v30: Final water texture and continuous wave polish (2026-09-30)

Sam approves the latest wave's motion and asks for one final texture and smoothness
pass. Matched beach and lower-stair cycles reproduce a thin blue stripe across the
shallow wash. Disabling ripple detail does not remove it; disabling the wash does.
The surface's neighbor slopes omitted the sheet, and its bed map carries a narrow
shoreline shoulder. The low-variance reflection path also mirrored below-horizon
facets into the sky, unlike the rough path.

The bore and sheet now join with a smooth maximum over 12 cm, adding at most 3 cm.
Neighbor samples use the same displaced surface, including the wash. A four metre
bed-normal filter and small unresolved ripple variance soften the coarse shoulder.
The low-variance reflection path applies the same horizon mask as the rough path.
Matched beach frames show the blue stripe replaced by a softer reflective wash.
A flat wash normal removed the line but looked artificial; a sea-level floor and
smoothstep height interpolation introduced unwanted edges or a trough. None remains.

Ripple and caustic coordinates now follow the simulation's accumulated transport.
Instantaneous speed times the absolute clock made them race when the wash slowed or
reversed. Two fixed-coordinate uprush/backwash fields blend during the turn, avoiding
a global stretch of the texture. The shared film thickness blends its laws as well;
its previous centimetre drop at reversal was a separate temporal discontinuity.
Foam detail fades to its mean before distance cutoffs. Crest feathering uses a soft
threshold and face foam filters by pixel footprint. Crest solve, lip shape, impact
timing and spectrum are unchanged; there are no added maps or texture allocations.

### Verification

Two 18-second matched cycles contain 433 frames each at 24 fps. The beach spans 1–19 s,
the lower stairs 13–31 s, with 73 close review frames from 13–31 s. Inspected sequences
preserve the translucent wave face, break and foam handoff. All cycles and nine heroes
have zero console errors. Quarter-second crest-column readbacks compare 933,976 finite
values against `fe00f69`, with zero changes and matching inactive values. Readbacks,
clips and visual comparisons are retained in `docs/gallery/v30/`.

A GPU audit of the actual shared GLSL samples the reversal at 0.5 ms intervals for
three bed heights, runup 1 m and turn time 3.2 s. Maximum adjacent film steps fall
from 10.04–11.00 mm to 0.0115–0.0348 mm. All data are finite, velocity behavior is
unchanged, and the final diagnostic compiles without errors.

Twelve alternating paired rounds of eight complete frames pass all nine incremental
hero limits against `fe00f69`: −2.5% to +7.6%. No new exception; the original v26
close water-level performance exception remains documented. Water-hidden land masks
at overview and viewpoint have zero changed pixels at 1400 × 788. Reference photos
remain unavailable, so this is an accepted-outline regression check.

The terrain bake is current. The local standalone bundles 55 modules and its inline
scripts compile as classic scripts. Its optional local asset base points to port 5183.
With networking blocked it loads in 20.7 s and renders four scroll stops (0.3, 1, 2.6,
4.6) with zero console errors, using generated texture fallbacks. The online preview
is the material target. ES-module syntax and whitespace checks pass. No asset downloads,
uploads or publication. The shore wash still has a broad reflective shoulder; water
and foam are authored approximations verified in the recorded views and cycles.


## v31: Beach camera and selectable time of day (2026-10-01)

Sam asks for a better view after the stairs and morning, noon, evening and night options.
The previous beach view continued looking down along the walking direction, and dragging
returned to that direction. The new composition keeps every pose through tau 4, eases
into a level 64° view across the cove, then settles toward the surf at 58°. Walking arrays,
positions, terrain, stair geometry and accepted v30 water are unchanged. Dragging on the
beach holds an absolute world heading until reset or returning onto the stairs. A reset
button, stage arrow keys/Escape and touch handling provide the same control; vertical
swipes continue scrolling without releasing the chosen heading.

Four native radio controls coordinate the existing physical atmosphere, source direction,
SH sky light, cloud lighting, terrain shadows, water reflections and exposure. Noon keeps
the accepted photo sun. Morning uses 08:00, evening 17:00 on the same reference date. Night
uses one authored moon direction and a dim blue source, a moon disk and filtered procedural
stars occluded by the clouds. Night is an authored moonlit view, not a lunar ephemeris.
A temporary canvas dissolves the previous frame over 850 ms; it is removed on navigation,
rapid selection or resize. Reduced motion switches immediately. Selection is stored in
the URL. Morning/night beach text uses cream; noon/evening use dark ink on the bright sand.

The first path edit reused an existing variable name; standalone compilation caught it
and the beach sample was renamed. Initial evening light/text was too harsh, so evening
was moved to 17:00 and its sand chapter uses dark text. Mobile review led to retaining the
route beat on rotation, rather than retaining its pixel scroll offset. The test then
waited for native swipe momentum to end before comparing rotation positions: measuring
mid-fling had mistaken continuing scroll for a resize error.

### Verification

Eight matched approach stills and a 377-frame clip at 24 fps cover the final stairs,
widening panorama and water approach. The inspected sequence lifts and turns continuously.
All nine noon hero frames, four lighting reviews, moon view and phone screenshot have no
console errors. Desktop input verifies drag/scroll holding a world heading, reset, return
to stairs and eight rapid lighting choices (maximum one dissolve canvas). At 390 × 844,
controls retain 44 px targets without overflow. URL night restoration, native radio arrow
keys, reduced-motion reset, vertical touch scroll with the heading held and portrait /
landscape route position and selection retention pass.

A 1,001-sample path comparison against `8310f05` reports zero differences in stair poses
and camera positions. Sampled ground clearance is at least 1.498 m. Nine rays at each
reviewed beach pose have no terrain hit closer than 0.6 m; nearest is 3.103 m. These checks
cover the specified route and cameras, not arbitrary free camera travel.

Twelve alternating paired rounds of eight complete frames pass all nine incremental
hero limits: −0.4% to +5.1% against `8310f05`. No new exception; the original v26 close
water-level exception remains. Water-hidden land labels at overview and viewpoint have
zero changed pixels. Reference photos remain unavailable, so this is an accepted-outline
regression check. Raw timing, outline, input and clearance readbacks accompany the gallery.

The terrain bake is current. Six changed ES modules parse; the local standalone contains
56 modules and its inline scripts compile as classic scripts. With networking blocked,
the standalone loads in 20.4 s, renders four scroll stops and switches to night without
console errors, using generated terrain and texture fallbacks. The online preview is the
scan-material target. No downloads, uploads or publication. The moonlit treatment and
clouds remain authored approximations; the controlled switch dissolves between settings
rather than simulating hours of changing daylight.


## v32: Clean foliage edges and pixelation (2026-10-01)

Sam reports pixelated plants along the ridge and switchbacks, most obvious in evening light
at 94, 88 and 61 m. The main renderer already has multisampling. Matched diagnostic views
showed that whole-pixel random discard in near plant and impostor LOD transitions, also
used when the camera approaches a crown, was breaking blades into dots and punching noise
into nearby leaves. Turning that discard off restored continuous blades; changing render
scale does not remove that screen-space discard.

Both representations now send their coverage weight to MSAA instead of deleting random
pixels. A gentle square-root coverage bias limits thinning where the two representations
do not overlap exactly. The near picker excludes empty intervals created by the lens fade.
The full-coverage shaders, plant geometry, species distribution, texture assets, camera,
lighting controls and accepted water are unchanged. The existing adaptive pixel ratio
policy is preserved. Camera-proximity clearance remains and plants still dissolve before
filling the lens.

The first diagnostic script treated the pose's north coordinate as altitude; correcting
it to the third coordinate reproduced the screenshots. A linear coverage trial made
handover crowns too faint, so a biased coverage trial was selected after comparing grass
and leaf silhouettes. The first full timing run put stairs just over the limit (+10.4%)
with a broad noise range. A targeted 24-round, 12-frame recheck measured +4.6%, with its
middle half +0.2% to +9.5%; the first result is retained alongside the recheck. An initial
standalone command supplied the wrong local flag and reached the existing stale-CDN guard.
The corrected local build uses the active localhost assets and does not publish anything.

### Verification

All nine noon hero renders have zero console errors. The three matched evening views were
rendered at 0.75×, 1× and 2×. Readbacks confirm four MSAA samples and a 3174 × 2000 buffer
for a 1587 × 1000 CSS canvas at 2×. A resize to 1024 × 640 retains a 2048 × 1280 buffer and
the correct camera aspect. Morning, noon, evening and night selection/readback agree and
render without errors. No foliage material retains the random screen-pixel discard and
no near fading instance has an empty interval.

A 144-frame, 24 fps recording reviews two moving approaches through the reported views,
with animated wind; 72 further frames check the same approaches at Retina resolution.
Inspected sequences retain continuous leaf edges and grass blades. Same-camera 1× and 2×
measurements confirm actual target scaling; they include cold-target overhead and are
not the paired performance gate.

Twelve alternating paired rounds of eight complete frames compare every hero with accepted
`5cd561d`. Using the targeted stairs recheck, all incremental limits pass (−2.8% to +4.6%).
No new exception; the historical v26 close-water-level exception remains. Water-hidden
land labels have zero changed pixels at overview and viewpoint. Reference photos are still
unavailable, so this verifies the accepted outline rather than a new photographic match.

The terrain bake is current. Three changed ES modules parse as modules; whitespace checks
pass. The local standalone contains 56 modules, its inline scripts compile as classic
scripts, and its offline load takes 21.0 s. It renders four scroll stops and the night
option without console errors, using generated terrain and texture fallbacks. The online
preview remains the material target. No new asset files, uploads or publication.

The fade is still an authored LOD approximation with four-sample coverage on the checked
renderer. Very thin blades soften at reduced resolution; distant cards still use discrete
baked directions. This pass removes the conspicuous stochastic pixel breakup without
adding temporal post-processing or changing the accepted scene.


## v33: Correct the artificial cliff shadow line (2026-10-01)

Sam reported a long thin dark line across the rock behind the final stairs, in evening
light at beach level. Reproduced from local position (124.091, 189.952, 4.209), looking
130° at a 3° pitch and 64° field of view. The line crossed both sides of the stair bank.

### Diagnosis and correction

The initial depth-prepass hypothesis was wrong. Independent material clones showed that
hiding the prepass, enabling invariant position output, or disabling bounce lighting did
not remove it. Disabling direct terrain shadowing did. Isolating the factors narrowed it
to `tFineShadow`: ground/overhang shadows and canopy shadowing rendered a continuous wall,
while fine ledge shadows alone reproduced the line.

The strata table's shadow margin is in unscaled relief metres. The lookup's sun-steepness
parameter already includes local relief strength, but the returned margin was compared
against world-space bias and softness without applying that strength. A readback on the
line gave roughly 0.08 m of table margin and 0.114 local strength: the actual margin was
about 9 mm, below the existing 10 mm lit bias, instead of a fully dark ledge.

One functional expression changes in terrain-shader.js: `margin * m` restores world-space
units before the shadow comparison. A separate opacity-fade trial was unnecessary and
was not retained. The correction applies throughout the terrain material. The original
depth pass, textures, mesh, coast, plants, trail, sand contact, camera, lights and water
are unchanged.

### Verification

Matched before/after stills show the line removed. Three beach headings (50°, 90°, 130°)
in morning, noon, evening and night have no reported line in the inspected views and zero
console errors. A 2× Retina render is 3200 × 2000 for 1600 × 1000 CSS pixels, with four
MSAA samples. A 72-frame / 24 fps sweep moves four metres and turns from 110° to 148°;
inspected frames keep the wall continuous without the seam reappearing.

Nine noon hero renders have zero console errors. Twelve alternating paired timing rounds
of eight completed frames against accepted `6cf2940` pass every incremental hero limit
(−12.8% to +3.1%). The apparent speed variation is background timing noise, not a claimed
optimization. No new exception; the historical v26 close-water exception remains.
Overview and viewpoint land labels with water hidden have zero changed pixels.
Reference photos remain unavailable; this compares the accepted scene outline.

The terrain bake is current. The modified ES module parses and whitespace checks pass.
The local standalone rebuild contains 56 modules and its inline scripts parse as classic
scripts. With networking disabled it loads in 21.3 s, generates terrain and texture
fallbacks, and renders four scroll stops (0.3, 1, 2.6, 4.6) without console errors.
The online preview remains the texture target. No assets, downloads, uploads or publication.

The fine ledge shadows still use the existing precomputed relief approximation. This fix
corrects its units; it does not claim a full ray-traced rock surface. Gallery and raw
readbacks are in docs/gallery/v33; the local sweep is captures/v33/cliff-sweep.mp4.


## v34: Remove remaining foliage coverage patterns (2026-10-01)

Sam still saw pixelation after v32, especially in close plants during evening descent.
Matched the three supplied views by camera height: 27 m at tau 3.690, 63 m at tau 2.823,
and 95 m at tau 2.076. The first showed a fine transparent grid in the naupaka and dotted
thin grass. All had a valid drawing buffer and four MSAA samples.

### Diagnosis and correction

Removing impostors left the pattern intact; forcing full near-plant coverage removed it.
The remaining problem was the uniform MSAA opacity fade, not a missing source texture.
With only four samples, overlapping leaves used correlated partial sample masks, so the
crown stayed patterned and translucent rather than accumulating solid leaf coverage.
A regular transparent-blending trial dulled the foliage and was not retained.

Near foliage now assigns a stable value to each leaf or blade from its existing seed and
plant position. The same LOD/lens intervals select groups of complete leaves instead of
attenuating every pixel. A narrow boundary reveals/retracts a leaf along its length;
its interior remains opaque, and MSAA smooths the silhouette. The selection follows the
plant through wind and camera motion without a screen-space mask. Full solid instances
retain their efficient no-discard shaders.

The lighter grass level was three crossed painted cards. It now retains a quarter of
the same curved blades, 2.8× wider, with two segments instead of four, plus seed stalks.
Both levels consume the same random sequence so corresponding blades share their phase.
This removes reliance on a tuft-wide alpha mask at medium distance without drawing full
near-detail geometry everywhere. The scatter, original high-detail plants, texture assets,
terrain, water, camera, lighting and automatic resolution policy are unchanged.

### Verification

Matched stills cover all three views at 0.85×, 1× and 2×; four lighting settings are also
inspected. At 2× the 1587 × 1000 CSS viewport has a 3174 × 2000 buffer. An independent
DPR=2 resize produces 2048 × 1280 for 1024 × 640 CSS pixels. The camera approaches have
animated wind: 216 frames at 1× and 144 at 2×, at 24 fps. Inspected frames show solid
leaf interiors and curved grass through the transitions, with zero console errors.

All nine noon heroes render without errors. Twelve alternating paired timing rounds of
eight completed frames against accepted `af278c3` pass all incremental hero limits
(−9.5% to +6.6%). No new performance exception. Overview and viewpoint land labels with
water hidden have zero changed pixels; unavailable reference photos were not downloaded.
The bake is current, the modified ES modules parse, and the local standalone rebuild
contains 56 modules whose inline scripts compile as classic scripts. With networking
blocked it loads in 20.8 s, generates terrain and texture fallbacks, and renders four
scroll stops without console errors. The online preview remains the texture target.

Actual leaf edges still have finite sample coverage. Blades narrower than a pixel can
soften at reduced resolution; distant impostors retain discrete baked directions and their
existing coverage treatment. This fixes the reported near-foliage breakup without claiming
infinite detail or adding a temporal post-processing pass. Own-render evidence is in
`docs/gallery/v34`; raw PNG buffers and clips remain local in `captures/v34/`.
