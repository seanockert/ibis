# Levels

Level data, prop placement, characters and brains, and the game shell (`src/main.js`, `src/app/`).
The props themselves are in `props.md`.
The physics is in `physics.md`.

## Structure

- `src/main.js` reads the config (`src/app/config.js`), makes the `Stage` and the `Level`, and runs the frame loop.
- Free play calls `level.populate()`: it makes the characters and the props of the level data.
- The other views (fixed time, fixed camera, the grid, the bench) do not populate. They add ibises in a grid with `level.add()`, and the props and the physics are off.
- Frame order: player input (`Input.apply()`) or a move script, then `level.update(dt, camera)`, then the camera (`Follow`, `shadowTo()`), then `level.updateView(camera, dt)`, then `stage.render()`.
- `level.updateView()` comes after the camera moves, because the ground and the sky follow the camera.

## Level data

- A level is a JSON file in `src/levels/`, as `suburb.json` or `meadow.json` (land only). `LEVELS` (`load.js`) holds every file there by name; `?level=meadow` picks one (default `suburb`). `buildLevel()` (`src/levels/load.js`) makes the definition that `Level` takes. A future level editor reads and writes the same JSON.
- Level keys: `id`, `sky` and `backdrop` (true: the `Sky` and the `Backdrop`), `ambience` (`mower`, `frogs`: `[x, z]`), `mission` (optional: `goal`, `need`, `win`; the mission view, `docs/game.md`; or `goal` and `challenges`: the challenge list of a toy, `src/app/challenges.js`), and `areas`: a list of areas.
- Area keys: `id`, `type` (a key of `AREAS` in `src/levels/areas.js`), `bounds` (`{ x, z }`), the scenery lists of its type, and `props`, `characters` and `fliers`.
  - `street`: the strips of `street.js`. `fences` (`[[x, z], [x, z]]` runs), `plants`, `lamps`, `clover` (the options of `Plants`, `Lamps`, `Clover`). A tree gets a mulch bed (gum 2.6, bottlebrush 2.0; `bed` sets the radius). The tufts grow round the lamps and the fence posts, and not in the beds, the clover or a gate's swing.
  - `land`: `box` and `features` (`land.md`), `plants`, `rows` (plants in a row), `clover`, `fences`. It owns the ground from `box.z[0]` to the near side; the street ends there.
- All places are world `[x, z]`. A `note` key is a comment: the loader ignores it.
- The loader throws on an unknown area type, prop kind or species, with the path (`Level suburb: areas[0].props[3]: unknown kind "x"`).
- Seeds: a plant, prop (fly count), character or flier takes its `seed`, or else its place in its list (plants: in the area's list; the others: in the level's list, areas in order). Give every item its own seed, unique in the level, so an edit to one list changes no other item. `suburb.json` has them. Two plants with the same seed grow the same (the park's gums had the street's seeds 1 to 6).
- `bounds`: the box round all areas: the characters stay in it. The fence walls keep the bird in the street, so it goes into the park only through the gate. The park has no fence: its bounds stop the bird before the rows of plants.
- A new area type: add `{ ground(area), parts(area, ctx) }` to `AREAS`. `ctx`: `{ asset, physics, ground, own, bounds, gates }`: `ground` is the level's, `own` the area's. `ground: null` for a type that has none. The first area must be a ground that is not land (the street).
- The first area is the base ground: a street, or a land area (then the only land: its mesh goes flat all round the box, and the physics is its mesh only, so keep `bounds` inside `box`).
- Not generic yet: the street runs along x at the z of `STRIPS` (constants in `street.js`, in its shader, mesh, physics and tuft rules), so a level has at most one, in the same place. A land area after a street owns all z from `box.z[0]` toward +z. The sprinkler's wet patch is one per level (`GROUND_WET`). The street's tuft rules use `TUFTS.area` and the strips.
- `joinGrounds()` (`load.js`): the level's ground is the first area's, with each land area over it from its `from` (`box.z[0]`). `cut` is where the first land starts; `profile` is the street's, cut there.
- Ground (`level.ground`): `profile` (for the physics ground), `height(x, z)`, `kind(x, z)` (`grass`, `path`, `kerb`, `road`, and on land `dirt`, `mud`) and `print(x, z)` (the footprint look). The street's is `STREET_GROUND` in `street.js`. This is the one source of the ground height and kind for the scenery, the props, the characters, the footprints and tap to walk. Scenery must not import `streetHeight()` or `stripAt()`: it gets the ground in `ctx`.
- Without `env`, the level uses flat ground at 0 and no scenery, so the fixed views still match `sdf.html`.
- Scenery parts: a part with `update(camera, dt, ibises, solids)` gets it each frame.
- Tufts: each placement rule has its own stream of random values (`own()` in `tufts.js`): each fence post and lamp post by its place, the long grass by itself. With one stream, a new post moved all the tufts after it. The clusters, edges and joints still share the first stream.
- `characters`: `species` (a key of `SPECIES`), `at`, `heading`, and `player: true` or `brain: 'wander'`. Each character gets its seed from its place in the list.
- `props`: `kind` (a key of `PROPS`), `at` (`[x, z]`), `heading`, and the options of that kind (for example `size`, `print`, `small`, `lid`, `tap`). The level adds `base` and `height(x, z)` (the ground). Each prop's `update(ibises, dt, camera)` runs after the physics step.
- A prop has no height in the level data. `place.js` gives it.

