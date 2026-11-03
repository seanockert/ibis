// Physics for the scene: props that roll, rock and fall over, and the ibis as a solid that pushes them.
// This is the only file that imports crashcat, so the engine can change without changes elsewhere.
//
//   const physics = new Physics({ ground });   // ground: [z, y] heights across the street, or flat
//   physics.addFence({ x: [x0, x1], z: [z0, z1] });   // walls round a box: keep props in the play area
//   physics.addMesh(positions, indices);       // static ground of triangles: a land area (land.js)
//   physics.addBird(ibis);                     // the controller then can't walk through props
//   const id = physics.addBox(size, { position, mass });
//   const hinge = physics.addHinge(id, lidId, point, axis, normal, [min, max]);   // a lid or a door
//   physics.hingeTo(hinge, angle);             // a soft spring toward an angle
//   physics.step(dt);                          // every frame, after ibis.update(dt)
//   physics.body(id).position, .quaternion     // arrays: [x, y, z], [x, y, z, w]
//
// World units, as the ibis: about 2 tall. Masses are in kg.
//
// The bird: the controller still owns the root. Each controller sub step, a kinematic character
// controller (crashcat kcc) sweeps the bird's solid (chest and head) from the old position to the new
// one and gives back where the bird can go. It pushes what it touches, with a mass and a strength
// limit, so a light ball moves away and a heavy bin stops the bird. Each bird's solid is a body on the
// bird layer, so the sweep of one bird stops at the solid of another, and pushes it (nudgeBirds()).
// Small kinematic spheres on the feet and the head kick and peck light props only, so a peck can't
// shove the bin. A flying bird (a miner, src/miner/flier.js) is one kinematic sphere on the flier layer:
// it knocks light props, and the other birds' sweeps and the rays pass through it.
//
// Shove: the beak is not part of the solid. Rays ahead find a heavy prop before the beak gets to it,
// and set controller.shove (0 to 1). The animator puts the head down, so the beak points along the
// face of the prop and the forehead takes the weight. While the bird walks into it, it pushes at the
// forehead along its heading, harder with speed: a walk rocks the bin, a run tips it. A prop that rocks
// back toward the bird pushes it back, so the head and beak don't go into it.
//
// Ground: the street (the road is lower, with a kerb), terrain (static steps, ramps: addTerrain) and the
// tops of heavy props (a fallen bin). Rays
// down from stepUp above each foot and toe tip give the ground under each foot (controller.feet) and
// the highest (controller.floor), so no toe sinks into a sloped top, and the bird lands on it, walks
// on it and falls off its edge. controller.groundAt() gives the animator the ground where a foot will
// land. A ray that starts inside a solid goes through it: a top above stepUp is a wall, not a floor.
// The bird's solid starts above stepUp, so it walks up a low step and a wall stops it.
//
// Room: actions move the head (a peck, a threat). Each sub step, rays from the chest to the posed head
// and bill find a heavy prop in the way. The bird steps back by the overlap and the prop gets a push,
// so the action has room and the beak stays out.
//
// Grab: a peck ('grab' event at the bottom of the jab) picks up the nearest grabbable prop near the
// bill (addHull(..., { grab: true })). The next peck is a drop (Character.act): the bill opens, 'drop'. A held prop is kinematic on the
// ghost layer (it touches nothing) and follows the bill, crosswise. On the drop it is dynamic again,
// with the bill's speed.
import {
  CastRayStatus, MotionType, MotorState, SpringMode, addBroadphaseLayer, addObjectLayer, box, capsule, castRay, convexHull,
  createClosestCastRayCollector, createDefaultCastRaySettings, createWorld, createWorldSettings, enableCollision, filter,
  compound, hingeConstraint, kcc, motionProperties, offsetCenterOfMass, registerConstraints, registerShapes, rigidBody, sphere, triangleMesh, updateWorld,
} from 'crashcat';
import { Matrix4, Quaternion, Vector3 } from 'three';
import { Character } from '../ibis/motion/character.js';
import { GROUND } from '../ibis/motion/controller.js';
import { HEAD_SCALE, solveRig } from '../ibis/rig.js';

registerShapes([sphere.def, box.def, capsule.def, convexHull.def, offsetCenterOfMass.def, compound.def, triangleMesh.def]);
registerConstraints([hingeConstraint.def]);

const STEP = 1 / 120;   // longest sub step, seconds, as in Character
// A little less than earth gravity at the size of the ibis (about 28), near the jump's own gravity.
export const GRAVITY = 22;
const GROUND_FRICTION = 0.8;

