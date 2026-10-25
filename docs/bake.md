# Bake and pack

`tools/bake/*`, `tools/pack.mjs`, `public/ibis.glb`.

- `SIMPLIFY_ERROR = 0.003` gives about 8k triangles. 0.0015 gives about 15k with no visible gain. 0.005 makes the beak and head look faceted.
- The simplifier sees two vertices at one position as a seam, not a border. `LockBorder` alone does not hold material lines. `simplify()` locks material line points `LINE_LOCK_SPACING` (0.02) apart, so the lines keep their curves.
- `pack.mjs` stores `_MAT`, `_GROUP`, `_LINE` and `JOINTS_0` as bytes, `NORMAL` and `_OUTLINE` as 8-bit vectors, then compresses with meshopt. Current file: about 8k triangles, 95 KB.
- POSITION must stay float in character units. The shaders read the raw bind position (`eyeSpace(position)`, `stroke(position)`). `KHR_mesh_quantization` on positions changes the units and breaks the eyes and the line widths.
- `loadIbis()` needs `setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`.
- Do not give `smin()` a far value such as `1e9`. It computes `mix(b, a, h)`, and in float that loses `a`. Use about `10.0`. Example: the head part in `bake.glsl`.
- In `bake.glsl`, Chrome on Metal gave zeros for `idx / 32` in the palette mode, so the bake wrote a black palette. It uses `idx >> 5` and `idx & 31`. After a bake, check that the game mesh has its colours.
