// gulp.html: Toss and gulp, an arcade game for the ibis alone. A side view, a plain ground, the bird and
// the things it catches. Rules: game.js.
//
// URL parameters: bot=1 (a bot plays), miss=3,5 (the bot is late on those catches), t=SECONDS (run that
// long at 60 steps per second, draw one frame, and set the title to DONE, for tools/shot.mjs), close=1 (a
// close camera on the head and the neck), yaw (camera turn, radians), seed, item (every item is this one).
import * as THREE from 'three';
import { IBIS } from '../ibis/bird.js';
import { IbisEffects } from '../ibis/effects.js';
import { Ibis, loadIbis } from '../ibis/Ibis.js';
import { IbisSound } from '../ibis/sound.js';
import { lockScreen } from '../app/screen.js';
import { Game } from './game.js';
import { GulpHud } from './hud.js';
import { GulpSound } from './sound.js';

const FOCAL = 3.2;   // the lens of the other views: vertical half-angle atan(1 / FOCAL)
// Camera: a side view, turned a little toward the bird's front, and the follow along x.
const CAMERA = { yaw: 0.3, pitch: 0.08, dist: 10, target: [0, 2.3], close: { dist: 4.2, target: [0.4, 1.9] }, follow: 0.5, lag: 0.25, shake: 0.12 };
const GROUND_LIT = new THREE.Color().setRGB(0.925, 0.902, 0.855, 'srgb');
const GROUND_SHADE = new THREE.Color().setRGB(0.80, 0.78, 0.86, 'srgb');
const SKY = new THREE.Color().setRGB(0.80, 0.88, 0.93, 'srgb');

const params = new URLSearchParams(location.search);
const num = (k, d) => (params.has(k) ? Number(params.get(k)) : d);
const fixedTime = params.has('t') ? num('t', 0) : null;
const close = params.get('close') === '1';
const bot = params.get('bot') === '1' ? { miss: (params.get('miss') ?? '').split(',').filter(Boolean).map(Number) } : null;
lockScreen();

const asset = await loadIbis(IBIS);
const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true });
renderer.setPixelRatio(Math.min(num('scale', devicePixelRatio), 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
const scene = new THREE.Scene();
scene.background = SKY;
const camera = new THREE.PerspectiveCamera(2 * Math.atan(1 / FOCAL) * 180 / Math.PI, 1, 0.1, 100);
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
Object.assign(sun.shadow.camera, { left: -6, right: 6, top: 6, bottom: -6, near: 0.5, far: 30 });
sun.shadow.bias = -0.0005;
sun.shadow.normalBias = 0.01;
scene.add(sun, sun.target, ground());

const ibis = new Ibis(asset);
scene.add(ibis.object);
const fx = new IbisEffects(asset);
scene.add(fx.object);
const sound = fixedTime === null ? new IbisSound() : null;
sound?.load('honk', '/sfx/honk.m4a');
const hud = new GulpHud(document.getElementById('hud'), camera);
const game = new Game({ ibis, asset, scene, fx, sound: sound && new GulpSound(sound), hud, seed: num('seed', Date.now() % 100000), bot, only: params.get('item') });
window.gulp = { game, ibis, camera, scene, step: dt => step(dt), render: () => { aim(0); renderer.render(scene, camera); } };   // for the console and the tools

// ---- input: keys, the on-screen buttons, and a tap anywhere else to catch ----
const held = { left: false, right: false };
const KEYS = { ArrowLeft: 'left', KeyA: 'left', ArrowRight: 'right', KeyD: 'right' };
const CATCH = ['Space', 'ArrowUp', 'KeyW', 'Enter'];
addEventListener('keydown', e => {
  if (KEYS[e.code]) held[KEYS[e.code]] = true;
  else if (CATCH.includes(e.code) && !e.repeat) game.press();
  else return;
  e.preventDefault();
});
addEventListener('keyup', e => { if (KEYS[e.code]) held[KEYS[e.code]] = false; });
for (const el of document.querySelectorAll('[data-hold]')) {
  const key = el.dataset.hold;
  el.addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); held[key] = true; el.setPointerCapture(e.pointerId); });
  for (const type of ['pointerup', 'pointercancel']) el.addEventListener(type, () => { held[key] = false; });
}
document.getElementById('catch').addEventListener('pointerdown', e => { e.preventDefault(); e.stopPropagation(); game.press(); });
canvas.addEventListener('pointerdown', e => { e.preventDefault(); game.press(); });
addEventListener('blur', () => { held.left = held.right = false; });

// ---- camera ----
let followX = 0, shake = 0, lives = game.lives;
function aim(dt) {
  if (game.lives < lives) shake = 1;
  lives = game.lives;
  const view = close ? CAMERA.close : CAMERA;
  const want = close ? ibis.object.position.x : ibis.object.position.x * CAMERA.follow;
  followX += (want - followX) * (dt > 0 ? 1 - Math.pow(2, -dt / CAMERA.lag) : 1);
  shake = Math.max(shake - dt * 4, 0);
  const jolt = CAMERA.shake * shake * shake;
  const yaw = num('yaw', CAMERA.yaw), target = new THREE.Vector3(followX + view.target[0], view.target[1], 0);
  camera.position.set(Math.sin(yaw) * Math.cos(CAMERA.pitch), Math.sin(CAMERA.pitch), Math.cos(yaw) * Math.cos(CAMERA.pitch))
    .multiplyScalar(view.dist).add(target);
  camera.position.x += jolt * Math.sin(game.time * 90);
  camera.position.y += jolt * Math.cos(game.time * 77);
  camera.lookAt(target);
  // The sun's shadow area follows the bird.
  sun.target.position.set(ibis.object.position.x, 0, 0);
  sun.position.copy(asset.sun).multiplyScalar(10).add(sun.target.position);
}

function step(dt) {
  game.update(dt, (held.right ? 1 : 0) - (held.left ? 1 : 0));
  fx.update(dt, [ibis], camera);
  aim(dt);
  sound?.update([ibis], camera);
}

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

// Ground: the lit colour, with the shade colour where a shadow falls. It draws first and writes no depth,
// so it can't cover the outline round the feet.
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

