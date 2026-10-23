// three.js demo of the baked ibis. URL params: anim (0 free play, 1 and up one move from src/moves.js),
// t (fixed time), yaw and pitch (fixed camera, as in sdf.html), scale, count (ibises in a grid), bench
// (frames to time), mud and wet (0 to 1), root (1: with t, place the bird where the move took it),
// props (0: no ball and bin in free play), physics (1: show the colliders), env (0 or 1: the street and
// the sky; on in free play, off in the fixed views, so they still match sdf.html), sound (0: no sound),
// terrain (1: steps and a ramp in free play, to test the foot placement).
// Free play: WASD or the arrow keys walk, Shift runs, Space jumps (hold to flutter). The joystick
// walks, and runs when pushed far. A tap on the ground walks there; a tap on the bird prods it. The bird
// can push the football, the wheelie bin, the cardboard boxes and the cereal boxes. A step or a jump in
// the puddle splashes mud on it.
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { IbisEffects } from './ibis/effects.js';
import { IbisSound } from './ibis/sound.js';
import { Ibis, loadIbis } from './ibis/Ibis.js';
import { Character } from './ibis/motion/character.js';
import { MOVE } from './ibis/motion/controller.js';
import { Spring } from './ibis/motion/spring.js';
import { ARENA, MOVES, playScript, startMove } from './moves.js';
import { Physics } from './world/physics.js';
import { Ball, Bin, Box, Cereal } from './world/props.js';
import { Stubbies } from './world/stubbies.js';
import { Terrain } from './world/terrain.js';
import { Grade } from './world/grade.js';
import { Backdrop } from './world/backdrop.js';
import { Sky } from './world/sky.js';
import { inPlay, PLAY, printOn, PROFILE, Street, streetHeight } from './world/street.js';
import { inPuddle, Puddle, splashMud } from './world/puddle.js';
import { Fence } from './world/fence.js';
import { Tufts } from './world/tufts.js';

const FOCAL = 3.2;   // the SDF view's lens: vertical half-angle atan(1 / FOCAL)
const CAM_DIST = 6.2;        // close camera, as in the SDF view: screenshots and the grid
const CAM_DIST_PLAY = 12.5;  // free play: the whole walk circle is in view, then the camera follows
const TARGET = new THREE.Vector3(0, 1, 0.3);
const TARGET_PLAY = new THREE.Vector3(0, 0.9, 0);
// Free play camera: a loose follow of a point a little ahead of the bird. The orbit centre follows the
// point on critically damped springs (no overshoot), so the camera trails the bird as it starts to move,
// then overtakes it and shows where it goes. The look-ahead builds and turns slowly, so a quick turn or
// a stop doesn't swing the view. Up: the view follows part of a jump, and leads a little on the way up.
// Seconds and Hz; distances in units.
const CAMERA = {
  lead: 1.2, maxLead: 4,   // look ahead: seconds of movement, and the most
  leadFreq: [0.4, 0.7],    // how fast the look-ahead builds and turns, and shrinks at a stop (quicker,
                           // so the view doesn't drift on far past the bird)
  follow: 0.5,             // horizontal follow: low is loose
  catchUp: 0.25,           // the follow gets this much stiffer for each unit the bird is past catchFrom
  catchFrom: 3,            // (so it can't leave the view)
  slack: 0.35,             // a soft dead zone round the point: small shuffles don't move the camera
  rise: 0.6,               // part of the height above the floor (a jump) the view follows. The floor: all
  riseLead: 0.15,          // seconds of vertical speed to look ahead, up to riseMax up
  riseMax: 0.8,
  riseFreq: 0.8,           // vertical follow: quicker than horizontal, so a jump stays in view
};
const GROUND_LIT = new THREE.Color().setRGB(0.925, 0.902, 0.855, 'srgb');
const GROUND_SHADE = new THREE.Color().setRGB(0.80, 0.78, 0.86, 'srgb');
const WEATHER_RATE = 0.5;   // mud and wet change per second when toggled
const TAP_PX = 8;           // a pointer that moves less than this between down and up is a tap
const STICK_DEAD = 0.12;    // joystick dead zone, part of its reach
const STICK_RUN = 0.65;     // the joystick walks up to this part of its reach, then runs
const CAM_MIN_Y = 0.3;      // the orbit can't take the camera lower than this
// Cardboard boxes in free play, 60 to 70% of the bird's height (2): [x, z], size [x, y, z], heading.
// Two on the nature strip, one on the footpath.
const BOXES = [[[-3.6, 1.2], [1.25, 1.3, 1.1], 0.3], [[-5.6, -0.3], [1.0, 1.2, 1.0], -0.5], [[-4.2, 4.2], [1.3, 1.4, 1.05], 0.1]];
// Cereal boxes in free play, on the footpath: [x, z], size, heading, print (CEREAL.prints in props.js).
const CEREALS = [[[-2.4, 4.6], [0.6, 0.86, 0.2], -0.4, 'sunny'], [[-1.6, 3.9], [0.52, 0.74, 0.18], 0.5, 'berry']];
// Head pin of the stubbies on the road, in the near lane: kick the football down off the kerb at them.
const PINS = [1.8, -6.2];
// Free play sun shadow: half size of the area, map size, and the sun's distance from the area's centre.
const SHADOW = { half: 10, map: 4096, sun: 20 };

