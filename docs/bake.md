# Bake and pack

`tools/bake/*`, `tools/pack.mjs`, `public/ibis.glb`, `public/miner.glb`.

- `npm run bake -- NAME` bakes the bird `NAME` of `src/birds.js` (`bake.html?bird=NAME`). The default is the ibis.
- `bake.glsl` is the same for all birds. It calls the part functions of the bird's model by name (`body`, `tail`, `thigh`, `thighOnly`, `lowerLeg`, `wingL`, `skullBill`, `jaw`, ...) and the material hooks `bodyMat()`, `tailMat()`, `skullMat()`, `MAT_THIGH` and `MAT_NECK`. The scarf part is only for a model that defines `SCARF`.
- `headGroup` of the bird is the part group of the head, neck, eyes and lids. The miner uses 5, so the inner hull draws a line where the dark hood meets the pale body. Separate meshes in one group get no line where they meet.
- A fresh bake of the HEAD code does not give the same bytes as the `public/ibis.glb` in git: the file in git is from an older bake. To show that a bake did not change, compare it with a bake from a copy of HEAD.

- Skin weights: the wings blend wing and hand over the wrist (`wingHand()` in `model.glsl`, the same curve in `wingWeights()`); the core blends body, tail and thighs by distance to each sub-part (`PART_W_*` in `bake.glsl`); the scarf blends the wrap (pelvis) and each end (`scarfEnd()`).
- `SIMPLIFY_ERROR = 0.003` gives about 8k triangles. 0.0015 gives about 15k with no visible gain. 0.005 makes the beak and head look faceted.
- The simplifier sees two vertices at one position as a seam, not a border. `LockBorder` alone does not hold material lines. `simplify()` locks material line points `LINE_LOCK_SPACING` (0.02) apart, so the lines keep their curves.
- `pack.mjs` stores `_MAT`, `_GROUP`, `_LINE` and `JOINTS_0` as bytes, `NORMAL` and `_OUTLINE` as 8-bit vectors, then compresses with meshopt. Current file: about 8k triangles, 95 KB.
- POSITION must stay float in character units. The shaders read the raw bind position (`eyeSpace(position)`, `stroke(position)`). `KHR_mesh_quantization` on positions changes the units and breaks the eyes and the line widths.
- `loadIbis()` needs `setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`.
- Do not give `smin()` a far value such as `1e9`. It computes `mix(b, a, h)`, and in float that loses `a`. Use about `10.0`. Example: the head part in `bake.glsl`.
- In `bake.glsl`, Chrome on Metal gave zeros for `idx / 32` in the palette mode, so the bake wrote a black palette. It uses `idx >> 5` and `idx & 31`. After a bake, check that the game mesh has its colours.
