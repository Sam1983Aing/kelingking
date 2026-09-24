# v2

Hero frames, rendered with `node tools/hero.mjs v2`. The sea is frozen at 17 s.

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
the change column means anything: it is against v1, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 15.2 ms | 66 | -3% |
| Clifftop viewpoint | 9.2 ms | 109 | -3% |
| On the stairs | 9.0 ms | 111 | -4% |
| Top of the trail | 5.7 ms | 175 | +0% |
| Low on the trail | 7.2 ms | 139 | +13% (over budget) |
| On the sand | 6.1 ms | 164 | +11% (over budget) |
| Shore break, eye level | 10.2 ms | 98 | +10% |
| Head from the sea | 8.5 ms | 118 | +16% (over budget) |

These times were taken with other apps busy on the machine. Across three runs each frame's
change against v1 moved by up to 8 points; averaged, every frame is within 10% (0 to +8%).
See v2 in `PROCESS.md`.
