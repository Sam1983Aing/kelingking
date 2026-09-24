# Kelingking: working notes

A real place (Kelingking Beach, Nusa Penida) rebuilt in three.js as a scroll descent from the
air down to the sand. The bar is photoreal water, sand and rock, and plants that feel alive.

## How this project is run

It is built in versions, one element per chat session. Before doing anything, read
`docs/versions/README.md` and the brief for the version you have been asked to do. Work on
that element only, on its own branch, and finish with `node tools/hero.mjs <version>` and a
section in `PROCESS.md`. Problems that belong to another version go into that version's brief.

## Things that already cost time

- **The browser pane lies.** It stops rendering when hidden and its screenshots go stale. Use
  `tools/capture.mjs` (headless Chrome, nothing to install) and read numbers back from the
  page. The server is `python3 -m http.server 5178` (`.claude/launch.json`, "kelingking").
- **`node --check` on a `.js` file treats it as a script**, so module-only mistakes pass.
  Check a copy named `.mjs` instead.
- **A backtick inside a comment inside a GLSL template string ends the JavaScript string.**
- **When a page never becomes ready,** `capture.mjs` prints its console. Read that before
  guessing.
- **Scripted find-and-replace edits:** assert the old text is there exactly once, or the edit
  can land twice or not at all.
- **Pattern that repeats with the mesh?** Look for a jump in the function being drawn before
  blaming the mesh (the v1 wave "teeth").
- **Absolute frame times mean nothing on this Mac.** They swing 2x to 8x with whatever else is
  using the GPU. The browser pane showing the page while a benchmark runs made everything
  look 5 to 8 times slower for a whole stage. Close the page in the pane before timing, and
  only compare versions timed back to back in the same run (`tools/hero.mjs` does this).

## Hard rules

- Reference photos (`references/**/*.jpg`) are other people's work. Never commit them, never
  upload them, never push them to the assets repo.
- Ask Sam before downloading anything, with the source and the size. Only CC0 assets ship,
  credited in a CREDITS.md next to them.
- OpenStreetMap data (`data/osm.json`, `src/terrain/geo.js`) is ODbL: keep the attribution.
- The headland must keep passing the outline check on `viewpoint` and `overview` unless a
  brief says the shape is changing.
