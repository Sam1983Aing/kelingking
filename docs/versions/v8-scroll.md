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
