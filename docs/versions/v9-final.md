# v9: the final pass

**Goal.** Sam watched the whole descent (v8) and named what still reads as fake. This version
fixes those four things, in one session:

1. **The clouds.** "Especially the clouds: they don't really look real."
2. **The water close to the beach.** The open sea is fine, near and far. Where the foam is,
   close to the beach, it does not look realistic, and the breaking wave needs a careful
   review.
3. **The camera on the path.** It always faces one way, so on the legs of the switchbacks that
   run the other way it goes down backwards. It should look where it is going, and the
   visitor should be able to look around.
4. **The green on the rock.** The plants round the stairs look good. The trees and the green on
   the rock faces look fake.

This breaks the one-element rule on purpose (Sam's call, 2026-09-27): four parts, one
session. Speed and the shareable build moved to v10.

A suggested order: the camera first (it is small, it lives in `src/scroll/`, and it changes
which views of the water and the faces the scroll shows), then the clouds (Sam's first
complaint), then the water near the beach (the biggest), then the plants on the faces. Show
Sam each part before starting the next.

## How to judge it

The scroll is the product now, so judge in motion as well as in the hero frames:

- `node tools/scroll-clip.mjs --from=10 --to=13.5` records a stretch of the page (screens of
  scroll; about 3 s of video per screen), `--phone` for 390 x 844, no arguments for the whole
  page. Send Sam clips, not only stills.
- `http://localhost:5178/?at=2.5&notext` opens the page at a place on the way down (`tau`, 0
  over the bay to 5 at the water) without the words. `?debug` adds the panel and keys `1` to
  `6` for the stops. `__scroll.jumpTo(__scroll.pace.screensAt(2.5))` from the console.
- Hero frames with their photos: `node tools/capture.mjs eastCove shoreBreak swash beach cove
  surfTop sideFromSea viewpoint --compare` (local only, the photos are not ours).

## 1. The clouds

**Photos.** `references/04-beach/cove-from-east-cliff.jpg` (the same day and hour as the
viewpoint photo, the `eastCove` shot: one big cumulus over the cliff, its sunlit side bright
and billowing, its underside soft and shaded, and low flat cloud along the horizon).
`references/01-overview/aerial-side-from-sea.jpg` (a whole sky of broken cumulus with grey
bases). The skies in `references/02-viewpoint/*` and `references/04-beach/*`.

**What is wrong** (`eastCove` side by side, and every frame of the walk and the beach):

- Small round puffs, all about the same size, spread evenly and only low near the horizon.
  Nothing big, nothing near, no variety.
- Flat white. Almost no shaded base, no darker undersides, no bright rim where the sun is
  behind, no sense of volume.
- Hard edges, like cut-outs pasted on the sky. The photo's cumulus frays at its edges.
- No layer along the horizon, no thin high cloud.

**In scope.** The cloud field: sizes from scattered puffs to towering cumulus a few kilometres
across and up to 2 to 3 km high, clustered, with a bank of low cloud toward the horizon and
perhaps a thin high layer. Their light: shadowed from within, flat darker bases, bright
tops, the silver edge toward the sun, the darkened edges where light has entered but not yet
scattered out (the "powder" look). Soft eroded edges. The clear radius over the island (see
below). Their drift on the scene clock, visible over a minute of scroll.

**Found in the code.** `src/sky/clouds.js`: fair-weather cumulus marched at half resolution
and blended in by the sky dome, billow noise (64^3) kept where a weather map (1024 square)
puts clusters, `coverage`, `density`, `base` (0.7 km), `top`, `clearRadius` (4 km, "as on the
photo day"), `seed`, all settable with `?clouds.name=`. Cloud shadows on the island are off
while the clear radius keeps clouds away from it. The same atmosphere lights and hazes them.
The photo day did have a big cumulus close to the cliff, so the clear radius may be too
strict. The flight starts at 670 to 810 m (v8), which is at the cloud base: a cloud near the
island could put the opening in or just under a cloud. That could be a moment, or a problem.

## 2. The water close to the beach

**Photos.** `references/05-water/wave-breaking-closeup.jpg` (the `shoreBreak` shot),
`references/04-beach/beach-white-sand-surf.jpg` (`swash`), `beach-headland-waves.jpg`,
`references/05-water/topdown-foam-sand.jpg` (`surfTop`), `waves-from-cliff.jpg` (`cove`),
`aerial-shore-waves.jpg`, and `references/04-beach/cove-from-east-cliff.jpg` for a surf band
seen from above.

**What is wrong:**

- **From above** (the cliff, the switchbacks, `cove`, `surfTop`): the foam trails read as
  marbled white swirls, like paint stirred into the turquoise. Too white, too sharp-edged,
  too even in width. In the photos the surf is a broad band of churned white water at the
  break that thins into lace: a fine web with holes, fading into milky turquoise.
- **At eye level** (`shoreBreak`, `swash`, `beach`): the foam is flat white shapes with hard
  edges, like decals on the water. The breaking wave's face is a smooth turquoise tube with
  jagged white flame shapes painted on it. The whitewater after the break has no volume and
  no bubbles. The spray reads as separate white dots.
- The swash sheet is one even film; its leading edge and the foam it carries are where the
  eye goes.

**In scope.** The foam's look at every distance (texture, bubbles, thickness, soft edges,
the scale of the lace), the whitewater bore after the break (volume, churn, light through
it), the breaking wave's shape and face (a lip with thickness and light through it, sand
stirred into the face, foam streaking down it), spray as mist rather than dots, the swash's
leading edge. The open sea stays as it is.

