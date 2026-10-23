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
| `src/sdf/library.glsl` | SDF primitives (`sdEllipsoid`, `smin`, ...), shared by the game shader, the bake and `sdf.html` |
| `src/sdf/raymarch.glsl` | Reference renderer for `sdf.html`, with its view helpers (camera, colour, dither, debug, `palette()`). `DEBUG_MODE` shows ids, normals and masks |
| `src/ibis/rig.js` | `Pose`, authored clips (`idle peck squawk flap`), `solveRig()`, `boneMatrices()`, `rigUniforms()` |
| `src/ibis/motion/spring.js` | `Spring` (implicit, stable at any dt), easing, `hash()` (seeded random) |
| `src/ibis/motion/controller.js` | `Controller`: input to position, heading, speed, jump and flutter. `MOVE`, `JUMP` tuning |
| `src/ibis/motion/animator.js` | `Animator`: the layer stack that makes the Pose. `GAIT` tuning |
| `src/ibis/motion/actions.js` | `ACTIONS` (one-shot moves), `FACES` (expressions), `CHANNELS` (mask groups) |
| `src/ibis/motion/character.js` | `Character`: controller and animator at a fixed 120 Hz sub step. Prod reactions |
| `src/ibis/effects.js` | `IbisEffects`: dust puffs, footprints and comic anger lines, driven by character events and state |
| `src/ibis/sound.js` | `IbisSound`: Web Audio sounds from character and prop events. `public/sfx/honk.m4a` is the only file |
| `src/moves.js` | Demo moves: buttons, `anim=N` scripts, `scriptedCharacter()` for fixed-time poses |
| `src/ibis/materialIds.js` | `MAT` ids for JS. Must match `MAT_*` in `model.glsl` |
| `src/ibis/materials.js` | Runtime shaders: body (cel shading, eye, lids, wing and scarf lines), hull outline, border lines |
| `src/ibis/Ibis.js` | `loadIbis()`, `Ibis` class, part groups, stencil setup, border line geometry |
| `src/demo.js` | Demo page and URL parameters. Free play UI: joystick (bottom left), Jump, Peck, Run and Threat diamond (bottom right), a row of the other actions. Other views: one button for each move |
| `src/world/physics.js` | `Physics`: the crashcat world, the bird's solid, shove and room. The only file that imports crashcat |
| `src/world/props.js` | `Ball` (AFL football) and `Bin` (wheelie bin with a hinged lid): bodies and toon meshes |
| `src/world/terrain.js` | `Terrain`: a test course (steps, a top, a ramp, a kerb) of static prisms, for the foot placement. `COURSE` |
| `src/world/street.js` | `Street`: the ground shader (grass, footpath, kerb, road strips along x), `STRIPS`, `PLAY` (the play area box) |
| `src/world/tufts.js` | `Tufts`: grass tufts, one instanced draw of upright quads turned to the camera about y. `TUFTS` tuning |
| `src/world/sky.js` | `Sky`: sky dome shader (gradient, warm glow toward the sun, puff clouds, far hills and trees), `HAZE` |
| `src/world/backdrop.js` | `Backdrop`: two rings of tree silhouettes round the street (`RINGS`), so the world ends past the yards |
| `src/world/grade.js` | `Grade`: the scene to a multisampled target, then one colour grade pass to the canvas. `GRADE` tuning |
| `tools/bake/bake.js` | Bake: grid, dual contouring, material split, simplify, normals, skin weights, GLB export |
| `tools/bake/bake.glsl` | Bake kernel: which SDF each `PART_*` is |
| `tools/pack.mjs` | Small vertex types and `EXT_meshopt_compression` |
| `tools/shot.mjs`, `tools/strip.mjs`, `tools/bench.mjs` | Headless screenshot, filmstrip of a move, GPU timing |

## Commands