const params = new URLSearchParams(location.search);
// ui=0 hides the buttons and the joystick, for tools/strip.mjs.
if (params.get('ui') === '0') for (const el of document.querySelectorAll('.bar, .stick, .acts')) el.style.display = 'none';
let anim = Number(params.get('anim') || 0);
const fixedTime = params.has('t') ? Number(params.get('t')) : null;
const scale = Number(params.get('scale') || Math.min(window.devicePixelRatio, 1.5));
const count = Number(params.get('count') || 1);
const weather = { mud: Number(params.get('mud') || 0), wet: Number(params.get('wet') || 0) };   // targets
const play = count === 1 && fixedTime === null && !params.has('yaw') && !params.has('bench');
const env = params.has('env') ? params.get('env') === '1' : play;

const canvas = document.getElementById('c');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, stencil: true, preserveDrawingBuffer: true });
renderer.setPixelRatio(scale);
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

const scene = new THREE.Scene();
scene.background = GROUND_LIT;
const camera = new THREE.PerspectiveCamera(2 * Math.atan(1 / FOCAL) * 180 / Math.PI, innerWidth / innerHeight, 0.1, env ? 800 : 100);
const yaw = params.has('yaw') ? Number(params.get('yaw')) : -0.8;
const pitch = params.has('pitch') ? -0.05 + 1.15 * Number(params.get('pitch')) : play ? 0.25 : 0.22;
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
sun.shadow.normalBias = 0.02;   // no shadow acne on the toon bands
if (play) {
  // Free play: a wide shadow area round the camera's focus, so props away from the bird keep their
  // shadows. The map is larger, so a texel stays about as small as in the close views.
  sun.shadow.mapSize.set(SHADOW.map, SHADOW.map);
  const r = SHADOW.half;
  Object.assign(sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 2 * SHADOW.sun });
}
scene.add(sun, sun.target);

// Ground: plain background colour, with the shade colour where the shadow falls. It draws first and
// writes no depth, so it can't cover the outline round the feet.
const world = env ? [new Sky(asset.sun), new Street(asset.sun), new Tufts(), new Backdrop()] : [];
for (const part of world) scene.add(part.object);
// A muddy puddle on the nature strip: steps and jumps in it splash mud on the bird.
const puddle = env ? new Puddle(asset.sun) : null;
if (puddle) scene.add(puddle.object);
// With the street: bloom and the warm colour grade on the whole frame.
const grade = env ? new Grade(renderer, scene, camera) : null;
const draw = () => (grade ? grade.render() : renderer.render(scene, camera));
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
if (!env) scene.add(ground);

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
if (env) {
  fx.surface = (x, z) => (inPuddle(x, z) ? false : printOn(x, z));   // the colour of the strip: pressed grass, dust. None in the puddle
  fx.height = (x, z) => streetHeight(z);
}
scene.add(fx.object);
// Sound only where the frame loop runs: not in the fixed views or the bench.
const sound = fixedTime === null && !params.has('bench') && params.get('sound') !== '0' ? new IbisSound() : null;
sound?.load('/sfx/honk.m4a');
bird.character.controller.bounds = play ? PLAY : { x: [-ARENA - 0.5, ARENA + 0.5], z: [-ARENA - 0.5, ARENA + 0.5] };

