# v10: polish pass

**Goal.** Sam approved v9 after using the page, and asked for a verification and polish pass
over everything built in v1 to v9, self-checked until nothing reads as wrong. His notes on the
v9 page (2026-09-27, with screenshots of the viewpoint, the ridge, the switchbacks and the
beach):

1. **The horizon.** A black line between the sea and the sky, seen from anywhere high up.
2. **The clouds** could be more realistic (soft cotton blobs; ragged, blocky edges on the far
   ones at the horizon).
3. **The foot of the cliff at the beach** lacks polish: the rock texture up close, where the
   rock meets the sand, the cave under the overhang. Looking around from the sand shows it.
4. **The waves and the foam** still do not read as real. Mostly the foam: less intense.
5. **The steps** are very good but too perfect and linear: randomise them, the odd broken step,
   more rocks, weathered and beaten wood.
6. **The trees and plants on the head** (the top of the T-Rex) still look a little weird. The
   plants round the steps are great.
7. **The view going down the steps** should show the steps more: going down, the camera often
   looks at the horizon, so it does not feel like descending a stair.

Plus a pass of my own over the whole descent, looking for anything else that reads as fake or
broken.

## How to judge it

As v9: the landing page in motion (`scroll-clip.mjs`, stills with `--stills=`), the hero frames
against their photos, and Sam's own screenshots. The horizon: read the pixel rows across it
(it was one row of pure 0,0,0 in the `viewpoint` shot).

## Rules

The frame budget was spent at v9 (`stairs` +10% against v8). This pass should not make any
hero frame or path camera more than 10% slower than v9; anything that needs more comes with a
saving elsewhere, or goes into the v11 brief.

## Found by other versions

(none yet)