**Found in the code.** `src/water/breaker.js` (the breaking wave's ribbon), `surf-sim.js` (the
foam simulation, 1024 square over the bay), `water-shader.js` (how foam and whitewater are
drawn on the sea), `spray.js`, `swash.js` and `swash-map.js`. The sea's shaders are at 16
texture units, the limit WebGL guarantees, so anything new has to share a texture. At eye
level the sea is bound by its vertices, not its pixels. More on what the sea costs in the
v10 brief (the notes from v4 and v5).

## 3. The camera on the path

**What Sam saw.** From the viewpoint to the sand the camera looks toward the head (south-west),
whichever way the path goes (v8 chose that because the path swings through every compass
direction on the switchbacks and the head stays within about 20 degrees of south-west). On
the ridge that is forward. On the legs of the switchbacks that run north and north-east it
is backwards: the camera moves away from what it sees, and you never see the path ahead going
down.

**Wanted.** Look where you walk: along the path and down the steps, turning with the
switchbacks. And, in Sam's words, "the camera should be able to move, you can see from every
side if you want": the visitor can look around. Ask Sam at the start whether that means the
view following the path, a way to look around yourself (drag with the mouse or a finger to
turn the head, easing back when let go), or both. Both is the likely answer.

**The hard part is comfort.** The hairpins turn 180 degrees in a bend of 1.2 to 1.5 m. A camera
that follows the path's heading exactly spins. Options: start turning before the bend and
finish after it, slow the scroll through the turns (the `PACE` knots, or pacing by how much
the view turns), cap the turn rate per screen of scroll, and look out over the view on the
straight legs where that is natural. Keep roll at zero and the horizon level.

**Found in the code.** `src/scroll/path.js`: `lookKeys()` (where the view is aimed, by metres
walked), the look-at logic, `PACE`, `HAIRPIN` (the walk line is smoothed across 2 m, so the
camera cuts inside each bend by up to a metre), `LIFT` and `STEPS_LIFT` (the eye is held a
metre higher on the switchbacks and down the concrete steps, over the verge: once the camera
looks along the path the verge is at the sides, so these may come down). `node
tools/descent.mjs` prints speed, turn and tilt rates per screen of scroll for every stretch,
and clearance: use it to hold the turn rates. `scroll.js` places the camera every frame
(`placeCamera`) and is where a drag-to-look would go.

## 4. The green on the rock

