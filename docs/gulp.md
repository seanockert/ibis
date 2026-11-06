# Toss and Gulp

An arcade game for the ibis alone: `gulp.html`, code in `src/gulp/`.
It is the first test of the "one verb, precise timing, just one more go" idea in `docs/game-findings.md`.

## Rules

- Things fall from the sky. Press (Space, a tap, or the Catch button) when the item gets to the bill.
- A catch must come within `RULES.good` seconds of the arrival. Within `RULES.perfect` it is perfect.
- A press more than `RULES.armed` seconds early does nothing. A press nearer but outside the window is a whiff: the item can't be caught now.
- After a catch the bird flicks the item up again. It comes back after `RULES.air` seconds. A perfect catch tosses it near the bill. A good catch tosses it to the side, so the bird must walk.
- After `catches` catches (per item, `ITEMS`) the bird swallows it.
- Perfect catches in a row raise the multiplier. A good catch or a miss resets it.
- A miss bonks the head, bounces off the body, or lands on the ground. Three misses and the bird faints.
- Each swallow makes gravity and the toss faster (`RULES.faster`), and opens new items (`from`).
- The best score is in `localStorage` (`ibis-gulp-best`).

## What the player sees

- The bill opens wide just before the item arrives (the tell, `OPEN` in `game.js`).
- A grey disc on the ground under each item shows where it falls, also before the item is in view.
- The bird always faces right. Left walks it backward (`Character.drive`), so the bill stays where the player expects it.

## The swallow

- The item slides to the corner of the open bill and shrinks to nothing there, inside the gap, so it does not go through the head.
- Then a pouch swells in the throat, a lump goes down the front of the neck in three gulps, and the belly gets rounder (`Ibis.bulge()`, `docs/rendering.md`).
- The belly stays round for the run and goes back at the restart.

## Tools

- `gulp.html?bot=1`: a bot walks under each item and presses on time. `miss=3,5`: it does not press on those catches.
- `t=SECONDS`: runs that long at 60 steps per second and draws one frame (for `npm run shot`). `close=1`: a close camera. `item=gnome`: every item is that one. `seed`, `yaw`.
- `window.gulp.step(dt)` and `window.gulp.render()` let a script stop at a moment (a held item, the lump at mid neck) and take a screenshot.
- A bot run proves the rules work. It says nothing about fun. Judge that from a person's first minute.

## Known gaps

- The shadow of the sun does not show the bulges.
- A late miss falls a few frames into the bill, then glances off it forward.
- No hit-stop yet. A bonk shakes the camera.
