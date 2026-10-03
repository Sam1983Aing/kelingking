# Kelingking starter prompt

One prompt to paste into Claude Code or Codex, in an empty folder. By the end it has built the foundation of the island: the shape from the map, the sea, real textures, plants grown in code, and the scroll from the sky down to the sand. That's your version one. Part two (below) is how you refine it from there, the same way I did.

## What happens when you paste it

It doesn't build everything in one go. It works in five steps, and it stops after each one to show you what it made. You look, then you tell it to continue ("looks good, go ahead with step 1").

| Step | What it does | What you see when it stops |
|---|---|---|
| 0. Research | Finds reference photos and the map data for the place. It asks before downloading the photos | A page of reference photos grouped by stop, and the map. No 3D yet, and that's normal |
| 1. The shape | Builds the island from the map, in plain grey, and the tools to check it against the photos | A grey T-Rex headland, next to the real photo with an outline traced over it |
| 2. The sea | Adds the water: colour from the depth, waves, surf on the beach | Stills and short clips of the water |
| 3. Surfaces and plants | Adds real textures (it asks before downloading them) and plants grown in code | The same views with rock, sand and green |
| 4. The descent | Turns it into the page: the scroll from the sky down to the sand, with the words | The landing page you can scroll |

So the very first thing you get back is research, not an island. Each step can take a while. Let it run, and look at what it shows you before saying go.

Your result won't look exactly like mine. Nobody's will, mine included if I ran it again. What you should get at the end of step 4 is a recognisable T-Rex headland you can scroll down, and a project set up so every next round makes it better.

---

## The prompt

```text
I want to rebuild a real place in the browser: Kelingking Beach on Nusa Penida, Bali, the
headland everyone calls the T-Rex. The end result is a scroll-driven landing page in three.js.
You start high above the bay, the scroll flies you down onto the clifftop viewpoint, walks you
down the path on the ridge, and you end standing on the sand at the water's edge with waves
breaking in front of you.

This prompt is the foundation only: make the place recognisable and get the whole descent
working end to end. We polish one element at a time afterwards, so set the project up for
that too. Work in the steps below, and stop at the end of each one to show me.

WHAT MATTERS MOST
- The shape has to read as Kelingking from the famous clifftop view. If the T-Rex doesn't
  read, nothing else matters.
- Water, sand and rock should end up looking real at every distance, from a kilometre up to
  standing on the beach. For now: believable and physically sensible, not perfect.
- Plants can be invented, but they should feel alive, not like a painted green surface.
- Don't sculpt anything by hand and don't download a 3D model of the place. Build it from
  map data and code.

STACK
- Plain HTML and JavaScript, three.js from a CDN, no build step, served by a small local
  server. Lenis for the smooth scroll, GSAP for the text.

THE PLACE (check all of this yourself, don't trust me)
- The summit of the head, "Puncak Kelingking", is around -8.7532, 115.4720, about 111 m high.
  It's tagged in OpenStreetMap.
- The ridge runs from the clifftop viewpoint in the north-east towards the south-west, then
  hooks west into the head. The beach sits inside the hook. There's a small rock islet just
  off the head.
- The viewpoint platform is roughly 150 m above the sea. From there, about 150 concrete steps,
  then a steep dirt path with bamboo handrails tied with blue rope, zigzagging down to the sand.
- White coral sand, turquoise water over the sand, deep navy further out, a strong shore break.
- Leave out the unfinished glass lift on the cliff.

STEP 0. REFERENCES AND DATA, BEFORE BUILDING ANYTHING
- Find 20 to 30 reference photos, sorted by the stops of the scroll: from the air, the clifftop
  viewpoint, the path, the beach, the water. Drone shots looking straight down matter most,
  they pin the layout. Wikimedia Commons and Unsplash are good sources. Ask me before
  downloading them, then save them in references/, list the source, author and licence of each
  in references/REFERENCES.md, and add the photos to .gitignore. They're other people's work and
  never get committed.
- Get the OpenStreetMap data for the area through the Overpass API (roughly south -8.760,
  west 115.460, north -8.745, east 115.484): the coastline, the cliff lines (natural=cliff),
  the paths and steps, the peaks with their heights, the viewpoints. Convert it to metres
  around the summit. Check it against satellite imagery before you use it. OpenStreetMap data
  is ODbL, so keep the attribution in the project and on the page.
- If a photo still has its EXIF (date, time, GPS), use it. It tells you where the sun was.
- Show me the photos on a simple reference page, grouped by stop.

STEP 1. THE SHAPE, IN GREY
- Build the terrain from the map lines plus a few hand-tuned numbers: a plateau, a ridge along
  the spine, a drop below every cliff-top line (sheer on the head, steep where the path comes
  down), and sand only where the beach is. Everything comes down to sea level at the waterline.
  No elevation data needed.
- A grid of heights can't draw a vertical cliff well. Once the shape is right, plan to give the
  cliff faces their own geometry.
- Show it in plain grey first, no materials.
- Build the checking tools now, before anything pretty:
  - Six to nine fixed camera shots along the descent, stored as plain numbers (position,
    heading, pitch, lens), each tied to a reference photo. Include the clifftop viewpoint and
    the overview from the air.
  - A script that renders any shot in headless Chrome and saves the image.
  - An outline mode that draws the render's coastline and silhouettes as lines over the real
    photo, so every mismatch shows.
- Tune the shape until the outline matches on the viewpoint and the overview. Show me.

STEP 2. THE SEA
- Colour from depth over white sand: turquoise in the shallows, navy in deep water (water
  absorbs red light first).
- Waves at several sizes, from the swell down to ripples, so it holds up from the air and from
  the beach.
- Surf only in front of the beach, breaking where the water gets shallow, with foam. Elsewhere
  the swell runs straight into the rock.
- Judge the water in short clips, not only stills.

STEP 3. SURFACES AND PLANTS
- Real scanned CC0 textures from Poly Haven for the limestone, the sand, the ground and the
  path. Ask me before downloading anything, with the source and the size. Project them from
  three directions so the cliff faces don't smear. Credit them in a CREDITS.md.
- Horizontal layers in the limestone faces.
- Plants grown in code from a seed number, a few species (low coastal shrubs, grass, palms),
  all moving in one shared wind. No plant downloads.
- Compare with the photos again, region by region: sky, sea, sand, rock.

STEP 4. THE DESCENT
- Turn the scroll into one number for the camera's place on the way down, 0 over the bay to 5
  at the water's edge, and drive everything from it: the camera, the text, and a small readout
  of latitude, longitude and height.
- The camera flies down onto the clifftop platform, pauses on the view, then walks the path at
  eye height, looking where it walks, and ends on the sand. Slow the scroll down in the bends.
- One short line of copy at each stop, an elegant serif headline. A loader that shows the real
  loading progress.

HOW WE WORK AFTER THIS
- Put the project in git. Tag each step (stage-1, stage-2 ...) and the end of this prompt as v1.
- Render the fixed shots into docs/gallery/v1/, so every later version can be compared shot
  for shot.
- Write docs/versions/README.md with the plan for the next versions, one element each: light,
  rock, water, sand, path, plants, the scroll, then polish. Give each a short brief: the goal,
  the photos to match, what's out of scope, and what done means.
- Keep a PROCESS.md: what changed, what went wrong and how it was fixed, what's still weak.
- A speed budget: no version makes any shot more than 10% slower than the one before.

At every step, check your own work against the photos before telling me it's done, and show
me side by sides and short clips. Self-verify until it's right.
```

