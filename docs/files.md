# Files

What each source file does.

| File | Purpose |
|---|---|
| `src/sdf/model.glsl` | SDF parts, material ids (`MAT_*`), `paletteSrgb()` colours, `wingSeam()` |
| `src/sdf/library.glsl` | SDF primitives (`sdEllipsoid`, `smin`, ...), shared by the game shader, the bake and `sdf.html` |
| `src/sdf/eye.glsl` | Eye and lid shapes (`EYE_C`, `EYE_R`, `lidCover()`, `lidCrease()`, `pupilIn()`), shared by `model.glsl` and the runtime shaders. `gl.js` and `materials.js` include it before `model.glsl` |
| `src/sdf/raymarch.glsl` | Reference renderer for `sdf.html`, with its view helpers (camera, colour, dither, debug, `palette()`). `DEBUG_MODE` shows ids, normals and masks |
| `src/ibis/rig.js` | `Pose`, authored clips (`idle peck squawk`), `solveRig()`, `boneMatrices()`, `rigUniforms()` |
| `src/ibis/motion/spring.js` | `Spring` (implicit, stable at any dt), easing, `hash()` (seeded random) |
| `src/ibis/motion/controller.js` | `Controller`: input to position, heading, speed, jump and flutter. `MOVE`, `JUMP` tuning |
| `src/ibis/motion/animator.js` | `Animator`: the layer stack that makes the Pose. `GAIT` tuning |
| `src/ibis/motion/actions.js` | `ACTIONS` (one-shot moves), `FACES` (expressions), `CHANNELS` (mask groups) |
| `src/ibis/motion/character.js` | `Character`: controller and animator at a fixed 120 Hz sub step. Prod reactions (flinch, glare, head shake, shake, startle). `trip()`: a stumble when the bird is prodded at a run (`TRIP_SPEED`), or sometimes when it runs into a heavy prop at a full run (`knock()` from `physics.js`, `KNOCK_TRIP`); other knocks are a headbutt push |
| `src/ibis/effects.js` | `IbisEffects`: dust puffs, footprints and comic anger lines, driven by character events and state |
| `src/ibis/sound.js` | `IbisSound`: Web Audio sounds from character and prop events. `public/sfx/honk.m4a` is the only file |
| `src/moves.js` | Demo moves: buttons, `anim=N` scripts, `scriptedCharacter()` for fixed-time poses |
| `src/ibis/materialIds.js` | `MAT` ids for JS. Must match `MAT_*` in `model.glsl` |
| `src/ibis/materials.js` | Runtime shaders: body (cel shading, eye, lids, wing and scarf lines), hull outline, border lines |
| `src/ibis/Ibis.js` | `loadIbis()`, `Ibis` class, part groups, stencil setup, border line geometry |
| `src/demo.js` | Demo page and URL parameters. Free play UI: joystick (bottom left: walks, runs when pushed far, `STICK_RUN`), Threat, Squawk, Peck and Jump diamond (bottom right; hold Jump to flutter; Squawk gives a squawk and a happy dance in turn), the other action (Shake) in the top bar after Wet. Other views: one button for each move |
| `src/world/physics.js` | `Physics`: the crashcat world, the bird's solid, shove and room. The only file that imports crashcat |
| `src/world/props.js` | `Ball` (AFL football), `Bin` (wheelie bin with a hinged lid), `Box` (cardboard box with two hinged flaps, `CARTON`) and `Cereal` (`CEREAL`): bodies and toon meshes. `Tub` and `Flap` (the bin and the boxes: a hollow body with hinged flaps), `Slam` (dust and sound when a prop falls over hard), `Rest` (a prop whose bodies sleep does no work), `toonParts()` (the parts of one body as two draws) |
| `src/world/util.js` | `srgb()` (a colour from sRGB values) and `f()` (a number as a GLSL float), for the world files |
| `src/world/stubbies.js` | `Stubbies`: ten empty beer stubbies as bowling pins, see-through glass, four instanced draws. `STUBBY`, `GLASS` |
| `src/world/terrain.js` | `Terrain`: a test course (steps, a top, a ramp) of static prisms, for the foot placement. `COURSE` |
| `src/world/street.js` | `Street`: the ground mesh and shader (grass, footpath, kerb, road strips along x), `STRIPS`, `KERB`, `PROFILE` (heights across z), `streetHeight()`, `PLAY` (the play area box) |
| `src/world/fence.js` | `Fence`: white posts, a top rail and chain wire along the yard edges of the two footpaths (`FENCE`), none at the ends. Instanced toon posts and rails; the wire is a shader pattern. With physics, a static wall on the `terrain` layer |
| `src/world/puddle.js` | `Puddle`: a muddy puddle on the nature strip (`PUDDLE`, `shape()`), splash events from steps and landings, ripples. `SPLASH`, `splashMud()`: the mud a splash puts on the bird |
| `src/world/tufts.js` | `Tufts`: grass tufts, one instanced draw of upright quads turned to the camera about y. `TUFTS` tuning |
| `src/world/sky.js` | `Sky`: sky dome shader (gradient, warm glow toward the sun, puff clouds, far hills and trees), `HAZE` |
| `src/world/backdrop.js` | `Backdrop`: two rings of tree silhouettes round the street (`RINGS`), so the world ends past the yards |
| `src/world/grade.js` | `Grade`: the scene to a multisampled target, then one colour grade pass to the canvas. `GRADE` tuning |
| `tools/bake/bake.js` | Bake: grid, dual contouring, material split, simplify, normals, skin weights, GLB export |
| `tools/bake/bake.glsl` | Bake kernel: which SDF each `PART_*` is |
| `tools/pack.mjs` | Small vertex types and `EXT_meshopt_compression` |
| `tools/shot.mjs`, `tools/strip.mjs`, `tools/bench.mjs` | Headless screenshot, filmstrip of a move, GPU timing |
