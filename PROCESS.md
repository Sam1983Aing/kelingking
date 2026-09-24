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
