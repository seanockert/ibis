// flap.html: Greedy Guts, the take-off test. The ibis runs at a paling fence and flaps to get over it.
// Each fence cleared, it eats one more chip and gets fatter. A crash ends the run. Rules: takeoff.js.
//
// URL parameters: bot=1 (a bot flaps on time), fat=N (start with N chips), t=SECONDS (run that long at 60
// steps per second, draw one frame, title DONE, for tools/shot.mjs), seed.
import * as THREE from 'three';
import { IBIS } from '../ibis/bird.js';
import { IbisEffects } from '../ibis/effects.js';
import { Ibis, loadIbis } from '../ibis/Ibis.js';
import { IbisSound } from '../ibis/sound.js';
import { Character } from '../ibis/motion/character.js';
import { bezier, HEAD_SCALE } from '../ibis/rig.js';
import { clamp, mix, smoothstep, Spring } from '../ibis/motion/spring.js';
import { lockScreen } from '../app/screen.js';
import { toonParts } from '../world/props.js';
import { srgb } from '../world/util.js';
import { ITEMS, itemMesh } from '../gulp/items.js';
import { GulpSound } from '../gulp/sound.js';
import { Takeoff, TAKEOFF } from './takeoff.js';

const FOCAL = 3.2;
const CAMERA = { yaw: 0.1, pitch: 0.06, dist: 12, y: 2.2, lag: 0.3, rise: 0.8 };   // rise: the camera goes up with a bird above 2
const GROUND_LIT = srgb(0.925, 0.902, 0.855);
const GROUND_SHADE = srgb(0.80, 0.78, 0.86);
const SKY = srgb(0.80, 0.88, 0.93);
// Wing spread (radians) through a beat: up and ready, down at the end of the stroke, tired after the window.
const WING = { up: 1.65, down: 0.1, tired: 1.0, flutter: [0.9, 0.45, 55] };
// The flying pose: body forward, feet tucked back (character space).
const FLY = { pitch: 0.38, headPitch: -0.15, stretch: 1.05, foot: [0.2, 0.32, -0.28] };
const BELLY = { a: [0, 0.12, -0.12], b: [0, 0.12, 0.1], base: 0.3, grow: 0.034 };   // grow: radius for each chip
const ROUND = { eat: 1.35, next: 1.1, card: 0.9 };   // seconds: the chip, from a clear to the next round, to the crash card
const FENCE_C = { paling: [srgb(0.70, 0.58, 0.46), srgb(0.50, 0.42, 0.42), srgb(0.27, 0.20, 0.16)], rail: [srgb(0.60, 0.48, 0.38), srgb(0.42, 0.34, 0.36), srgb(0.24, 0.17, 0.14)] };

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const fixedTime = params.has('t') ? num('t', 0) : null;
const bot = params.get('bot') === '1';
lockScreen();

const asset = await loadIbis(IBIS);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(num('scale', devicePixelRatio), 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = SKY;
const camera = new THREE.PerspectiveCamera(2 * Math.atan(1 / FOCAL) * 180 / Math.PI, 1, 0.1, 200);
const size = () => {
  const w = canvas.clientWidth || innerWidth, h = canvas.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
};
size();
new ResizeObserver(size).observe(canvas);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
Object.assign(sun.shadow.camera, { left: -8, right: 8, top: 8, bottom: -8, near: 0.5, far: 40 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.01;
scene.add(sun, sun.target, ground(), fence());

const ibis = new Ibis(asset);
ibis.inPlace = true;
scene.add(ibis.object);
let c = null;
// A new character at the start: the feet plant in world space, so the bird can't move there by a jump.
function freshBird() {
  c = ibis.character = new Character();
  c.controller.heading = c.controller.wantHeading = Math.PI / 2;
  c.controller.position.set(TAKEOFF.start, 0, 0);
  c.animator.stance = (P, dt) => stance(P, dt);
}
freshBird();
const fx = new IbisEffects(asset);
scene.add(fx.object);
const sound = fixedTime === null ? new IbisSound() : null;
sound?.load('honk', '/sfx/honk.m4a');
const sfx = sound && new GulpSound(sound);

// ---- the game ----
const hud = {
  score: document.querySelector('.score'), best: document.querySelector('.best'), ring: document.getElementById('ring'),
  title: document.querySelector('.title'), over: document.querySelector('.over'), pops: document.querySelector('.pops'),
};
const game = {
  fat: num('fat', 0), best: loadBest(), time: 0, phase: 'title', at: 0, run: null, ghost: [], path: [],
  chip: null, lump: -1, air: new Spring(0, 10, 1), belly: new Spring(0, 5, 0.6), slide: 0,
};
game.run = new Takeoff(game.fat);
const ghost = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0x262838, size: 4, sizeAttenuation: false, transparent: true, opacity: 0.35 }));
scene.add(ghost);
window.flap = { game, ibis, step: dt => step(dt), render: () => { aim(0); renderer.render(scene, camera); } };

