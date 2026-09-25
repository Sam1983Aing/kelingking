# v3

Hero frames, rendered with `node tools/hero.mjs v3`. The sea is frozen at 17 s.

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

### Shore break, eye level

![Shore break, eye level](shoreBreak.jpg)

### Head from the sea

![Head from the sea](sideFromSea.jpg)

## Frame times

Time to render one frame to completion at 1400 px wide, pixel ratio 1, best of three rounds, on
the build machine (Apple M1 Max). Absolute times depend on what else is using the GPU, so only
the change column means anything: it is against v2, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 16.7 ms | 60 | -6% |
| Clifftop viewpoint | 8.4 ms | 119 | -25% |
| On the stairs | 12.5 ms | 80 | +16% (over budget) |
| Top of the trail | 7.5 ms | 133 | +10% (over budget) |
| Low on the trail | 10.5 ms | 95 | +19% (over budget) |
| On the sand | 7.9 ms | 127 | +16% (over budget) |
| Shore break, eye level | 10.6 ms | 94 | -12% |
| Head from the sea | 10.0 ms | 100 | +6% |
