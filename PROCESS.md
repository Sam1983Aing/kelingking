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
