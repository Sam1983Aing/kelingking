# v12

Hero frames, rendered with `node tools/hero.mjs v12`. The sea is frozen at 17 s.

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
the change column means anything: it is against v11, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 12.0 ms | 83 | -2% |
| Clifftop viewpoint | 7.7 ms | 130 | +4% |
| On the stairs | 8.4 ms | 119 | +1% |
| Top of the trail | 5.9 ms | 169 | +0% |
| Low on the trail | 8.1 ms | 123 | +1% |
| On the sand | 7.8 ms | 128 | -18% |
| At the water's edge | 12.0 ms | 83 | +26% (over budget) |
| Shore break, eye level | 9.7 ms | 103 | -1% |
| Head from the sea | 7.4 ms | 135 | -27% |
