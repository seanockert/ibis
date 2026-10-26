# Ibis model: notes for agents

A toon-shaded Australian white ibis in three.js, with an SDF source model, a bake to a skinned mesh, procedural motion, crashcat physics and a suburban street.
`README.md` has the user-facing API.
This file has only the rules that apply to all work.
Read the file in `docs/` for the area that you change, and only that file.

## Docs

| File | Read it when you change |
|---|---|
| `docs/files.md` | Anything: a table of what each source file does |
| `docs/tools.md` | Any work you must render or measure: commands, URL parameters, screenshots, GPU timing, the full "Check a change" |
| `docs/motion.md` | Controller, animator, gait, foot placement, turns, actions, faces, Pose fields |
| `docs/effects-sound.md` | Character events, sounds, dust, footprints, anger lines |
| `docs/rendering.md` | Ibis shaders, coordinate spaces, material ids, colours, light, shadow, lines, mud and wet |
| `docs/bake.md` | `tools/bake/*`, `tools/pack.mjs`, `public/ibis.glb` |
| `docs/physics.md` | `physics.js`: layers, the bird's solid, shove, room, push, floor, bounds |
| `docs/props.md` | A prop or set piece: size and mass rules, the bin, boxes, cereal, stubbies, grab |
| `docs/levels.md` | Level data, prop placement and stacking, characters and brains, `src/main.js` and `src/app/` |
| `docs/environment.md` | Street, kerb, footpaths, fence, tufts, sky, backdrop, grade, free play camera |
| `docs/improvements.md` | Performance and clean-up ideas not done yet, with triangle counts |

When you learn something that cost time, add it to the docs file for that area, not here.

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

- `sdf.html` shows a change to `model.glsl` at once. The game mesh (`index.html`) shows it only after `npm run bake`.
- The runtime shaders in `materials.js` also include `model.glsl`. They call `wingL`, `wingR`, `body`, `bodySpace`, `wingSeam` and the scarf functions at runtime to draw lines. A change to those functions changes the game without a bake.

## Commands

```sh
npm run dev      # demo /index.html, reference /sdf.html
npm run bake     # about 90 s, writes public/ibis.glb
npm run shot -- out.png "index.html?anim=6&t=0.35&yaw=1.3&pitch=0" 700x700
npm run build
```

URL parameters and the other tools are in `docs/tools.md`.

## Rules

- Determinism: random values come from `hash()` with the seed. Do not use `Math.random()` in motion code.
- Constants are copied between `rig.js` and `model.glsl` (`WING_FOLD`, `NECK_BASE`, `HEAD_SCALE`, the toe directions and lengths, the jaw hinge). Change both.
- `MAT` in `src/ibis/materialIds.js` must match `MAT_*` in `model.glsl`.
- Scale: the ibis is 2 units tall (1 unit is about 35 cm). Size and weigh every object for a bird of that size.
- Australian, not American, and no real brands. See `docs/props.md`.
- Only `src/world/physics.js` imports crashcat.
- Measure GPU cost with timer queries, not `npm run bench` (see `docs/tools.md`).
- `public/ibis.glb` is in git. To undo a bake, run `git checkout public/ibis.glb`.

## Check a change

1. Define what must look different and what must not.
2. Render `sdf.html` and `index.html` with the same parameters before and after. Diff the PNGs for "no visible change" claims.
3. Check idle front, side, back, squawk side and wings open. Details in `docs/tools.md`.
4. Run `npm run build`.
