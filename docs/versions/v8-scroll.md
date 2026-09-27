# v8: the scroll descent

**Goal.** The landing page itself. Scrolling takes you from high above the bay, down to the
clifftop, down the stairs and the path, onto the sand, and ends in front of the waves.

## Starting points

- The hero frames are the stops along the way: `overview`, `viewpoint`, `stairs`,
  `trailTop`, `trailLow`, `beach`, `shoreBreak`. The walkable camera line from v6 joins them.
- Sam's cinematic landing page conventions: weighted smooth scroll, GSAP ScrollTrigger, the
  animation vocabulary in his global CLAUDE.md. Load the `cinematic-landing-page` skill.
- Copy is part of the page: a few lines about the place, set in the editorial style Sam
  likes. Ask Sam for the words or propose them.

## In scope

- The camera path and its pacing: slow over the bay, a pause at the viewpoint, the descent,
  the landing on the sand. No motion sickness: limit turn rates, keep the horizon steady.
- The page layer: text, a loading screen that hides terrain generation, the end state.
- The debug panel and keys hidden unless `?debug` is in the URL.
- Phones and small screens.

## Not in scope

The look of anything in the scene. If a frame along the path looks wrong, log it in the
right version's brief.

## Files

New `src/scroll/`, `index.html`, styles, and splitting `src/main.js` into the app and the
debug tools.

## Done when

- The whole descent plays smoothly on scroll, forwards and back.
- A screen recording of it reads as a finished piece to Sam.
- Frame budget holds along the whole path, not just at the hero frames.

## Found by other versions

**From v2 (light).**

- Time of day is one number (`state.hour`, or `?hour=`), the sun follows the real date and
  place, and the white balance is held at the photo's noon light, so a golden-hour ending
  comes out golden. Clouds drift with the scene clock (6 m/s toward 290 degrees).
- One exposure for every shot (the photo's EV100). Standing under the overhang will read dark
  next to the open beach, as a camera would. If the descent needs the eye to adapt, add it in
  `src/post/grade.js`.
- Clouds are kept clear within about 4 km of the island (`clearRadius` in
  `src/sky/clouds.js`), as on the photo day. A camera above 0.7 km is inside the cloud layer's
  height; the march handles it, but there are no clouds that close.
- The atmosphere tables and the cloud pass run every frame in `renderFrame()` in `main.js`.
  Call that, not `renderer.render`, from the scroll loop.

**From v4 (water).**

- The sea moves with the scene clock (`simTime` in `main.js`, `?t=` freezes it). The wave
  spectrum (`src/water/ocean.js`), the foam simulation (`surf-sim.js`) and the breaker's
  column pass (`breaker.js`) only run when the clock moves, from `water.update()` in the
  animation loop. Keep calling it once a frame with the scene clock.
- A jump of the clock (backwards, or more than half a second forward) makes the foam
  simulation replay the last 30 s so the trails look as they would, which is 450 steps and a
  visible hitch (see the v9 notes for its cost). If the scroll scrubs time, let the clock run
  forward on its own instead and keep jumps for cuts.
- The foam simulation covers a 640 m square around the bay (`rect` in `surf-sim.js`), and
  the breaking wave only exists along the beaches. Every point on the planned descent is
  inside it. A camera path further out would need the square moved or grown.
- `shoreBreak` stands in the water now, 10 m from the break. The last frame of the scroll,
  standing on the sand, is `beach`.


**From v5 (sand).**

- The swash runs on the sea's clock (`src/water/swash.js`), worked out once per frame into a
  map over the beach (`swash-map.js`, only when the clock moves). The sand's wetness and gloss
  and the sea's sheet both read it, so they cannot disagree. The foam simulation works the
  swash out itself at its own steps, so a replay after a jump is consistent too.
- New hero frame `swash`: standing at the water's edge, looking at the break by the rock at
  the south end (`beach-white-sand-surf.jpg`). It could be the last beat of the scroll, or the
  one before `beach`.
- `beach` moved: it stands on the upper beach 2 m up, about 14 m from the water (it was 27 m
  from it, on a sand ramp that is gone). Its camera was refitted to its photo.

**From v6 (trail).**

- The walk line: `node tools/walk-line.mjs` writes `data/walk-line.json`, 565 points 0.5 m
  apart, from the viewpoint photo's spot on the platform (228, 236, 152), across the platform
  onto the concrete steps (27 m down them) and down to the sand at (127.6, 188.1). Each point
  has `s` (metres walked), `path` (metres along the path, as the shots' `s`), `pos` [east,
  north, height], `heading` (the way the path goes) and `grade`. The eye is 1.6 m over the
  treads with the single steps smoothed out, so it does not bob; add a bob on purpose if
  wanted. It is built by `walkLine()` in `src/trail/route.js` from the same route the page
  carves, so it follows any change to the path.
- The path is steep: grades up to 1.24 on the concrete steps and 1.25 at the bottom, and the
  hairpins are 1.2 to 1.5 m in radius, where the heading turns by up to 13 degrees between
  points. Ease the look direction, not just the position.
- `stairs`, `trailTop` and `trailLow` stand on the path now, 32, 147.5 and 244 m along it
  (their `s`). The descent does not pass `trailLow`'s photo position (it was taken from over
  the beach), so its frame was set by eye.
- `__app.contactSheet([{ s, side, eye, yaw, pitch, fov }, ...])` renders cameras on the path
  side by side, and `src/fit.js` fits one to a photo along it.

**From v7 (plants).**

- The plants near the camera are picked for where it stands every frame it moves
  (`src/veg/near.js`): about 1.2 ms of JavaScript at `trailLow` (16,000 plants checked, about
  1,000 drawn), plus writing their instance buffers. In a scroll the camera moves every frame,
  so this is paid every frame. If it shows, pick every other frame or only when the camera
  has moved half a metre (the hand-over bands are 2 to 7 m wide, so nothing pops).
- The plants hand over from real geometry to impostors by stippling across a band (naupaka
  5 m and 10 to 15 m, grass 6 m and 11 to 15 m, trees 22 to 32 m, palms 30 to 44 m). A
  moving camera sweeps the band across the slope, which reads as a soft dissolve. Worth a
  look in motion once the scroll exists; widen a band if it shimmers.
- The wind runs on the sea's clock (`uWindTime` is the page's `simTime`), so a frozen sea
  (`t=`) freezes the plants too.
- Beside the concrete steps the verge is low leafy scrub, on purpose (the stairs photos).
  The walk line passes right by it: the first metres of the descent have leaves in the lower
  corners of the frame.
