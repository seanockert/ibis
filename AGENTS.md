# Ibis model: notes for agents

Read this file before you change the ibis.
It tells you where each thing is, how the data flows, and which mistakes cost time before.
`README.md` has the user-facing API and a short overview.

## Data flow

```
src/sdf/model.glsl  (shape, materials, palette: the source of truth)
src/ibis/motion/*   (input -> controller -> animator layers -> Pose)
src/ibis/rig.js     (pose -> joints -> bone matrices)
        |
        +--> sdf.html: raymarch reference view (live, no bake)
        |
        +--> npm run bake: tools/bake/* -> tools/pack.mjs -> public/ibis.glb
                                                              |
                                      src/ibis/Ibis.js + materials.js (game runtime)
```

- `model.glsl` is the source of the shape, the material ids and the colours.
- `sdf.html` shows a change to `model.glsl` at once.
- The game mesh (`index.html`) shows a change to `model.glsl` only after `npm run bake`.
- The runtime shaders in `materials.js` also include `model.glsl`. They call `wingL`, `wingR`, `body`, `bodySpace`, `wingSeam` and the scarf functions at runtime to draw lines. A change to those functions changes the game without a bake.

## Files

| File | Purpose |
|---|---|
| `src/sdf/model.glsl` | SDF parts, material ids (`MAT_*`), `paletteSrgb()` colours, `wingSeam()` |
| `src/sdf/library.glsl` | SDF primitives (`sdEllipsoid`, `smin`, ...) |
| `src/sdf/raymarch.glsl` | Reference renderer for `sdf.html`. `DEBUG_MODE` shows ids, normals and masks |
| `src/ibis/rig.js` | `Pose`, authored clips (`idle peck squawk flap`), `solveRig()`, `boneMatrices()`, `rigUniforms()` |
| `src/ibis/motion/spring.js` | `Spring` (implicit, stable at any dt), easing, `hash()` (seeded random) |
| `src/ibis/motion/controller.js` | `Controller`: input to position, heading, speed, jump and flutter. `MOVE`, `JUMP` tuning |
| `src/ibis/motion/animator.js` | `Animator`: the layer stack that makes the Pose. `GAIT` tuning |
| `src/ibis/motion/actions.js` | `ACTIONS` (one-shot moves), `FACES` (expressions), `CHANNELS` (mask groups) |
| `src/ibis/motion/character.js` | `Character`: controller and animator at a fixed 120 Hz sub step. Prod reactions |
| `src/ibis/effects.js` | `IbisEffects`: dust puffs, footprints and comic anger lines, driven by character events and state |
| `src/moves.js` | Demo moves: buttons, `anim=N` scripts, `scriptedCharacter()` for fixed-time poses |
| `src/ibis/materialIds.js` | `MAT` ids for JS. Must match `MAT_*` in `model.glsl` |
| `src/ibis/materials.js` | Runtime shaders: body (cel shading, eye, lids, wing and scarf lines), hull outline, border lines |
| `src/ibis/Ibis.js` | `loadIbis()`, `Ibis` class, part groups, stencil setup, border line geometry |
| `src/demo.js` | Demo page and URL parameters |
| `tools/bake/bake.js` | Bake: grid, dual contouring, material split, simplify, normals, skin weights, GLB export |
| `tools/bake/bake.glsl` | Bake kernel: which SDF each `PART_*` is |
| `tools/pack.mjs` | Small vertex types and `EXT_meshopt_compression` |
| `tools/shot.mjs`, `tools/strip.mjs`, `tools/bench.mjs` | Headless screenshot, filmstrip of a move, GPU timing |

## Commands

```sh
npm run dev                                           # demo /index.html, reference /sdf.html
npm run bake                                          # about 30 s, writes public/ibis.glb, prints triangles and KB
npm run shot -- out.png "index.html?anim=5&t=0.1&yaw=1.3&pitch=0" 700x700
npm run shot -- out.png "sdf.html?anim=5&t=0.1&yaw=1.3&pitch=0" 700x700
npm run strip -- out.png "index.html?anim=8&yaw=1.3&pitch=0.1" 0 1.2 12   # filmstrip: 12 frames, t 0 to 1.2
npm run build
```

