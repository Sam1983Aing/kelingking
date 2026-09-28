# v11

Hero frames, rendered with `node tools/hero.mjs v11`. The sea is frozen at 17 s.

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
the change column means anything: it is against v10, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 15.0 ms | 67 | +29% (over budget) |
| Clifftop viewpoint | 10.2 ms | 98 | +16% (over budget) |
| On the stairs | 9.6 ms | 104 | +9% |
| Top of the trail | 10.3 ms | 97 | +84% (over budget) |
| Low on the trail | 12.2 ms | 82 | +5% |
| On the sand | 10.0 ms | 100 | -6% |
| At the water's edge | 9.5 ms | 105 | -45% |
| Shore break, eye level | 14.8 ms | 68 | +3% |
| Head from the sea | 11.3 ms | 88 | -3% |
