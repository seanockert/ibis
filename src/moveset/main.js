// moves.html: every move of MOVES (src/moves.js) in a grid of cards, by group. Each card has its own
// bird that plays its move again and again, with its dust and anger lines. One canvas over the page
// draws the bird of each card in view, with a scissor. The camera of a card follows its bird, up in a jump too.
// Only the card under the pointer (or the last card tapped) makes sound. The first click starts the sound.
//
// The beak moves have props (props.js): a tennis ball, a gnome, hot chips, a hose.
//
// URL parameters: view (front, side, three-quarter, back), t=SECONDS (each move run to that time at 60
// steps per second, one frame, title DONE, for tools/shot.mjs), only=N (one card: move N, as anim=N).
import * as THREE from 'three';
import { plainGround } from '../app/stage.js';
import { IBIS } from '../ibis/bird.js';
import { IbisEffects } from '../ibis/effects.js';
import { IbisSound } from '../ibis/sound.js';
import { GulpSound } from '../gulp/sound.js';
import { makeProps } from './props.js';
import { Ibis, loadIbis } from '../ibis/Ibis.js';
import { Character } from '../ibis/motion/character.js';
import { damp } from '../ibis/motion/spring.js';
import { GROUPS, MOVES, playScript, startMove } from '../moves.js';

const FOCAL = 3.2;   // the lens of the other views: vertical half-angle atan(1 / FOCAL)
const VIEWS = { 'Three-quarter': -0.8, Front: 0, Side: 1.4, Back: Math.PI };   // camera yaw
const PITCH = 0.22;
const DIST = 6.8;      // closer than IBIS.view, with room for the bill to the sky
const FOLLOW = 0.15;   // half-life (s) of the camera's follow of the bird
const GROUND_LIT = new THREE.Color().setRGB(0.925, 0.902, 0.855, 'srgb');

const params = new URLSearchParams(location.search);
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const only = params.has('only') ? Number(params.get('only')) - 1 : null;
const viewName = Object.keys(VIEWS).find(k => k.toLowerCase() === params.get('view')) ?? 'Three-quarter';

const asset = await loadIbis(IBIS);
const sound = fixedTime === null ? new IbisSound() : null;
sound?.load('honk', '/sfx/honk.m4a');
const gulpSound = sound && new GulpSound(sound);
let heard = null;   // the card that makes sound
const hint = document.getElementById('hint');
if (sound) {
  const show = () => { hint.hidden = sound.ctx.state === 'running'; };
  sound.ctx.addEventListener('statechange', show);
  show();
} else hint.hidden = true;
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(Math.min(Number(params.get('scale')) || devicePixelRatio, 1.5));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const size = () => renderer.setSize(canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight, false);
size();
new ResizeObserver(size).observe(canvas);

const scene = new THREE.Scene();
scene.background = GROUND_LIT;
const camera = new THREE.PerspectiveCamera(2 * Math.atan(1 / FOCAL) * 180 / Math.PI, 1, 0.1, 100);
const sun = new THREE.DirectionalLight(0xffffff, 1);
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.01;
const ground = plainGround();
scene.add(sun, sun.target, ground);

// ---- the cards ----
const groups = document.getElementById('groups');
const cards = [];
for (const group of GROUPS) {
  const moves = MOVES.map((move, i) => ({ move, i })).filter(m => m.move.group === group && (only === null || m.i === only));
  if (!moves.length) continue;
  const h = document.createElement('h2');
  h.textContent = `${group} (${moves.length})`;
  const grid = document.createElement('div');
  grid.className = 'grid';
  for (const { move, i } of moves) {
    const el = document.createElement('button');
    el.className = 'card';
    el.innerHTML = '<div class="view"></div><div class="name"></div>';
    el.querySelector('.name').textContent = move.name;
    el.title = 'Start again';
    const ibis = new Ibis(asset, { seed: i });
    const fx = new IbisEffects(asset);
    const props = makeProps(move.name, asset);
    scene.add(ibis.object, fx.object, ...(props ? [props.object] : []));
    const card = { i, ibis, fx, props, view: el.querySelector('.view'), focus: new THREE.Vector3(), run: null, time: 0 };
    el.addEventListener('click', () => { heard = card; restart(card); });
    el.addEventListener('pointerenter', () => { heard = card; });
    el.addEventListener('pointerleave', e => { if (heard === card && e.pointerType === 'mouse') heard = null; });
    restart(card);
    cards.push(card);
    grid.appendChild(el);
  }
  groups.append(h, grid);
}
document.getElementById('count').textContent = `${MOVES.length} moves`;

