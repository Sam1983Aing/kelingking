# v5

Hero frames, rendered with `node tools/hero.mjs v5`. The sea is frozen at 17 s.

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
the change column means anything: it is against v4, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 17.1 ms | 58 | +4% |
| Clifftop viewpoint | 8.1 ms | 123 | -4% |
| On the stairs | 10.8 ms | 93 | -5% |
| Top of the trail | 6.8 ms | 147 | +0% |
| Low on the trail | 11.5 ms | 87 | +0% |
| On the sand | 7.6 ms | 132 | +13% (over budget) |
| At the water's edge | 10.6 ms | 94 | new in v5 |
| Shore break, eye level | 9.9 ms | 101 | -4% |
| Head from the sea | 7.5 ms | 133 | -4% |
