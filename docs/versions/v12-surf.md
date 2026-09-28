# v12: the breaking wave, and the clouds

**Goal.** From Sam, after v11: the waves and the water feel weak, and when a wave breaks it
does not feel smooth and natural. Later the same night, with a screenshot from the sand: the
clouds feel weird too. He said not to use the `3d-ultra-realistic-water` skill (it is a deep
open ocean at sunset, with no shallows, no surf and no shore), and to fix the break itself.

Judge the break in motion, not in stills: clips of `shoreBreak` (eye level in the surf) and
`swash` (on the sand, the break by the rock), frame by frame, before and after each change.
Judge the clouds against the sky in the drone and beach photos.

## The break, as it was at v11

From `capture.mjs shoreBreak swash --clip=10 --t=12`, read frame by frame:

1. **It pops.** The wave is already standing tall a second before it breaks, but shaded the
   same pale cyan as the flat water in front, so it does not read as a wave (with a vertical
   seam between two shadings across it). Half a second later the breaker mesh takes over with
   another look altogether: bright chrome glints like crumpled foil. The eye reads the change
   of look as the wave appearing.
2. **The white water is cut out.** Hard-edged white blobs with flat grey insides under the
   lip, then a grey comb of vertical streaks as it collapses, then a white slab.
3. **No impact.** The lip lands and the white water just spreads; there is no burst of spray
   and white water where it hits.
4. **Snow on the face.** Near the camera the spray draws every puff with a grid of hard specks
   inside it, which covers the face in even white dots.
5. **Cracks.** Within a second of the collapse the white water turns into a web of polygon
   cells, then leaves white slashes floating on the sea.
6. **Small and tidy from the sand.** A thin curl peeling by the rock, where the photo has a
   tall dumping wave exploding white against it and the inner surf churned white.

## The clouds, as they were at v11

From Sam's screenshot at the sand stop (the standalone file in Chrome):

1. Round blobs and pill shapes floating alone. Small cumulus are flat underneath and wider
   than tall.
2. No flat grey bases: every cloud evenly white. Midday trade cumulus have bright tops and
   flat, darker bases at one height.
3. Edges like cotton wool all round.
4. A small glitch smudge in the middle of the sky.

## Budget

As every version: no hero frame more than 10% slower than v11 side by side (`ab.mjs --hero`).
