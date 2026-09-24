# Kelingking, in three.js

A real place rebuilt in the browser: Kelingking Beach on Nusa Penida, the T-Rex headland.
The plan is a scroll piece that starts with the whole bay from the air, walks down the
trail on the ridge, and ends standing on the sand with the waves coming in.

It is built in stages, each one checked against real photos before moving on.

| Stage | What | Status |
|---|---|---|
| 1 | Terrain shape in grey clay, plus the photo-matching tools | done |
| 2 | Water: depth colour, shore foam, breaking waves, sun glitter | done |
| 3 | Surfaces: limestone cliffs, vegetation, sand | done |
| 4 | Light, atmosphere and colour grade | next |
| 5 | Life: wave timing, foam drift, cloud shadows | |
| 6 | The scroll descent from the viewpoint to the beach | |

## Run it

```bash
python3 -m http.server 5178
```

Then open http://localhost:5178. It needs a local server (module workers do not run from
`file://`). A standalone single-file build comes later.

Keys: `1` to `8` switch shots, `O` photo overlay, `D` difference blend, `L` outline mode,
`F` free camera, `C` contour lines. The panel on the right tunes the camera and the terrain
live.

## How the terrain is made

Nothing is sculpted by hand in a 3D tool. The shape comes from map data plus a few numbers
tuned against photos.