```sh
npm run dev                                           # demo /index.html, reference /sdf.html
npm run bake                                          # about 90 s, writes public/ibis.glb, prints triangles and KB
npm run shot -- out.png "index.html?anim=5&t=0.1&yaw=1.3&pitch=0" 700x700
npm run shot -- out.png "sdf.html?anim=5&t=0.1&yaw=1.3&pitch=0" 700x700
npm run strip -- out.png "index.html?anim=8&yaw=1.3&pitch=0.1" 0 1.2 12   # filmstrip: 12 frames, t 0 to 1.2
npm run build
```

- URL parameters: `anim` (a move from `MOVES` in `src/moves.js`, index + 1: 1 idle, 2 walk, 3 peck, 4 squawk, 5 flap, 6 run, 7 jump, 8 happy, 9 shake head, 10 threat, 11 startle, 12 stumble, 13 shake, 14 turn, 15 prod), `t`, `yaw`, `pitch`, `ui=0` (hide the buttons and the joystick). `index.html` also takes `count`, `props=0`, `physics=1`, `terrain=1` (the test course in free play) and `env` (0 or 1: the street and sky; on in free play, off in fixed views). `sdf.html` also takes `debug`.
- `index.html` with no `t`, `yaw` or `count` is free play: a wide camera, keys, taps. With `t` or `yaw` it uses the close camera of `sdf.html`.
- A fixed `t` runs the move's script from 0 at 60 steps per second (`playScript()`), so both pages show the same pose, and `index.html` the same effects. `sdf.html` ignores position and heading (the bird moves on the spot). On `index.html`, `root=1` places the bird where the move took it, and the camera moves with it: use it to see dust trails and turns.
- Use the same parameters on `index.html` and `sdf.html` to compare the mesh with the SDF.
- Useful views: back `yaw=3.14&pitch=0.3`, side `yaw=1.4&pitch=0.1`, wings fully open `anim=5&t=0.1`.
- The tools start Vite and headless Chrome at `/Applications/Google Chrome.app`. They work on macOS only.
- To zoom in, render at 1400x1400 or more and crop with `sips -c H W --cropOffset Y X in.png --out out.png`.
- `public/ibis.glb` is in git. To undo a bake, run `git checkout public/ibis.glb`.

## Motion