## Placement and stacking

- `stack()` in `src/world/place.js` gives each prop its `base`: the highest point under its footprint.
- The highest point is the ground (sampled on a grid, at most `SAMPLE` apart), or the top of a prop before it in the list whose footprint overlaps, plus `GAP`.
- So two props at the same place stack. Put a prop after the prop that it stands on.
- The footprint is a rectangle turned by the heading (`footprint(def)` on each prop class: `half`, `height`, and `centre` if the prop is not centred on `at`). The overlap test is a separating axis test.
- Why: two dynamic bodies that start inside each other stick together, and do not separate. A prop that starts in the ground jumps out.
- A tall stack can still fall over. The boxes stand on their hinged flaps. Two boxes and a cereal box at one place settle and sleep.

## Characters and brains

- `SPECIES` in `src/characters/species.js` makes a character from its name and the bird assets (`birds` of the `Level`).
- The noisy miner on the ground (`SPECIES.miner`) uses the ibis `Character` and motion, scaled by `MINER_SCALE`. It only stands: a scaled bird that walks takes steps that are too short for its speed. It has no solid in the physics (`solid: false` in `src/miner/bird.js`). The street does not use it.
- `fliers` in the level data: birds in the air (`FLIERS`, `src/miner/flier.js`), with a `home` (`[x, z]`) and the options of their `Flight` (circle `height`, `radius`, `dir`), and `gaze` (optional: the gaze of `docs/game.md`, in place of the alert distance). They are not in `level.ibises`: no footprints, mud or tap. `Sentry` (`src/characters/sentry.js`) makes each one a guard dog of a territory:
  - Perch: the highest perch within `SENTRY.home` of the home (`level.perches`: the props with `perch()`, and the `perches()` of the scenery parts, as the fence post tops and rail middles, and tree perch branches). Of perches at about the same height, the nearest. A tree perch is on a bare branch that a level asks for (`perch: [x, z]` on a bottlebrush in the area's `plants`: the world direction of the branch). The branch is about level, 3.3 above the foot, from the low limb that points most that way, out past the other limbs (`PLANTS.bottlebrush.perch`, `perchBranch()` in `plants.js`). A perch on a limb at the fork was hidden between the limbs, so point the branch to where the player comes from. Only the street tree has one, with a miner: no post is within `SENTRY.home` of it. It is higher than the post tops (3.2), so do not put one near a fence miner. It starts on it (`Flight.settle()`).
  - Watch: it sits and looks round.
  - Alert: the player is within the alert distance of the perch (on the ground): `SENTRY.alert`, plus `SENTRY.wary` times the noise. It turns to face the player, bobs, flicks its wings, glares and calls (`chip`), faster as the player comes nearer (`SENTRY.chip`). It calms down when the player goes `SENTRY.calm` past the alert distance.
  - Attack: after at least `SENTRY.warn` seconds of alert (so the `?` always shows first), the player comes within `SENTRY.attack`, or the patience runs out: `SENTRY.patience` seconds, `1 + SENTRY.hurry` times faster at full noise. It sits for `SENTRY.spot` seconds, then takes off, circles over the player and calls (`scold`). Only one miner dives at a time (`SENTRY.wait`). The dive aims at the head when it starts down and keeps that line, so a player that moves out of the way is missed.
  - Back: the player goes farther than the leave distance from the perch: `SENTRY.leave`, plus `SENTRY.wary` times the noise. Without the noise in it, a miner that noticed the player from far attacked, turned back at once, landed, and was on alert again. It flies back and lands. If the player comes within `SENTRY.attack` before it lands, it attacks again.
  - If the perch moves or tips (a bin), it takes off and finds another perch near its home.
  - Noise: disruption that a miner hears within `SENTRY.hear` of its perch adds to its noise (0 to 1): a run at `SENTRY.run` or faster (`loud.run` each second), a prop `slam` or `squash` (`loud.slam` times the strength, at least half; from `Level.update()`), a squawk or hiss of the player (`call` or `hiss` event, `loud.call`). The noise fades by `SENTRY.quiet` each second. It also makes the miner more agitated (faster calls, more shake of the `?`). The rules are fixed and the same for each miner, so the player can learn them.
  - `sentry.events`: `alert` as a miner goes on alert. The player turns its head to it for `NOTICE_LOOK` seconds (`animator.lookAt()`, in `Level.update()`), and the camera glances toward it when it is out of view (`Follow.glance()`, see `environment.md`).
  - Marks: `flier.mark` is `'?'` in the alert and `'!'` for `SENTRY.exclaim` seconds as the attack starts. `IbisEffects.alertMarks()` draws them.
  - Snap (`SNAP`): a Peck of the player is a snap (`snap` in `actions.js`) while `sentry.prey()` gives a miner: the nearest one in the air within `SNAP.range` of the head, where a snap now hits a dive. Out of range, a Peck is the usual ground peck. `Level.update()` puts its centre in `character.snapAt` each frame and sets `flier.glow` (a white contour) on it, so the outline shows exactly when a Peck snaps. The snap's `bite` event calls `sentry.bite()`: for `SNAP.window` seconds, a miner within `SNAP.reach` of the head is hurt. Tested: a peck hits a dive when the miner is about 1.4 to 3.5 units from the head at the press (about 0.2 s), and misses at 3.8. A hurt miner tumbles (`flight.hurt()`, `FLIGHT.hurt`: knocked away and up, two rolls, a drop), yelps, gets large hit lines that hold longer (`HURT` in `level.js`), a burst of puffs (`fx.impact()`), a hit-stop (the level runs at `HURT.rate` for `HURT.freeze` seconds) and a camera shake (`Follow.shake()`), and takes as its new home the free perch nearest to it that is at least `SNAP.away` from the player. It flies there and lands. For `SNAP.cool` seconds it does not go on alert and does not attack. `sentry.events`: `hurt`.
- A dive that hits the player's head makes it drop what its bill holds (`Physics.release()`) and stumble (`Ibis.strike()`, at any speed on the ground), with a burst of hit lines over its head (`fx.hit()`). In the air, or while it already stumbles, the player flinches as from a prod.
- The street has two miners on the far fence behind the small bin and one behind the stack of boxes. The near fence is under the free play camera, so a miner there is out of view.
- A brain writes `character.input` (move, fast, jump), the same input that a player gives. So a brain works for any species with a `Controller`.
- `Wander` (`src/characters/wander.js`): walks to a random point within `WANDER.range` of its home, waits, and picks another. It sometimes runs (`WANDER.run`). It gives up on a goal after `WANDER.stuck` seconds with no progress (a prop in the way).
- Random values come from `hash()` with the seed, not `Math.random()`.
- Each character has its own mud and wet targets (`level.target(ibis)`). A step in mud, the sprinkler's drops or a shake change only that character.
- Only the player gets the peck highlight and the camera follow.
- Every character with physics has a solid (`addBird()`), so characters collide with the props and with each other, and push each other (`bird` layer and bird push, see `physics.md`).
- Plans for other species: a brush turkey (a walk and a short flight, as the ibis), a ringtail possum (a walk on four legs). Each needs its own controller and animator. The brain shape stays the same.

## Add an AI character

1. Put it in the `characters` list of the level, with a brain: `{ species: 'ibis', at: [5, 2], heading: -2, brain: 'wander' }`. It collides, pushes, splashes and gets muddy as the player does.
2. A new behaviour is a new brain: a class with `update(character, dt)` that sets `character.input` (`move`, `fast`, `jump`) and can call `character.act(name)`. Put it in `src/characters/` and add it to `BRAINS` in `src/world/level.js`. `BRAINS` makes it from `(seed, home, bounds)`. Use `hash()` with the seed for random values. Look at `Wander` first.
3. A new species is a maker in `SPECIES` (`src/characters/species.js`): `(birds, seed)` to an object with `object` (a three.js `Object3D`), `character` (a `Controller` and an `Animator`, as `Character`) and `update(dt)`.
4. A new species also needs work outside `src/characters/`, because these parts take the ibis as given:
   - `Physics.addBird()` and the code that it calls (`feetGround()`, `makeRoom()`, `placeLimbs()`, grab) read the ibis rig (`rig.footL`, `rig.footR`, `rig.head`, `rig.headRot`) and the ibis sizes in `BIRD`. Give the species its own solid sizes and rig points, or a simpler path (for example only the solid and one ground ray).
   - `IbisEffects` and `IbisSound` read the rig feet and head, and `ibis.mud` and `ibis.wet`.
   - `Ibis.prod()` and `Ibis.hit()` for the tap, and `ibis.inPlace`.
   - A flier (the miner bird) is not on the ground: the `Controller`, the ground rays and the bounds need a flight mode. Keep it off the `bird` layer push while it is in the air, or give it its own layer.
5. Check it: walk the player into it and run into its side (the push), let it wander for a minute near props and mud, and run `npm run build`.