function press() {
  const g = game;
  if (g.phase === 'title') { hud.title.hidden = true; sfx?.start(); begin('wait'); return; }
  if (g.phase === 'over') { if (g.time - g.at > ROUND.card + 0.4) { g.fat = 0; hud.over.hidden = true; newRound(false); } return; }
  if (g.phase === 'eat') { finishEat(); }
  if (g.phase === 'wait') begin('run');
  if (g.phase === 'run') g.run.press();
}

function begin(phase) { game.phase = phase; game.at = game.time; }

// A new attempt at the fence. eat: one more chip first.
function newRound(eat) {
  const g = game;
  if (g.path.length) g.ghost = g.path;
  g.path = [];
  g.run = new Takeoff(g.fat);
  g.slide = 0;
  freshBird();
  ghost.geometry.setAttribute('position', new THREE.Float32BufferAttribute(g.ghost.flat(), 3));
  if (!eat) { begin('wait'); return; }
  begin('eat');
  c.act('gulp');
  g.chip = itemMesh(ITEMS.chip, asset.uniforms);
  scene.add(g.chip);
  g.lump = 0;
}

function finishEat() {
  const g = game;
  if (g.chip) { scene.remove(g.chip); g.chip = null; }
  begin('wait');
}

function step(dt) {
  const g = game, run = g.run;
  g.time += dt;
  if (bot) botStep();
  if (g.phase === 'run') {
    run.step(dt);
    for (const e of run.events) onEvent(e);
    g.path.push([run.x, run.y + 1.1, 0]);
  }
  if (g.phase === 'crash') {
    // Slides down the face of the fence.
    g.slide = Math.min(g.slide + dt, 0.6);
    run.y = Math.max(run.y - dt * 4 * smoothstep(0.15, 0.4, g.slide), 0);
    if (g.time - g.at > ROUND.card) { begin('over'); hud.over.hidden = false; hud.over.querySelector('.final').textContent = g.fat; hud.over.querySelector('.note').textContent = g.newBest ? 'New best!' : `Best ${g.best}`; sfx?.over(ibis.object.position); }
  }
  if (g.phase === 'eat' && g.time - g.at > ROUND.eat) finishEat();
  if (g.phase === 'cleared' && g.time - g.at > ROUND.next) { g.fat++; newRound(true); }

  // The bird: it runs on the ground through the gait, and its root follows the rules.
  c.drive = (g.phase === 'run' && run.state === 'run') || g.phase === 'cleared' && run.y <= 0 ? Math.max(run.vx, 0) : 0;
  if (g.phase === 'cleared') run.vx *= Math.exp(-dt * 3);
  ibis.update(dt);
  ibis.object.position.set(run.x, run.y, 0);
  ibis.object.rotation.set(0, Math.PI / 2, 0);
  ibis.object.updateMatrixWorld();
  placeChip();
  bulges(dt);
  fx.update(dt, [ibis], camera);
  aim(dt);
  sound?.update([ibis], camera);
  ui();
}

function onEvent(e) {
  const g = game, at = ibis.object.position.clone().setY(ibis.object.position.y + 1.6);
  if (e.type === 'flap') {
    if (e.kind === 'perfect') pop(g.run.chain > 2 ? `Perfect x${g.run.chain}` : 'Perfect', at, 'perfect');
    if (e.kind === 'early') { pop('Flail!', at, 'bad'); c.animator.blink(); }
    if (e.kind === 'late') pop('Late', at, 'good');
  }
  if (e.type === 'scrape') pop('Scraped!', at, 'good');
  if (e.type === 'crash') {
    begin('crash');
    c.act('bonk');
    fx.hit(ibis);
    sfx?.bonk(at);
    pop('Splat!', at, 'bad');
    if (g.fat > g.best) { g.best = g.fat; g.newBest = true; saveBest(g.best); } else g.newBest = false;
  }
  if (e.type === 'land' && e.over) {
    begin('cleared');
    c.act('happy');
    fx.cloud?.(ibis.object.position.clone().setY(0.05), new THREE.Vector3(), { size: 0.14, speed: 0.5, up: 0.2 }, 4);
    pop(g.run.scraped ? 'Just!' : 'Cleared!', at, 'perfect');
    sfx?.swallowed(at, g.fat + 1);
    if (g.fat + 1 > g.best) { g.best = g.fat + 1; saveBest(g.best); }
  }
}

