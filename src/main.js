// index.html: the game. Free play loads a level (src/levels/) with the player, other characters and
// props; the other views (fixed time, fixed camera, the grid, the bench) show birds (the bird parameter)
// playing moves, as sdf.html. URL parameters: src/app/config.js.
import * as THREE from 'three';
import { readConfig } from './app/config.js';
import { Follow } from './app/follow.js';
import { Input } from './app/input.js';
import { Stage, TARGET_PLAY } from './app/stage.js';
import { hideUi, Ui } from './app/ui.js';
import { IBIS } from './ibis/bird.js';
import { Ibis, loadIbis } from './ibis/Ibis.js';
import { MINER } from './miner/bird.js';
import { Flier } from './miner/flier.js';
import { flightDemo } from './miner/flight.js';
import { Character } from './ibis/motion/character.js';
import { IbisSound } from './ibis/sound.js';
import { STREET } from './levels/street.js';
import { ARENA, MOVES, playScript, startMove } from './moves.js';
import { Level } from './world/level.js';

const config = readConfig();
const { play, count, anim, fixedTime } = config;
if (!config.ui) hideUi();

// The meshes of the birds, by species. They share the sun.
const asset = await loadIbis(IBIS);
const birds = { ibis: asset, miner: await loadIbis(MINER, asset.uniforms) };
const stage = new Stage(document.getElementById('c'), config, asset.sun);
const { scene, camera, controls, sun } = stage;
const sound = config.sound ? new IbisSound() : null;
sound?.load('/sfx/honk.m4a');
const level = new Level(STREET, { asset, birds, scene, env: config.env, props: config.props, terrain: config.terrain, sound, weather: config.weather });

// Free play: the level's characters and props. Other views: ibises in a grid that play moves in place,
// in the walk circle of the moves.
if (play) level.populate();
else if (config.fly) {
  // One miner that flies on the spot, as sdf.html with fly.
  const flier = level.addFlier(new Flier(birds.miner, { scale: 1 }));
  flier.inPlace = true;
  flier.object.position.set(0, 0, 0);
  flier.object.rotation.set(0, 0, 0);
  const dives = flightDemo(flier.flight, config.fly);
  level.flyDemo = dt => { dives(dt); };
} else {
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const ibis = level.add(new Ibis(birds[config.bird.name], { seed: i }));
    ibis.inPlace = true;
    ibis.object.position.set((i % side - (side - 1) / 2) * 2.2, 0, -Math.floor(i / side) * 2.2);
    ibis.character.controller.bounds = { x: [-ARENA - 0.5, ARENA + 0.5], z: [-ARENA - 0.5, ARENA + 0.5] };
  }
  if (count > 1) {
    Object.assign(sun.shadow.camera, { left: -side * 1.5, right: side * 1.5, top: side * 2.5, bottom: -side * 1.5 });
    sun.shadow.camera.updateProjectionMatrix();
  }
}
if (config.colliders && level.physics) await level.showColliders();
const bird = level.player ?? level.ibises[0];
const { physics, props, highlight, puddle, fx } = level;
window.demo = { level, ibises: level.ibises, physics, props, highlight, puddle, fx, sound, camera, controls, world: level.parts, sun, grade: stage.grade, renderer: stage.renderer, scene, render: () => stage.render() };   // for the console

// Scripted moves: the grid plays move i on ibis i, and a single ibis plays the anim move. In free play,
// only Walk and Run are scripts; the other buttons are one-shot actions. Only the player plays scripts:
// the other characters have brains.
const driven = play ? [bird] : level.ibises;
const scripts = driven.map((ibis, i) => {
  const move = count > 1 ? (anim > 0 ? anim - 1 : i % MOVES.length) : Math.max(anim - 1, 0);
  return { move, run: startMove(ibis.character, move), time: 0 };
});
let freePlay = play && !(anim > 0 && MOVES[anim - 1].loop);
if (play && anim > 0) MOVES[anim - 1].press?.(bird.character);

// The camera starts at the player, and follows it in free play.
if (play) {
  const start = new THREE.Vector3(bird.character.position.x, 0, bird.character.position.z);
  camera.position.add(start);
  controls.target.add(start);
  controls.update();
}
const follow = play ? new Follow(camera, controls, TARGET_PLAY.y) : null;
const input = play ? new Input(stage.renderer.domElement, stage, level, () => { freePlay = true; ui.setPressed(-1); }, () => follow.recentre()) : null;
window.demo.input = input;
const ui = new Ui({
  play, anim, level, input,
  onMove: i => {
    freePlay = false;
    driven.forEach((ibis, k) => { scripts[k] = { move: i, run: startMove(ibis.character, i), time: 0 }; });
  },
});

let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  driven.forEach((ibis, i) => {
    if (freePlay) input.apply(ibis.character);
    else { scripts[i].run(ibis.character, scripts[i].time); scripts[i].time += dt; }
  });
  level.flyDemo?.(dt);
  level.update(dt, camera);
  ui.update();
  stage.keepAbove();
  if (follow) {
    follow.update(dt, bird.character);
    stage.shadowTo(controls.target);
  }
  level.updateView(camera, dt);
  stage.render();
}

if (config.bench !== null) {
  // Draw N frames in a blocking loop and put the mean frame time in the title.
  const n = config.bench, px = new Uint8Array(4), gl = stage.renderer.getContext();
  const once = () => { frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  once();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) once();
  document.title = 'BENCH ' + ((performance.now() - t0) / n).toFixed(2) + ' ms';
} else if (fixedTime !== null && config.fly) {
  // The flight from 0 to t at 60 steps per second, as sdf.html.
  const [flier] = level.fliers;
  for (let time = 0; time < fixedTime - 1e-9; time += 1 / 60) { const dt = Math.min(1 / 60, fixedTime - time); level.flyDemo(dt); flier.update(dt); }
  level.updateView(camera, 0);
  stage.render();
  document.title = 'DONE';
} else if (fixedTime !== null) {
  // Replay the move from 0 on a new character, with the effects, so the dust at t is always the same.
  // root=1: place the bird where the move took it, to see turns and steps on the ground.
  level.ibises.forEach((ibis, i) => {
    ibis.character = new Character({ seed: i });
    ibis.inPlace = !config.root;
    playScript(ibis.character, scripts[i].move, fixedTime, dt => { ibis.update(dt); fx.update(dt, [ibis], camera); });
  });
  if (config.root) {
    // The camera keeps its view and moves with the bird.
    const shift = new THREE.Vector3(bird.object.position.x, 0, bird.object.position.z);
    camera.position.add(shift);
    controls.target.add(shift);
    controls.update();
    fx.update(0, level.ibises, camera);
  }
  level.updateView(camera, 0);
  stage.render();
  document.title = 'DONE';
} else {
  stage.renderer.setAnimationLoop(frame);
}
