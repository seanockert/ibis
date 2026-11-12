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
- Night and lamps: `LIGHT_GLSL` (`src/world/lighting.js`) in `TOON`. A new toon shader calls `toonShadowCoord()` (it sets `vToonWorld`) and `toonLit()`, or `lampLight()` and `night()`. See `environment.md`.
- Highlights: `GLOSS` in `materials.js` (N.H threshold and strength for each material id, runtime only). The bare head, bill and neck (`BLACK`, but not on the wings), the jaw, the legs and the eye catchlight. Keep the head and the legs faint: strong highlights there distract. The wet highlight is separate, in `weather()`.
- Shadow area: in the close views, 6 by 6 round the bird (2048 map). In free play, `SHADOW` in `src/app/stage.js`: 20 by 20 round the camera's focus (4096 map, about the same texel size; 2048 in lite mode, see `LITE` in `src/app/config.js`), moved in whole texels so edges don't crawl. `sunShadow()` fades the shadow out near the edge of the area, to the far map of the plants (`FAR_SHADOW`, `src/world/farShadow.js`; see `environment.md`). A small area round the bird cut the bin's shadow as the bird walked away.
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

## Bulge

- `bulge()` in `materials.js` pushes the surface out round up to `BULGES` capsules, so the bird wraps what it swallows. The body, the hull and the border lines all use it.
- `Ibis.bulge(i, a, b, r, k)` sets capsule `i`: ends `a` and `b` in character space, radius `r`, amount `k` (0 off). The surface goes out to the radius with a smooth max, so a part outside the capsule does not move.
- The body shader keeps `vPos` from before the bulge, so the SDF line tests stay correct.
- The shadow depth pass does not know the bulge.
- A bulge on the eyes breaks their shape. Keep a capsule below the eyes (`THROAT` in `src/gulp/game.js`).
- A `Vector4` starts with w = 1. The uniforms start at 0, or each bird has a bulge of radius 1 at its feet.
- With every amount at 0, the render is the same as before (pixel diff of the five check views: 0 pixels).

## Mud and wet

- `ibis.mud` and `ibis.wet` (0 to 1) set the `uMud` and `uWet` uniforms of the body material. Each `Ibis` has its own body material, so each ibis has its own values.
- The code is the `WEATHER` chunk in `materials.js`: `mudMask()` and `weather()`. The body fragment shader calls `weather()` on the base colour before the lines. Eyes and lids are not changed.
- The pattern uses `vBind` (the bind position), so it stays on the body as the ibis moves.
- Mud: solid below a noisy line at bind height `0.05 + 0.80 * uMud`, with splashes above it. Colours are `MUD_LIT` and `MUD_SHADE`.
- Wet: darker colour, streaks that run down, and a hard broken highlight in the lit band.
- Only the game shows mud and wet. `sdf.html` does not. No bake is needed.
- Demo: the sprinkler's drops (`props.md`) raise the wet target and wash the mud off; a shake takes half off. Mud comes only from mud on land. Wet and mud follow their targets at `WEATHER_RATE` (`level.js`). URL parameters `mud` and `wet` set them for screenshots, for example `index.html?anim=1&t=0.5&mud=1`.
- With `uMud = 0` and `uWet = 0`, the render is the same as without the effects.
- Mud (`mud.js`, land areas: `land.md`): a step or a landing on `mud` (`under`) is a splash (`level.js`): `splashMud()` sets `ibis.mud` at once (a walk muddies the feet, a run the legs, a jump the belly: `SPLASH`) and raises the mud target so it stays, `fx.splash()` throws mud blobs (`fall` and `floor` in `puff()`), `sound.splash()` sloshes, and `Land.splash()` makes a ring (`Ripples`). The sprinkler washes it off. The street had a `Puddle` mesh; land `pool` features replaced it.

## Known traps

- The mesh is not on the SDF surface. The error is up to `SIMPLIFY_ERROR`. A runtime SDF test at `vPos` can get the wrong sign. Example: `overLine()` uses `abs(miss)` for the wings, because the torso can sit just inside a wing. Do not use `abs` for the scarf: its solid stand-in is larger than the drawn scarf, and `abs` opens a gap at its outline.
- Constants are copied between the bird's `SHAPE` and its `model.glsl` (`headScale`, the toe directions and the lengths in `toes`, the jaw hinge). Change both.
- The noisy miner paints the back of its body with the wing id (`bodyMat()`), so no line shows where the folded wings lie on the back. It has no glint material: the eye highlight is `GLOSS`, as on the ibis.
- The renderer needs a stencil buffer (`stencil: true`).
- Bone count is 32 (`BONES` in `rig.js`). Byte joints allow up to 256. New bones go at the end of `BONES`, so the bone numbers in an older bake stay right: `public/miner.glb` has the first 27, and `Ibis.setPose()` skips the bones a bake does not have.
- Squash (`P.squash`): `R.body` has the scale, `R.bodyRot` only the turn. `gBodyInv` is then a true inverse, not a transpose, and `gBodyK` (1 at rest) is the most that body space stretches a distance: `mapChar()` multiplies the body, tail and scarf distances by it, so the raymarch step stays safe. The runtime line tests use screen derivatives (`lineMask()`), so they do not need it.
- Swung scarf ends (`gScarfSwing` more than 0): `scarfUncarved()` turns each end back about its hinge and takes the body distance there again (two more `body()` for each scarf test). That costs about 0.35 ms in a full screen close-up, so the animator keeps the swing at exactly 0 while the bird stands. The solid stand-in of a swung end is its shell only: the solid at rest takes in the body under the end, and swung, that part went into the chest and painted it in the scarf line colour. The torso's scarf march (`overLine()`) draws only the thin line for a swung end. Near the chest, the miss follows how close the end is in depth, not its outline on screen, so a wide line there was a ragged fringe (more steps did not fix it).
The scarf's contour hull draws the wide line of a swung end over the torso: `Ibis.setPose()` sets its stencil test to always while `scarfSwing` is more than 0, and back to not-the-torso at rest.
The hull push of the scarf (0.2) puts it behind the chest, so for the vertices of an end (by skin weight on `scarfR` or `scarfL`) the push goes down to `SCARF_PUSH` as that end swings (`uScarfSwing`, full at `SCARF_PUSH_SWING`). The line then grows in where the gap to the chest gets wider.
Do not draw only the wrap in the march with the hull at a push of 0.2: the swung ends then have no line over the torso.
- Scarf contact shadow (`scarfShadow()` in the body shader): a lit torso pixel within 0.12 of the scarf's solid tests 4 points toward the sun against the scarf. The shadow map loses the shadow where the scarf lies close (its bias), so an end that swung out a little left a lit gap in its shape behind it. About 0.1 ms in a close-up.
- Body shader cost (close view, see `improvements.md`): `weather()` returns at once on a clean, dry bird, and the scarf march runs only when the view ray passes within `SCARF_R` (more with a swing) of `SCARF_C` (`rayNear()`): the whole scarf is within 0.47 of it at rest, from the baked vertices.
