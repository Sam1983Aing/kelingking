# v25: Cliff toe and sand polish

## Goal

Refine the lower cliff and its contact with the beach from Sam’s four September 30 screenshots. Remove the remaining angular blue facets, protruding pale aprons and straight sand ribbons. Keep the contact curved, continuous and grounded. Give dry sand modest geometric relief and varied surface texture while preserving the sparse five visitor walking lines.

## Judge against

- Reproduce the lower stair landing and beach views in the supplied screenshots, including opposite head turns and a downward sand view.
- Compare clay and textured renders to distinguish shape, topology and shading defects.
- Check the lower descent in motion and retain the v24 closure at tau 3.665.
- Keep the upper headland and postcard silhouette unchanged; local reference photos are unavailable, so do not claim a new photo match.
- Capture all nine hero views and paired frame timings against v24 checkpoint `5fa4370`; each median must remain within 10%.
- Rebuild the terrain bake and local standalone, and verify offline rendering.

## Scope

Terrain mesh ownership, lower cliff curvature and sand material/relief. Existing rope, trail, vegetation, clouds and water remain outside the requested polish.

## Found by other versions

v24 restored the supporting ground around the lower stairs. Preserve that bank protection while correcting the beach junction.

## Verification

Ready for review on `codex/v25-cliff-sand-polish`.

- Curved and seated the lower cliff profiles, removed the exposed pale apron and sand ribbon, and refined only the low beach-contact cells. Shared boundary vertices keep the packed mesh continuous.
- Added shallow dry-sand geometry plus filtered centimetre-scale grain, slope and colour variation. The five walking lines remain unchanged.
- Inspected 42 textured and plant-free clay views across tau 3.665–4.3 with head turns up to 90 degrees. No new contact seams or openings were observed. Six regression rays still hit near supporting ground.
- Recorded a 5.3-second scrolling check through the last descent and a 60-degree turn toward the cove. Fixed-camera before/after images cover both cove directions and the stair landing.
- All nine final hero renders produced zero console messages. Twelve alternating timing rounds against `5fa4370` passed the 10% limit at every camera; paired median changes range from -7.3% to +7.9%.
- The terrain bake is current. Mesh triangles increased by 0.45%; packed positions above 100 m differ by no more than 7.6 mm. Stored overview/viewpoint renders retain the silhouette. Local reference photos remain unavailable.
- Rebuilt the local standalone with the final material and tested with network access blocked: terrain generated, four scroll stops rendered and no console errors occurred.

See the [v25 gallery and measurements](../gallery/v25/README.md) for the comparisons, audit sheets, motion stills and timing data.
