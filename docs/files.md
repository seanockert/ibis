# Files

What each source file does.

| File | Purpose |
|---|---|
| `src/sdf/model.glsl` | SDF parts, material ids (`MAT_*`), `paletteSrgb()` colours, `wingSeam()`. The part functions that the bake and the game shaders call by name (`body`, `tail`, `bodyMat`, `tailMat`, `skullMat`, ...) |
| `src/sdf/library.glsl` | SDF primitives (`sdEllipsoid`, `smin`, ...), shared by the game shader, the bake and `sdf.html` |
| `src/sdf/eye.glsl` | Eye and lid functions (`lidCover()`, `lidCrease()`, `pupilIn()`), shared by `model.glsl` and the runtime shaders. The eye constants (`EYE_C`, `EYE_R`, `LID_OPEN`, `PUPIL_DIR`, `PUPIL_R`) come from `eye` of the bird first. `gl.js` and `materials.js` include it before `model.glsl` |
| `src/birds.js` | `BIRDS` by name, `pageBird()`: the `bird` URL parameter |
| `src/ibis/bird.js` | `IBIS`: the ibis as a bird for the shared code: model, `SHAPE`, `MAT`, eye constants, `scarf`, `headGroup`, `solid`, `view` (close camera) |
| `src/miner/flight.js` | `Flight`: the miner in the air. It circles over a centre (flap and glide, bank into the turn) and dives at a target (`dive()`): it turns toward the target, takes aim at where it is then, and dives in a straight line, faster on the way down. It does not follow the target, so a target that moves gets missed. Then it climbs back in an arc (a Hermite curve). `land(at)`: an arc down onto a point with a flare, then it stands (the ibis idle clip). `settle(at)`: on the perch at once. On a perch it turns to face `watch`, and `agitation` makes it bob, flick its wings and glare. `call(kind)`: the bill opens, event `call`. `takeOff()`: a crouch, a jump up and back to the circle. Event `hit` when the body passes the target. `FLIGHT` tuning. `flightDemo()`: the dives of the `fly` views |
| `src/miner/flier.js` | `Flier`: an `Ibis` mesh moved by a `Flight`. `centre()`: the middle of the body, world |
| `src/characters/sentry.js` | `Sentry`: the brain of the fliers. Each one guards a territory round the highest perch near its home (a fence post top: `Fence.perches()`; a tree perch branch: `Plants.perches()`; a bin or a box: `perch()` on the prop). States: watch, alert (it faces the player and calls), attack (it circles over the player and dives at its head, one at a time), back (it flies back and lands). Noise from runs, crashes and squawks makes it notice from farther and attack sooner. `SENTRY` |
| `src/miner/bird.js`, `src/miner/model.glsl`, `src/miner/materialIds.js` | `MINER`: the noisy miner. Its own SDF model, shape and ids on the ibis rig and motion. `MINER_SCALE`: its size in the game. Mesh: `public/miner.glb` |
| `src/sdf/raymarch.glsl` | Reference renderer for `sdf.html`, with its view helpers (camera, colour, dither, debug, `palette()`). `DEBUG_MODE` shows ids, normals and masks |
| `src/ibis/rig.js` | `Pose`, authored clips (`idle peck squawk`), `SHAPE` (the ibis body sizes), `solveRig()`, `boneMatrices()`, `rigUniforms()`, `bindPose()`. The solve takes the shape of a bird, the ibis by default |
| `src/ibis/motion/spring.js` | `Spring` (implicit, stable at any dt), easing, `hash()` (seeded random) |
| `src/ibis/motion/controller.js` | `Controller`: input to position, heading, speed, jump and flutter. `MOVE`, `JUMP` tuning |
| `src/ibis/motion/animator.js` | `Animator`: the layer stack that makes the Pose. `GAIT` tuning |
| `src/ibis/motion/actions.js` | `ACTIONS` (one-shot moves), `FACES` (expressions), `CHANNELS` (mask groups) |
| `src/ibis/motion/character.js` | `Character`: controller and animator at a fixed 120 Hz sub step. Prod reactions (flinch, glare, head shake, shake, startle). `strike()`: a blow from a diving miner, a stumble at any speed on the ground. `trip()`: a stumble when the bird is prodded at a run (`TRIP_SPEED`), or sometimes when it runs into a heavy prop at a full run (`knock()` from `physics.js`, `KNOCK_TRIP`); other knocks are a headbutt push |
| `src/ibis/effects.js` | `IbisEffects`: dust puffs, footprints and comic anger lines, driven by character events and state. `alertMarks()`: the `?` and `!` over the miners |
| `src/ibis/sound.js` | `IbisSound`: Web Audio sounds from character and prop events, and the noisy miner's calls (`minerCall()`). Recordings: `public/sfx/honk.m4a`, `miner-chip.m4a`, `miner-scold.m4a` |
| `src/moves.js` | Demo moves: buttons, `anim=N` scripts, `scriptedCharacter()` for fixed-time poses |
| `src/ibis/materialIds.js` | `MAT` ids for JS. Must match `MAT_*` in `model.glsl` |
| `src/ibis/materials.js` | Runtime shaders: body (cel shading, eye, lids, wing and scarf lines), hull outline, border lines |
| `src/ibis/Ibis.js` | `loadIbis(bird)`, `Ibis` class (any bird, with a `scale`), part groups, stencil setup, border line geometry |
| `src/main.js` | Entry of `index.html`: reads the config, makes the stage and the level, runs the frame loop. Free play, or the other views (fixed time, fixed camera, grid, bench) |
| `src/app/config.js` | `readConfig()`: the URL parameters, read once. `LITE` |
| `src/app/stage.js` | `Stage`: renderer, scene, camera and orbit controls, sun and shadow (`SHADOW`, `shadowTo()`), grade, plain ground, `keepAbove()` (`CAM_MIN_Y`) |
| `src/app/follow.js` | `Follow`: the free play camera follow, the swing behind the bird, the recentre and the glance toward a point out of view. `CAMERA` |
| `src/app/input.js` | `Input`: keys, joystick (walks, runs when pushed far, `STICK_RUN`), tap to walk, tap to prod, joystick tap to recentre (`STICK_TAP`) |
| `src/app/meter.js` | `Meter`: the frame meter, top left in free play: frame time, fps, CPU and GPU time (timer queries) |
| `src/app/ui.js` | `Ui`: free play Threat, Squawk, Peck and Jump diamond (hold Jump to flutter), the other action (Shake) in the top bar after the time of day. Other views: one button for each move |
| `src/app/screen.js` | `lockScreen()`: stops browser zoom and page gestures on touch screens (iOS ignores `user-scalable=no` and `touch-action` for a second-finger double tap), full screen on the first touch where it can. Touch gives no click, so `ui.js` buttons act on pointerdown for touch. The canvas fills `100lvh` (under the iOS Safari bars); `Stage` sizes from the canvas, not `innerHeight`. Manifest and icons: `public/manifest.webmanifest`, `public/icon-*.png` |
| `src/sw.js` | Service worker: the built game starts offline. `swPlugin` in `vite.config.js` adds `VERSION` and `FILES` (every file in `dist`) and writes `dist/sw.js`. Cache first. Registered only in the build, so the dev server and the tools always get fresh files. Cache matches use `ignoreVary`: Vite's module scripts are `crossorigin`, and a server that sends `Vary: Origin` makes the match miss |
| `src/levels/suburb.json` | The suburb level as JSON: the street area and the park (a land area) behind the near fence (format in `docs/levels.md`) |
| `src/levels/meadow.json` | A small land-only level, to test levels with no street (`?level=meadow`) |
| `src/levels/load.js` | `buildLevel()`: level JSON to the definition that `Level` takes. Checks the names. `LEVELS`: every level file by name. `joinGrounds()`: the street with the land areas over it |
| `src/levels/areas.js` | `AREAS`: area types (`street`, `land`) to their ground and scenery. `plantRows()` |
| `src/world/level.js` | `Level`: makes a level from data, steps characters, brains, physics and props, and mud splashes, and sends events to effects and sounds. Mud and wet targets for each character |
| `src/world/place.js` | `stack()`: the base height of each prop from the ground and the props before it, so props stack and never start inside each other |
| `src/world/kinds.js` | `PROPS`: prop kind names in level data to classes |
| `src/world/gate.js` | `Gate`: a swing gate in a fence gap: a leaf on a hinge with a spring back to shut, a hinge creak as it opens, rust round the hinges. `GATE` |
| `src/characters/species.js` | `SPECIES`: species names in level data to makers. The ibis, and the miner on the ground (it only stands). `FLIERS`: the miner in the air |
| `src/characters/wander.js` | `Wander`: a brain that walks a character to random points near its home. `WANDER` |
| `src/world/physics.js` | `Physics`: the crashcat world, the bird's solid, shove and room. The only file that imports crashcat |
| `src/world/props.js` | `Ball` (AFL football), `Bin` (wheelie bin with a hinged lid), `Box` (cardboard box with two hinged flaps, `CARTON`) and `Cereal` (`CEREAL`): bodies and toon meshes. `Tub` and `Flap` (the bin and the boxes: a hollow body with hinged flaps), `Slam` (dust and sound when a prop falls over hard), `Rest` (a prop whose bodies sleep does no work), `toonParts()` (the parts of one body as two draws). `SEE_THROUGH`: the fade of the props, the fence and the plants where the camera is in them (`seeIds()`: the objects of one mesh that fade) |
| `src/world/highlight.js` | `Highlight`: a thick white outline round the prop that a peck would pick up now (`Physics.target()`, `hull(id)` on the prop). `HIGHLIGHT` |
| `src/world/util.js` | `srgb()` (a colour from sRGB values) and `f()` (a number as a GLSL float), for the world files |
| `src/world/sprinkler.js` | `Sprinkler`: an oscillating lawn sprinkler on a hose (a light prop) from a tap with a handle that a peck turns (a switch): a drop spray (one instanced draw, flights in the vertex shader), soak events, and a wet patch on the ground (`GROUND_WET`). `SPRINKLER` |
| `src/world/stubbies.js` | `Stubbies`: ten empty beer stubbies as bowling pins, see-through glass, four instanced draws. `STUBBY`, `GLASS` |
| `src/world/land.js` | `Field` (heights and dirt and mud from the features of a land area, on a grid), `Land` (its mesh, shader and physics mesh), `wildTufts()`. `LAND` |
| `src/world/terrain.js` | `Terrain`: a test course (steps, a top, a ramp) of static prisms, for the foot placement. `COURSE` |
| `src/world/street.js` | `Street`: the ground mesh and shader (grass, footpath, kerb, road strips along x), `STRIPS`, `KERB`, `PROFILE` (heights across z), `streetHeight()`, `PLAY` (the play area box) |
| `src/world/plants.js` | `Plants`: trees and shrubs (`PLANTS`: gum, bottlebrush, shrub), each grown from a seed (branches, clumps, flowers). In chunks along x (four draws each). Bark and flowers through `toonParts()`; leaves are balls with their own toon shader, hidden triangles left out, and an outline only round the outside of a crown. A plant in `PLAY` gets a solid trunk on the `terrain` layer |
| `src/world/farShadow.js` | `renderFarShadow()`: a static sun shadow map of the plants (`FAR_LAYER`) over the whole level, drawn once. `sunShadow()` uses it past the sun's map |
| `src/world/wind.js` | `WIND`, `sway()` (GLSL), `windDepthMaterial()`: the plants sway in the wind, with their outlines and shadows. `wind: true` on the prop toon materials turns it on |
| `src/world/fence.js` | `Fence`: white posts, a top rail and chain wire along the runs of the level data (`FENCE`), with a gap for each gate on a run (`fenceRuns()`). Instanced toon posts and rails; the wire is a shader pattern. With physics, a static wall on the `terrain` layer |
| `src/world/mud.js` | The shared mud model for land mud (`land.js`): `splashMud()` (`SPLASH`), `Ripples` (rings), `MUD_WATER` and `mudUniforms()` (the water and its colours) |
| `src/world/ambience.js` | `Ambience`: background sounds of a level: cicadas and a far lawnmower by day, crickets and frogs at night. `AMBIENCE` tuning |
| `src/world/flies.js` | `Flies`: flies round the lid of a bin (`flies: N` or `[min, max]` on a prop). They dart and land on the lid, scatter from a bird or a bin that moves, and come back one by one. One instanced draw. `buzz` for the sound. `FLIES` tuning |
| `src/world/clover.js` | `Clover`: clover patches (`clover` of an area in the level JSON), one toon draw. `height(x, z)`. Makes the `Bees` |
| `src/world/bees.js` | `Bees`: bees on the clover, one instanced draw. `BEES` tuning |
| `src/world/insects.js` | Shared by flies and bees: `insect()`, `rand()`, `seek()`, `move()`, `awayFrom()`, `quads()`, `INSECT` GLSL |
| `src/world/noise.js` | `noise2()` (GLSL `NOISE_TEX`, `noiseUniform`): value noise from a tiling texture, for the ground and the tufts |
| `src/world/tufts.js` | `Tufts`: grass tufts, one instanced draw of upright quads turned to the camera about y. `TUFTS` tuning |
| `src/world/lighting.js` | `LIGHT` (shared uniforms: night, lamp slots, lamp shadow atlas), `LIGHT_GLSL` (`lampLight()`, `night()`, `toonLit()`, in `TOON`), `DayNight` (turns the sun to the moon) |
| `src/world/lamps.js` | `Lamps`: street lamps (pole, arm, head, lens, halo, beam), the slots of the nearest lit lamps and their shadow atlas tiles |
| `src/world/sky.js` | `Sky`: sky dome shader (gradient, warm glow toward the sun, puff clouds, far hills and trees), `HAZE` |
| `src/world/backdrop.js` | `Backdrop`: two rings of tree silhouettes round the street (`RINGS`), so the world ends past the yards |
| `src/world/grade.js` | `Grade`: the scene to a multisampled target, then one colour grade pass to the canvas. `GRADE` tuning |
| `tools/bake/bake.js` | Bake: grid, dual contouring, material split, simplify, normals, skin weights, GLB export |
| `tools/bake/bake.glsl` | Bake kernel: which SDF each `PART_*` is |
| `tools/pack.mjs` | Small vertex types and `EXT_meshopt_compression` |
| `tools/shot.mjs`, `tools/strip.mjs`, `tools/bench.mjs`, `tools/gpu.mjs`, `tools/playshot.mjs` | Headless screenshot, filmstrip of a move, wall time, GPU time of free play (timer queries), free play screenshot |
