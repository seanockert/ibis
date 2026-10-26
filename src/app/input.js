// Free play input: WASD or the arrow keys walk, Shift runs, Space jumps (hold to flutter). The joystick
// walks, and runs when pushed far. A tap on the ground walks there (runs when far); a tap on the player
// prods it. A drag orbits the camera. A tap on the middle of the joystick turns the camera behind the bird.
//
//   const input = new Input(canvas, stage, level, () => { ... }, () => { ... });   // onFree, onRecentre
//   input.bindStick(element);
//   input.apply(character);   // every frame, before the level update
import * as THREE from 'three';
import { MOVE } from '../ibis/motion/controller.js';
import { wrapAngle } from '../ibis/motion/spring.js';

const TAP_PX = 8;           // a pointer that moves less than this between down and up is a tap
const STICK_DEAD = 0.12;    // joystick dead zone, part of its reach
const STICK_RUN = 0.65;     // the joystick walks up to this part of its reach, then runs
const STICK_TAP = 0.35;     // a tap on the joystick inside this part of its reach recentres the camera
const TAP_MS = 300;         // a tap is shorter than this
const INPUT_TURN = Math.PI / 4;   // the input keeps its view until its direction turns more than this
const WALK_KEYS = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'];

export class Input {
  // onFree: called when a key, the joystick, a tap or a held button takes over from a move script.
  // onRecentre: called on a tap on the middle of the joystick.
  constructor(canvas, stage, level, onFree, onRecentre) {
    Object.assign(this, { stage, level, onFree, onRecentre });
    this.keys = new Set();
    this.goal = null;                 // tap target on the ground, world space
    this.stick = new THREE.Vector2();   // joystick: x right, y up, length 0 to 1 (with stickRun, of the run speed)
    this.stickRun = false;
    this.jump = false;                // the Jump button, while held
    this.view = null;                 // while there is move input: { dir, fwd }, its direction and view
    this.dragging = false;
    stage.controls.addEventListener('start', () => { this.dragging = true; });
    stage.controls.addEventListener('end', () => { this.dragging = false; });
    addEventListener('keydown', e => {
      if (e.repeat) return;
      this.keys.add(e.code);
      if (WALK_KEYS.includes(e.code)) this.free();
      if (e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', e => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    let down = null;
    canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
    canvas.addEventListener('pointerup', e => {
      if (down && Math.hypot(e.clientX - down.x, e.clientY - down.y) <= TAP_PX) this.tap(e);
    });
  }

  free() {
    this.goal = null;
    this.onFree();
  }

  // Sets the character's input from the keys, the joystick and the tap target.
  apply(c) {
    const { keys, stick } = this, { camera, controls } = this.stage;
    const ax = (keys.has('KeyD') || keys.has('ArrowRight') ? 1 : 0) - (keys.has('KeyA') || keys.has('ArrowLeft') ? 1 : 0) + stick.x;
    const ay = (keys.has('KeyW') || keys.has('ArrowUp') ? 1 : 0) - (keys.has('KeyS') || keys.has('ArrowDown') ? 1 : 0) + stick.y;
    // Camera relative: up on the keys and the joystick is away from the camera. The camera swings behind
    // the bird, so the input keeps the view of when it started or last turned a lot: held to the side, the
    // bird keeps its line and doesn't circle the camera. A drag turns the view at once.
    const fwd = new THREE.Vector3().subVectors(controls.target, camera.position).setY(0).normalize();
    if ((ax === 0 && ay === 0) || this.dragging) this.view = null;
    else {
      const dir = Math.atan2(ax, ay);
      if (!this.view || Math.abs(wrapAngle(dir - this.view.dir)) > INPUT_TURN) this.view = { dir, fwd: fwd.clone() };
      fwd.copy(this.view.fwd);
    }
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const move = fwd.multiplyScalar(ay).add(right.multiplyScalar(ax));
    c.input.fast = keys.has('ShiftLeft') || keys.has('ShiftRight') || this.stickRun;
    if (move.lengthSq() > 0) this.goal = null;
    else if (this.goal) {
      move.set(this.goal.x - c.position.x, 0, this.goal.z - c.position.z);
      const d = move.length();
      if (d < 0.15) this.goal = null;
      else c.input.fast = this.goal.fast;
    }
    c.input.move.set(move.x, move.z);
    if (c.input.move.lengthSq() > 1) c.input.move.normalize();   // the joystick keeps its analog length
    c.input.jump = keys.has('Space') || this.jump;
  }

  // On the player, a prod; on the ground in bounds, walk there.
  tap(e) {
    const bird = this.level.player, ray = new THREE.Raycaster();
    ray.setFromCamera(new THREE.Vector2(e.clientX / innerWidth * 2 - 1, 1 - e.clientY / innerHeight * 2), this.stage.camera);
    bird.object.updateMatrixWorld();
    const d = bird.hit(ray.ray);
    if (d !== null) { bird.prod(ray.ray.at(d, new THREE.Vector3())); return; }
    // The ground may not be flat: two more tries at the height where the last one hit.
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), height = this.level.ground.height;
    let p = ray.ray.intersectPlane(plane, new THREE.Vector3());
    for (let i = 0; i < 2 && p; i++) p = ray.ray.intersectPlane(plane.set(plane.normal, -height(p.x, p.z)), p);
    const { x, z } = this.level.bounds;
    if (!p || p.x < x[0] || p.x > x[1] || p.z < z[0] || p.z > z[1]) return;
    this.free();
    this.goal = { x: p.x, z: p.z, fast: p.distanceTo(bird.object.position) > 2.5 };
  }

  // Joystick: the knob follows the pointer out to the rim. Its offset is the move input: the inner part
  // walks from still to the walk speed, the outer part runs from the walk speed to the run speed. A short
  // tap near the middle recentres the camera.
  bindStick(pad) {
    const knob = pad.firstElementChild, stick = this.stick;
    let finger = null, tap = null;   // tap: { x, y, time } of the press while it can still be a tap
    const aim = e => {
      const r = pad.getBoundingClientRect(), reach = r.width / 2;
      stick.set(e.clientX - r.left - reach, r.top + reach - e.clientY).divideScalar(reach);
      if (stick.length() > 1) stick.normalize();
      knob.style.transform = `translate(${stick.x * reach}px, ${-stick.y * reach}px)`;
      const n = stick.length();
      const k = Math.max(n - STICK_DEAD, 0) / (1 - STICK_DEAD), walk = STICK_RUN, slow = MOVE.slow / MOVE.fast;
      this.stickRun = k > walk;
      if (n > 0) stick.multiplyScalar((this.stickRun ? slow + (1 - slow) * (k - walk) / (1 - walk) : k / walk) / n);
    };
    pad.addEventListener('pointerdown', e => {
      if (finger !== null) return;
      finger = e.pointerId;
      pad.setPointerCapture(finger);
      this.free();
      aim(e);
      const r = pad.getBoundingClientRect(), reach = r.width / 2;
      const middle = Math.hypot(e.clientX - r.left - reach, e.clientY - r.top - reach) < STICK_TAP * reach;
      tap = middle ? { x: e.clientX, y: e.clientY, time: e.timeStamp } : null;
    });
    pad.addEventListener('pointermove', e => {
      if (e.pointerId !== finger) return;
      aim(e);
      if (tap && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > TAP_PX) tap = null;
    });
    for (const ev of ['pointerup', 'pointercancel']) pad.addEventListener(ev, e => {
      if (e.pointerId !== finger) return;
      if (ev === 'pointerup' && tap && e.timeStamp - tap.time < TAP_MS) this.onRecentre();
      finger = null;
      tap = null;
      stick.set(0, 0);
      this.stickRun = false;
      knob.style.transform = '';
    });
    pad.hidden = false;
  }
}