// The bird's solid, in character space (+z toward the beak): an upright capsule from just above
// GROUND.stepUp to the chest. It must be one convex shape: the kcc's padding correction in crashcat
// 0.0.5 does not handle a compound and throws. The head stays out of props by the shove rays and the room check.
// head: where the shove pose (animator.js) puts the head, for the gap the brace measures.
export const BIRD = {
  solid: { radius: 0.45, halfHeight: 0.175, at: [0, 0.925, 0] },
  head: { radius: 0.24, at: [0, 1.37, 0.53] },
  mass: 3, strength: 150,      // kg, and the largest push from the solid in N
  shove: 41,                   // forehead push in N for each unit of speed into the prop. Tips the bin at a run
  bump: 10,                    // impulse in N s for each unit of speed when the forehead first touches,
  bounce: 1.8,                 // up to this many times the bird's speed where it hits (1 + restitution)
  pushAt: [0.9, 0.6],         // part of a prop's height the bump and the steady push go up to at most
  // Shove rays: start, length, side offsets at head height, and the height of one more at the beak tip.
  look: { at: [0, 1.4, 0.2], ahead: 2.0, across: 0.22, low: 0.95 },
  braceFrom: 0.6,              // the head goes down over this distance before the head sphere touches,
  braceAhead: 0.3,             // plus this many seconds at the bird's speed, so a run braces as a walk does
  margin: 0.04,                // a prop that rocks back closer than this pushes the bird back
  // Room: points in head space (+z along the bill) with radii: the skull, and the middle and tip of
  // the upper bill (skullBill() in model.glsl).
  reach: [[[0, 0, 0], 0.22], [[0, -0.11, 0.53], 0.06], [[0, -0.24, 0.71], 0.04], [[0, -0.42, 0.86], 0.02]],
  clear: 0.02,                 // feet stand this far above a prop's top, as the mesh is not exact
  teleport: 0.5,               // a root move longer than this in one sub step jumps, with no sweep
  cap: 0.1,                    // thickness of the cap over a hollow prop's open top (addHollowBox)
  capTilt: 0.6,                // the cap is there only while the prop is tipped less than this (radians)
  // Duck: rays up from these points (character z) find a heavy thing over the bird lower than head
  // (above the root): controller.duck. Inside the solid's radius, and a ray that starts in a solid goes
  // through it (groundSettings), so a wall beside the bird is not a ceiling.
  duck: { ahead: [0, 0.4], from: 0.3, head: 2.1 },
  backSpeed: 8,                // fastest step back for room, units per second
  room: 600,                   // push on the prop in N for each unit of overlap,
  roomSpeed: 1,                // up to this speed of the prop where the head is
  foot: 0.13, footUp: 0.1,     // foot spheres: radius, height above the ankle
  flier: 0.18,                 // the sphere of a flying bird (a miner) round the middle of its body
  peck: 0.2,                   // head sphere that follows the rig
  // Bird into bird: the other bird takes this part of the move into it. touch: the solids touch at
  // this distance (two radii and the kcc padding).
  nudge: { share: 0.6, touch: 0.93 },
};
// Grab: reach, the largest gap from the bill tip (head space, BIRD.reach) to a prop, so the aim can be
// rough. holds: how the bill holds each kind of prop. jaw: the bill opens this far, so the gap fits the
// prop's thickness. grip: head space, the middle of that gap (the bill curves down, so a wider jaw moves
// it down and back). out: the direction out of the gap, between the two bills. The three go together:
// change them together, from the bill shapes in model.glsl. round: a stubby (0.4 across). flat: a
// cereal box (0.2 thick).
export const GRAB = {
  tip: [0, -0.42, 0.86], reach: 0.75,
  holds: {
    round: { jaw: 0.7, grip: [0, -0.51, 0.66], out: [0, -0.89, 0.45] },
    flat: { jaw: 0.37, grip: [0, -0.46, 0.73], out: [0, -0.87, 0.48] },
  },
};
const LIMB_TELEPORT = 1;       // a limb that moves farther than this in a frame jumps there: no kick

const GROUND_HALF = 100;   // half size of the ground, x and z: past the play area (PLAY in street.js)
const GROUND_DEPTH = 1.5;   // ground solids and rays go this far below 0: under the deepest mud (land.js)

export class Physics {
  // ground: [z, y] points from +z to -z (PROFILE in street.js), straight between. Without it: flat at 0.
  constructor({ ground = null } = {}) {
    const s = createWorldSettings();
    s.gravity = [0, -GRAVITY, 0];
    const still = addBroadphaseLayer(s), moving = addBroadphaseLayer(s);
    // fixed: the ground. fence: stops light props only, so a bin can still fall over it. terrain: steps
    // and ramps; the bird walks on them. heavy: blocks the bird. light: the feet and head move it too.
    // limb: the bird's kinematic spheres. bird: each bird's solid; it collides with nothing, but the
    // sweeps of the other birds stop at it. ghost: a held prop; it touches nothing. flier: the sphere of
    // a flying bird; it knocks light props. cap: the top of a hollow prop to the bird alone; it collides
    // with nothing, but the bird's sweep and feet stop at it.
    this.layers = {
      fixed: addObjectLayer(s, still), fence: addObjectLayer(s, still), terrain: addObjectLayer(s, still), heavy: addObjectLayer(s, moving),
      light: addObjectLayer(s, moving), limb: addObjectLayer(s, moving), bird: addObjectLayer(s, moving), ghost: addObjectLayer(s, moving),
      flier: addObjectLayer(s, moving), cap: addObjectLayer(s, moving),
    };
    const L = this.layers;
    const pairs = [['heavy', 'fixed'], ['heavy', 'terrain'], ['light', 'terrain'], ['heavy', 'heavy'], ['heavy', 'light'], ['light', 'fixed'], ['light', 'fence'], ['light', 'light'], ['limb', 'light'], ['flier', 'light']];
    for (const [a, b] of pairs) {
      enableCollision(s, L[a], L[b]);
    }
    this.world = createWorld(s);
    this.gravity = s.gravity;
    this.addGround(ground ?? [[GROUND_HALF, 0], [-GROUND_HALF, 0]]);
    // The bird collides with props and other birds only: the controller keeps it on the ground and inside
    // its bounds.
    // Set the object layers directly: disableObjectLayer() also turns off the broadphase layer, which
    // the limbs share with the props.
    this.birdFilter = filter.create(this.world.settings.layers);
    for (const layer of [L.fixed, L.fence, L.limb, L.ghost, L.flier]) this.birdFilter.enabledObjectLayers[layer] = 0;
    this.birdUpdate = kcc.createDefaultUpdateSettings();
    this.birdUpdate.stickToFloorStepDown = [0, 0, 0];
    this.birdUpdate.walkStairsStepUp = [0, 0, 0];
    this.birds = [];
    this.fliers = [];   // { flier, body, placed }
    this.heavyFilter = filter.create(this.world.settings.layers);
    for (const layer of [L.fixed, L.fence, L.terrain, L.light, L.limb, L.bird, L.ghost, L.flier, L.cap]) this.heavyFilter.enabledObjectLayers[layer] = 0;
    // Ground rays: the ground, terrain and heavy props. The bird's feet also stand on the caps.
    this.groundFilter = filter.create(this.world.settings.layers);
    for (const layer of [L.fence, L.light, L.limb, L.bird, L.ghost, L.flier, L.cap]) this.groundFilter.enabledObjectLayers[layer] = 0;
    this.feetFilter = filter.create(this.world.settings.layers);
    for (const layer of [L.fence, L.light, L.limb, L.bird, L.ghost, L.flier]) this.feetFilter.enabledObjectLayers[layer] = 0;
    this.ray = createClosestCastRayCollector();
    this.raySettings = createDefaultCastRaySettings();
    this.groundSettings = { ...createDefaultCastRaySettings(), treatConvexAsSolid: false };
    this.hit = [0, 0, 0];
    this.probe = { y: 0, n: new Vector3() };
  }