**Photos.** `references/01-overview/aerial-side-from-sea.jpg` (`sideFromSea`),
`references/02-viewpoint/*`, `references/04-beach/beach-white-sand-cliff.jpg` (a whole
stretch of wall green from the rim to near the sand), `beach-under-cliff.jpg`,
`references/01-overview/aerial-back-of-trex.jpg`.

**What is wrong** (`sideFromSea` side by side):

- The faces carry rounded patches of dark, dense canopy, like blobs of moss stuck on the rock.
  All the same dark green, with sharp edges.
- In the photos the green on the faces is lighter and yellower, sparser and finer: scrub in
  streaks along the ledges and down the gullies, with rock showing through, and a thicker,
  brighter band along the rims.
- From the beach, the hanging scrub on the wall reads as dark cotton-wool clumps.
- The plants round the stairs and along the path look good. Keep them.

**In scope.** What grows on the faces, ledges and rims: where (`scatter.js`: the patches on
the faces, the ledge runs, the rim spill), what (`grow/species.js`: the hanging scrub, and
perhaps a smaller, lighter face shrub or grass that clings to rock), colour, density, patch
shapes (streaks that follow the ledges and the gullies, not round blobs), and how they read
from afar (their impostors). The trees near the cliff edge that Sam called fake. Also: at the
first hairpin below `trailTop`, six hanging scrubs up to 5 m tall grow on the cut bank and hang
over the path (v8 found them when the camera walked into them). Keep what hangs off the path.

**Found in the code.** v7 grew every plant in code (no downloads; see its section in
`PROCESS.md`). Faces: a point on a face slides down the fall line to the nearest shelf of the
bedding table (`strata.js`); runs along a ledge; scrub spilling over the rim; patches down the
faces, longer down than across. v7's own list of what was still weak: "the patches of scrub on
the faces are rounder and denser than the photos' finer texture of scrub on the rock, from the
sea especially". The near-plant picker dissolves a plant whose crown the lens is inside
(`near.js`, `LENS`, v8).

## Not in scope

The rock itself, the sand, the light and the sky's colour, the plants round the path and on
the ridge top, the page layer (words, loader, frame), and speed beyond the budget (v10).

## Files

`src/sky/clouds.js`, `src/water/*` (the near-shore parts), `src/scroll/path.js` and
`src/scroll/scroll.js` (the camera and the input for looking around), `src/veg/scatter.js`,
`src/veg/grow/*`, `src/veg/near.js`, the `plants` settings in `src/terrain/layout.js`.

## Done when

- A new recording of the whole scroll, desktop and phone, reads to Sam as real in these four
  places: the sky, the water at the beach, the walk down the switchbacks, the faces.
- The hero frames' side by sides move toward the photos: `eastCove` for the sky, `shoreBreak`,
  `swash`, `beach`, `cove` and `surfTop` for the water, `sideFromSea` and `viewpoint` for the
  faces.
- The headland still passes the outline check on `viewpoint` and `overview`.
- Frame budget: no hero frame more than 10% slower than v8 (`ab.mjs --hero`), and none of the
  path's cameras either (`path-bench.mjs`, still and moving). If realism needs more, say so in
  PROCESS.md and add it to the v10 brief.

## Found by other versions

**From v8 (the scroll).**

- The scroll's tools: `tools/scroll-clip.mjs` (the page recorded frame by frame on its own
  clock, so it is smooth however slow the frames; `--from= --to=` for a stretch), `ffmpeg`'s
  scene score over a recording finds pops (`select='gte(scene,0)',metadata=print`), and
  `tools/path-bench.mjs` for frame times at 21 cameras down the path against the last tag.
- The scene is `src/app.js`, the tools are `src/debug.js` (on `?shot=`), the page is
  `src/scroll/`. The hero frames came out identical to v7's in v8.
- On the page the pixel ratio is picked while loading (13 ms a frame on the M1 Max), so a
  dearer scene shows up as a softer picture before it shows up as dropped frames. Check
  `window.__calibration` on the page.
