# v14

Hero frames, rendered with `node tools/hero.mjs v14`. The sea is frozen at 17 s.

### Overview, straight down

![Overview, straight down](overview.jpg)

### Clifftop viewpoint

![Clifftop viewpoint](viewpoint.jpg)

### On the stairs

![On the stairs](stairs.jpg)

### Top of the trail

![Top of the trail](trailTop.jpg)

### Low on the trail

![Low on the trail](trailLow.jpg)

### On the sand

![On the sand](beach.jpg)

### At the water's edge

![At the water's edge](swash.jpg)

### Shore break, eye level

![Shore break, eye level](shoreBreak.jpg)

### Head from the sea

![Head from the sea](sideFromSea.jpg)

## Frame times

Time to render one frame to completion at 1400 px wide, pixel ratio 1, best of three rounds, on
the build machine (Apple M1 Max). Absolute times depend on what else is using the GPU, so only
the change column means anything: it is against v13, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 12.4 ms | 81 | -1% |
| Clifftop viewpoint | 8.1 ms | 123 | +3% |
| On the stairs | 9.5 ms | 105 | -14% |
| Top of the trail | 5.7 ms | 175 | -34% |
| Low on the trail | 9.0 ms | 111 | +1% |
| On the sand | 10.5 ms | 95 | +30% (over budget) |
| At the water's edge | 11.4 ms | 88 | -3% |
| Shore break, eye level | 10.1 ms | 99 | +16% (over budget) |
| Head from the sea | 9.5 ms | 105 | +7% |

The beach and shore-break flags above come from separate timed runs with unstable GPU
load. In the alternating side-by-side v13 comparison, beach was -3% and shoreBreak +1%;
viewpoint was +8% and sideFromSea +6%. See `PROCESS.md` for the method.
