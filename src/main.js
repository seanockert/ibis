// index.html: the game. Free play loads a level (src/levels/) with the player, other characters and
// props; the other views (fixed time, fixed camera, the grid, the bench) show birds (the bird parameter)
// playing moves, as sdf.html. URL parameters: src/app/config.js.
import * as THREE from 'three';
import { readConfig } from './app/config.js';
import { Follow } from './app/follow.js';
import { Challenges } from './app/challenges.js';
import { ComboHud } from './app/comboHud.js';
import { Hud } from './app/hud.js';
import { Input } from './app/input.js';
import { Meter } from './app/meter.js';
import { lockScreen } from './app/screen.js';
import { Stage, TARGET_PLAY } from './app/stage.js';
import { hideUi, Ui } from './app/ui.js';
import { IBIS } from './ibis/bird.js';
import { Ibis, loadIbis } from './ibis/Ibis.js';
import { MINER } from './miner/bird.js';
import { Flier } from './miner/flier.js';
import { flightDemo } from './miner/flight.js';
import { Character } from './ibis/motion/character.js';
import { IbisSound } from './ibis/sound.js';
import { buildLevel, LEVELS } from './levels/load.js';
import { ARENA, MOVES, playScript, startMove } from './moves.js';
import { renderFarShadow } from './world/farShadow.js';
import { Level } from './world/level.js';
import { DayCycle } from './world/lighting.js';
import { seeOn } from './world/props.js';

const config = readConfig();
const { play, count, anim, fixedTime } = config;
if (!config.ui) hideUi();
lockScreen();
// The built game starts offline (src/sw.js). Not in the dev server, so the tools always get fresh files.
if (import.meta.env.PROD && 'serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js');

// The meshes of the birds, by species. They share the sun.
const asset = await loadIbis(IBIS);
const birds = { ibis: asset, miner: await loadIbis(MINER, asset.uniforms) };
const stage = new Stage(document.getElementById('c'), config, asset.sun);
const { scene, camera, controls, sun } = stage;
const sound = config.sound ? new IbisSound() : null;
sound?.load('honk', '/sfx/honk.m4a');
sound?.load('chip', '/sfx/miner-chip.m4a');
sound?.load('scold', '/sfx/miner-scold.m4a');
const level = new Level(buildLevel(LEVELS[config.level] ?? LEVELS.suburb), { asset, birds, scene, env: config.env, props: config.props, terrain: config.terrain, sound, weather: config.weather });

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
// The day cycle, with the street: day, dusk, night, morning.
const cycle = config.env ? new DayCycle(asset.sun, config.time) : null;
stage.aimSun();
if (config.env) renderFarShadow(stage.renderer, scene, asset.sun);   // the plants' shadows past the sun's map
let turning = 0;
if (config.colliders && level.physics) await level.showColliders();
const bird = level.player ?? level.ibises[0];
const { physics, props, highlight, fx } = level;
window.demo = { cycle, level, ibises: level.ibises, physics, props, highlight, fx, sound, camera, controls, world: level.parts, sun, grade: stage.grade, renderer: stage.renderer, scene, render: () => stage.render() };   // for the console

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
  // A level with a mission starts with the camera behind the player.
  if (level.def.mission) {
    const off = camera.position.clone().sub(controls.target), r = Math.hypot(off.x, off.z), h = bird.character.heading;
    camera.position.set(controls.target.x - Math.sin(h) * r, camera.position.y, controls.target.z - Math.cos(h) * r);
  }
  camera.position.add(start);
  controls.target.add(start);
  controls.update();
}
const follow = play ? new Follow(camera, controls, TARGET_PLAY.y) : null;
seeOn.value = play ? 1 : 0;   // the props and the fence fade where the camera is in them
const input = play ? new Input(stage.renderer.domElement, stage, level, () => { freePlay = true; ui.setPressed(-1); }, () => follow.recentre()) : null;
window.demo.input = input;
window.demo.follow = follow;
const ui = new Ui({
  play, anim, level, input, cycle,
  onMove: i => {
    freePlay = false;
    driven.forEach((ibis, k) => { scripts[k] = { move: i, run: startMove(ibis.character, i), time: 0 }; });
  },
});

// The mission view, in free play on a level with a mission.
const mission = play ? level.def.mission : null;
const hud = !mission ? null : mission.combo ? new ComboHud(level, camera) : mission.challenges ? new Challenges(level) : new Hud(level, asset);
window.demo.hud = hud;

// Frame meter, top left: free play with the buttons.
const meter = play && config.ui ? new Meter(stage.renderer) : null;
let last = performance.now();
function frame() {
  meter?.begin();
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  driven.forEach((ibis, i) => {
    if (freePlay) input.apply(ibis.character);
    else { scripts[i].run(ibis.character, scripts[i].time); scripts[i].time += dt; }
  });
  level.flyDemo?.(dt);
  if (cycle?.update(dt)) {
    stage.aimSun();
    // Far map: every 6th frame of the turn, and at the end.
    if (++turning % 6 === 0 || !cycle.turning) renderFarShadow(stage.renderer, scene, asset.sun);
  }
  level.update(dt, camera);
  hud?.update(dt);
  ui.update();
  stage.keepAbove(level.ground.height);
  if (follow) {
    // A miner that goes on alert out of view: the camera glances toward its head.
    // A snap that hurts a miner shakes the view.
    if (level.sentry?.events.some(e => e.type === 'hurt')) follow.shake();
    for (const e of level.sentry?.events ?? []) if (e.type === 'alert') follow.glance(e.flier.rig.head.clone().applyMatrix4(e.flier.object.matrixWorld));
    follow.update(dt, bird.character);
    stage.shadowTo(controls.target);
  }
  level.updateView(camera, dt);
  level.renderShadows(stage.renderer);
  stage.render(dt);
  meter?.end();
}
window.demo.frame = frame;   // for tools/gpu.mjs

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
  level.renderShadows(stage.renderer);
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
  level.renderShadows(stage.renderer);
  stage.render();
  document.title = 'DONE';
} else {
  stage.renderer.setAnimationLoop(frame);
}
