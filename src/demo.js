// three.js demo of the baked ibis. URL params: anim (0 free play, 1 and up one move from src/moves.js),
// t (fixed time), yaw and pitch (fixed camera, as in sdf.html), scale, count (ibises in a grid), bench
// (frames to time), mud and wet (0 to 1), root (1: with t, place the bird where the move took it).
// Free play: WASD or the arrow keys walk, Shift runs, Space jumps (hold to flutter). A tap on the ground
// walks there; a tap on the bird prods it.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IbisEffects } from './ibis/effects.js';
import { Ibis, loadIbis } from './ibis/Ibis.js';
import { Character } from './ibis/motion/character.js';
import { ARENA, MOVES, playScript, startMove } from './moves.js';

const FOCAL = 3.2;   // the SDF view's lens: vertical half-angle atan(1 / FOCAL)
const CAM_DIST = 6.2;        // close camera, as in the SDF view: screenshots and the grid
const CAM_DIST_PLAY = 12.5;  // free play: the whole walk circle is in view
const TARGET = new THREE.Vector3(0, 1, 0.3);
const TARGET_PLAY = new THREE.Vector3(0, 0.6, 0);
const GROUND_LIT = new THREE.Color().setRGB(0.925, 0.902, 0.855, 'srgb');
const GROUND_SHADE = new THREE.Color().setRGB(0.80, 0.78, 0.86, 'srgb');
const WEATHER_RATE = 0.5;   // mud and wet change per second when toggled
const TAP_PX = 8;           // a pointer that moves less than this between down and up is a tap

const params = new URLSearchParams(location.search);
// ui=0 hides the buttons and the hint, for tools/strip.mjs.
if (params.get('ui') === '0') for (const el of document.querySelectorAll('.bar, .hint')) el.style.display = 'none';
let anim = Number(params.get('anim') || 0);
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const scale = Number(params.get('scale') || Math.min(window.devicePixelRatio, 1.5));
const count = Number(params.get('count') || 1);
const weather = { mud: Number(params.get('mud') || 0), wet: Number(params.get('wet') || 0) };   // targets
const play = count === 1 && fixedTime === null && !params.has('yaw') && !params.has('bench');

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(scale);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = GROUND_LIT;
const camera = new THREE.PerspectiveCamera(2 * Math.atan(1 / FOCAL) * 180 / Math.PI, innerWidth / innerHeight, 0.1, 100);
const yaw = params.has('yaw') ? Number(params.get('yaw')) : -0.8;
const pitch = params.has('pitch') ? -0.05 + 1.15 * Number(params.get('pitch')) : play ? 0.42 : 0.22;
const target = play ? TARGET_PLAY : TARGET;
camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
  .multiplyScalar(play ? CAM_DIST_PLAY : CAM_DIST).add(target);
const controls = new OrbitControls(camera, canvas);
controls.target.copy(target);
controls.update();

const asset = await loadIbis('/ibis.glb');
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.position.copy(asset.sun).multiplyScalar(6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
sun.shadow.bias = -0.0005;
scene.add(sun, sun.target);

// Ground: plain background colour, with the shade colour where the shadow falls. It draws first and
// writes no depth, so it can't cover the outline round the feet.
const groundMaterial = new THREE.ShadowMaterial({ color: GROUND_SHADE, transparent: false, depthWrite: false });
groundMaterial.onBeforeCompile = shader => {
  shader.uniforms.litColor = { value: GROUND_LIT };
  shader.fragmentShader = shader.fragmentShader
    .replace('void main() {', 'uniform vec3 litColor;\nvoid main() {')
    .replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', 'gl_FragColor = vec4( mix( color, litColor, getShadowMask() ), 1.0 );');
};
const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), groundMaterial);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
ground.renderOrder = -1;
scene.add(ground);

