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

## v5: sand and the waterline (2026-09-25, in progress)

Not finished yet. Where it stands, so the next session can pick it up.

### Done

- **Beach shape.** The foot of the wall behind the beach is traced from the registered drone
  photo (`beach.back` in `layout.js`), and the walls come down to it steep at the base. The
  sand ramp at the south end is gone, the south end is low (`btop` zones) so the swash reaches
  the rock, and the beach has a steep face up to a berm. Outline checks on `viewpoint` and
  `overview` still pass.
- **Cameras.** `beach` was refitted from the people in its photo (the man at the water's edge
  is about 14 m off and 3.5 m below the eye). New shot `swash` at the water's edge for
  `beach-white-sand-surf.jpg`.
- **Sand.** About 0.5 reflectance and pinker (coral sand), measured within 0.01 stops of the
  viewpoint photo. Close range from two CC0 scans (`sand_02`, `damp_beach_sand`, Sam approved
  the download). Maroon band, grit and dust along the wall foot.
- **Swash.** `src/water/swash.js`: each wave sends a sheet up the sand that slows, stops and
  drains back, with lobes and a foamy front. Worked out once per frame into a map
  (`swash-map.js`). The sea draws the sheet as a thin film over the ground's wet sand, the
  sand is soaked, glossy just after, then damp, and the foam simulation moves with it.
- **Tools.** `tools/parts.mjs` times parts of a frame in one page. Water debug view 10
  (sheet, foam amount, film thickness).

### Things that cost time

- Working the swash out per vertex in the ground cost 1.2 ms at `beach`, even though only a
  few vertices are on the wet sand: the ground's vertex shader runs for every vertex of the
  island. A map made once per frame fixed it.
- A GLSL ternary choosing between two structs hung Chrome's GPU process (the page never became
  ready). Plain if/else works.
- The sea's shaders sit at 16 texture units. The sea's vertex shader now takes three
  displacement cascades as their own uniform (`uOceanV`): three.js allocates units by the
  length of the JavaScript array, not the shader's.
- `ab.mjs` picks the second newest gallery folder as the previous version, so before
  `docs/gallery/v5` exists it times against v3. Pass `--a=v4`.
- Face strips reaching out over flat sand folded where the lines across a concave wall cross
  (dark specks in `trailLow`). They now stop before crossing and only a few metres past the foot.

### Open

- The white carpet in the uprush at `swash` is not the sheet: debug view 10 shows it is the
  sea's own surf surface lying over the lower beach, fully foamed by the simulation. The surf's
  height and foam on the beach face should hand over to the sheet sooner.
- Frame times against v4 (`ab.mjs --hero --a=v4`): all within 10% except `beach` +16%, whose
  camera moved and now sees mostly close sand.
- Not done: hero frames and gallery, the final swash clip, `swash` in `HERO` (hero.mjs and
  ab.mjs need to skip shots the previous version lacks), README and status table.