// Props in free play: the bird pushes them, kicks and pecks the ball, and runs the bin over.
const physics = play && params.get('props') !== '0' ? new Physics({ ground: env ? PROFILE : null }) : null;
const props = [];
let physicsView = null;
if (physics) {
  physics.addFence({ x: [PLAY.x[0] - 0.5, PLAY.x[1] + 0.5], z: [PLAY.z[0] - 0.5, PLAY.z[1] + 0.5] });
  physics.addBird(bird);
  props.push(new Ball(physics, asset, [1.4, 1.3], 0.7), new Bin(physics, asset, [-1.3, -1.1], 0.87));
  for (const [at, size, heading] of BOXES) props.push(new Box(physics, asset, at, size, heading));
  for (const [at, size, heading, print] of CEREALS) props.push(new Cereal(physics, asset, at, size, heading, print));
  // Stubbies as bowling pins on the road (or on flat ground without the street).
  props.push(new Stubbies(physics, asset, PINS, { ground: env ? streetHeight(PINS[1]) : 0 }));
  for (const prop of props) scene.add(prop.object);
  if (params.get('terrain') === '1') scene.add(new Terrain(physics, asset).object);
  if (params.get('physics') === '1') {
    physicsView = await physics.debugView();
    scene.add(physicsView.object);
  }
}
// A white post and wire fence round the play area, with the street. With props, a wall for them too.
const fence = env ? new Fence(asset, physics) : null;
if (fence) scene.add(fence.object);
window.demo = { ibises, physics, props, puddle, fence, fx, sound, camera, controls, world, sun, grade, renderer, scene, render: draw };   // for the console
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
  const ax = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + stick.x;
  const ay = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + stick.y;
  // Camera relative: up on the keys and the joystick is away from the camera.
  const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
  const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
  const move = fwd.multiplyScalar(ay).add(right.multiplyScalar(ax));
  c.input.fast = keys.has('ShiftLeft') || keys.has('ShiftRight') || stickRun;
  if (move.lengthSq() > 0) goal = null;
  else if (goal) {
    move.set(goal.x - c.position.x, 0, goal.z - c.position.z);
    const d = move.length();
    if (d < 0.15) goal = null;
    else c.input.fast = goal.fast;
  }
  c.input.move.set(move.x, move.z);
  if (c.input.move.lengthSq() > 1) c.input.move.normalize();   // the joystick keeps its analog length
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
  // The street is not flat: two more tries at the height where the last one hit.
  let p = ray.ray.intersectPlane(groundPlane.set(groundPlane.normal, 0), new THREE.Vector3());
  for (let i = 0; i < 2 && p && env; i++) p = ray.ray.intersectPlane(groundPlane.set(groundPlane.normal, -streetHeight(p.z)), p);
  if (!p || !inPlay(p.x, p.z)) return;
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
    // A body shake throws off half the water and half the mud, as drops that fly off.
    if (ibis.character.events.some(e => e.type === 'shakeOff')) {
      fx.shakeOff(ibis);
      weather.wet = ibis.wet = Math.max(ibis.wet - 0.5, 0);
      weather.mud = ibis.mud = Math.max(ibis.mud - 0.5, 0);
      wetButton.setAttribute('aria-pressed', String(weather.wet > 0));
    }
  });
  // Puddle splashes: mud on the bird at once (the target too, so it stays), mud blobs and a splash sound.
  puddle?.update(dt, ibises);
  for (const e of puddle?.events ?? []) {
    e.ibis.mud = splashMud(e.ibis.mud, e);
    weather.mud = Math.max(weather.mud, e.ibis.mud);
    fx.splash(e.at, e.strength, e.land);
    sound?.splash(e, camera);
  }
  if (physics) {
    physics.step(dt);
    for (const prop of props) {
      prop.update(ibises);
      for (const e of prop.events) {
        if (e.type === 'slam') { if (e.kind !== 'glass') fx.burst(e.points, e.centre); sound?.slam(e, camera); }
        if (e.type === 'squash') { fx.burst(e.points, e.centre); sound?.squash(e, camera); }
      }
    }
    physicsView?.update();
  }
  fx.update(dt, ibises, camera);
  sound?.update(ibises, camera);
  // Keep the camera above the ground: the lowest polar angle for this distance.
  const reach = camera.position.distanceTo(controls.target);
  controls.maxPolarAngle = Math.PI / 2 + Math.asin(Math.min(Math.max((controls.target.y - CAM_MIN_Y) / reach, -1), 1));
  if (play) {
    follow(dt);
    shadowTo(controls.target);
  }
  const solids = props.flatMap(prop => prop.solids?.() ?? []);   // the tufts hide under the props
  for (const part of world) part.update?.(camera, dt, ibises, solids);
  draw();
}

