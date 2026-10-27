# Rendering

Spaces, materials, colours, light, lines, mud and wet on the ibis.

## Coordinate spaces

- Character space: y up, +z toward the beak, feet on y = 0. The ibis is about 2 units tall.
- Body space: `bodySpace(p)`. Fixed to the torso. +x is the ibis's left side.
- Wing space: `gWingInvL * (p - gShoulderL)`. x points outward from the body, -y runs along the wing to the tips, z points toward the head. `wingR` mirrors x, so one `wing()` function serves both wings.
- Head space: `headSpace(p)`, scaled by `HEAD_SCALE`.
- The bake uses the bind pose (`BIND_RIG`). A feature in body space stays on the body as the wings move. A feature in wing space moves with the wing.

## Materials and colours

- A material is an id per surface point, returned by the part SDFs as `vec2(distance, id)`.
- To add a colour region, change the id inside the part function. Example: the pink underwing disc in `wing()` (`WING_PINK_C`, `WING_PINK_R`).
- To add a new material id:
  1. Add `MAT_X` in `model.glsl` and `X` in `src/ibis/materialIds.js` (for the miner: `src/miner/`).
  2. Add its colours to `paletteSrgb()`.
  3. Keep ids below 32 (`weldByMaterial` key and the bake palette) and below 256 (`pack.mjs` byte type). The uniform arrays in `materials.js` get their size from the largest id.
- The bake writes the palette into the GLB (`mesh.userData.palette`). A colour change needs a bake.
- `MAT_WHITE` and `MAT_WING` have the same colour but different ids, so a line splits wing from body. Use a new id when you need a line.
- Light: `TOON` and `TOON_VERTEX` in `materials.js`, used by the ibis and the props. `toonBand()` is the N.L split (edge one pixel wide, from the screen derivative) times the stepped sun shadow. The material needs `lights: true` and `lightUniforms()`, and the mesh `receiveShadow`.
- Highlights: `GLOSS` in `materials.js` (N.H threshold and strength for each material id, runtime only). The bare head, bill and neck (`BLACK`, but not on the wings), the jaw, the legs and the eye catchlight. Keep the head and the legs faint: strong highlights there distract. The wet highlight is separate, in `weather()`.
- Shadow area: in the close views, 6 by 6 round the bird (2048 map). In free play, `SHADOW` in `src/app/stage.js`: 20 by 20 round the camera's focus (4096 map, about the same texel size; 2048 in lite mode, see `LITE` in `src/app/config.js`), moved in whole texels so edges don't crawl. `sunShadow()` fades the shadow out near the edge of the area. A small area round the bird cut the bin's shadow as the bird walked away.
- The bird and the props receive the sun's shadow (self shadow too). `sdf.html` has no self shadow, so shadowed areas differ between the pages. `sun.shadow.normalBias` in `src/app/stage.js` stops acne on the bands.

## Part groups and lines

- Groups (`_group` attribute): 0 torso and head, 1 jaw, 2 wings, 3 legs, 4 scarf, 5 head of the miner (`headGroup` in its `bird.js`). They are set in `PARTS` in `bake.js` and used for stencil values in `Ibis.js`.
- Line types:
  - Contour hull: wide inverted hull for the silhouette.
    - `uGlow` (0 to 1, each bird's own contour material, `ibis.glow`): the contour goes white and `GLOW` (a part of the view height) wider. A highlight for the miner that a peck would snap at. At 0 the bird is as before (pixel diff).
  - Inner hull: thin inverted hull where one group lies near another. It is off for the wings and the scarf.
  - Border lines: a quad on each mesh edge where two materials meet. They are built at load time in `borderLines()`.
  - Body shader lines: the torso tests the wing and scarf SDFs, and the wings test the body SDF. `overLine()` and the `lineMask(d, ...)` call in `materials.js`.
- `wingSeam(p)` in `model.glsl` removes the wing line at the back of the wing root, so the wings blend into the back.
- To find which pass draws a line, hide `this.inner`, `this.contour` or `this.lines` in a scratch copy of `Ibis.js`, or paint a debug value in the body fragment shader.

## Mud and wet

- `ibis.mud` and `ibis.wet` (0 to 1) set the `uMud` and `uWet` uniforms of the body material. Each `Ibis` has its own body material, so each ibis has its own values.
- The code is the `WEATHER` chunk in `materials.js`: `mudMask()` and `weather()`. The body fragment shader calls `weather()` on the base colour before the lines. Eyes and lids are not changed.
- The pattern uses `vBind` (the bind position), so it stays on the body as the ibis moves.
- Mud: solid below a noisy line at bind height `0.05 + 0.80 * uMud`, with splashes above it. Colours are `MUD_LIT` and `MUD_SHADE`.
- Wet: darker colour, streaks that run down, and a hard broken highlight in the lit band.
- Only the game shows mud and wet. `sdf.html` does not. No bake is needed.
- Demo: the Wet button at the top right fades wet in or out over 2 s. Wet on also washes the mud off (the mud target goes to 0). Mud comes only from the puddle. URL parameters `mud` and `wet` set them for screenshots, for example `index.html?anim=1&t=0.5&mud=1`.
- With `uMud = 0` and `uWet = 0`, the render is the same as without the effects.
- Puddle (`puddle.js`, with `env`): a flat mesh on the nature strip, not in the physics. `Puddle.update(dt, ibises)` reads `step` and `land` events and tests the feet with `inPuddle()`; each hit gives a `splash` event (`strength` 0 to 1 from the speed or the landing impact, `land`). The demo then sets `ibis.mud` at once with `splashMud()` (a walk muddies the feet, a run the legs, a jump the belly: `SPLASH`), raises the mud target so it stays, and calls `fx.splash()` (mud blobs that fall back, with `fall` and `floor` in `puff()`) and `sound.splash()`. The Wet button washes it off. No footprints in the water (`fx.surface` returns `false`) and no tufts on the puddle or its bank. `shape()` is in JS and in the shader: change both.

## Known traps

- The mesh is not on the SDF surface. The error is up to `SIMPLIFY_ERROR`. A runtime SDF test at `vPos` can get the wrong sign. Example: `overLine()` uses `abs(miss)` for the wings, because the torso can sit just inside a wing. Do not use `abs` for the scarf: its solid stand-in is larger than the drawn scarf, and `abs` opens a gap at its outline.
- Constants are copied between the bird's `SHAPE` and its `model.glsl` (`headScale`, the toe directions and the lengths in `toes`, the jaw hinge). Change both.
- The noisy miner paints the back of its body with the wing id (`bodyMat()`), so no line shows where the folded wings lie on the back. It has no glint material: the eye highlight is `GLOSS`, as on the ibis.
- The renderer needs a stencil buffer (`stencil: true`).
- Bone count is 27 (`BONES` in `rig.js`). Byte joints allow up to 256.