const side = Math.ceil(Math.sqrt(count));
const ibises = Array.from({ length: count }, (_, i) => {
  const ibis = new Ibis(asset, { seed: i });
  ibis.inPlace = !play;
  ibis.object.position.set((i % side - (side - 1) / 2) * 2.2, 0, -Math.floor(i / side) * 2.2);
  ibis.mud = weather.mud;
  ibis.wet = weather.wet;
  scene.add(ibis.object);
  return ibis;
});
const bird = ibises[0];
const fx = new IbisEffects(asset);
scene.add(fx.object);
bird.character.controller.bounds = ARENA + 0.5;
window.demo = { ibises, render: () => renderer.render(scene, camera) };   // for the console
if (count > 1) {
  Object.assign(sun.shadow.camera, { left: -side * 1.5, right: side * 1.5, top: side * 2.5, bottom: -side * 1.5 });
  sun.shadow.camera.updateProjectionMatrix();
}

// Scripted moves: the grid plays move i on ibis i, and a single ibis plays the anim move. In free play,
// only Walk and Run are scripts; the other buttons are one-shot actions.
const scripts = ibises.map((ibis, i) => {
  const move = count > 1 ? (anim > 0 ? anim - 1 : i % MOVES.length) : Math.max(anim - 1, 0);
  return { move, run: startMove(ibis.character, move), time: 0 };
});
let freePlay = play && !(anim > 0 && MOVES[anim - 1].loop);
if (play && anim > 0) MOVES[anim - 1].press?.(bird.character);

// ---- free play input ----
const keys = new Set();
let goal = null;   // tap target on the ground, world space
addEventListener('keydown', e => {
  if (e.repeat) return;
  keys.add(e.code);
  if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) setFree();
  if (e.code === 'Space') e.preventDefault();
});
addEventListener('keyup', e => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

function freeInput(c) {
  const ax = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0);
  const ay = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0);
  // Camera relative: up on the keys is away from the camera.
  const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = fwd.multiplyScalar(ay).add(right.multiplyScalar(ax));
  c.input.fast = keys.has('ShiftLeft') || keys.has('ShiftRight');
  if (move.lengthSq() > 0) goal = null;
  else if (goal) {
    move.set(goal.x - c.position.x, 0, goal.z - c.position.z);
    const d = move.length();
    if (d < 0.15) goal = null;
    else c.input.fast = goal.fast;
  }
  c.input.move.set(move.x, move.z);
  if (c.input.move.lengthSq() > 1) c.input.move.normalize();
  c.input.jump = keys.has('Space') || jumpButton;
}

// Taps: on the bird, a prod; on the ground, walk there (run when far). A drag orbits the camera.
const ray = new THREE.Raycaster();
const groundPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
let down = null;
canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerup', e => {
  if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > TAP_PX || !play) return;
  ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2), camera);
  bird.object.updateMatrixWorld();
  const d = bird.hit(ray.ray);
  if (d !== null) { bird.prod(ray.ray.at(d, new THREE.Vector3())); return; }
  const p = ray.ray.intersectPlane(groundPlane, new THREE.Vector3());
  if (!p || p.length() > ARENA + 0.5) return;
  setFree();
  goal = { x: p.x, z: p.z, fast: p.distanceTo(bird.object.position) > 2.5 };
});

function setFree() {
  freePlay = true;
  goal = null;
  setPressed(-1);
}