  // Four walls round a box that only light props touch, so the bird can always reach them.
  addFence({ x: [x0, x1], z: [z0, z1] }) {
    const t = 0.25, cx = (x0 + x1) / 2, cz = (z0 + z1) / 2, hx = (x1 - x0) / 2 + 2 * t, hz = (z1 - z0) / 2 + 2 * t;
    for (const [x, z, w, d] of [[cx, z0 - t, hx, t], [cx, z1 + t, hx, t], [x0 - t, cz, t, hz], [x1 + t, cz, t, hz]]) {
      rigidBody.create(this.world, {
        motionType: MotionType.STATIC, objectLayer: this.layers.fence, shape: box.create({ halfExtents: [w, 3, d] }),
        position: [x, 3, z],
      });
    }
  }

  // The ground: one static solid for each straight part of the profile, down to GROUND_DEPTH below 0.
  addGround(profile) {
    const clip = ([z, y]) => [Math.min(Math.max(z, -GROUND_HALF), GROUND_HALF), y];
    for (let i = 1; i < profile.length; i++) {
      const [z0, y0] = clip(profile[i - 1]), [z1, y1] = clip(profile[i]);
      if (z0 <= z1) continue;
      const points = [-GROUND_HALF, GROUND_HALF].flatMap(x => [x, y0, z0, x, y1, z1, x, -GROUND_DEPTH, z0, x, -GROUND_DEPTH, z1]);
      rigidBody.create(this.world, {
        motionType: MotionType.STATIC, objectLayer: this.layers.fixed, friction: GROUND_FRICTION,
        shape: convexHull.create({ positions: points, convexRadius: 0 }), position: [0, 0, 0],
      });
    }
  }

  // Static ground of triangles (land.js), counter-clockwise from above. No inside: keep it above -GROUND_DEPTH.
  addMesh(positions, indices) {
    return rigidBody.create(this.world, {
      motionType: MotionType.STATIC, objectLayer: this.layers.fixed, friction: GROUND_FRICTION,
      shape: triangleMesh.create({ positions, indices }), position: [0, 0, 0],
    }).id;
  }

  // Static ground the bird walks on: a convex hull round points (flat array [x, y, z, ...], world).
  addTerrain(points, { friction = GROUND_FRICTION } = {}) {
    return rigidBody.create(this.world, {
      motionType: MotionType.STATIC, objectLayer: this.layers.terrain, friction,
      shape: convexHull.create({ positions: points, convexRadius: 0 }), position: [0, 0, 0],
    }).id;
  }

  // A dynamic box. size: full size [x, y, z]. com: centre of mass height from the middle. The convex
  // radius stays below half the thinnest half size: the default (0.05) is too big for a thin flap.
  addBox(size, { com = 0, ...options } = {}) {
    const halfExtents = size.map(v => v / 2);
    let shape = box.create({ halfExtents, convexRadius: Math.min(0.05, Math.min(...halfExtents) / 2) });
    if (com) shape = offsetCenterOfMass.create({ shape, offset: [0, com, 0] });
    return this.addDynamic(shape, options);
  }

  // A dynamic box with an open top: a floor and four walls in one compound body, so things can go in.
  // size: full outside size; wall, floor: thickness. com: the centre of mass height from the middle of
  // the box, as addBox() (not from the hollow shape's own centre).
  addHollowBox([w, h, d], { wall, floor = wall, com = 0, ...options }) {
    const part = (size, position) => ({
      position, quaternion: [0, 0, 0, 1],
      shape: box.create({ halfExtents: size.map(v => v / 2), convexRadius: Math.min(0.05, Math.min(...size) / 4) }),
    });
    const inner = h - floor, y = floor / 2;
    let shape = compound.create({ children: [
      part([w, floor, d], [0, -h / 2 + floor / 2, 0]),
      ...[-1, 1].map(s => part([wall, inner, d], [s * (w - wall) / 2, y, 0])),
      ...[-1, 1].map(s => part([w - 2 * wall, inner, wall], [0, y, s * (d - wall) / 2])),
    ] });
    shape = offsetCenterOfMass.create({ shape, offset: [-shape.centerOfMass[0], com - shape.centerOfMass[1], -shape.centerOfMass[2]] });
    const id = this.addDynamic(shape, options);
    // A cap over the open top that only the bird touches (kinematic, on the cap layer, moved with the box
    // in step()), so the bird can't get in from above. A ball still falls in. On its side the prop has
    // no cap: the bird can duck into it (duckUnder()).
    const cap = rigidBody.create(this.world, {
      motionType: MotionType.KINEMATIC, objectLayer: this.layers.cap,
      shape: box.create({ halfExtents: [w / 2, BIRD.cap / 2, d / 2], convexRadius: 0.02 }), position: options.position,
    }).id;
    (this.caps ??= []).push({ box: id, cap, y: h / 2 - BIRD.cap / 2, placed: false });
    return id;
  }