- URL parameters: `anim` (a move from `MOVES` in `src/moves.js`, index + 1: 1 idle, 2 walk, 3 peck, 4 squawk, 5 flap, 6 run, 7 jump, 8 happy, 9 shake head, 10 threat, 11 startle, 12 stumble, 13 shake, 14 turn, 15 prod), `t`, `yaw`, `pitch`, `ui=0` (hide the buttons). `index.html` also takes `count`. `sdf.html` also takes `debug`.
- `index.html` with no `t`, `yaw` or `count` is free play: a wide camera, keys, taps. With `t` or `yaw` it uses the close camera of `sdf.html`.
- A fixed `t` runs the move's script from 0 at 60 steps per second (`playScript()`), so both pages show the same pose, and `index.html` the same effects. `sdf.html` ignores position and heading (the bird moves on the spot). On `index.html`, `root=1` places the bird where the move took it, and the camera moves with it: use it to see dust trails and turns.
- Use the same parameters on `index.html` and `sdf.html` to compare the mesh with the SDF.
- Useful views: back `yaw=3.14&pitch=0.3`, side `yaw=1.4&pitch=0.1`, wings fully open `anim=5&t=0.1`.
- The tools start Vite and headless Chrome at `/Applications/Google Chrome.app`. They work on macOS only.
- To zoom in, render at 1400x1400 or more and crop with `sips -c H W --cropOffset Y X in.png --out out.png`.
- There is no git. Before you overwrite `public/ibis.glb`, copy it to a scratch folder.

## Motion