// ---- frame loop ----
let last = performance.now();
function frame() {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  ibises.forEach((ibis, i) => {
    if (play && freePlay) freeInput(ibis.character);
    else { scripts[i].run(ibis.character, scripts[i].time); scripts[i].time += dt; }
    for (const key of ['mud', 'wet']) {
      const step = WEATHER_RATE * dt;
      ibis[key] = Math.min(Math.max(weather[key], ibis[key] - step), ibis[key] + step);
    }
    ibis.update(dt);
    // A body shake throws off half the water.
    if (ibis.character.events.some(e => e.type === 'shakeOff')) {
      weather.wet = ibis.wet = Math.max(ibis.wet - 0.5, 0);
      wetButton.setAttribute('aria-pressed', String(weather.wet > 0));
    }
  });
  fx.update(dt, ibises, camera);
  if (play) {
    // The shadow camera follows the bird.
    sun.target.position.copy(bird.object.position);
    sun.position.copy(asset.sun).multiplyScalar(6).add(bird.object.position);
  }
  renderer.render(scene, camera);
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---- buttons ----
// Walk and Run stay on and walk the circle. Jump jumps while held (hold for the flutter). The others
// play once (press in src/moves.js).
const bar = document.getElementById('bar');
let jumpButton = false;
const buttons = MOVES.map((move, i) => {
  const b = document.createElement('button');
  b.textContent = move.name;
  b.setAttribute('aria-pressed', String(i === anim - 1 && (move.loop || !play)));
  if (move.hold && play) {
    b.addEventListener('pointerdown', () => { setFree(); jumpButton = true; });
    for (const ev of ['pointerup', 'pointerleave', 'pointercancel']) b.addEventListener(ev, () => { jumpButton = false; });
  } else {
    b.onclick = () => {
      if (play && move.press) { move.press(bird.character); return; }
      if (play && !move.loop) { setFree(); return; }   // Idle: stand
      freePlay = false;
      for (const [k, ibis] of ibises.entries()) scripts[k] = { move: i, run: startMove(ibis.character, i), time: 0 };
      setPressed(i);
    };
  }
  bar.appendChild(b);
  return b;
});
function setPressed(i) { buttons.forEach((x, j) => x.setAttribute('aria-pressed', String(j === i))); }

// Mud and wet toggles: the ibis gets muddy or wet over two seconds, and clean or dry again.
const weatherBar = document.getElementById('weather');
let wetButton;
for (const [key, name] of [['mud', 'Mud'], ['wet', 'Wet']]) {
  const b = document.createElement('button');
  if (key === 'wet') wetButton = b;
  b.textContent = name;
  b.setAttribute('aria-pressed', String(weather[key] > 0));
  b.onclick = () => {
    weather[key] = weather[key] > 0 ? 0 : 1;
    b.setAttribute('aria-pressed', String(weather[key] > 0));
  };
  weatherBar.appendChild(b);
}
if (play) document.getElementById('hint').textContent = 'WASD or arrows: walk · Shift: run · Space: jump (hold to flutter) · tap the ground: go there · tap the bird: prod · drag: orbit';

if (params.has('bench')) {
  // Draw N frames in a blocking loop and put the mean frame time in the title.
  const n = Number(params.get('bench')) || 30, px = new Uint8Array(4), gl = renderer.getContext();
  const once = () => { frame(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px); };
  once();
  const t0 = performance.now();
  for (let i = 0; i < n; i++) once();
  document.title = 'BENCH ' + ((performance.now() - t0) / n).toFixed(2) + ' ms';
} else if (fixedTime !== null) {
  // Replay the move from 0 on a new character, with the effects, so the dust at t is always the same.
  // root=1: place the bird where the move took it, to see turns and steps on the ground.
  ibises.forEach((ibis, i) => {
    ibis.character = new Character({ seed: i });
    ibis.inPlace = params.get('root') !== '1';
    playScript(ibis.character, scripts[i].move, fixedTime, dt => { ibis.update(dt); fx.update(dt, [ibis], camera); });
  });
  if (params.get('root') === '1') {
    // The camera keeps its view and moves with the bird.
    const shift = new THREE.Vector3(bird.object.position.x, 0, bird.object.position.z);
    camera.position.add(shift);
    controls.target.add(shift);
    controls.update();
    fx.update(0, ibises, camera);
  }
  renderer.render(scene, camera);
  document.title = 'DONE';
} else {
  renderer.setAnimationLoop(frame);
}