  // A dynamic convex hull round points: flat array [x, y, z, ...].
  addHull(points, options) {
    return this.addDynamic(convexHull.create({ positions: points, convexRadius: 0.03 }), options);
  }

  // group: a bit from newGroup(). Bodies with the same group don't collide, as a bin and its lid.
  // grab: a peck can pick it up (light props only). { hold, edge }: hold, a kind in GRAB.holds; edge,
  // the prop's middle sits this far out of the bill from the grip, so the bill holds it by an edge. A
  // held prop lies with its y across the bill (along the head's x), its x out of the bill and its z
  // across the gap.
  addDynamic(shape, { position, quaternion = [0, 0, 0, 1], mass, friction = 0.6, restitution = 0, damping = 0.05, light = false, group, grab = false }) {
    const id = rigidBody.create(this.world, {
      motionType: MotionType.DYNAMIC, objectLayer: light ? this.layers.light : this.layers.heavy, shape,
      position, quaternion, mass, friction, restitution, linearDamping: damping, angularDamping: damping,
      ...(group && { collisionGroups: group, collisionMask: ~group >>> 0 }),
    }).id;
    if (grab && light) (this.grabbable ??= new Map()).set(id, { edge: 0, ...grab, ...GRAB.holds[grab.hold] });
    else (this.bulky ??= new Set()).add(id);
    return id;
  }

  // True while a bird holds the body in its bill.
  held(id) { return this.birds.some(b => b.held === id); }

  newGroup() {
    this.groups = (this.groups ?? 0) + 1;
    if (this.groups > 31) throw new Error('No collision groups left');
    return 2 ** (this.groups - 1);
  }

  // Joins child to parent at a world point. The child swings about axis, from min to max radians away
  // from where it is now. normal: a world direction across the axis, for the angle. spring: frequency
  // (Hz) and damping of hingeTo().
  addHinge(parentId, childId, point, axis, normal, [min, max], spring = [4, 0.3]) {
    const hinge = hingeConstraint.create(this.world, {
      bodyIdA: parentId, bodyIdB: childId, pointA: point, pointB: point,
      hingeAxisA: axis, hingeAxisB: axis, normalAxisA: normal, normalAxisB: normal, limitsMin: min, limitsMax: max,
    });
    Object.assign(hinge.motorSettings.springSettings, { mode: SpringMode.FREQUENCY_AND_DAMPING, frequencyOrStiffness: spring[0], damping: spring[1] });
    hingeConstraint.setMotorState(hinge, MotorState.POSITION);
    return hinge.id;
  }

  hingeTo(id, angle) { hingeConstraint.setTargetAngle(hingeConstraint.get(this.world, id), angle); }

  body(id) { return rigidBody.get(this.world, id); }

  remove(id) {
    this.bulky?.delete(id);
    this.grabbable?.delete(id);
    rigidBody.remove(this.world, rigidBody.get(this.world, id));
  }

  impulse(id, impulse, at) { rigidBody.addImpulseAtPosition(this.world, this.body(id), impulse, at); }

  // Gives the ibis a solid body. Call before its first update after this.
  addBird(ibis) {
    const L = this.layers, c = ibis.character;
    const shape = capsule.create({ radius: BIRD.solid.radius, halfHeightOfCylinder: BIRD.solid.halfHeight });
    const k = kcc.create({
      shape, shapeOffset: BIRD.solid.at, mass: BIRD.mass, maxStrength: BIRD.strength, innerRigidBody: { shape, objectLayer: L.bird },
    }, [c.position.x, c.position.y, c.position.z], yaw(c.heading));
    kcc.add(this.world, k);
    const limb = r => rigidBody.create(this.world, {
      motionType: MotionType.KINEMATIC, objectLayer: L.limb, shape: sphere.create({ radius: r }), position: [0, -10, 0],
    }).id;
    const bird = { ibis, kcc: k, limbs: [limb(BIRD.foot), limb(BIRD.foot), limb(BIRD.peck)], held: null, placed: false, touching: false, over: null, nudge: [0, 0] };
    this.birds.push(bird);
    c.collide = (controller, dt) => this.moveBird(bird, controller, dt);
    c.controller.groundAt = (x, z, out) => this.groundAt(x, z, c.position.y + GROUND.stepUp, out, this.feetFilter);
  }

  // Gives a flying bird (src/miner/flier.js) its sphere. It follows flier.centre() each step.
  addFlier(flier) {
    const body = rigidBody.create(this.world, {
      motionType: MotionType.KINEMATIC, objectLayer: this.layers.flier, shape: sphere.create({ radius: BIRD.flier }),
      position: flier.centre().toArray(),
    }).id;
    this.fliers.push({ flier, body, placed: false });
  }

  // One controller sub step: sweep the solid from where it was to where the controller put it. It turns
  // with the heading without a sweep, and the next sweep pushes it back out of what the turn hit.
  moveBird(bird, c, dt) {
    this.takeNudge(bird, c);
    this.nudgeBirds(bird, c);
    this.moveBirdIn(bird, c, dt);
  }

