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

- `SPECIES` in `src/characters/species.js` makes a character from its name. Only the ibis exists now.
- A brain writes `character.input` (move, fast, jump), the same input that a player gives. So a brain works for any species with a `Controller`.
- `Wander` (`src/characters/wander.js`): walks to a random point within `WANDER.range` of its home, waits, and picks another. It sometimes runs (`WANDER.run`). It gives up on a goal after `WANDER.stuck` seconds with no progress (a prop in the way).
- Random values come from `hash()` with the seed, not `Math.random()`.
- Each character has its own mud and wet targets (`level.target(ibis)`). The Wet button sets all of them. A splash or a shake changes only that character.
- Only the player gets the peck highlight and the camera follow.
- Every character with physics has a solid (`addBird()`), so characters collide with the props and with each other, and push each other (`bird` layer and bird push, see `physics.md`).
- Plans for other species: a brush turkey (a walk and a short flight, as the ibis), a ringtail possum (a walk on four legs), a miner bird (it flies, circles overhead and dives at the player). Each needs its own controller and animator. The brain shape stays the same.

## Add an AI character

1. Put it in the `characters` list of the level, with a brain: `{ species: 'ibis', at: [5, 2], heading: -2, brain: 'wander' }`. It collides, pushes, splashes and gets muddy as the player does.
2. A new behaviour is a new brain: a class with `update(character, dt)` that sets `character.input` (`move`, `fast`, `jump`) and can call `character.act(name)`. Put it in `src/characters/` and add it to `BRAINS` in `src/world/level.js`. `BRAINS` makes it from `(seed, home, bounds)`. Use `hash()` with the seed for random values. Look at `Wander` first.
3. A new species is a maker in `SPECIES` (`src/characters/species.js`): `(asset, seed)` to an object with `object` (a three.js `Object3D`), `character` (a `Controller` and an `Animator`, as `Character`) and `update(dt)`.
4. A new species also needs work outside `src/characters/`, because these parts take the ibis as given:
   - `Physics.addBird()` and the code that it calls (`feetGround()`, `makeRoom()`, `placeLimbs()`, grab) read the ibis rig (`rig.footL`, `rig.footR`, `rig.head`, `rig.headRot`) and the ibis sizes in `BIRD`. Give the species its own solid sizes and rig points, or a simpler path (for example only the solid and one ground ray).
   - `IbisEffects`, `IbisSound` and `Puddle` read the rig feet and head, and `ibis.mud` and `ibis.wet`.
   - `Ibis.prod()` and `Ibis.hit()` for the tap, and `ibis.inPlace`.
   - A flier (the miner bird) is not on the ground: the `Controller`, the ground rays and the bounds need a flight mode. Keep it off the `bird` layer push while it is in the air, or give it its own layer.
5. Check it: walk the player into it and run into its side (the push), let it wander for a minute near props and the puddle, and run `npm run build`.