// Centres the sun's shadow area on a point on the ground. The centre moves in whole shadow texels
// across the sun's view, so the shadow edges don't crawl as the camera follows the bird.
const sunRight = new THREE.Vector3(), sunUp = new THREE.Vector3(), centre = new THREE.Vector3();
function shadowTo(point) {
  const texel = 2 * SHADOW.half / SHADOW.map;
  sunRight.crossVectors(asset.sun, new THREE.Vector3(0, 1, 0)).normalize();
  sunUp.crossVectors(sunRight, asset.sun);
  const x = Math.round(point.dot(sunRight) / texel) * texel, y = Math.round(point.dot(sunUp) / texel) * texel;
  centre.copy(sunRight).multiplyScalar(x).addScaledVector(sunUp, y).addScaledVector(asset.sun, point.dot(asset.sun));
  sun.target.position.copy(centre);
  sun.position.copy(asset.sun).multiplyScalar(SHADOW.sun).add(centre);
}

// Moves the camera and its orbit centre together toward the point ahead of the bird (CAMERA), so a
// drag still orbits and the zoom stays.
const cam = {
  lead: [new Spring(0, CAMERA.leadFreq[0]), new Spring(0, CAMERA.leadFreq[0])],
  x: new Spring(TARGET_PLAY.x, CAMERA.follow), z: new Spring(TARGET_PLAY.z, CAMERA.follow),
  y: new Spring(TARGET_PLAY.y, CAMERA.riseFreq),
};
const shift = new THREE.Vector3();
function follow(dt) {
  const c = bird.character.controller, p = c.position;
  // Look ahead along the velocity on the ground.
  const k = Math.min(CAMERA.lead, CAMERA.maxLead / Math.max(Math.abs(c.speed), 1e-3));
  const tx = Math.sin(c.heading) * c.speed * k, tz = Math.cos(c.heading) * c.speed * k;
  const [lx, lz] = cam.lead;
  lx.freq = lz.freq = CAMERA.leadFreq[Math.hypot(tx, tz) < Math.hypot(lx.value, lz.value) ? 1 : 0];
  const ax = lx.update(dt, tx), az = lz.update(dt, tz);
  // The point, with a soft dead zone round it: near the centre the goal stays put.
  let gx = p.x + ax, gz = p.z + az;
  const dx = gx - cam.x.value, dz = gz - cam.z.value, d = Math.hypot(dx, dz);
  const keep = d > 1e-6 ? Math.max(0, 1 - CAMERA.slack / d) : 0;
  gx = cam.x.value + dx * keep;
  gz = cam.z.value + dz * keep;
  // Stiffer when the bird is far from the centre, so it stays in view.
  const away = Math.hypot(p.x - cam.x.value, p.z - cam.z.value);
  cam.x.freq = cam.z.freq = CAMERA.follow * (1 + CAMERA.catchUp * Math.max(0, away - CAMERA.catchFrom));
  const air = Math.max(p.y - c.floor, 0), up = Math.min(Math.max(c.vy * CAMERA.riseLead, 0), CAMERA.riseMax);
  const gy = TARGET_PLAY.y + c.floor + CAMERA.rise * air + (c.grounded ? 0 : up);
  shift.set(cam.x.update(dt, gx), cam.y.update(dt, gy), cam.z.update(dt, gz)).sub(controls.target);
  controls.target.add(shift);
  camera.position.add(shift);
  controls.update();
}

addEventListener('resize', () => {
  renderer.setSize(innerWidth, innerHeight, false);
  grade?.setSize(innerWidth, innerHeight);
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
});

