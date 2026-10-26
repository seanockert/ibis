# Tools and checks

Commands, URL parameters, screenshots and the regression check.

## Commands

```sh
npm run dev                                           # demo /index.html, reference /sdf.html
npm run bake                                          # about 90 s, writes public/ibis.glb, prints triangles and KB
npm run bake -- miner                                 # writes public/miner.glb
npm run shot -- out.png "index.html?anim=6&t=0.35&yaw=1.3&pitch=0" 700x700
npm run shot -- out.png "sdf.html?anim=6&t=0.35&yaw=1.3&pitch=0" 700x700
npm run strip -- out.png "index.html?anim=7&yaw=1.3&pitch=0.1" 0 1.2 12   # filmstrip: 12 frames, t 0 to 1.2
npm run build
```

- URL parameters: `anim` (a move from `MOVES` in `src/moves.js`, index + 1: 1 idle, 2 walk, 3 peck, 4 squawk, 5 run, 6 jump, 7 happy, 8 shake head, 9 threat, 10 startle, 11 stumble, 12 shake, 13 turn, 14 prod), `t`, `yaw`, `pitch`, `ui=0` (hide the buttons and the joystick), `bird=miner` (the noisy miner in `sdf.html` and in the fixed views of `index.html`, with its own close camera), `fly` (with `bird=miner`: 1 the flight, 2 a dive at a head at the origin, again and again, 3 a landing, 1.5 s on the perch and a take off, again and again; on the spot, lifted 0.5 so the wings stay above the ground).
- `sdf.html` stops each ray at the ground (y = 0). A part below the ground is cut in the SDF view and not in `index.html`. The `fly` views lift the bird for this reason. `lite` (0 or 1: less GPU work, `LITE` in `src/app/config.js`: a pixel ratio cap of 1.25 and a 2048 shadow map; on for touch screens). `index.html` also takes `count`, `props=0`, `physics=1`, `terrain=1` (the test course in free play) and `env` (0 or 1: the street and sky; on in free play, off in fixed views). `sdf.html` also takes `debug`.
- `index.html` with no `t`, `yaw` or `count` is free play: a wide camera, keys, taps. With `t` or `yaw` it uses the close camera of `sdf.html`.
- A fixed `t` runs the move's script from 0 at 60 steps per second (`playScript()`), so both pages show the same pose, and `index.html` the same effects. `sdf.html` ignores position and heading (the bird moves on the spot). On `index.html`, `root=1` places the bird where the move took it, and the camera moves with it: use it to see dust trails and turns.
- Use the same parameters on `index.html` and `sdf.html` to compare the mesh with the SDF.
- Useful views: back `yaw=3.14&pitch=0.3`, side `yaw=1.4&pitch=0.1`, wings open (jump flutter) `anim=6&t=0.35`.
- The tools start Vite and headless Chrome at `/Applications/Google Chrome.app`. They work on macOS only.
- To zoom in, render at 1400x1400 or more and crop with `sips -c H W --cropOffset Y X in.png --out out.png`.
- `public/ibis.glb` is in git. To undo a bake, run `git checkout public/ibis.glb`.
- To show that a change to shared code does not change the ibis, render the views from a copy of HEAD (`git archive HEAD | tar -x -C DIR`, then a link to `node_modules`) and from the work tree, and diff the PNGs.
- `npm run bench` measures wall time. When another tab or app renders (the demo open in a browser), it can read 5 to 10 times too high, with no pattern. For costs, use GPU timer queries (`EXT_disjoint_timer_query_webgl2`) round `window.demo.render()`, and take the median. Free play at 1200x800: about 1.2 ms GPU with no environment, about 4 ms with the street, sky, backdrop, grade and the 4096 shadow map. Keep a large budget free for the props and set pieces to come.
- `npm` and `npx` can be slow here. Run long installs in the background.

## Check a change

1. Define what must look different and what must not.
2. Render `sdf.html` and `index.html` with the same parameters before and after.
3. For "no visible change" claims, diff the PNGs pixel by pixel in headless Chrome (canvas `getImageData`), and count pixels that differ by more than 8 and by more than 64 of 255.
4. Check at least: idle front (`anim=1&t=0.5`), side, back, squawk side (`anim=4&t=0.5&yaw=1.6`), and wings open (`anim=6&t=0.35`). For motion, look at a filmstrip (`npm run strip`).
5. Run `npm run build`.