  // Pushes the other birds that this sub step moves the bird into: each takes BIRD.nudge.share of the
  // part of the move past touching, along the line between them, at its own next sub step. So a run
  // into the side of a walking bird shoves it out of the way, and a still bird slows the bird that
  // pushes it.
  nudgeBirds(bird, c) {
    const k = bird.kcc, mx = c.position.x - k.position[0], mz = c.position.z - k.position[2];
    const { share, touch } = BIRD.nudge, tall = 2 * (BIRD.solid.halfHeight + BIRD.solid.radius);
    for (const other of this.birds) {
      const o = other.kcc.position;
      if (other === bird || Math.abs(o[1] - k.position[1]) > tall) continue;
      const dx = o[0] - k.position[0], dz = o[2] - k.position[2], d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      const approach = (mx * dx + mz * dz) / d, into = Math.min(approach, touch - (d - approach));
      if (into <= 0) continue;
      other.nudge[0] += dx / d * share * into;
      other.nudge[1] += dz / d * share * into;
    }
  }

  // Moves the bird by the nudges from other birds since its last sub step. Its sweep comes after, so
  // a wall or a prop still stops it.
  takeNudge(bird, c) {
    const [x, z] = bird.nudge;
    if (x === 0 && z === 0) return;
    c.position.x += x;
    c.position.z += z;
    if (c.bounds) {
      c.position.x = Math.min(Math.max(c.position.x, c.bounds.x[0]), c.bounds.x[1]);
      c.position.z = Math.min(Math.max(c.position.z, c.bounds.z[0]), c.bounds.z[1]);
    }
    bird.nudge[0] = bird.nudge[1] = 0;
  }

  moveBirdIn(bird, c, dt) {
    const k = bird.kcc;
    k.position[1] = c.position.y;
    kcc.setQuaternion(this.world, k, yaw(c.heading));
    // A teleport (a respawn, a scripted move) jumps there. A sweep that long can stall in the kcc.
    if (Math.hypot(c.position.x - k.position[0], c.position.z - k.position[2]) > BIRD.teleport) {
      kcc.setPosition(this.world, k, [c.position.x, c.position.y, c.position.z]);
      return;
    }
    k.linearVelocity[0] = (c.position.x - k.position[0]) / dt;
    k.linearVelocity[1] = 0;
    k.linearVelocity[2] = (c.position.z - k.position[2]) / dt;
    kcc.update(this.world, k, dt, this.gravity, this.birdUpdate, undefined, this.birdFilter);
    c.position.x = k.position[0];
    c.position.z = k.position[2];
    this.feetGround(bird, c);
    this.duckUnder(bird, c);
    // Whatever stops the bird (the forehead, or the bill in an action or at a run) takes the push. In
    // the air the bird has nothing to push from: no brace and no push, so it can land on a prop.
    const forehead = this.shove(c), room = this.makeRoom(bird, c, dt);
    const contact = forehead ?? room;
    if (!c.grounded) c.shove = 0;
    this.push(bird, c, c.grounded ? contact : null, dt);
  }

  // A heavy thing over the bird, lower than its head (a fallen bin it walks into): controller.duck, and
  // bird.over, the body, which the bird does not push (so it can't stand up the bin it is in).
  duckUnder(bird, c) {
    const { ahead, from, head } = BIRD.duck, sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    bird.over = null;
    for (const z of ahead) {
      this.ray.reset();
      castRay(this.world, this.ray, this.groundSettings, [c.position.x + z * sn, c.position.y + from, c.position.z + z * cs], [0, 1, 0], head - from, this.heavyFilter);
      if (this.ray.hit.status === CastRayStatus.COLLIDING) bird.over = this.ray.hit.bodyIdB;
    }
    c.duck = bird.over !== null;
  }

  // Pushes the prop the bird is against: one bump for each approach (none again until the bird backs
  // off, so a rocking bin can't pump), then a steady push with the bird's speed. Neither pushes the
  // prop faster than the bird moves (pushUpTo).
  push(bird, c, contact, dt) {
    const bump = contact !== null && !bird.touching;
    if (contact) bird.touching = true;
    else if (c.shove === 0) bird.touching = false;
    if (!contact || c.speed <= 0 || contact.id === bird.over) return;
    const { id, dir } = contact;
    // At forehead height, whatever touched: a low push (the bill at a run) slides the bin, not tips it.
    // On a short prop (a box), the bump goes no higher than BIRD.pushAt[0] of its height and the steady
    // push no higher than pushAt[1], so a walk slides it and a run knocks it over.
    const box = rigidBody.get(this.world, id).aabb, forehead = c.position.y + BIRD.head.at[1];
    const at = k => [contact.at[0], Math.min(forehead, mix(box[1], box[4], k)), contact.at[2]];
    if (bump) {
      this.pushUpTo(id, at(BIRD.pushAt[0]), dir, c.speed * BIRD.bounce, BIRD.bump * c.speed);
      bird.ibis.character.knock();
    }
    this.pushUpTo(id, at(BIRD.pushAt[1]), dir, c.speed, BIRD.shove * c.speed * dt);
  }

  // An impulse along dir at a world point, at most most (N s). It stops where the point moves along
  // dir at speed: the bird can't push a thing faster than it moves itself, so a push can't throw it.
  // The effective mass at the point counts the turn, so a push high on the bin tips it.
  pushUpTo(id, at, dir, speed, most) {
    const body = rigidBody.get(this.world, id), mp = body.motionProperties, com = body.centerOfMassPosition;
    const r = [at[0] - com[0], at[1] - com[1], at[2] - com[2]];
    const need = speed - dot(add(mp.linearVelocity, cross(mp.angularVelocity, r)), dir);
    if (need <= 0 || most <= 0) return;
    const rn = cross(r, dir);
    const turn = motionProperties.multiplyWorldSpaceInverseInertiaByVector([0, 0, 0], mp, body.quaternion, rn);
    const j = Math.min(most, need / (mp.invMass + dot(rn, turn)));
    rigidBody.addImpulseAtPosition(this.world, body, [dir[0] * j, dir[1] * j, dir[2] * j], at);
  }

