# Ibis

A toon-shaded Australian white ibis character for three.js games.

The shape is an SDF model (`src/sdf/model.glsl`).
A bake step turns the SDF into a skinned mesh (`public/ibis.glb`).
The game draws the mesh with toon materials and an outline. A procedural motion system (`src/ibis/motion/`) moves it and a JS rig poses it.

## Commands

```sh
npm install
npm run dev     # demo at /index.html, SDF reference view at /sdf.html
npm run bake    # SDF -> public/ibis.glb (about 90 s)
npm run bake -- miner   # the noisy miner: src/miner/model.glsl -> public/miner.glb
npm run build   # production build of the demo
npm run shot -- out.png "index.html?anim=2&t=0.4" 700x700
npm run strip -- out.png "index.html?anim=7&yaw=1.3&pitch=0.1" 0 1.2 12   # filmstrip of a move
npm run bench -- "index.html?anim=2" 1280x800 60
```

`moves.html` shows every move of the ibis in a grid of cards, by group. Click a card to start its move again.

Page parameters: `anim` (a move from `src/moves.js`, index + 1: 1 idle, 2 walk, 3 peck, 4 squawk, 5 run, 6 jump, 7 happy, 8 shake head, 9 threat, 10 startle, 11 stumble, 12 shake, 13 turn, 14 prod, 15 lunge jab, 16 duck, 17 snap, 18 pick up, 19 fumble, 20 drop, 21 aim and fling, 22 side throw, 23 tug, 24 rummage, 25 catch, 26 toss, 27 gulp, 28 flinch, 29 bonk, 30 whiff, 31 knocked over, 32 slip, 33 hard landing, 34 faint, 35 glare, 36 burp, 37 preen, 38 wing stretch), `t` (fixed time), `yaw` and `pitch` (fixed camera), `count` (number of ibises, demo only), `ui=0` (no buttons), `bird=miner` (show the noisy miner in the fixed views and in `sdf.html`), `fly=1` or `fly=2` with `bird=miner` (the miner flies on the spot, or dives).

Demo controls: WASD or the arrow keys walk, Shift runs, Space jumps (hold it to flutter; double-tap it, or the Jump button, to shake), E pecks (hold it with something in the bill to aim, let go to fling), Q squawks. Tap the ground to walk there. Tap the bird to prod it: it looks away, then glares, then shakes, then threatens. Drag to orbit. The camera swings behind the bird as it moves, and waits 2 s after a drag. On a touch screen, tap the middle of the joystick to turn the camera behind the bird.
Use the same parameters on `index.html` and `sdf.html` to compare the mesh with the SDF.

Game prototypes: `index.html?level=fling` (the fling toy: throw lemons at the miners) and `index.html?level=barbie` (hide in the rubbish). See `docs/game-findings.md`.

## Use in a game

```js
import { IBIS } from './ibis/bird.js';
import { Ibis, loadIbis } from './ibis/Ibis.js';

const asset = await loadIbis(IBIS);          // load one time: public/ibis.glb
const ibis = new Ibis(asset);                // one for each character
scene.add(ibis.object);

// In the frame loop: set the input as a player would, then update.
ibis.input.move.set(x, z);   // wanted direction on the ground, length 0 to 1
ibis.input.fast = running;
ibis.input.jump = jumpHeld;  // hold to flutter
ibis.update(dt);             // moves ibis.object to the character's position and heading

ibis.act('happy');           // happy, headShake, threat, startle, stumble, shake, glare, flinch, peck, squawk
ibis.prod(worldPoint);       // a poke: the reaction gets stronger with each prod
ibis.character.turnTo(heading);
ibis.character.events;       // this frame: step, land, jump, flap, call, shakeOff, ...

// Dust puffs, footprints and comic anger lines, for all ibises:
const fx = new IbisEffects(asset);   // from './ibis/effects.js'
scene.add(fx.object);
fx.update(dt, [ibis], camera);       // after ibis.update(dt)

// Sound: steps, wing beats, landings, honks, hiss, bill clacks:
const sound = new IbisSound();       // from './ibis/sound.js'
sound.load('/sfx/honk.m4a');
sound.update([ibis], camera);        // after ibis.update(dt)
```