// ---- buttons ----
// Free play: a joystick, a diamond of Threat, Squawk, Peck and Jump, and the other one-shot actions in
// the top bar. Jump acts while held.
// Other views: one button for each move script.
const bar = document.getElementById('bar');
let jumpButton = false, stickRun = false;
const stick = new THREE.Vector2();   // joystick: x right, y up, length 0 to 1 (with stickRun, of the run speed)
const moveIndex = name => MOVES.findIndex(m => m.name === name);
// Icons: 24 by 24 SVG, filled shapes and lines (class s) with a little bow in the edges, so they look hand drawn.
const ICONS = {
  Jump: '<path d="M11.8 1.6Q16.3 6 21.1 9.9Q20 11.2 18.7 12.4Q15.2 9.5 11.9 6.5Q8.6 9.3 5.5 12.4Q4.2 11.2 2.9 10.1Q7 5.5 11.8 1.6z"/><path d="M12.1 10.8Q16.8 15.1 21.4 19.5Q20 20.7 18.4 21.8Q15.5 18.6 12.2 15.9Q8.9 19 5.5 21.8Q4.1 20.8 3 19.6Q7.4 15 12.1 10.8z"/>',
  Peck: '<path d="M-1 0.9Q1.1 0.9 3.2 0.8Q5 1.1 6.8 1.4Q8.3 1.9 9.8 2.3Q11.3 3.2 12.9 4.1Q14 5.2 15.1 6.2Q16.1 7.5 17 8.9Q17.3 10.6 17.8 12.2Q17.9 14.2 18.1 16.2Q17.4 15 16.8 13.8Q16 13 15.2 12.2Q14.3 11.7 13.3 11.1Q12.2 10.7 11.1 10.4Q9.9 10.1 8.7 9.8Q7.3 9.8 6 9.8Q4.3 10 2.7 10Q0.9 5.4 -1 0.9z"/><path d="M20.3 21.8Q20.2 22.1 20 22.3Q19.8 22.5 19.6 22.8Q19.2 22.9 18.8 23Q18.4 23.1 17.9 23.2Q17.4 23.1 17 23.1Q16.6 23 16.2 22.8Q15.8 22.6 15.4 22.4Q15.1 22.1 14.8 21.8Q14.6 21.5 14.4 21.2Q14.4 20.8 14.4 20.5Q14.6 20.3 14.7 20Q15 19.8 15.3 19.6Q15.6 19.5 16 19.3Q16.5 19.3 16.9 19.2Q17.3 19.3 17.8 19.4Q18.2 19.5 18.6 19.6Q19 19.9 19.4 20.1Q19.7 20.4 20 20.7Q20.1 21 20.3 21.3Q20.3 21.5 20.3 21.8z"/>',
  Squawk: '<path d="M4.9 8.1Q7.9 4.6 10.6 0.9Q10.6 2.3 10.5 3.7Q13.4 2 16.4 0.4Q13.7 3.9 11 7.5Q11 6 10.8 4.4Q7.9 6.3 4.9 8.1z"/><path d="M5.1 12Q10.6 10.4 16 8.9Q15.1 10.3 14.2 11.7Q18.6 12.1 23.1 12.1Q17.5 13.3 12 14.9Q13 13.6 14.1 12.3Q9.6 12.3 5.1 12z"/><path d="M4.8 16Q9.3 17 13.8 18.3Q12.3 18.9 10.9 19.5Q13.8 21.5 16.6 23.7Q12.1 22.6 7.7 21.3Q9 20.8 10.3 20.3Q7.5 18.1 4.8 16z"/>',
  Threat: '<path d="M8.4 1.5Q12.1 1.7 15.7 1.4Q14.9 8.4 14.2 15.4Q12.2 15.2 10.3 15.3Q9.7 8.4 8.4 1.5z"/><path d="M15 20.1Q14.9 20.5 14.8 21Q14.6 21.4 14.4 21.8Q14.1 22.2 13.8 22.6Q13.3 22.8 12.9 22.9Q12.4 23 12 23.1Q11.5 23 11 22.9Q10.7 22.7 10.3 22.5Q9.9 22.2 9.6 21.9Q9.4 21.5 9.1 21Q9.1 20.5 9 20.1Q9.1 19.6 9.2 19.2Q9.4 18.8 9.5 18.4Q9.9 18 10.2 17.6Q10.6 17.4 11 17.3Q11.5 17.2 12 17.1Q12.4 17.2 12.9 17.3Q13.3 17.5 13.8 17.7Q14.1 18 14.5 18.3Q14.7 18.7 14.8 19.2Q14.9 19.6 15 20.1z"/>',
};
const icon = name => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name]}</svg>`;
const DIAMOND = [   // grid cell, move
  ['1 / 2', 'Threat'],
  ['2 / 1', 'Squawk'],
  ['2 / 3', 'Peck'],
  ['3 / 2', 'Jump'],
];
// Not in the free play row: the joystick and the diamond do them, or the bird does them itself (Shake
// head in the prod chain, Startle at the end of it, Happy from Squawk, Stumble when it runs into the bin or
// is prodded at a run).
const PAD = ['Idle', 'Walk', 'Run', 'Jump', 'Peck', 'Squawk', 'Threat', 'Turn', 'Prod', 'Shake head', 'Stumble',
  'Happy', 'Startle'];

// Jump: on while a pointer holds it.
function hold(b, set) {
  b.addEventListener('pointerdown', e => { b.setPointerCapture(e.pointerId); setFree(); set(true); });
  for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, () => set(false));
}

let buttons = [];
const topActions = document.createDocumentFragment();   // free play: the other actions, in the top bar after Wet
if (play) {
  const acts = document.getElementById('acts');
  for (const [area, name] of DIAMOND) {
    const move = MOVES[moveIndex(name)];
    const b = document.createElement('button');
    b.style.gridArea = area;
    b.setAttribute('aria-label', name);
    b.title = name;
    b.innerHTML = icon(name);
    if (move.hold) hold(b, on => { jumpButton = on; });
    else b.addEventListener('pointerdown', () => move.press(bird.character));
    acts.appendChild(b);
  }
  acts.hidden = false;

  // Joystick: the knob follows the pointer out to the rim. Its offset is the move input: the inner part
  // walks from still to the walk speed, the outer part runs from the walk speed to the run speed.
  const pad = document.getElementById('stick'), knob = pad.firstElementChild;
  let finger = null;
  const aim = e => {
    const r = pad.getBoundingClientRect(), reach = r.width / 2;
    stick.set(e.clientX - r.left - reach, r.top + reach - e.clientY).divideScalar(reach);
    if (stick.length() > 1) stick.normalize();
    knob.style.transform = `translate(${stick.x * reach}px, ${-stick.y * reach}px)`;
    const n = stick.length();
    const k = Math.max(n - STICK_DEAD, 0) / (1 - STICK_DEAD), walk = STICK_RUN, slow = MOVE.slow / MOVE.fast;
    stickRun = k > walk;
    if (n > 0) stick.multiplyScalar((stickRun ? slow + (1 - slow) * (k - walk) / (1 - walk) : k / walk) / n);
  };
  pad.addEventListener('pointerdown', e => {
    if (finger !== null) return;
    finger = e.pointerId;
    pad.setPointerCapture(finger);
    setFree();
    aim(e);
  });
  pad.addEventListener('pointermove', e => { if (e.pointerId === finger) aim(e); });
  for (const ev of ['pointerup', 'pointercancel']) pad.addEventListener(ev, e => {
    if (e.pointerId !== finger) return;
    finger = null;
    stick.set(0, 0);
    stickRun = false;
    knob.style.transform = '';
  });
  pad.hidden = false;
  bar.hidden = true;
}
for (const [i, move] of MOVES.entries()) {
  if (play && PAD.includes(move.name)) continue;
  const b = document.createElement('button');
  b.textContent = move.name;
  b.setAttribute('aria-pressed', String(i === anim - 1 && (move.loop || !play)));
  b.onclick = () => {
    if (play) { move.press(bird.character); return; }
    freePlay = false;
    for (const [k, ibis] of ibises.entries()) scripts[k] = { move: i, run: startMove(ibis.character, i), time: 0 };
    setPressed(i);
  };
  (play ? topActions : bar).appendChild(b);
  buttons[i] = b;
}
function setPressed(i) { buttons.forEach((x, j) => x?.setAttribute('aria-pressed', String(j === i))); }

// Top bar: the Wet toggle (the ibis gets wet over two seconds, and dry again; wet also washes the mud
// off), then in free play the other actions. Mud comes from the puddle.
const weatherBar = document.getElementById('weather');
const wetButton = document.createElement('button');
wetButton.textContent = 'Wet';
wetButton.setAttribute('aria-pressed', String(weather.wet > 0));
wetButton.onclick = () => {
  weather.wet = weather.wet > 0 ? 0 : 1;
  if (weather.wet > 0) weather.mud = 0;
  wetButton.setAttribute('aria-pressed', String(weather.wet > 0));
};
weatherBar.append(wetButton, topActions);

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
  for (const part of world) part.update?.(camera, 0, ibises);
  draw();
  document.title = 'DONE';
} else {
  renderer.setAnimationLoop(frame);
}