1. **OpenStreetMap** gives the coastline, the cliff-top lines, the trail and spot heights
   (the head's summit is tagged at 111 m). `tools/extract-osm.mjs` turns `data/osm.json`
   into `src/terrain/geo.js` in local metres, origin on the summit.
2. **`src/terrain/layout.js`** holds the hand-tuned part: a spine running down the ridge
   with a height and width at each control point, a spur for the jaw, and zones that say
   how sheer the cliffs are and where the beaches are.
3. **`src/terrain/heightfield.js`** combines them in two passes. First a top surface
   (the island plateau blended into the ridge). Then the drop: on rock the cliff falls at
   the waterline, in beach zones it falls from the mapped cliff-top line and sand fills the
   gap. Signed distance fields (exact Euclidean transform) do the heavy lifting, and the
   transform also reports the nearest cliff-top pixel, so a beach wall takes its height from
   the edge above it.
4. It runs in a web worker at 1024 or 2048 texels over 1.6 km (0.78 m per texel), and the
   page builds a mesh plus a full-resolution normal map from it.

## How the cliffs and surfaces work

A plain grid cannot draw these cliffs: a 100 m face that is 7 m wide on the map gets a
handful of grid rows, crossed at an angle, and renders as stripes and teeth. So:

- **The generator hands out a function, not just a grid.** Everything smooth (distances to
  the coast and to the cliff tops, the top surface, the zone settings) is stored on the grid,
  and `heightAt(x, y)` applies the sharp steps at any point.
- **The mesh builder slides vertices onto the faces** (`src/terrain/mesh-builder.js`). Each
  vertex near a cliff moves along the slope direction, so that vertices end up evenly spaced
  over the ground instead of on the map. The flats give up vertices and the face gets them.
  Normals come from `heightAt` too, so the lighting is smooth even where the triangles are not.
- **A wave-cut notch** is carved into the foot of the rock, which makes the base overhang.

The look is all procedural (`src/terrain/terrain-shader.js`), patched into three.js's
standard material:

- **Limestone** in beds of uneven thickness, gently warped across the island, each with its
  own shade. Ledges come and go along the face. Vertical joints, crags, grey runoff streaks,
  lichen, ochre staining over the beach undercut, and the dark notch and algae line at the
  waterline.
- **Scrub** on everything short of a sheer face, and in clumps along the ledges of the faces.
  At field scale it varies between forest, scrub, grass and bare patches. Bushes, trees and
  leaves appear as you get closer.
- **Sand**, wet where the swash reaches, and smoother.
- Everything finer than a pixel is faded out by the pixel footprint, so it holds up from 1 km
  and at your feet without shimmering.

**Sun shadows are baked.** For each map column there is one height above which a point sees
the sun, which is exact for a heightfield, cliff faces included. It is baked on the GPU in one
pass whenever the sun moves (`src/terrain/sun-shadow.js`), and the ground and sea each read
it with a single texture lookup.

## How the water works

One mesh follows the camera: rings packed tight within 150 m and spread out to the horizon,
so it holds up both at your feet on the sand and from 1 km up. Everything else is in one
shader (`src/water/water-shader.js`), fed by a texture the terrain worker writes: seabed
height, distance offshore, how sandy the shore is, and how much sand hangs in the water.

- **Colour** comes from light travelling through water, not from a gradient. Red is absorbed
  within a few metres and blue lasts longest, so white sand under 2 m of water reads
  turquoise and 30 m reads navy. The view ray is refracted down to the seabed, and the
  seabed gets moving caustics where it is shallow and calm.
- **Milky plumes.** Sand stirred up in the surf and in the east bay is modelled as
  scattering. The light it sends back has already lost its red, so it glows turquoise
  instead of going brown.
- **Waves** are driven by distance from the shore. They bunch up in shallow water, grow,
  break at a set distance off the beach, and run up the sand as swash. Each wave has its own
  size and breaks in sections along the shore. On rock there is no wave train: the swell
  runs into the cliff and leaves a pulsing band of white water, wider on the coasts that
  face the swell.
- **Surface**: 14 wind wave trains as a slope field, a GGX sun glint whose roughness picks
  up the waves too small to draw, sky reflection, and the terrain's shadow on the water.
- **Performance**: see the note under Known limits.

## Matching photos

Each shot in `src/shots.js` is tied to a reference photo. The capture tool renders it
headlessly through Chrome's DevTools protocol, with nothing to install:

```bash
node tools/capture.mjs viewpoint --compare     # render and photo side by side
node tools/capture.mjs viewpoint --outline     # render edges traced over the photo
node tools/capture.mjs --overlay=0.5           # every shot, 50% blend
node tools/capture.mjs beach --t=17            # freeze the sea at 17 s
node tools/capture.mjs beach --clip=9          # 9 s clip to captures/beach.mp4 (needs ffmpeg)
node tools/capture.mjs shoreBreak --debug=5    # water debug views 1 to 5
node tools/capture.mjs --bench                 # render time per shot
node tools/capture.mjs beach --clay            # grey ground, to judge the shape alone
node tools/preview-height.mjs 1024             # top-down shaded map with contours
```

Outline mode is the one that does the work: red is where the render's land meets water or
sky, yellow is where one landform passes in front of another. See `PROCESS.md` for what it
caught.

## Known limits

- **Speed.** On an M1 Max at about 1 megapixel: the clifftop view runs at 45 fps and the
  beach and sea views at around 30, but the 1 km overview is under 20. The ground material
  and the sea both cost too much per pixel when they fill the screen. A resolution governor
  hides some of it. The fix (cheaper far-away shading, baked far-field colour) is planned
  once the scroll path says which views matter.
- **Cliff rims** still show a comb of small fins in some views, where rim triangles zigzag.
- **Season.** The scrub is wet-season green. Most trail photos are dry season.

## Credits

- Map data (C) OpenStreetMap contributors, available under the Open Database License.
  `data/osm.json` and `src/terrain/geo.js` are derived from it and stay under the ODbL.
- Reference photos are not included in this repo. `references/refs.json` and
  `references/REFERENCES.md` list every source with its author and licence (Unsplash and
  Wikimedia Commons), and `node references/fetch-refs.mjs --get` downloads them locally.
- Rock, sand and ground textures and the tree scans are from Poly Haven (polyhaven.com),
  CC0. `node tools/fetch-assets.mjs` downloads the originals (about 260 MB, not committed),
  `node tools/prepare-assets.mjs` makes the 10 MB of textures in `assets/textures/`, and
  `node tools/bake-impostors.mjs` bakes the trees into `assets/veg/`. See
  `assets/textures/CREDITS.md`.
- three.js and lil-gui load from jsDelivr.
