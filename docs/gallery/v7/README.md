# v7

Hero frames, rendered with `node tools/hero.mjs v7`. The sea is frozen at 17 s.

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
the change column means anything: it is against v6, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 9.9 ms | 101 | -34% |
| Clifftop viewpoint | 8.4 ms | 119 | +8% |
| On the stairs | 9.7 ms | 103 | +0% |
| Top of the trail | 7.8 ms | 128 | -5% |
| Low on the trail | 8.3 ms | 120 | -2% |
| On the sand | 7.0 ms | 143 | -17% |
| At the water's edge | 8.6 ms | 116 | +0% |
| Shore break, eye level | 8.6 ms | 116 | +7% |
| Head from the sea | 8.8 ms | 114 | -2% |
