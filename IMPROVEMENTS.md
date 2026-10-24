# Improvements for later

Ideas from the code review of October 2026 that are not done yet. Each has its expected gain and its risk. Measure before and after (GPU timer queries round `window.demo.render()`, see AGENTS.md), and use the regression checks in "Check a change".

## Triangle count

Free play at 1200x800 draws about 158k triangles in 81 draw calls each frame, with the shadow pass. Most of them are in three things:

| Part | Triangles | Why |
|---|---|---|
| Fence | 70k | About 80 posts and rails, `RoundedBoxGeometry` with 2 segments (300 triangles each), drawn 3 times (toon, outline, shadow) |
| Stubbies | 36k | 10 bottles, lathe of 24 segments: label, glass inside, glass outside, outline, and the shadow of the label and the glass |
| Ibis | 30k | About 8k triangles, drawn for the body, the contour hull, the inner hull and the shadow |
| Ball | 5.6k | Sphere of 40 by 24, drawn 3 times |
| Everything else | 16k | Bin, boxes, cereal boxes, tufts, sky, backdrop |

Ideas, largest gain first:

1. **Fence posts and rails as custom low meshes** (about −55k). A post needs a round top edge only: a box with a chamfer or a 2-segment round on the 4 top edges, and no bottom face, is about 40 to 60 triangles. A rail meets a post at each end, so it needs no end caps; a round on the top edges only is about 20 to 30. Keep the near-post look: the rounding shows at the play camera (a 1-segment `RoundedBoxGeometry` made the near posts look cut, so do not use that). Also try `castShadow = false` on the rails: their shadow is a thin line.
2. **Stubbies** (about −15k). 16 lathe segments in place of 24 (the outline hides the facets). The label does not need to cast a shadow: the glass shadow covers it. Check the inside (back face) draw: at the play distance it may not show.
3. **Ibis shadow mesh** (about −6k, and 4 fewer draws). The shadow pass draws the full 8k mesh as 5 group draws. Bake a second, coarse mesh for the shadow only (a higher `SIMPLIFY_ERROR`, about 2k triangles, one group), skinned to the same bones, with `castShadow` on it and off on the body.
4. **Ball** (about −3k). 28 by 16 in place of 40 by 24; the outline hides the facets.
5. **Small circles and cylinders**: cereal logo circles 32 → 20, bin wheels 24 → 16. Small gain; check the outline.

## GPU

- **Noise from a texture.** `noise3()` is 8 sin hashes. Each grass pixel calls it 4 times, each sky pixel 6 times, each backdrop pixel 3 times. One tiling noise texture would cost much less. The look changes a little: tune against the concept.
- **Road noise in a branch.** The road repair noise (`street.js`, `road = mix(...)`) runs on every ground pixel. It has no `fwidth`, so it can go behind a road-only branch, as `onGrass` does.
- **Sky ridges.** In `sky.js`, skip the hills and trees above the highest ridge (`el > 0.11`).
- **Ibis body early-z.** The body program has `discard` (the lid cut), which can turn off early depth on the whole body. Compile the `discard` only into the material that draws the lids (a define), and draw the wings and the scarf before the torso, so the torso pixels that they hide skip the line march. The lids are in group 0 now: they would need their own group.
- **Hull vertex shader.** `inverse(modelMatrix)` runs for each vertex in the body and the hull. Send the camera position in object space as a uniform.
- **Shadow map.** Free play uses a 4096 PCF map (about 64 MB). Try 2048 on mobile: the toon step hides the softer edge.

## CPU

These are small. The bird and the physics take about 0.24 ms a frame at a run, so do them only with a profile that shows a need.

- **Allocations in the 120 Hz sub step.** New Poses (`clipPose`, `restPose`, `mixPose(P, P, 0)` as a clone), ray arrays and hit objects in `physics.js`. Use scratch objects. Take care: a reused pose must not still be read elsewhere.
- **Swing foot rays.** `plant()` casts 2 rays for each swing foot in each sub step (`animator.js`). Cache the target for each swing. This changes behaviour a little: a foot no longer follows a prop that moves under it mid-swing.
- **Rig uniforms.** `rigUniforms()` makes 4 `Matrix3` for each ibis each frame. `onBeforeRender` writes `uViewHeight` 4 times for each ibis. `paletteArrays()` runs 3 times for each ibis: do it once in `loadIbis()`.
- **Footprints.** All prints write their matrix and colour each frame, but only the fade changes. Use a birth time attribute and a time uniform, and upload only when a print is made.
- **Puffs.** `puffs.shift()` and `filter()` re-index every puff, so the seed and mud attributes upload each frame. A ring buffer would upload them only when a puff is made.

## Clean-up

- **Shared GLSL helpers.** The pixel-wide step `1 - smoothstep(w - px, w + px, d)` is written in about 8 places (`street.js`, `puddle.js`, `fence.js`, `materials.js`). The world position and `toonShadowCoord` vertex shader is the same in `street.js`, `puddle.js` and `fence.js`. The lit and shade uniform pairs and `tone()` are made 3 times (`street.js`, `puddle.js`, `sky.js`).
- **Ground normals.** `groundGeometry()` takes each normal from the two neighbour points, so a flat strip next to a slope leans a very small amount (about 0.002°). Give the end points of each curve the true normal (up). The visible change is less than a pixel.
- **Footprints at a path edge.** A print near the edge of the raised footpath can hang over the grass. Skip a print whose toes are off the flat top.
- **Demo buttons.** Three blocks in `demo.js` make buttons by hand, and `aria-pressed` is set in 5 places. A `button(label, onPress)` helper would do. `PAD` lists the 13 moves to leave out of the top bar; a list of the moves to keep is shorter, but then a new move does not show by default (a design choice).
- **Bound sphere.** `Ibis.js` (`BOUND_OFFSET`, `BOUND_R`) and `model.glsl` (`BOUND_C`, `BOUND_R`, `boundCentre()`) hold the same sphere with different formulas. Make one source.

## Possible bugs

- **Fumble on flat props.** `addDynamic()` puts every body that is not grabbable in `bulky`: the bin lid, the box flaps and a squashed cereal sheet too. So a peck at a flat sheet plays `fumble`. Decide if that is wanted.
- **Stale ray hit.** `groundAt()` sets `out.body` only on a hit, so a miss keeps the old value. `feetGround()` clears it first, but the animator's `landing` object does not. Harmless now.