// The flying pose and the wings through the beat, under the actions.
function stance(P, dt) {
  const run = game.run, flying = run.state === 'air' || game.phase === 'crash';
  const k = clamp(game.air.update(dt, flying ? 1 : 0), 0, 1);
  if (k <= 0.001) return;
  P.pitch = mix(P.pitch, FLY.pitch, k);
  P.headPitch = mix(P.headPitch, FLY.headPitch, k);
  P.stretch = mix(P.stretch, FLY.stretch, k);
  P.bob = mix(P.bob, 0, k);
  const [fx_, fy, fz] = FLY.foot;
  P.footL.lerp(new THREE.Vector3(fx_, fy, fz), k);
  P.footR.lerp(new THREE.Vector3(-fx_, fy, fz), k);
  const last = run.flaps[run.flaps.length - 1];
  const s = run.since, stroke = TAKEOFF.stroke, rec = run.recover;
  let w;
  if (last?.kind === 'early' && s < rec) w = WING.flutter[0] + WING.flutter[1] * Math.sin(WING.flutter[2] * s);
  else if (s < stroke) w = mix(WING.up, WING.down, smoothstep(0, 1, s / stroke));
  else if (s < rec) w = mix(WING.down, WING.up, smoothstep(0, 1, (s - stroke) / (rec - stroke)));
  else w = mix(WING.up + 0.04 * Math.sin(60 * s), WING.tired, smoothstep(0, 0.3, s - rec - run.window));
  P.wingL = P.wingR = mix(P.wingL, w, k);
  P.sweepL = P.sweepR = mix(P.sweepL, s < stroke ? 0.35 : 0, k);
  P.jaw = Math.max(P.jaw, 0.2 * k);
  // Strain shows more with each chip.
  P.lid = mix(P.lid, last?.kind === 'early' ? -0.4 : 0.2 + 0.03 * Math.min(game.fat, 10), k);
  P.lowLid = mix(P.lowLid, 0.3, k);
}

// The chip in the bill while the gulp action takes it in, then the lump down the neck.
function placeChip() {
  const g = game;
  if (!g.chip) return;
  const t = g.time - g.at;
  g.chip.position.copy(ibis.object.localToWorld(headPoint([0, -0.46, 0.73])));
  g.chip.quaternion.setFromRotationMatrix(new THREE.Matrix4().extractRotation(ibis.object.matrixWorld).multiply(ibis.rig.headRot)).multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), Math.PI / 2));
  g.chip.scale.setScalar(1 - smoothstep(0.05, 0.2, t));
  if (t > 0.2) { scene.remove(g.chip); g.chip = null; }
}

function bulges(dt) {
  const g = game, R = ibis.rig;
  const t = g.phase === 'eat' ? g.time - g.at : -1;
  if (t > 0.3 && t < 1.05) {
    const s = 1 - (smoothstep(0.32, 0.44, t) + smoothstep(0.54, 0.66, t) + smoothstep(0.76, 0.88, t)) / 3;
    const a = bezier(R.neckBase, R.neckCtrl, R.neckTip, clamp(s + 0.12, 0, 0.85)), b = bezier(R.neckBase, R.neckCtrl, R.neckTip, clamp(s - 0.12, 0, 0.85));
    const front = new THREE.Vector3(0, 0, 0.06);
    ibis.bulge(0, a.add(front), b.add(front), 0.11, smoothstep(0.3, 0.36, t) * (1 - smoothstep(0.88, 1.0, t)));
  } else ibis.bulge(0, new THREE.Vector3(), new THREE.Vector3(), 0, 0);
  const shown = t >= 0 && t < 0.95 ? g.fat - 1 : g.fat;
  const f = Math.max(g.belly.update(dt, Math.max(shown, 0)), 0);
  ibis.bulge(1, bodyPoint(BELLY.a), bodyPoint(BELLY.b), BELLY.base + BELLY.grow * f, smoothstep(0, 1, f));
}

const headPoint = h => new THREE.Vector3(...h).multiplyScalar(HEAD_SCALE).applyMatrix4(ibis.rig.headRot).add(ibis.rig.head);
const bodyPoint = b => new THREE.Vector3(...b).applyMatrix4(ibis.rig.body).add(ibis.rig.pelvis);