  // Moves the bird back, and pushes the prop, where the posed head or bill would be inside a heavy prop.
  // Gives the contact, or null.
  makeRoom(bird, c, dt) {
    const R = bird.ibis.rig, e = R.headRot.elements;
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading);
    const from = BIRD.look.at[2];
    let worst = 0, away = null, hit = null;
    for (const [[hx, hy, hz], r] of BIRD.reach) {
      // Head space to character space, then the ray from the chest at the same height.
      const s = HEAD_SCALE;
      const x = R.head.x + s * (e[0] * hx + e[4] * hy + e[8] * hz);
      const y = R.head.y + s * (e[1] * hx + e[5] * hy + e[9] * hz);
      const z = R.head.z + s * (e[2] * hx + e[6] * hy + e[10] * hz) - from;
      const length = Math.hypot(x, z);
      if (z <= 0 || length < 1e-3) continue;
      const dir = [(x * cs + z * sn) / length, 0, (-x * sn + z * cs) / length];
      const start = [c.position.x + from * sn, c.position.y + y, c.position.z + from * cs];
      this.ray.reset();
      castRay(this.world, this.ray, this.raySettings, start, dir, length + r, this.heavyFilter);
      if (this.ray.hit.status !== CastRayStatus.COLLIDING) continue;
      const d = this.ray.hit.fraction * (length + r), overlap = length + r - d;
      if (overlap > worst) { worst = overlap; away = dir; hit = { id: this.ray.hit.bodyIdB, at: start.map((v, i) => v + dir[i] * d) }; }
    }
    if (!hit) return null;
    const back = Math.min(worst, BIRD.backSpeed * dt);
    c.position.x -= away[0] * back;
    c.position.z -= away[2] * back;
    if (hit.id !== bird.over) this.pushUpTo(hit.id, hit.at, away, BIRD.roomSpeed, BIRD.room * worst * dt);
    return { ...hit, dir: away };
  }

  // Ground under a world point, from a ray down from top: out.y the height, out.n the normal (a
  // Vector3). A prop top (or a cap) gets BIRD.clear. A miss (off the ground) is y = 0. ground: the
  // filter; the bird's feet use feetFilter, which has the caps.
  groundAt(x, z, top, out, ground = this.groundFilter) {
    const length = top + GROUND_DEPTH;
    this.ray.reset();
    castRay(this.world, this.ray, this.groundSettings, [x, top, z], [0, -1, 0], length, ground);
    if (this.ray.hit.status !== CastRayStatus.COLLIDING) {
      out.y = 0;
      out.n.set(0, 1, 0);
      return out;
    }
    const y = top - this.ray.hit.fraction * length, hit = this.hit, body = rigidBody.get(this.world, this.ray.hit.bodyIdB);
    hit[0] = x; hit[1] = y; hit[2] = z;
    rigidBody.getSurfaceNormal(hit, body, hit, this.ray.hit.subShapeId);
    out.y = y + (body.motionType === MotionType.STATIC ? 0 : BIRD.clear);
    out.n.fromArray(hit);
    return out;
  }

  // Ground under each posed foot, the higher of the ankle and the toe tip (controller.feet), and the
  // highest of them (controller.floor).
  feetGround(bird, c) {
    const R = bird.ibis.rig, sn = Math.sin(c.heading), cs = Math.cos(c.heading), top = c.position.y + GROUND.stepUp;
    const probe = this.probe;
    [R.footL, R.footR].forEach((foot, i) => {
      const out = c.feet[i];
      out.y = -Infinity;
      for (const ahead of [0, GROUND.toes]) {
        const x = foot.x, z = foot.z + ahead;
        this.groundAt(c.position.x + x * cs + z * sn, c.position.z - x * sn + z * cs, top, probe, this.feetFilter);
        if (probe.y > out.y) { out.y = probe.y; out.n.copy(probe.n); }
      }
    });
    c.floor = Math.max(c.feet[0].y, c.feet[1].y);
  }

  // Finds a heavy prop ahead of the head, sets controller.shove, and moves the bird back if the prop
  // comes too close. Gives the contact at the forehead, or null.
  shove(c) {
    const { look, head } = BIRD;
    const sn = Math.sin(c.heading), cs = Math.cos(c.heading), dir = [sn, 0, cs];
    let near = Infinity, hit = null;
    for (const [x, y] of [[-look.across, look.at[1]], [0, look.at[1]], [look.across, look.at[1]], [0, look.low]]) {
      const from = [c.position.x + x * cs + look.at[2] * sn, c.position.y + y, c.position.z - x * sn + look.at[2] * cs];
      this.ray.reset();
      castRay(this.world, this.ray, this.raySettings, from, dir, look.ahead, this.heavyFilter);
      if (this.ray.hit.status !== CastRayStatus.COLLIDING) continue;
      const d = this.ray.hit.fraction * look.ahead;
      if (d < near) { near = d; hit = { id: this.ray.hit.bodyIdB, at: from.map((v, i) => v + dir[i] * d) }; }
    }
    // Gap from the front of the head sphere to the prop.
    const gap = near + look.at[2] - (head.at[2] + head.radius);
    const full = BIRD.braceAhead * Math.max(c.speed, 0);   // fully down from this gap
    c.shove = Math.min(Math.max(1 - (gap - full) / BIRD.braceFrom, 0), 1);
    if (gap < BIRD.margin) {
      c.position.x -= dir[0] * (BIRD.margin - gap);
      c.position.z -= dir[2] * (BIRD.margin - gap);
    }
    if (!hit || gap >= 0.05) return null;
    return { ...hit, dir };
  }

  step(dt) {
    for (const bird of this.birds) {
      const events = bird.ibis.character.events;
      if (events.some(e => e.type === 'drop')) this.drop(bird);
      else if (bird.held === null && events.some(e => e.type === 'grab')) this.grab(bird);
      this.placeLimbs(bird, dt);
    }
    // moveKinematic gives the flier's sphere the velocity to get there in dt, so a dive passes its speed
    // to what it hits.
    for (const f of this.fliers) {
      const body = rigidBody.get(this.world, f.body), to = f.flier.centre().toArray();
      if (!f.placed) rigidBody.setPosition(this.world, body, to, false);
      else rigidBody.moveKinematic(body, to, body.quaternion, dt);
      f.placed = true;
    }
    this.placeCaps(dt);
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    for (let i = 0; i < n; i++) updateWorld(this.world, undefined, dt / n);
    for (const bird of this.birds) bird.placed = true;
  }

  // Each cap goes to the top of its hollow prop, turned with it. moveKinematic, so a bird on it rides.
  // A prop tipped past BIRD.capTilt puts its cap far below the ground.
  placeCaps(dt) {
    for (const c of this.caps ?? []) {
      const box = rigidBody.get(this.world, c.box), cap = rigidBody.get(this.world, c.cap);
      const on = tiltAngle(box.quaternion) < BIRD.capTilt;
      const to = on ? new Vector3(0, c.y, 0).applyQuaternion(new Quaternion().fromArray(box.quaternion)).add(new Vector3().fromArray(box.position)).toArray() : [box.position[0], -10, box.position[2]];
      if (!c.placed || on !== c.on) rigidBody.setTransform(this.world, cap, to, box.quaternion, false);
      else rigidBody.moveKinematic(cap, to, box.quaternion, dt);
      c.placed = true;
      c.on = on;
    }
  }

  // The ibis lets go of what its bill holds, as a blow knocks it out.
  release(ibis) {
    const bird = this.birds.find(b => b.ibis === ibis);
    if (bird) this.drop(bird);
  }

  // Lets go of what the bill holds: dynamic again, with the bill's speed.
  drop(bird) {
    const body = bird.held === null ? null : rigidBody.get(this.world, bird.held);
    bird.held = bird.ibis.character.controller.carry = null;
    if (!body) return;
    rigidBody.setObjectLayer(this.world, body, this.layers.light);
    rigidBody.setMotionType(this.world, body, MotionType.DYNAMIC, true);
  }

  // Throws what the bill holds: dynamic again (drop()), with velocity v and spin w (world [x, y, z]).
  // Gives its body id, or null when the bill held nothing.
  // at: a world point to throw it from (the arc's start in fling.js), or the bill.
  fling(ibis, v, w = [0, 0, 0], at = null) {
    const bird = this.birds.find(b => b.ibis === ibis), id = bird?.held ?? null;
    if (id === null) return null;
    this.drop(bird);
    const body = rigidBody.get(this.world, id);
    if (at) rigidBody.setPosition(this.world, body, at, false);
    rigidBody.setLinearVelocity(this.world, body, v);
    rigidBody.setAngularVelocity(this.world, body, w);
    return id;
  }

  // The linear damping of the held prop (per second), or 0.
  heldDamping(ibis) {
    const bird = this.birds.find(b => b.ibis === ibis);
    return bird?.held == null ? 0 : rigidBody.get(this.world, bird.held).motionProperties.linearDamping;
  }

  // The world point where the held prop's middle is now, or null.
  heldAt(ibis) {
    const bird = this.birds.find(b => b.ibis === ibis);
    return bird?.held == null ? null : this.holdPoint(bird);
  }

  // A switch: a box (world [x0, y0, z0, x1, y1, z1]) that a peck turns in place of a pick up: grab()
  // calls turn(). Not a body: nothing collides with it. Returns its id, for target() and hull().
  addSwitch(box, turn) {
    const id = `switch${(this.switches ??= new Map()).size}`;
    this.switches.set(id, { box, turn });
    return id;
  }

  // A peck: turns the nearest switch, or picks up the nearest grabbable prop, within GRAB.reach of the
  // bill tip. A prop pops into the bill at once, and the head comes up with it (lift in actions.js).
  // With none, but another prop in reach (too big: the ball, a box), the bird tries to bite it and
  // gives up (fumble in actions.js).
  grab(bird) {
    const c = bird.ibis.character;
    if (c.inside) return;   // in a disguise (disguise.js): a peck hops out instead
    const tip = this.headPoint(bird, GRAB.tip);
    const id = this.nearest(this.targets(), tip);
    if (this.switches?.has(id)) {
      this.switches.get(id).turn();
      c.events.push({ type: 'turn' });   // for the sound (sound.js)
      return;
    }
    if (id === null) {
      if (this.nearest(this.bulky, tip) !== null) c.act('fumble');
      return;
    }
    c.act('lift');
    const body = rigidBody.get(this.world, id);
    rigidBody.setMotionType(this.world, body, MotionType.KINEMATIC, true);
    rigidBody.setObjectLayer(this.world, body, this.layers.ghost);
    bird.held = id;
    c.controller.carry = this.grabbable.get(id).jaw;
    rigidBody.setTransform(this.world, body, this.holdPoint(bird), this.gripQuaternion(bird), false);
    c.events.push({ type: 'pick', hold: this.grabbable.get(id).hold });   // for the sound (sound.js)
  }

  // The switch or grabbable prop that a peck would turn or pick up now (grab()), or null: the nearest one
  // to where the bill tip goes at the 'grab' of a peck (peckTip()). For a highlight.
  target(ibis) {
    const bird = this.birds.find(b => b.ibis === ibis);
    if (!bird || ibis.character.inside) return null;
    if (bird.held !== null) return null;
    const c = ibis.character, [x, y, z] = this.peckTip ??= peckTip();
    const cs = Math.cos(c.heading), sn = Math.sin(c.heading);
    return this.nearest(this.targets(), [c.position.x + x * cs + z * sn, c.position.y + y, c.position.z - x * sn + z * cs]);
  }

  // What a peck can take or turn: the grabbable props and the switches.
  targets() { return [...this.grabbable?.keys() ?? [], ...this.switches?.keys() ?? []]; }

  // Of ids (props and switches), the one not in a bill whose box is nearest to the world point tip,
  // within GRAB.reach.
  nearest(ids, tip) {
    let best = GRAB.reach, id = null;
    for (const other of ids ?? []) {
      if (this.held(other)) continue;
      const box = this.switches?.get(other)?.box ?? rigidBody.get(this.world, other).aabb;
      const d = Math.hypot(...[0, 1, 2].map(i => Math.max(box[i] - tip[i], 0, tip[i] - box[i + 3])));
      if (d < best) { best = d; id = other; }
    }
    return id;
  }

  // A head space point (as BIRD.reach) in world space, from the rig.
  headPoint(bird, point) {
    const { rig: R, character: c } = bird.ibis, [x, y, z] = headToCharacter(R, point);
    const cs = Math.cos(c.heading), sn = Math.sin(c.heading);
    return [c.position.x + x * cs + z * sn, y, c.position.z - x * sn + z * cs];
  }

  // Where the held prop's middle goes: the grip of its hold, and its edge distance out of the bill.
  holdPoint(bird) {
    const { grip, out, edge } = this.grabbable.get(bird.held), k = edge / HEAD_SCALE;
    return this.headPoint(bird, grip.map((v, i) => v + k * out[i]));
  }

  // A held prop lies across the bill (hold()): its y along the head's x.
  gripQuaternion(bird) {
    const { rig: R, character: c } = bird.ibis;
    return new Quaternion().setFromAxisAngle(UP, c.heading)
      .multiply(new Quaternion().setFromRotationMatrix(R.headRot))
      .multiply(hold(this.grabbable.get(bird.held).out)).toArray();
  }

  // Feet and head from the rig, in world space. moveKinematic gives them the velocity to get there in
  // dt, so a kick passes its speed to the ball.
  placeLimbs(bird, dt) {
    const { rig: R, character: c } = bird.ibis;
    const h = c.heading, cs = Math.cos(h), sn = Math.sin(h);
    const world = (v, up = 0) => [c.position.x + v.x * cs + v.z * sn, v.y + up, c.position.z - v.x * sn + v.z * cs];
    const targets = [world(R.footL, BIRD.footUp), world(R.footR, BIRD.footUp), world(R.head)];
    bird.limbs.forEach((id, i) => {
      const body = rigidBody.get(this.world, id), to = targets[i];
      const far = Math.hypot(to[0] - body.position[0], to[1] - body.position[1], to[2] - body.position[2]) > LIMB_TELEPORT;
      if (!bird.placed || far) rigidBody.setPosition(this.world, body, to, false);
      else rigidBody.moveKinematic(body, to, body.quaternion, dt);
    });
    if (bird.held === null) return;
    const body = rigidBody.get(this.world, bird.held);
    if (body) rigidBody.moveKinematic(body, this.holdPoint(bird), this.gripQuaternion(bird), dt);
  }

  // Wireframes of every collider. Loads the debug renderer only when asked.
  async debugView() {
    const { debugRenderer } = await import('crashcat/three');
    const options = debugRenderer.createDefaultOptions();
    options.bodies.wireframe = true;
    const state = debugRenderer.init(options);
    return { object: state.object3d, update: () => debugRenderer.update(state, this.world) };
  }
}

