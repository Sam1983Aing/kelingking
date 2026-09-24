# Kelingking, in three.js

A real place rebuilt in the browser: Kelingking Beach on Nusa Penida, the T-Rex headland.
The plan is a scroll piece that starts with the whole bay from the air, walks down the
trail on the ridge, and ends standing on the sand with the waves coming in.

It is built in stages, each one checked against real photos before moving on.

| Stage | What | Status |
|---|---|---|
| 1 | Terrain shape in grey clay, plus the photo-matching tools | done |
| 2 | Water: depth colour, shore foam, breaking waves, sun glitter | done |
| 3 | Surfaces: limestone cliffs, vegetation, sand | next |
| 4 | Light, atmosphere and colour grade | |
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
- **Performance**: 50 to 68 fps on this Mac with a resolution governor that lowers the pixel
  ratio when frames run long.

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
node tools/preview-height.mjs 1024             # top-down shaded map with contours
```

Outline mode is the one that does the work: red is where the render's land meets water or
sky, yellow is where one landform passes in front of another. See `PROCESS.md` for what it
caught.

## Credits

- Map data (C) OpenStreetMap contributors, available under the Open Database License.
  `data/osm.json` and `src/terrain/geo.js` are derived from it and stay under the ODbL.
- Reference photos are not included in this repo. `references/refs.json` and
  `references/REFERENCES.md` list every source with its author and licence (Unsplash and
  Wikimedia Commons), and `node references/fetch-refs.mjs --get` downloads them locally.
- three.js and lil-gui load from jsDelivr.