// ---- view ----
let camX = -4, camY = CAMERA.y;
function aim(dt) {
  const want = clamp(game.run.x / 2 + 0.6, -3.6, 2), up = CAMERA.y + CAMERA.rise * Math.max(game.run.y - 2, 0);
  const k = dt > 0 ? 1 - Math.pow(2, -dt / CAMERA.lag) : 1;
  camX += (want - camX) * k;
  camY += (up - camY) * k;
  const target = new THREE.Vector3(camX, camY, 0);
  camera.position.set(Math.sin(CAMERA.yaw) * Math.cos(CAMERA.pitch), Math.sin(CAMERA.pitch), Math.cos(CAMERA.yaw) * Math.cos(CAMERA.pitch)).multiplyScalar(CAMERA.dist).add(target);
  camera.lookAt(target);
  sun.target.position.set(camX, 0, 0);
  sun.position.copy(asset.sun).multiplyScalar(15).add(sun.target.position);
}

// The ring at the bird: it closes in to the inner circle as the wings come up, and goes green while a
// flap is full strength.
function ui() {
  const g = game, run = g.run;
  hud.score.textContent = `${g.fat} ${g.fat === 1 ? 'chip' : 'chips'}`;
  hud.best.textContent = `Best ${g.best}`;
  const show = g.phase === 'run' && run.state === 'air';
  hud.ring.hidden = !show;
  if (!show) return;
  const p = ibis.object.position.clone().setY(ibis.object.position.y + 1.2).project(camera);
  hud.ring.style.left = `${(p.x * 0.5 + 0.5) * 100}%`;
  hud.ring.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
  const b = run.since / run.recover;
  hud.ring.style.setProperty('--close', String(clamp(1 + 1.6 * (1 - b), 1, 2.6)));
  hud.ring.dataset.state = run.ready ? 'ready' : b < 1 ? 'wait' : 'late';
}

function pop(text, at, kind) {
  const p = at.clone().project(camera);
  const el = document.createElement('div');
  el.className = 'pop ' + kind;
  el.textContent = text;
  el.style.left = `${(p.x * 0.5 + 0.5) * 100}%`;
  el.style.top = `${(-p.y * 0.5 + 0.5) * 100}%`;
  hud.pops.append(el);
  setTimeout(() => el.remove(), 900);
}

// A bot for the tools: it hops at -4.5 and flaps at the start of each window until it is over the fence.
// It clears about 9 chips.
function botStep() {
  const g = game, run = g.run;
  if (g.phase === 'title' || g.phase === 'wait' || g.phase === 'over' && g.time - g.at > 2) return press();
  if (g.phase !== 'run') return;
  if (run.state === 'run' && run.x >= -4.5) run.press();
  else if (run.state === 'air' && run.since >= run.recover + 0.005 && run.since - run.recover < 0.03 && run.x < 0.8) run.press();
}

// ---- input ----
addEventListener('keydown', e => {
  if (!['Space', 'ArrowUp', 'KeyW', 'Enter'].includes(e.code) || e.repeat) return;
  e.preventDefault();
  press();
});
canvas.addEventListener('pointerdown', e => { e.preventDefault(); press(); });

if (fixedTime !== null) {
  for (let t = 0; t < fixedTime - 1e-9; t += 1 / 60) step(Math.min(1 / 60, fixedTime - t));
  aim(0);
  renderer.render(scene, camera);
  document.title = 'DONE';
} else {
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.05);
    last = now;
    step(dt);
    renderer.render(scene, camera);
  });
}

// ---- the set ----

// A timber paling fence across the run at x = 0: palings side by side, a top rail on the near face.
function fence() {
  const parts = [];
  const H = TAKEOFF.fence, w = 0.28;
  for (let i = -9; i <= 9; i++) {
    const h = H + 0.04 * Math.sin(i * 2.7);
    parts.push([new THREE.BoxGeometry(0.06, h, w - 0.02), FENCE_C.paling, [0, h / 2, i * w]]);
  }
  parts.push([new THREE.BoxGeometry(0.1, 0.12, 19 * w), FENCE_C.rail, [-0.08, H - 0.25, 0]]);
  parts.push([new THREE.BoxGeometry(0.1, 0.12, 19 * w), FENCE_C.rail, [-0.08, 0.35, 0]]);
  return new THREE.Group().add(...toonParts(parts, asset.uniforms));
}

function ground() {
  const material = new THREE.ShadowMaterial({ color: GROUND_SHADE, transparent: false, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.uniforms.litColor = { value: GROUND_LIT };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 litColor;\nvoid main() {')
      .replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', 'gl_FragColor = vec4( mix( color, litColor, getShadowMask() ), 1.0 );');
  };
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(400, 400), material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.receiveShadow = true;
  mesh.renderOrder = -1;
  return mesh;
}

const BEST_KEY = 'ibis-flap-best';
function loadBest() { try { return Number(localStorage.getItem(BEST_KEY)) || 0; } catch { return 0; } }
function saveBest(n) { try { localStorage.setItem(BEST_KEY, String(n)); } catch { /* no storage */ } }
