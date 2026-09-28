# v13

Hero frames, rendered with `node tools/hero.mjs v13`. The sea is frozen at 17 s.

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
the change column means anything: it is against v12, timed in the same run.

| Frame | Time | fps | Change |
|---|---|---|---|
| Overview, straight down | 12.9 ms | 78 | +7% |
| Clifftop viewpoint | 10.0 ms | 100 | +33% (over budget) |
| On the stairs | 8.9 ms | 112 | +7% |
| Top of the trail | 9.6 ms | 104 | +71% (over budget) |
| Low on the trail | 10.2 ms | 98 | +29% (over budget) |
| On the sand | 8.2 ms | 122 | +6% |
| At the water's edge | 9.5 ms | 105 | +1% |
| Shore break, eye level | 8.2 ms | 122 | -4% |
| Head from the sea | 7.2 ms | 139 | -42% |

**Read these times with care.** The table above times v12 and v13 in separate pages minutes apart,
which on this Mac swings by 2x (it shows "Head from the sea", which v13 did not touch, at -42%).
Side by side in one browser (`node tools/ab.mjs --hero --a=v12`, 20 rounds) every frame is within
+8% of v12 except trailTop, which averaged about +7% over eight runs (the last read +11%):
overview +3%, viewpoint +8%, stairs +4%, trailTop +11%, trailLow +3%, beach +4%, swash +1%,
shoreBreak +0%, sideFromSea -0%. See PROCESS.md, v13.