- Data flow each frame: `Character.update(dt)` runs sub steps of at most 1/120 s. Each sub step: `Controller.step()`, then `Animator.step()`. The result is a Pose. `Ibis.update()` solves it and places `object` at the controller position and heading.
- The controller owns the root: position, heading, speed, jump. The animator only reads it. Actions can drive it with root motion (`root(t)` speed) and can lock the input (`lock`, `cancelAfter`).
- Animator layers, in order: base (idle clip, waddle gait by speed, air pose by jump state), face (smoothed preset), actions (masked blend), secondary (look chain, lean, bank, squash, hit springs, wing flicks, blinks).
- Gait: a foot on the ground is planted in world space (`plants`), so it never slides, whatever the root does. A swing foot steps to a place ahead, turned into the turn. Backward speed walks backward. After a stop, the bird steps until both feet are home (`GAIT.settle`). While the gait drives, the feet take it at full weight: a part blend with the idle feet slides them.
- Turns: the controller eases the turn rate in and out (`turnAccel`, `turnGain`). On the spot, the root turns about the planted foot that carries the weight (`animator.pivot`), with quick small steps, inside foot first. The eyes lead, then the head, then the chest (`twist`), then the legs. Check with the slide test idea: the world position of a planted foot must not change.
- Squash and stretch: no bone scale (the runtime line tests in `materials.js` do not know scale). Use `bob`, `stretch` (neck length) and the wings.
- To add an action: add an entry to `ACTIONS` in `actions.js` (see the field list at the top), then a line in `MOVES` in `src/moves.js` for a button. No bake.
- To add a face: add it to `FACES`. Face keys are `blink lid lidTilt lowLid pupil`.
- To add a Pose field: add it to `restPose()` with a value that changes nothing (the bind pose must not change), use it in `solveRig()`, and add it to a channel in `CHANNELS`.
- Lids: `gExpr` / `uExpr` (lid, tilt, lower lid, pupil). The formula is in `lidCover()` in `model.glsl` and `lidCut()` in `materials.js`. Change both.
- Events (`character.events`): `crouch`, `jump`, `land` (`impact`), `liftOff` and `step` (`foot`, `scuff`), and action events (`thump` with `dust`, `shakeOff`). Use them for sound later. The demo uses `shakeOff` to dry the bird.
- Effects (`effects.js`): run dust at `liftOff` above `RUN_DUST_SPEED`, skid dust, a ring on a hard `land`, a burst for events with `dust: 'rump'` or `'feet'`. Footprints at each `step` and `land`, along the rig's toes and foot turn, in the colour of the feet (`printStyle()`: dust, wet, mud), held 2.5 s then faded over 3.5 s. A ground material can replace `printStyle()` with a style for each surface. Footprints at each `step` and `land`, as wide as the SDF toes, along the rig's toes and foot turn, in the colour of the feet (`printStyle()`: dust, wet, mud), held 2.5 s then faded over 3.5 s. They write depth so overlapping parts blend once. A ground material can replace `printStyle()` with a style for each surface. Anger lines show while `animator.anger` (from the actions' `anger` field) is above 0.3. Puffs keep growing and dissolve (outline thins, then noise holes), so they stay opaque: no transparency or sorting. Each puff takes `ibis.mud` when made (`aMud`) and blends to mud-brown dust.
- Determinism: random values come from `hash()` with the seed. Do not use `Math.random()` in motion code.
- Responsiveness: keep wind-ups short (jump crouch 0.06 s, action fade-in 0.02 to 0.05 s).

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
  1. Add `MAT_X` in `model.glsl` and `X` in `src/ibis/materialIds.js`.
  2. Add its colours to `paletteSrgb()`.
  3. If the id is larger than `MAT.LID`, increase the uniform array sizes in `materials.js` (they use `MAT.LID + 1`).
  4. Keep ids below 32 (`weldByMaterial` key) and below 256 (`pack.mjs` byte type).
- The bake writes the palette into the GLB (`mesh.userData.palette`). A colour change needs a bake.
- `MAT_WHITE` and `MAT_WING` have the same colour but different ids, so a line splits wing from body. Use a new id when you need a line.

## Part groups and lines

- Groups (`_group` attribute): 0 torso and head, 1 jaw, 2 wings, 3 legs, 4 scarf. They are set in `PARTS` in `bake.js` and used for stencil values in `Ibis.js`.
- Line types:
  - Contour hull: wide inverted hull for the silhouette.
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
- Demo: the Mud and Wet buttons at the top right fade the values over 2 s. URL parameters `mud` and `wet` set them for screenshots, for example `index.html?anim=1&t=0.5&mud=1`.
- With `uMud = 0` and `uWet = 0`, the render is the same as without the effects.

## Bake and pack

- `SIMPLIFY_ERROR = 0.003` gives about 8k triangles. 0.0015 gives about 15k with no visible gain. 0.005 makes the beak and head look faceted.
- The simplifier sees two vertices at one position as a seam, not a border. `LockBorder` alone does not hold material lines. `simplify()` locks material line points `LINE_LOCK_SPACING` (0.02) apart, so the lines keep their curves.
- `pack.mjs` stores `_MAT`, `_GROUP`, `_LINE` and `JOINTS_0` as bytes, `NORMAL` and `_OUTLINE` as 8-bit vectors, then compresses with meshopt. Current file: about 8k triangles, 95 KB.
- POSITION must stay float in character units. The shaders read the raw bind position (`eyeSpace(position)`, `stroke(position)`). `KHR_mesh_quantization` on positions changes the units and breaks the eyes and the line widths.
- `loadIbis()` needs `setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`.

## Known traps

- The mesh is not on the SDF surface. The error is up to `SIMPLIFY_ERROR`. A runtime SDF test at `vPos` can get the wrong sign. Example: `overLine()` uses `abs(miss)` for the wings, because the torso can sit just inside a wing. Do not use `abs` for the scarf: its solid stand-in is larger than the drawn scarf, and `abs` opens a gap at its outline.
- Constants are copied between `rig.js` and `model.glsl` (`WING_FOLD`, `NECK_BASE`, `HEAD_SCALE`). Change both.
- The renderer needs a stencil buffer (`stencil: true`).
- Bone count is 27 (`BONES` in `rig.js`). Byte joints allow up to 256.
- `npm` and `npx` can be slow here. Run long installs in the background.

## Check a change

1. Define what must look different and what must not.
2. Render `sdf.html` and `index.html` with the same parameters before and after.
3. For "no visible change" claims, diff the PNGs pixel by pixel in headless Chrome (canvas `getImageData`), and count pixels that differ by more than 8 and by more than 64 of 255.
4. Check at least: idle front (`anim=1&t=0.5`), side, back, squawk side (`anim=4&t=0.5&yaw=1.6`), and flap open (`anim=5&t=0.1`). For motion, look at a filmstrip (`npm run strip`).
5. Run `npm run build`.
