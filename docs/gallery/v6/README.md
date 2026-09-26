# v6

Hero frames, rendered with `node tools/hero.mjs v6`. The sea is frozen at 17 s.

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
the change column means anything: it is against v5, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 13.9 ms | 72 | -5% |
| Clifftop viewpoint | 10.6 ms | 94 | +56% (over budget) |
| On the stairs | 8.5 ms | 118 | +8% |
| Top of the trail | 7.3 ms | 137 | +26% (over budget) |
| Low on the trail | 6.6 ms | 152 | -20% |
| On the sand | 8.7 ms | 115 | -16% |
| At the water's edge | 9.7 ms | 103 | +0% |
| Shore break, eye level | 7.1 ms | 141 | -16% |
| Head from the sea | 8.9 ms | 112 | +6% |
