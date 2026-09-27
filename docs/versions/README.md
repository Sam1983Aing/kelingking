# Versions

v1 is the first complete iteration: the headland, the sea, scanned rock and sand, and scanned
trees. Everything after it is built one element at a time, one dedicated chat session per
version. A session works on its element only, and goes deep on it.

| Version | Element | Brief | Status |
|---|---|---|---|
| v1 | Shape, sea, surfaces, first scans and trees | [history](../gallery/history/README.md) | done, tag `v1` |
| v2 | Light and atmosphere | [v2-light.md](v2-light.md) | done, tag `v2` |
| v3 | Rock | [v3-rock.md](v3-rock.md) | done, tag `v3` |
| v4 | Water | [v4-water.md](v4-water.md) | done, tag `v4` |
| v5 | Sand and the waterline | [v5-sand.md](v5-sand.md) | done, tag `v5` |
| v6 | Trail and stairs | [v6-trail.md](v6-trail.md) | done, tag `v6` |
| v7 | Plants | [v7-plants.md](v7-plants.md) | done, tag `v7` |
| v8 | The scroll descent | [v8-scroll.md](v8-scroll.md) | done, tag `v8` |
| v9 | Speed and the shareable build | [v9-speed.md](v9-speed.md) | next |

Why this order: light first, because every colour decision after it is made under it. Then
the elements Sam cares most about (rock, water, sand). The trail before the plants, so the
plants can leave room for the path. The scroll once there is something worth scrolling
through. Speed last, once the look is settled, although no version may make it worse
(see the budget below).

## Starting a session

Open a new chat in this folder and paste:

> Read docs/versions/README.md and docs/versions/v9-speed.md, then start v9.

## Rules for every version

1. **One element.** Work only on what the brief covers. If you find a problem that belongs to
   another version, write it into that version's brief under "Found by other versions", do
   not fix it.
2. **Branch.** Start from `main` with `git switch -c v5-sand` (version and element). Commit at
   each checkpoint. Merge into `main` and tag `v5` only when Sam says the version is done.
3. **Judge against the photos, not by eye in the browser.** Use `tools/capture.mjs`
   (side by side, outline, clips). The browser pane stops rendering when it is hidden and its
   screenshots go stale. Read numbers back from the page when a picture is ambiguous.
4. **Frame budget.** No hero frame may get more than 10% slower than the previous version.
   `node tools/hero.mjs` checks it by timing the previous version (checked out from its tag)
   and yours back to back, because absolute times on this Mac swing with background GPU load.
   Close the page in the browser pane before timing. If a gain in realism really needs more,
   say so in PROCESS.md and add it to the v9 brief.
5. **Stay publishable.** Reference photos never go into git or anywhere public (they are
   gitignored). Only CC0 assets ship, each credited in a CREDITS.md next to it. Ask Sam before
   any download, with the source and the size.
6. **Show Sam as you go.** At each meaningful step send a side by side (and a short clip for
   anything that moves), so he can redirect early.
7. **Keep the shape.** Unless the brief says otherwise, the headland must still pass the
   outline check on `viewpoint` and `overview`
   (`node tools/capture.mjs viewpoint overview --outline`).

## Finishing a version

1. `node tools/hero.mjs v6`: renders the hero frames into `docs/gallery/v6/`, times them
   against the previous version, and puts side by sides with the photos in
   `captures/compare-v6/` (local only). Frame times swing a lot on this Mac, so also run
   `node tools/ab.mjs --hero` (both versions side by side in one browser) before judging
   the budget.
2. Add a section to `PROCESS.md`: what changed, what went wrong and how it was fixed, what
   is still weak. This log is the raw material for the public write-up.
3. Update the status table above, and the README if the way something works changed.
4. Commit. When Sam approves, merge into `main` and tag the version.

## Hero frames

The frames every version is judged on (`HERO` in `src/shots.js`), in the order the scroll
passes through them. Each is tied to a reference photo.

| Shot | What it checks |
|---|---|
| `overview` | The whole bay from about 1 km up: layout, sea colour bands, plateau texture |
| `viewpoint` | The postcard from the clifftop platform: the main colour and light target |
| `stairs` | On the concrete steps below the platform, looking over the ridge to the head (on the path from v6) |
| `trailTop` | On the ridge path, the head ahead (on the path from v6) |
| `trailLow` | Low on the zigzag, looking into the overhang behind the beach (on the path from v6, set by eye) |
| `beach` | Standing on the sand with the cliff wall above |
| `swash` | At the water's edge, the swash running up the sand (from v5) |
| `shoreBreak` | A wave breaking at eye level |
| `sideFromSea` | The head from the sea, the frame people share |

Other shots in `src/shots.js` (`surfTop`, `cove`) are extra targets for the water.

## Tools

