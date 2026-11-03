# Game: hide in the rubbish

The game design and the prototype level (`?level=barbie`).
Playtest result: tedious and easy, not fun. See `docs/game-findings.md` for why, and for what to try next.
Read this when you change `src/world/disguise.js`, `src/world/fans.js`, `src/world/backyard.js`, the gaze in `src/characters/sentry.js`, `src/app/hud.js` or `src/levels/barbie.json`.

## Hook

"Hide in the rubbish. Move when nobody's looking."

- The ibis climbs into rubbish (a box, a wheelie bin) as a hermit crab into a shell. Only its legs show under it, and two eyes peek out of a hole in the front.
- The miners don't notice rubbish. They notice rubbish that moves while they look at it.
- Each miner's gaze is a fan on the ground. Calm is pale yellow; it goes to red as its meter fills. A `?` over the miner shows the meter is up. A full meter is an attack (`!`, dives).
- The loot needs the bird out of the disguise for a moment: hop out, take it, hop back in. You can carry the loot in a disguise.
- A dive that hits knocks the bird out of its disguise and makes it drop the loot. In an attack, a bird that hides in a still disguise for `GAZE.lose` seconds is lost.

An earlier idea ("stick your head in rubbish, but you can't get it off": a cone and a bucket) was cut after a playtest: the exits happened by accident, the worn mesh clipped through the head, and the loop was not fun.

## Rules in the code

- Disguise (`disguise.js`): a prop kind `disguise` with `as: 'box' | 'bin'`. Loose: one heavy box body, with the mesh of the real `Box` or `Bin` (made in a `Physics` world of its own that never steps). In use: no body, and the mesh follows the bird at `DISGUISE.lift` over its feet, with a waddle.
- `DISGUISE[as]`: `speed` (part of the walk speed; no run, no jump), `slow` (the meter fills this many times slower while it moves: a bin looks more at home).
- A peck goes in (`Character.act()`: `canHide()`, then `hop`). The target is the nearest loose disguise within `DISGUISE.reach` of a point `DISGUISE.ahead` in front of the bird, so not the one it just left (behind it), and not when the peck would take a prop (loot wins). The highlight outlines it. A peck in a disguise hops out; the disguise stays behind the bird.
- In a disguise: `character.inside` is the disguise. `ibis.showOnly([3])` draws only the legs (part group 3). The held prop is hidden. No snap, no grab.
- Gaze (`sentry.js`, `gaze` on a flier in the level data): `look` (world headings, held `hold` seconds each, turning at `turn`) or `spin` (radians per second), `range`, `angle` (half). The meter (`GAZE`): fills in `open` seconds for a bird in the open, in `move × slow` seconds for a moving disguise, and fades by `fade` each second out of view or still. A gaze miner has no alert distance and does not attack on the way back to its perch.
- Fans (`fans.js`): one fill and one edge strip for each gaze miner, on the ground heights, while it sits on its perch.
- Mission view (`hud.js`): `mission` in the level JSON: `goal`, `need` (loot in the nest), `win`. A count, a hint for the state of the player, bobbing markers over the loot and over the nest while the bird carries loot. A level with a mission starts with the camera behind the player (`main.js`).

## The Barbie (`src/levels/barbie.json`)

- A back yard, 36 by 43, that rises (a `hill`) to the back wall of the house. A timber deck against the house, with front steps (4 wide) and side steps from the side path. The steps go down in `DECK.rise` steps until the next is under the ground: on a slope, a fixed count left the lowest step higher than the bird's step up.
- The loot: 3 slices of fairy bread on a picnic rug on the deck. The nest: front left, by the start.
- Guards: a miner on the Hills Hoist in the middle (its gaze turns with the hoist, `spin` 0.4), one on the barbecue on the deck (the rug, the front steps, the side steps), one on a left fence post (up and down the side path).
- Disguises: a box by the start, a box on the right of the lawn, the bin on the side path (slow, but less suspicious), a box on the deck.
- Props go after the deck in the list, so `stack()` puts them on it. The front fence is 12 from the start, so the camera (12.5 behind the bird) is inside it.

## Test

- A headless bot: drive `window.demo`. Replace `demo.input.apply` to steer, replace `performance.now` with a fixed step, and call `demo.frame()`. To run fast, make `renderer.render` a no-op between shots. With no render, call `updateMatrixWorld()` on the top object before you read a world matrix.
- A bot that freezes while any fan is on the bird (`sentry.sees()`) and waits for a clear moment before it hops out takes a slice home in about 95 s.
- A bot only shows that a route works. Also think about what a new player sees and does.
- Things to check after a change: a peck in reach goes into a box; the legs show and the eyes peek; a moving disguise in a fan fills the meter, a still one does not; a peck hops out; loot in reach wins over the disguise behind the bird; the bird gets up both deck steps; loot carried in a box drops in the nest and counts.