// A new bird at the origin that plays the move from 0.
function restart(card) {
  const c = card.ibis.character = new Character({ seed: card.i });
  if (card.props) {
    for (const t of card.props.things) t.hide();
    const act = c.act.bind(c);
    c.act = (name, options) => { act(name, options); card.props.start(name, c); };
  }
  card.run = startMove(card.ibis.character, card.i);
  card.time = 0;
  card.ibis.update(0);
  card.focus.set(0, 0, 0);
}

// ---- the views ----
let yaw = VIEWS[viewName];
const views = document.getElementById('views');
for (const [name, value] of Object.entries(VIEWS)) {
  const b = document.createElement('button');
  b.textContent = name;
  b.setAttribute('aria-pressed', String(value === yaw));
  b.addEventListener('click', () => {
    yaw = value;
    for (const x of views.children) x.setAttribute('aria-pressed', String(x === b));
  });
  views.appendChild(b);
}

// The camera, the ground and the sun of a card, round its bird.
function aim(card) {
  const { target } = IBIS.view, f = card.focus;
  camera.position.set(Math.sin(yaw) * Math.cos(PITCH), Math.sin(PITCH), Math.cos(yaw) * Math.cos(PITCH)).multiplyScalar(DIST);
  camera.position.add(f).add(new THREE.Vector3(...target));
  camera.lookAt(f.x + target[0], f.y + target[1], f.z + target[2]);
  ground.position.set(f.x, 0, f.z);   // the bird's height (f.y) moves the camera, not the ground
  sun.target.position.set(f.x, 0, f.z);
  sun.position.copy(asset.sun).multiplyScalar(6).add(sun.target.position);
}

// Draws each card in view. The scissor stops at the bottom of the header.
function render() {
  const top = document.querySelector('header').getBoundingClientRect().bottom, h = canvas.clientHeight;
  renderer.setScissorTest(false);
  renderer.setClearColor(0x000000, 0);   // the background of the last render left its colour
  renderer.clear();
  renderer.setScissorTest(true);
  for (const card of cards) {
    const r = card.view.getBoundingClientRect();
    if (r.bottom <= top || r.top >= h || r.width === 0) continue;
    for (const c of cards) {
      c.ibis.object.visible = c.fx.object.visible = c === card;
      if (c.props) c.props.object.visible = c === card;
    }
    camera.aspect = r.width / r.height;
    camera.updateProjectionMatrix();
    aim(card);
    const clip = Math.max(r.top, top);
    renderer.setViewport(r.left, h - r.bottom, r.width, r.height);
    renderer.setScissor(r.left, h - r.bottom, r.width, r.bottom - clip);
    renderer.render(scene, camera);
  }
}

// One step of each card: the move script, the bird, its effects. The camera follows the bird.
function step(card, dt, follow) {
  const { ibis, fx } = card;
  card.run(ibis.character, card.time);
  card.time += dt;
  ibis.update(dt);
  card.props?.update(dt, ibis);
  if (ibis.character.events.some(e => e.type === 'shakeOff')) fx.shakeOff(ibis);
  card.focus.lerp(ibis.character.position, follow);
  aim(card);
  fx.update(dt, [ibis], camera);
  if (sound && card === heard) hear(card);
}

// The card's sounds. The game adds some sounds outside the actions; they are added here too:
// the snap of a prop that a peck picks up (physics.js), the whoosh of a fling (fling.js), the gulps (src/gulp/).
function hear(card) {
  const { events } = card.ibis.character;
  camera.updateMatrixWorld();
  for (const e of [...events]) {
    if (e.type === 'grab') events.push({ type: 'pick' });
    if (e.type === 'fling') events.push({ type: 'whoosh' });
  }
  sound.update([card.ibis], camera);
  for (const e of events) if (e.type === 'gulp') gulpSound.gulp(card.ibis.object.position, e.beat);
}

if (fixedTime !== null) {
  for (const card of cards) {
    playScript(card.ibis.character, card.i, fixedTime, dt => {
      card.ibis.update(dt);
      card.props?.update(dt, card.ibis);
      card.focus.copy(card.ibis.character.position);
      aim(card);
      card.fx.update(dt, [card.ibis], camera);
    });
  }
  render();
  document.title = 'DONE';
} else {
  let last = performance.now();
  renderer.setAnimationLoop(() => {
    const now = performance.now(), dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    for (const card of cards) step(card, dt, damp(FOLLOW, dt));
    render();
  });
}