```bash
python3 -m http.server 5178                          # the page, at http://localhost:5178
node tools/capture.mjs beach --compare               # render and photo side by side
node tools/capture.mjs viewpoint --outline           # render edges over the photo
node tools/capture.mjs beach --clip=9                # 9 s clip (needs ffmpeg)
node tools/capture.mjs viewpoint --clip=10 --hours=6.5:17.8   # the sun through the photo day
node tools/capture.mjs shoreBreak --debug=5          # water debug views 1 to 5
node tools/capture.mjs beach --clay                  # grey ground, shape only
node tools/capture.mjs --hero --bench                # frame times
node tools/capture.mjs viewpoint --measure           # colour per region, render against photo
node tools/capture.mjs viewpoint --set="hour=17"     # any page switch, ; between several
node tools/capture.mjs viewpoint --eval="expr"       # read from the page (a PNG data URL is saved)
node tools/hero.mjs v2                               # finish a version
node tools/ab.mjs beach --rounds=16                  # this build against the previous tag, side by side
node tools/parts.mjs beach --parts=none,SKIP_SANDNEAR,WSKIP_SWASH   # what parts of a frame cost
node tools/capture.mjs cove --console                # print the page's shader errors and warnings
node tools/capture.mjs cove --set="w.surge=0.8"      # water (w.), wave spectrum (o.), foam sim (s.) settings
node tools/preview-height.mjs 1024                   # top-down shaded height map
node tools/walk-line.mjs                             # the camera line down the path, data/walk-line.json (v6)
node tools/capture.mjs trailTop --eval="__app.contactSheet([{ s: 150, yaw: 234, pitch: -20, fov: 70 }])"   # cameras on the path by distance along it
node tools/veg-parts.mjs trailLow --groups=all,near,impostor,~^near:grass   # what groups of plants cost (v7)
node tools/ab.mjs trailLow --a=self --seta="vegHide=near"   # this build against itself, a switch on one side (v7)
node tools/descent.mjs                                # the scroll's camera path: speeds, turn rates, clearance (v8)
node tools/scroll-clip.mjs                            # the landing page recorded top to bottom, 1080p (--phone for 390 x 844)
node tools/path-bench.mjs                             # frame times at 21 cameras down the path, against the last tag (v8)
node tools/path-bench.mjs --pace --dpr=2 --size=1512x945   # the real page scrolling itself: dropped frames
```

Page switches: `?shot=`, `t=` (freeze the sea), `debug=`, `hide=terrain,water,plants,sky`,
`clay=1`, `contours=1`, `pr=1` (fixed pixel ratio), and from v2 `hour=`, `sun=az,el`,
`haze=`, `seaHaze=`, `ev=` (exposure compensation), `clouds=0`, `bounce=0`. From v3:
`cam=e,n,h,yaw,pitch[,fov]` (any camera, in a shot's frame), `clay=2` (the bare triangles),
`terrainDebug=1..5` (the ground's shadow, sky share, overhang horizon, lit ground, carving),
`faceStep=` (face strip spacing). From v4: `debug=1..9` (water views, see `src/main.js`),
`sprayDebug=1..4`, and `w.`, `o.`, `s.` for any water, spectrum or foam setting. From v5:
`debug=10` (the swash: sheet, foam, thickness), `w.runup=` and `w.swashT=` (how high the swash
runs and how long its uprush takes). From v6: `trail=0` (no path at all), `cam=` takes a roll
as a seventh number. From v7: `lab=x,y[,gap]` (one of every plant in a row instead of the
scatter), `vegDetail=` (how far the full plants reach, 0 for none), `vegHide=near:grass,impostor`
(leave out plant meshes by the start of their names). Keys: `1` to `9`
shots, `O` overlay, `L` outline, `F` free camera, `C` contours.

From v8 the page without `shot=`, `capture` or `cam=` is the landing page (`src/scroll/`), and
the switches above are the tools'. The landing page takes `debug` (the panel, a readout, keys
`1` to `6` for the stops), `at=` (start at a `tau`, 0 over the bay to 5 at the water),
`notext`, `record` (stepped frame by frame by `scroll-clip.mjs`), and any scene switch. In the
console, `__scroll.jumpTo(__scroll.pace.screensAt(2.5))` goes to a place on the way down.

Measuring light: `--measure` renders the shot twice more (class labels, and scene light
before the tone curve) and averages the same pixels in the render and the photo. Shots can
carry `rois` (rectangles, or separate ones for render and photo) in `src/shots.js`. The
`eastCove` shot is the same phone and hour as the viewpoint photo, with the sky up to 38
degrees: use it for anything about the sky.

## Frame times at v1

See [docs/gallery/v1](../gallery/v1/README.md). With nothing else on the GPU every hero frame
renders in well under 30 ms at 1400 px on an M1 Max. The 1 km overview is the slowest.
