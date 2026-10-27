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

- A level is one object in `src/levels/`, as `STREET` in `src/levels/street.js`.
- `ground`: `profile` (heights across z, for the physics ground) and `height(x, z)`. This is the one source of the ground height for the props, the characters, the footprints and tap to walk.
- Without `env`, the level uses flat ground at 0 and no scenery, so the fixed views still match `sdf.html`.
- `scenery(asset, physics)`: the parts. A part with `update(camera, dt, ibises, solids)` gets it each frame.
- `characters`: `species` (a key of `SPECIES`), `at`, `heading`, and `player: true` or `brain: 'wander'`. Each character gets its seed from its place in the list.
- `props`: `kind` (a key of `PROPS`), `at` (`[x, z]`), `heading`, and the options of that kind (for example `size`, `print`, `small`, `lid`).
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
- `fliers` in the level data: birds in the air (`FLIERS`, `src/miner/flier.js`), with a `home` (`[x, z]`) and the options of their `Flight` (circle `height`, `radius`, `dir`). They are not in `level.ibises`: no footprints, puddle or tap. `Sentry` (`src/characters/sentry.js`) makes each one a guard dog of a territory:
  - Perch: the highest perch within `SENTRY.home` of the home (`level.perches`: the props with `perch()`, and the `perches()` of the scenery parts, as the fence post tops and rail middles). Of perches at about the same height, the nearest. It starts on it (`Flight.settle()`).
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
- Each character has its own mud and wet targets (`level.target(ibis)`). The Wet button sets all of them. A splash or a shake changes only that character.
- Only the player gets the peck highlight and the camera follow.
- Every character with physics has a solid (`addBird()`), so characters collide with the props and with each other, and push each other (`bird` layer and bird push, see `physics.md`).
- Plans for other species: a brush turkey (a walk and a short flight, as the ibis), a ringtail possum (a walk on four legs). Each needs its own controller and animator. The brain shape stays the same.

## Add an AI character

1. Put it in the `characters` list of the level, with a brain: `{ species: 'ibis', at: [5, 2], heading: -2, brain: 'wander' }`. It collides, pushes, splashes and gets muddy as the player does.
2. A new behaviour is a new brain: a class with `update(character, dt)` that sets `character.input` (`move`, `fast`, `jump`) and can call `character.act(name)`. Put it in `src/characters/` and add it to `BRAINS` in `src/world/level.js`. `BRAINS` makes it from `(seed, home, bounds)`. Use `hash()` with the seed for random values. Look at `Wander` first.
3. A new species is a maker in `SPECIES` (`src/characters/species.js`): `(birds, seed)` to an object with `object` (a three.js `Object3D`), `character` (a `Controller` and an `Animator`, as `Character`) and `update(dt)`.
4. A new species also needs work outside `src/characters/`, because these parts take the ibis as given:
   - `Physics.addBird()` and the code that it calls (`feetGround()`, `makeRoom()`, `placeLimbs()`, grab) read the ibis rig (`rig.footL`, `rig.footR`, `rig.head`, `rig.headRot`) and the ibis sizes in `BIRD`. Give the species its own solid sizes and rig points, or a simpler path (for example only the solid and one ground ray).
   - `IbisEffects`, `IbisSound` and `Puddle` read the rig feet and head, and `ibis.mud` and `ibis.wet`.
   - `Ibis.prod()` and `Ibis.hit()` for the tap, and `ibis.inPlace`.
   - A flier (the miner bird) is not on the ground: the `Controller`, the ground rays and the bounds need a flight mode. Keep it off the `bird` layer push while it is in the air, or give it its own layer.
5. Check it: walk the player into it and run into its side (the push), let it wander for a minute near props and the puddle, and run `npm run build`.
