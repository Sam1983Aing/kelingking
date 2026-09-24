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

(nothing yet)