// Angle between a body's up and the world's up, from its quaternion.
export function tiltAngle([qx, , qz]) { return Math.acos(Math.min(1, Math.max(-1, 1 - 2 * (qx * qx + qz * qz)))); }

const UP = new Vector3(0, 1, 0);
// A held prop in head space: x out of the bill (the hold's out), y across the bill, z across the gap.
function hold(direction) {
  const out = new Vector3(...direction).normalize(), across = new Vector3(1, 0, 0);
  return new Quaternion().setFromRotationMatrix(new Matrix4().makeBasis(out, across, new Vector3().crossVectors(out, across)));
}

// Quaternion for a turn of a about y.
export function yaw(a) { return [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; }
const mix = (a, b, k) => a + (b - a) * k;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

// A head space point in character space, from the rig R.
function headToCharacter(R, [hx, hy, hz]) {
  const e = R.headRot.elements, s = HEAD_SCALE;
  return [
    R.head.x + s * (e[0] * hx + e[4] * hy + e[8] * hz),
    R.head.y + s * (e[1] * hx + e[5] * hy + e[9] * hz),
    R.head.z + s * (e[2] * hx + e[6] * hy + e[10] * hz),
  ];
}

// The bill tip at the 'grab' event of a peck from rest, in character space: about on the ground, 1.5
// ahead. A walk plays the peck on the upper body only, so it is the same then.
function peckTip() {
  const c = new Character();
  c.act('peck');
  for (let i = 0; i < 120 && !c.events.some(e => e.type === 'grab'); i++) c.update(STEP);
  return headToCharacter(solveRig(c.pose), GRAB.tip);
}
