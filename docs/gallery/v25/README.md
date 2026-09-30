# v25

Hero frames, rendered with `node tools/hero.mjs v25`. The sea is frozen at 17 s.

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

## Cliff contact comparisons

Previous version on the left; current version on the right. Identical fixed cameras at 1600 × 1060, 54° vertical FOV, sea frozen at 17 s.

### Opposite end of the cove

![Opposite contact before and after](compare-opposite.jpg)

### From the last stairs

![Cove contact before and after](compare-cove.jpg)

### Looking back up the stairs

![Landing before and after](compare-stairs.jpg)

### Sand close-up

![Dry sand](contact-sand.jpg)

## Shape inspection

Plant-free clay checks separate geometry from the rock and sand material.

![Cove shape](clay-cove.jpg)

![Opposite contact shape](clay-opposite.jpg)

![Last stairs shape](clay-stairs.jpg)

## Lower descent audit

21 poses, each rendered textured and with plant-free clay: tau 3.665 and 3.85 at −35°, 0°, +35° head turns; tau 4.0, 4.15 and 4.3 at −90°, −45°, 0°, +45°, +90°. Rows follow that order, left to right. Unused cells in the last sheets are black. The ocean wedge is refreshed after every scripted head turn. No console errors.

![Textured audit, first twelve poses](audit-textured-1.jpg)

![Textured audit, remaining nine poses](audit-textured-2.jpg)

![Clay audit, first twelve poses](audit-clay-1.jpg)

![Clay audit, remaining nine poses](audit-clay-2.jpg)

[Pose and near-bank ray measurements](audit.json). The previously reported opening still hits nearby supporting terrain at 2.89–3.51 m.

## Motion

5.3 s scrolling check from screens 14.85 to 16.70, including a 60° left turn toward the cove. Stills below are at one-second intervals; the last tile is unused. Local clip: captures/v25-contact-motion.mp4.

![Motion stills](motion.jpg)

## Geometry and build

[Raw geometry comparison](geometry.json): 1,180,372 triangles (+0.45%), 1,205,421 vertices. Shallow dry-sand relief changes the heightfield by at most 16.7 cm. Horizontal route coordinates, length and width are identical; route elevations settle by at most 27.4 mm. Above 100 m, packed grid positions differ by at most 7.6 mm. Stored overview and viewpoint renders retain the headland outline; local reference photos are unavailable, so this is a regression check. The five visitor walking lines remain unchanged.

Current bake: 13,450,447 bytes. The local standalone is rebuilt and scripts parse. Offline validation is recorded in the version brief.

## Paired frame times

Against v24 checkpoint 5fa4370. Twelve alternating rounds of eight complete frames at 1400 px wide, pixel ratio 1. The median ratio is taken per alternating round; it need not equal the ratio of the two separately listed median times. All nine cameras pass the 10% limit. Absolute times vary with background GPU load.

| Camera | v24 ms | v25 ms | Paired median change | Middle half |
|---|---:|---:|---:|---:|
| Overview, straight down | 14.01 | 14.01 | -1.1% | -3.6% to +5.9% |
| Clifftop viewpoint | 9.65 | 10.61 | +3.5% | -0.4% to +10.7% |
| On the stairs | 15.91 | 17.43 | +3.2% | +2.9% to +28.4% |
| Top of the trail | 9.72 | 8.56 | -6.5% | -12.0% to -2.1% |
| Low on the trail | 15.35 | 16.31 | +7.9% | -10.2% to +13.1% |
| On the sand | 11.98 | 12.50 | +7.0% | +1.5% to +18.9% |
| At the water’s edge | 19.02 | 17.68 | -4.5% | -6.9% to +3.1% |
| Shore break, eye level | 7.01 | 7.26 | +5.0% | -4.2% to +13.9% |
| Head from the sea | 11.66 | 11.89 | -7.3% | -10.0% to +8.4% |

[Raw paired timings](bench.json).
