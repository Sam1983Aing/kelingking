# v24: close visible terrain holes

**Goal.** Fix the see-through opening beside the lower stairs in Sam’s September 30
11:45 screenshot, and remove the same defect wherever it occurs through the descent.

## Judge it against

- The lower stair view around 28 m elevation, both in finished lighting and without plants.
- Adjacent scroll positions and head turns, plus the entire route and all nine hero cameras.
- The previously accepted cliff shape, beach recess and walking clearances.
- A paired frame cost no more than 10% above v23 checkpoint `bfafc01`.

## Scope

Terrain mesh coverage, the ground-to-face junction and camera visibility of solid elements.
Find and correct the shared cause, rebuild the bake and local standalone, and verify the
fix in motion. Preserve accepted materials, rope, clouds, water and plant placement.

## Found by other versions

None.

## Diagnosis and validation

The opaque, two-sided terrain was not a material problem. The beach floor lowered
uncarved grid vertices with the narrow 2–5 m trail carving mask. Cliff face windows
already stop short of the route, so that floor exposed openings beneath their ends.

Both beach-floor lowering and rising-cell replacement now preserve the complete stair
bank: its authored 8 m reach plus 2 m mesh overlap, with a 6 m transition into the beach
floor. This applies along the whole route rather than patching the screenshot location.

Validation so far:

- At tau 3.665 (28.03 m elevation), the opening is closed in textured and plant-free
  clay renders. Six rays hit nearby ground; the ray through the reported hole changes
  from a 27.77 m distant-cliff hit to a 3.56 m supporting-rock hit.
- 38 plant-free views cover tau 1.0–4.2 and ±35° turns at seven lower-stair positions.
  No remaining see-through openings were observed in these views. A 4.8 s scroll clip
  adds a head turn through the same area.
- All nine hero frames render without console messages.
- The original heightfield, 141,677 face-strip vertices, vegetation data, route line and
  stair mesh arrays are identical to v23. Only 973 grid vertices change by more than
  25 mm, in the lower stair-bank region below 48.3 m. The overall triangle count falls
  by 46. Local reference photos are absent; shape checks use numerical identity of
  the authored faces and stored v23 hero renders, without a new photo-match claim.
- Bake current, 13.38 MB, exact triangle indices after round trip. Local standalone rebuilt.

Twelve alternating rounds of eight complete frames against `bfafc01` measured paired
median changes from -6.5% to +7.2%, within the 10% limit at all nine hero cameras.
The local standalone loaded from file with networking blocked, generated the repaired
terrain, reached four scroll stops and had no console errors. Gallery evidence and raw
measurements are in `docs/gallery/v24/`.

Ready for Sam’s review; dedicated branch `codex/v24-terrain-closure`.
