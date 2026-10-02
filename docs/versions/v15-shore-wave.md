# v15: continuous shore wave

**Goal.** Sam wants the wave at the bottom of Kelingking Beach to feel ultra-realistic:
one smooth crest that steepens, breaks, becomes a moving white-water bore, and washes up
and back down the sand. The opening of [this demo](https://x.com/hajimetwi3/status/2104381179151753464)
is a motion cue for the broad crest, reflective shallows and delicate foam edge, not an
exact scene or camera target. This version starts from the v14 head-shape branch.

## Judge it in motion

- Capture `shoreBreak` and `swash` clips from the same starting time before and after the
  pass. Inspect stages across the whole break, especially the lip landing, the handoff to
  the bore, and the water sheet reaching the sand. No popping mesh or sudden white slab.
- Compare still frames at `swash`, `shoreBreak`, `surfTop`, and `viewpoint` with the existing
  water and beach reference photos. The beach should keep its scale and location.
- Preserve the v14 viewpoint and overview headland outlines.
- No hero frame more than 10% slower than v14 in a paired run.

## Current weakness

At the sand camera a long, nearly uniform cyan tube forms across the cove. Its lip and
white water read as smooth geometric bands; foam is a solid white wedge instead of a
broken, advected edge. The shallow water has too little visual connection between the
breaking crest, the moving bore and the thin swash on the sand.

## Scope

Only the coastal wave, its foam/spray, and the thin sheet at the waterline in `src/water/`.
Keep the open-ocean spectrum, terrain, sky, cliff, path and plants as they are.

## Found by other versions

- The sharp tan patch on the sand in the `swash` camera survives a `--hide=water` render.
  It is logged in [v5-sand.md](v5-sand.md) for a later terrain or sand pass.