- The renderer must have a stencil buffer: `new THREE.WebGLRenderer({ stencil: true })`. The outline uses it.
- Draw a flat ground first (`renderOrder = -1`) and do not let it write depth (`depthWrite: false`). If the ground writes depth, it can cover the outline at the feet. `plainGround()` in `src/app/stage.js` shows a ground that also shows the shadow.
- `asset.sun` is the direction toward the sun, in world space. Set it to the direction of your shadow light.
- `ibis.mud` (0 clean to 1 mud up to the belly) and `ibis.wet` (0 dry to 1 soaked) change how the ibis looks. Each ibis has its own values. Change them over time in your game, for example up while the ibis is in mud or rain and down after.
- `ibis.setPose(pose)` sets a pose directly. Make a pose with `restPose()`, `clipPose()` or `mixPose()` from `src/ibis/rig.js`. Set `ibis.inPlace = true` to keep your own transform on `ibis.object`.
- The body casts a shadow. To show the shadow, the scene must have a light with `castShadow`.
- Character units: the ibis is about 2 units tall. Its feet are on y = 0 and the beak points to +z.

## How it works

### Motion (`src/ibis/motion/`)

- `Controller`: input to position, heading and speed, with acceleration, a turn rate, and a slow-down in sharp turns, so a reverse turns on the spot. The jump has a 0.06 s crouch, a variable height (let go early for a hop), a jump buffer, and a flutter while the button is held (as in Yoshi's flutter jump).
- `Animator`: makes the Pose in layers.
  1. Base: the idle clip, the waddle (a gait from the speed, with no foot slide, slow and fast, and an occasional scuffed step), and the air pose.
  2. Face: an expression for the state, smoothed.
  3. Actions: one-shot moves with channel masks. While the bird walks, an action plays on the upper body only.
  4. Secondary: the eyes lead, the head follows, the body turns last. Lean into speed changes and turns. Squash and stretch, hit reactions and wing flicks on springs. Random blinks, and a blink on big turns.
- `ACTIONS` and `FACES` in `actions.js` are data. Add a move there.
- Feet on the ground stay fixed in the world, so they never slide. Turns pivot on the foot that carries the weight.
- `IbisEffects` (`src/ibis/effects.js`) adds dust when the bird runs, skids, lands or falls, footprints that fade away (dusty, wet or muddy, from `ibis.mud` and `ibis.wet`), and comic anger lines round the head in angry actions.
- `IbisSound` (`src/ibis/sound.js`) plays sounds from the same events. The honk is a recording of about 6 KB (`public/sfx/honk.m4a`). The steps, wing beats, landings, hiss, clacks and bin slam are made with Web Audio, with no files.

### Rig (`src/ibis/rig.js`)

This file is the one source of the animation.
A `Pose` holds body bob, offset, lift and rotation, foot targets and toe splay, neck bend, reach and length, head turn and tilt, jaw, blink, lids, pupil size and look, and wing spread and sweep.
`solveRig()` turns a pose into joint positions, with two-bone IK for the legs.
The neck ends at the nape (the back of the skull), and the head turns about the nape.
`boneMatrices()` turns the joints into 27 bone matrices for the mesh.
The SDF view and the bake use the same `solveRig()` through the `g*` uniforms of `model.glsl`.

### Bake (`tools/bake/`)

The bake runs in headless Chrome and evaluates the SDF on the GPU.
For each part (body, neck, head, legs, wings, jaw, eyes, lids, scarf), it does these steps:

1. Samples the part's distance on a grid.
2. Makes a mesh with dual contouring, which keeps sharp edges sharp.
3. Splits the triangles on the true line where the material changes.
4. Simplifies the mesh with meshoptimizer (maximum error 0.003 units). The material lines stay locked.
5. Calculates normals from the SDF gradient, with split normals at sharp edges.
6. Calculates skin weights.

Then `tools/pack.mjs` makes the file small.
It stores ids and bone indices as bytes, and normals and outline normals as signed bytes.
It compresses the mesh with `EXT_meshopt_compression`.
Positions stay as floats, because the shaders use the bind position in character units.
`loadIbis()` decodes the file with the meshopt decoder from three.js.

The neck and the skull are separate meshes.
The head turns apart from the neck, so the neck slides into the skull, as it does in the SDF.

### Runtime (`src/ibis/`)

- `materials.js`: two-band cel shading with lit and shade colours for each material, from the SDF palette.
  The eye shader draws the pupil, the lid cut, the happy-eye crease and the line where the eye meets the skull.
- The outline uses two inverted hulls.
  The contour hull is wide (wider on the shadow side) and pushed back, so it shows only against surfaces that are far behind it.
  It does not go below the ground (y = 0), so the ground can't cover it at the feet.
  The inner hull is thin and pulled forward, so it shows where a part lies near another part.
  Each part group (torso and head, jaw, wings, legs, scarf) writes its own stencil value, and the inner hull of a group never draws over the same group, so it can't show through a thin part.
- The wings sink into the body, so a hull can't draw their lines.
  The body shader includes `src/sdf/model.glsl` and tests the real SDF with the current rig: the line is where a wing meets the body.
  Where a wing grows out of the back, the line gets thinner until it stops, so the wing blends into the body.
- The scarf lies close on the chest and neck. Torso pixels near it march toward the camera against the scarf's solid stand-in and draw a line where the ray passes close to the scarf, as the contour does in the SDF view.
  Torso pixels near the wings do the same march against the wings, so the wing edges get a full line over the body and the tail.
  The contours of the wings and the scarf do not draw over the torso.
  The line widens to the contour width where the scarf stands well off the torso. The scarf's contour hull does not draw over the torso.
- The scarf mesh is baked without the head carve, because the head moves apart from the scarf.
- The line width changes slowly along each line (smooth noise on the bind position), so the lines look hand-drawn. The pattern stays on the body when it moves.
- Lines along material borders (wing tips, mouth, scarf bands) are screen-space quads that the runtime makes from the mesh at load time.

### Physics (`src/world/`)

- `physics.js` runs a crashcat world (pure JS, about 76 KB gzip). The bird is a kinematic character controller: the controller still moves it, and props stop it.
- The bird pushes props: it kicks and pecks the football, and it puts its head down and shoves the wheelie bin. A walk rocks the bin. A run tips it over, and the lid flaps open.
- `props.js` has the `Ball` and the `Bin`, with toon meshes and outlines in the style of the ibis.
- In free play the props are on (a football, a wheelie bin, three cardboard boxes with flaps that swing open, two cereal boxes the bird can squash flat, and ten empty glass beer stubbies set up as bowling pins on the road). `props=0` turns them off, and `physics=1` shows the colliders.
- The road is lower than the footpaths and the grass, with a rolled kerb on each side. The bird walks down and up it, and the props roll off it.
- `terrain=1` adds a test course (steps and a ramp). The feet go onto uneven ground, and the body follows them.
- In free play the street and the sky are on. `env=0` turns them off, `env=1` turns them on in fixed views.

## Change the character

- To change the shape or the colours, edit `src/sdf/model.glsl`, then run `npm run bake`.
- The noisy miner is a second bird on the same rig: `src/miner/model.glsl` and `src/miner/bird.js`. Look at it with `sdf.html?bird=miner`, then run `npm run bake -- miner`. In free play three miners guard posts on the far fence, and one guards the street tree. When the ibis comes near, they call, then fly at it and dive at its head. A hit makes the ibis drop what it holds and stumble (`src/miner/flight.js`, `src/characters/sentry.js`).
- To change a clip, edit `src/ibis/rig.js`. To change a move, edit `src/ibis/motion/`. You do not have to bake again.
  You must bake again if you change `restPose()` or the rig dimensions, because the mesh is bound in the rest pose.

## Performance

Measured on an iMac (2017: Intel Core i5-7500, Radeon Pro 570) in headless Chrome, with `npm run bench` and 60 frames. Other processes were running, so the times can be high. The values are frame times, CPU and GPU, with shadows and 4x MSAA.

| View | 1280x800 | 1920x1080 |
|---|---|---|
| SDF raymarch, 1 ibis | 58.7 ms | 91.5 ms |
| Mesh, 1 ibis | 5.5 ms | 7.7 ms |
| Mesh, 100 ibises | 39.9 ms | |

The mesh has about 8,000 triangles and the GLB file is 95 KB.
The motion costs 12 to 28 µs and the rig solve about 20 µs for each ibis in each frame (Node, one core).
Each ibis uses 14 draw calls (5 body groups, 3 inner hull groups, 5 contour groups and the material lines) and 1 shadow draw.