- Data flow each frame: `Character.update(dt)` runs sub steps of at most 1/120 s. Each sub step: `Controller.step()`, then `Animator.step()`. The result is a Pose. `Ibis.update()` solves it and places `object` at the controller position and heading.
- The controller owns the root: position, heading, speed, jump. The animator only reads it. Actions can drive it with root motion (`root(t)` speed) and can lock the input (`lock`, `cancelAfter`).
- Animator layers, in order: base (idle clip, waddle gait by speed, air pose by jump state), face (smoothed preset), actions (masked blend), secondary (look chain, lean, bank, squash, hit springs, wing flicks, blinks), ground (foot placement).
- Ground (`groundPose()`, `GROUND` in `controller.js`): a foot IK pass after every other layer. `animator.ground[i]` is the world height and normal under each foot. A planted foot keeps the ground where it landed (`plants[i].y`, `.n`: the higher of the ankle and the toe tip, `GROUND.toes`). A swing foot asks `controller.groundAt()` for its landing each sub step; over a step it rises early and drops late (`GAIT.climb`) and lifts higher (`GAIT.climbLift`). With no gait, the ground eases to `controller.feet` (rays under the posed feet). The pose takes `floorL/R` (height from the root), `slopeL/R` (the foot and toes lie on the normal, up to `GAIT.maxTilt`) and `air` (toe curl in the air). The pelvis drops by the lower foot, so on flat ground nothing changes. The body leans with the slope (`GAIT.slopeLean`).
- Root height: the mean foot height goes to the controller as `support`, and the root eases to it (`GROUND.follow`), so steps don't pop. A drop past `GROUND.stepDown` is no step: the foot stays level and the bird falls when it walks off. A top higher than `GROUND.stepUp` is a wall. On the first step and on `land`, the plants take the ground under the feet. In the air the ground offsets fade out from the take-off height (`animator.base`).
- Check foot placement with a script that steps a `Character` over a height function (`groundAt`, and `controller.feet` from `solveRig()`), as the physics does: a planted foot must not move in world x and y, and no foot may sink below the ground. On flat ground the bone matrices must equal the old ones.
- Gait: a foot on the ground is planted in world space (`plants`), so it never slides, whatever the root does. A swing foot steps to a place ahead, turned into the turn. Backward speed walks backward. After a stop, the bird steps until both feet are home (`GAIT.settle`). While the gait drives, the feet take it at full weight: a part blend with the idle feet slides them.
- Turns: the controller eases the turn rate in and out (`turnAccel`, `turnGain`). On the spot, the root turns about the planted foot that carries the weight (`animator.pivot`), with quick small steps, inside foot first. The eyes lead, then the head, then the chest (`twist`), then the legs. Check with the slide test idea: the world position of a planted foot must not change.
- Squash and stretch: no bone scale (the runtime line tests in `materials.js` do not know scale). Use `bob`, `stretch` (neck length) and the wings.
- To add an action: add an entry to `ACTIONS` in `actions.js` (see the field list at the top), then a line in `MOVES` in `src/moves.js` for a button. No bake.
- To add a face: add it to `FACES`. Face keys are `blink lid lidTilt lowLid pupil`.
- To add a Pose field: add it to `restPose()` with a value that changes nothing (the bind pose must not change), use it in `solveRig()`, and add it to a channel in `CHANNELS`.
- Lids: `gExpr` / `uExpr` (lid, tilt, lower lid, pupil). The formula is in `lidCover()` in `model.glsl` and `lidCut()` in `materials.js`. Change both.
- Events (`character.events`): `crouch`, `jump`, `land` (`impact`), `liftOff`, `step` (`foot`, `scuff`), `flap` (`amount`, `time`), and action events (`thump` with `dust`, `shakeOff`, and for sound only `call`, `hiss`, `clack`, `stamp`). The demo uses `shakeOff` to dry the bird.
- `flap`: `beatEvents()` in the animator reads the final pose, so every wing beat (air pose, actions, flicks) gives one. It fires as the wings start down. `amount` is the height of the beat, `time` the seconds of the up stroke. Beats below `BEAT.min` (0.3) give no event, so the run flap and the walk swing are silent.
- Sound (`sound.js`): one `AudioContext`, started by a key or tap. On iOS only the end of a touch (`pointerup`, `touchend`) can start it, not `pointerdown`. iOS also mutes Web Audio when the ring/silent switch is on silent. Before that and while muted, the context is suspended: no sound plays or queues, and the audio thread does no work. Each sound is a voice (gain from the distance to the camera, `NEAR`; pan from the camera's x) with noise bursts and tones. Wet or muddy feet add a squelch to each step. The honk sample plays at `pitch` times a random ±6%; `hash()` gives the variation. `MAX_VOICES` caps sounds at one time, and a compressor stops clipping. The demo makes sound only in the frame loop (not in fixed views or the bench); `sound=0` turns it off, and the Sound button mutes it.
- To add a sound: add an event to the action (`events`), then a case in `IbisSound.update()`. To change the honk, trim the silence, encode mono AAC at 32 kbps (`afconvert -f m4af -d aac -b 32000 in.wav out.m4a`), and keep it below about 10 KB. Use AAC, not MP3: MP3 adds silence at the start.
- Effects (`effects.js`): run dust at `liftOff` above `RUN_DUST_SPEED`, skid dust, a ring on a hard `land`, a burst for events with `dust: 'rump'` or `'feet'`. Footprints at each `step` and `land`, as wide as the SDF toes, along the rig's toes and foot turn, held 2.5 s then faded over 3.5 s. The colour comes from the surface and the feet (`printStyle()`): `fx.surface(x, z)` (set by the demo to `printOn()` in `street.js` with `env`) gives dry and wet colours for each strip (pressed grass, dust on the footpath, light dust on the road, dark when wet); mud wins over wet, wet over dry. With no surface: dust, as before. Each print has a lit and a shade colour and takes the sun's shadow. They write depth so overlapping parts blend once. Anger lines show while `animator.anger` (from the actions' `anger` field) is above 0.3. Puffs keep growing and dissolve (outline thins, then noise holes), so they stay opaque: no transparency or sorting. Each puff takes `ibis.mud` when made (`aMud`) and blends to mud-brown dust.
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
- Light: `TOON` and `TOON_VERTEX` in `materials.js`, used by the ibis and the props. `toonBand()` is the N.L split (edge one pixel wide, from the screen derivative) times the stepped sun shadow. The material needs `lights: true` and `lightUniforms()`, and the mesh `receiveShadow`.
- Highlights: `GLOSS` in `materials.js` (N.H threshold and strength for each material id, runtime only). The bare head, bill and neck (`BLACK`, but not on the wings), the jaw, the legs and the eye catchlight. Keep the head and the legs faint: strong highlights there distract. The wet highlight is separate, in `weather()`.
- Shadow area: in the close views, 6 by 6 round the bird (2048 map). In free play, `SHADOW` in `demo.js`: 20 by 20 round the camera's focus (4096 map, about the same texel size), moved in whole texels so edges don't crawl. `sunShadow()` fades the shadow out near the edge of the area. A small area round the bird cut the bin's shadow as the bird walked away.
- The bird and the props receive the sun's shadow (self shadow too). `sdf.html` has no self shadow, so shadowed areas differ between the pages. `sun.shadow.normalBias` in `demo.js` stops acne on the bands.

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

## Physics and props

- Engine: crashcat (pure JS, based on Jolt). Only `src/world/physics.js` imports it, so the engine can change in one file. `registerShapes()` and `registerConstraints()` list only what is used, for tree shaking. Add a shape there before you use it.
- Units: world units (the ibis is about 2 tall), kg, `GRAVITY = 22`. The step is at most 1/120 s, as in `Character`.
- The controller still owns the root. `character.collide` (a hook after each controller sub step) runs the kcc: it sweeps the bird's solid (`BIRD.solid`, one upright capsule from just above `GROUND.stepUp` to the chest, so it walks up low steps and a wall stops it) and moves the root back out of props. The solid must be one convex shape: in crashcat 0.0.5 the kcc's padding correction does not handle a compound and throws (`setSupport is not a function`).
- Layers: `fixed` (ground), `fence` (stops light props only), `terrain` (static steps and ramps from `addTerrain()`: convex hulls; the bird walks on them, the props rest on them), `heavy` (blocks the bird: the bin), `light` (the feet and head kick it: the ball), `limb` (the bird's kinematic foot and head spheres, from the rig), `ghost` (the bird's solid for the debug view; it collides with nothing). Use `filter.create()` and set `enabledObjectLayers[i] = 0`: `filter.createEmpty()` has a zero collision mask, and `disableObjectLayer()` also turns off the shared broadphase layer.
- Shove: rays ahead of the head find a heavy prop and set `controller.shove`. The animator puts the head down (the `brace` spring), so the forehead takes the weight and the beak points down. The head sphere in `BIRD.head` sits where the brace puts the head. Change both. The brace distance grows with speed (`BIRD.braceAhead`), so a run braces as a walk does. The rays must reach past the bill in the run pose (`look.ahead`), or the room check stops the bird first.
- Room: each sub step, `makeRoom()` casts rays to the posed head and bill (`BIRD.reach`, from `skullBill()` in `model.glsl`). The bird steps back by the overlap, and the prop gets a push. This keeps the beak out of the bin in actions (peck, threat).
- Push: whatever stops the bird (the forehead from `shove()`, or the bill from `makeRoom()`) takes the push in `push()`, always at forehead height (a low push slides the bin and does not tip it). Every bird push goes through `pushUpTo()`: it stops where the contact point moves at the bird's speed (`BIRD.bounce` times that for the first bump), with the effective mass at the point, turn included. Without this cap a bump threw the bin like it had no weight. Both checks run every sub step. There is no brace and no push in the air: the bird has nothing to push from, and it must be able to land on a prop.
- Push tuning: `BIRD.shove` (steady push for each unit of speed: a walk stays below the tip force of the bin, a run is above it) and `BIRD.bump` (one impulse when the forehead first touches: the walk rock).
- Floor: `feetGround()` casts rays (`groundAt()`) down from `GROUND.stepUp` above each foot and toe tip (`GROUND.toes`) onto terrain and heavy props. It sets `controller.feet` (height plus `BIRD.clear`, and the surface normal) and `controller.floor` (the highest). One ray under the root lets the toes sink into a sloped top. The controller lands on the floor and falls (event `fall`, no flutter) when the bird walks off the edge. The pose lifts the bird by `position.y`. Footprints are skipped where the foot's ground is above 0.05. The ground rays do not treat a convex shape as solid: a ray that starts inside a wall goes through it, so a top above `stepUp` is not a floor.
- Jump: the flutter (`JUMP.flutter`, `JUMP.flutterRise`) reaches about 2.0, enough for the top of a fallen bin (1.5 to 1.7).
- Demo bounds: `controller.bounds` is a world box `{ x, z }`. In free play it is `PLAY` in `street.js`: the street from one footpath to the other, road included. The fence for light props is 0.5 outside it.
- Demo camera: in free play, `follow()` moves the camera and its orbit centre together toward the bird when the bird leaves the screen dead zone (`DEAD_ZONE`) or gets farther than `LEASH` from the orbit centre. Orbit with a drag still works. Fixed views (`t`, `yaw`) do not follow. The orbit can't take the camera below `CAM_MIN_Y` (`maxPolarAngle` is set each frame from the distance).
- The bin and its lid share a collision group (`newGroup()`), so they don't collide. The hinge has a soft position spring: the lid opens with the tilt and the spin of the bin (`BIN.flap`). Gravity alone keeps a lid shut in most falls.
- Slam dust: `Bin.update()` keeps the fastest spin of a fall with its velocities (`peak`). When the spin drops below `BIN.slam.keep` of it, the bin sends a `slam` event with points on its low edges, each with the speed of the hit there (v + w x r). Only the fast points (the top end) make dust, in `IbisEffects.burst()`. A check of two frames in a row missed hits that fell in one long frame. Edges within `BIN.slam.low` of the lowest corner count, as the open lid holds the top end up a little.
- Bird dust starts at `controller.floor`, so a landing on the bin puts its dust on the bin.
- The bin looks hollow: two flat dark squares on top of the tub (the inner wall and the depth) show when the lid opens. The bin is a solid box to the physics.
- A root move longer than `BIRD.teleport` in one sub step jumps, with no sweep: a long kcc sweep can stall the page.
- A sleeping body ignores a new hinge target. Wake it with an impulse if you drive the lid from code.
- A scaled sphere does not collide as an ellipsoid: the ball is a convex hull of points on the ellipsoid.
- The ground body needs its own friction. crashcat combines the two values, and the default ground friction lets the bin slide where it must tip.
- Demo: props are on in free play. `props=0` turns them off, `physics=1` shows wireframes of the colliders (the debug renderer loads only then). `window.demo` has `physics`, `props`, `fx`, `camera` and `controls` for the console and the tools.

## Bake and pack

- `SIMPLIFY_ERROR = 0.003` gives about 8k triangles. 0.0015 gives about 15k with no visible gain. 0.005 makes the beak and head look faceted.
- The simplifier sees two vertices at one position as a seam, not a border. `LockBorder` alone does not hold material lines. `simplify()` locks material line points `LINE_LOCK_SPACING` (0.02) apart, so the lines keep their curves.
- `pack.mjs` stores `_MAT`, `_GROUP`, `_LINE` and `JOINTS_0` as bytes, `NORMAL` and `_OUTLINE` as 8-bit vectors, then compresses with meshopt. Current file: about 8k triangles, 95 KB.
- POSITION must stay float in character units. The shaders read the raw bind position (`eyeSpace(position)`, `stroke(position)`). `KHR_mesh_quantization` on positions changes the units and breaks the eyes and the line widths.
- `loadIbis()` needs `setMeshoptDecoder(MeshoptDecoder)` from `three/examples/jsm/libs/meshopt_decoder.module.js`.

## Known traps

- The mesh is not on the SDF surface. The error is up to `SIMPLIFY_ERROR`. A runtime SDF test at `vPos` can get the wrong sign. Example: `overLine()` uses `abs(miss)` for the wings, because the torso can sit just inside a wing. Do not use `abs` for the scarf: its solid stand-in is larger than the drawn scarf, and `abs` opens a gap at its outline.
- Constants are copied between `rig.js` and `model.glsl` (`WING_FOLD`, `NECK_BASE`, `HEAD_SCALE`, the toe directions and lengths in `toeDir()` and `toeLength()`, the jaw hinge). Change both.
- The renderer needs a stencil buffer (`stencil: true`).
- Do not give `smin()` a far value such as `1e9`. It computes `mix(b, a, h)`, and in float that loses `a`. Use about `10.0`. Example: the head part in `bake.glsl`.
- In `bake.glsl`, Chrome on Metal gave zeros for `idx / 32` in the palette mode, so the bake wrote a black palette. It uses `idx >> 5` and `idx & 31`. After a bake, check that the game mesh has its colours.
- `npm run bench` measures wall time. When another tab or app renders (the demo open in a browser), it can read 5 to 10 times too high, with no pattern. For costs, use GPU timer queries (`EXT_disjoint_timer_query_webgl2`) round `window.demo.render()`, and take the median. Free play at 1200x800: about 1.2 ms GPU with no environment, about 4 ms with the street, sky, backdrop, grade and the 4096 shadow map. Keep a large budget free for the props and set pieces to come.
- Bone count is 27 (`BONES` in `rig.js`). Byte joints allow up to 256.
- `npm` and `npx` can be slow here. Run long installs in the background.

## Check a change

1. Define what must look different and what must not.
2. Render `sdf.html` and `index.html` with the same parameters before and after.
3. For "no visible change" claims, diff the PNGs pixel by pixel in headless Chrome (canvas `getImageData`), and count pixels that differ by more than 8 and by more than 64 of 255.
4. Check at least: idle front (`anim=1&t=0.5`), side, back, squawk side (`anim=4&t=0.5&yaw=1.6`), and flap open (`anim=5&t=0.1`). For motion, look at a filmstrip (`npm run strip`).
5. Run `npm run build`.

## Environment

- Scale: the bird is 2 units, so 1 unit is about 35 cm. Keep the street in rough proportion, a little smaller than real, as in a cartoon: footpath 3, nature strip 6, road 14, bin 3 tall.
- Layout: strips along x (`STRIPS` in `street.js`). The road is on the -z side, so the default camera looks across the nature strip and the road. The bird starts on the nature strip.
- The ground is one plane that follows the camera. Its shader draws the strips in world space, with the sun shadow from `TOON`. It writes no depth and draws first (`renderOrder -1`), as the old ground, so the outlines round the feet and the footprints still work.
- Road: dark slate (`COLOURS.road` in `street.js`), so the light kerbs and the grass stand out.
- Grass (`street.js`): the sunny and lush patches have hard toon edges, one pixel wide. `GRASS` (`grassPatches()`, `grassColour()`) is shared by the ground and the tufts, so a tuft root has the colour of the ground under it. `#define FRAGMENT` before the chunk in a fragment shader turns on the pixel-wide edge (the vertex shader has no `fwidth`).
- Painted marks (`MARKS` in `street.js`): small tufts drawn flat in the ground shader in some cells of a grid, stretched so they look upright to the camera. `BLADES` (`tuft()`) gives the same shape as the 3D tufts. Each pixel tests 2 by 2 cells, so a mark must stay inside half a cell (the stretch is clamped at a low view). They are off past the patch fade (`near`).
- Pebbles (`PEBBLES` in `street.js`): round mounds in the ground shader near the strip edges (more nearer an edge, from the root's `edgeDistance()`), upright to the camera as the marks: light top, cool underside, small contact shadow. Not on the kerbs and the road: pale dots there read as road marks. Flat ovals on the ground were thin slivers at the play camera.
- Cracks (`CRACKS` in `street.js`): in some footpath slabs, a cartoon zigzag of three straight strokes from one side. Only footpath pixels run the code. Small tufts grow in some footpath joints (`TUFTS.joints`).
- Ground cost: the grass patches and the marks run only near a grass strip (`onGrass`, with a margin wide enough that the branch edge has no grass weight), the cracks only on the footpaths, the pebbles only near an edge and not on the kerbs and the road.
- `Upright` in the ground shader: the frame for the marks and the pebbles, made once in `main()`, outside any branch, because `fwidth()` in a branch is undefined in GLSL.
- Warm and cool: the lit ground colours are warm (yellow-green, peach), the shade colours cool (teal, lavender), far apart on purpose. `GRADE` adds to it: a cool lavender lift in the dark parts, a warm gain in the light parts.
- Tufts (`tufts.js`): one family, from thin grass (light, warm) to a few wide leaves (darker, cooler), from `aLeafy`. Each tuft is one flat green (a cooler one in the sun's shadow). A two-tone split per leaf looked too busy, and a light normal (ball or cylinder) split the tufts with a flat line across: do not go back to them. The root colour comes from `grassPatches()` in the vertex shader, once for each tuft. Placement by rules in `place()`: clusters (one big tuft, small ones round it, one kind) where a value noise is high, and runs along the strip edges with gaps. Wind: waves in world space and a small flutter, a shear of the quad top (`TUFTS.wind`). The birds push tufts aside (`uBirds`, up to 4, from `update(camera, dt, ibises)`). `alphaToCoverage` gives soft edges with the multisampled target of `grade.js`, with no sorting. Far tufts shrink to nothing at `TUFTS.fade`. About 750 tufts, one draw call. Cost: the tufts and the marks add about 0.1 ms GPU in free play at 1200x800 (measured under load: check again).
- The sky is a sphere that follows the camera, drawn before the ground (`renderOrder -2`), with no depth test. Clouds are circles in azimuth and elevation (`CLOUDS`, made with `hash()`). The far hills and trees are bands in the sky shader, with soft edges as a fake depth of field.
- Far ground fades to `HAZE` (pale sage), and the sky fills below the trees with the same colour, so the ground meets the horizon band. A blue haze read as a lake.
- Colours: picked from the concept art with a colour picker. Warm in the sun (yellow-green grass, peach footpath), cool in the shade (teal grass, lavender footpath). Tune against the concept, not by eye alone.
- Backdrop: the horizon must be close, or the street feels empty. Two rings of upright quads along rounded boxes (`RINGS`): a near green one just past the yards, and a taller, hazier one behind it. The shader cuts a canopy line (slow crowns plus round clumps) and shades the clumps. Transparent, soft edges, no depth write. The quads stop at the highest canopy, so the empty part costs nothing.
- Clouds: few (`CLOUDS.count` 5) and low, so the hills and the trees cover their feet. Each is a wide flat ellipse base, a dome off centre and a small bump on each side, white with a pale cool underside and a faint shade on the dome away from the sun. Keep them simple: puffy clouds of many circles looked busy. Cloud white stays a little below 1.0.
- Grade (`grade.js`): lifts dark parts toward lavender, warms light parts (not blue ones, or the sky goes teal), adds a little saturation and a warm vignette. It runs only with `env`, so the fixed views are unchanged. About 1 ms; the sky is about 1 ms more. The three.js `EffectComposer` with `UnrealBloomPass` cost about 5 ms: do not use it for a faint glow.
- Fixed views keep the plain background (`env=0`), so they still match `sdf.html`. `env=1` turns the street on for screenshots.
- Plan for later phases: midground fences, letterbox, bushes and a street tree (toon meshes as in `props.js`, gobo noise for dappled shade); a backdrop of houses drawn to a half-size render target and blurred (depth of field); footprint and dust style for each surface.