---

## Your own place

Nothing in the method is specific to Kelingking. To build somewhere else, paste this line, then the prompt above underneath it:

```text
Below is a prompt written for Kelingking Beach in Bali. I want the same build for [your place,
for example Durdle Door in Dorset, England]. Before building anything, research the place and
rewrite the prompt for it: every fact in THE PLACE (check each one), the map area for
OpenStreetMap, what the reference photos should cover, the plants that grow there, and the
stops of the scroll (where it starts and where it ends). Check first what OpenStreetMap has for
the place and tell me. Keep every step, check and working rule the same. Show me the rewritten
prompt and wait for my OK before you start.
```

What makes a place easy or hard:

- **Good map data.** The shape comes from OpenStreetMap, so the place needs its coastline, cliff edges and paths mapped. Famous coastal spots usually are. A quick check on 2026-10-02: Durdle Door in England and Praia da Marinha in Portugal both have more cliff lines and paths mapped than Kelingking does.
- **Plenty of photos with clear licences.** Famous places are easy. A hidden local beach might have five photos.
- **Natural scenery fits best.** Coasts, cliffs, beaches, islands. For mountains or valleys, also ask it to use free elevation data, which Kelingking didn't need. Buildings and landmarks (a cathedral, a bridge) are a different job, because they have to be modelled.
- **Keep it small.** One spot about a kilometre or two across, with one walk through it. A whole city or a whole island is a much bigger build.

## Part two: refining it with your agent

This is where it becomes yours. Same loop I used for all 34 versions.

**1. One element per round, in a fresh chat.** The prompt above leaves you a brief for each version. Start each round with one line:

```text
Read docs/versions/README.md and docs/versions/v2-light.md, then start v2.
```

An order that works: light first (every colour after it is judged under that light), then rock, water, sand, the path, the plants, the scroll. Then polish rounds from your own notes.

**2. Watch the whole page like a visitor, then write down what still looks fake.** Take a screenshot of whatever bothers you and say what you see in plain words. You don't need to know the cause. These are some of my real notes, cleaned up:

- "I hope this is not the final texture?"
- "The camera only faces one way, so on half the zigzags it's like we're going down backwards."
- "The stairs are too perfect and linear. Add the odd broken step, more rocks, beaten wood."
- "There are too many footprints in the same place. Make it feel like five people walked here, not a hundred."
- "The blue rope doesn't feel attached at all. It looks like AI slop."
- "It doesn't feel like one continuous motion. It feels disconnected."
- "Make it ultra realistic. Self-verify until it's perfect."

**3. Spend detail where people slow down.** The visitor flies past the top of the path and stops at the bottom. Polish the bottom.

**4. Look at it in the least forgiving light.** Add a time-of-day switch at some point. Low evening light shows problems that noon hides.

**5. Know when to stop.** There's always another detail.

Or skip all of it: the finished project is open source. Clone it, open any of the 34 versions, and change whatever you like.
