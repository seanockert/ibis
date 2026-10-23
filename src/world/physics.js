// Physics for the scene: props that roll, rock and fall over, and the ibis as a solid that pushes them.
// This is the only file that imports crashcat, so the engine can change without changes elsewhere.
//
//   const physics = new Physics({ ground });   // ground: [z, y] heights across the street, or flat
//   physics.addFence({ x: [x0, x1], z: [z0, z1] });   // walls round a box: keep props in the play area
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
// limit, so a light ball moves away and a heavy bin stops the bird. Small kinematic spheres on the feet
// and the head kick and peck light props only, so a peck can't shove the bin.
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
import {
  CastRayStatus, MotionType, MotorState, SpringMode, addBroadphaseLayer, addObjectLayer, box, capsule, castRay, convexHull,
  createClosestCastRayCollector, createDefaultCastRaySettings, createWorld, createWorldSettings, enableCollision, filter,
  compound, hingeConstraint, kcc, motionProperties, offsetCenterOfMass, registerConstraints, registerShapes, rigidBody, sphere, updateWorld,
} from 'crashcat';
import { Quaternion, Vector3 } from 'three';
import { GROUND } from '../ibis/motion/controller.js';
import { HEAD_SCALE } from '../ibis/rig.js';

registerShapes([sphere.def, box.def, capsule.def, convexHull.def, offsetCenterOfMass.def, compound.def]);
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
  upright: 0.35,               // a hollow prop tipped less than this (radians) can hold the bird inside
  backSpeed: 8,                // fastest step back for room, units per second
  room: 600,                   // push on the prop in N for each unit of overlap,
  roomSpeed: 1,                // up to this speed of the prop where the head is
  foot: 0.13, footUp: 0.1,     // foot spheres: radius, height above the ankle
  peck: 0.2,                   // head sphere that follows the rig
};
const LIMB_TELEPORT = 1;       // a limb that moves farther than this in a frame jumps there: no kick

const GROUND_HALF = 100;   // half size of the ground, x and z: past the play area (PLAY in street.js)
const GROUND_DEPTH = 1;   // the ground solids go this far down

export class Physics {
  // ground: [z, y] points from +z to -z (PROFILE in street.js), straight between. Without it: flat at 0.
  constructor({ ground = null } = {}) {
    const s = createWorldSettings();
    s.gravity = [0, -GRAVITY, 0];
    const still = addBroadphaseLayer(s), moving = addBroadphaseLayer(s);
    // fixed: the ground. fence: stops light props only, so a bin can still fall over it. terrain: steps
    // and ramps; the bird walks on them. heavy: blocks the bird. light: the feet and head move it too.
    // limb: the bird's kinematic spheres. ghost: the bird's solid, for the debug view and ray casts; it
    // collides with nothing.
    this.layers = {
      fixed: addObjectLayer(s, still), fence: addObjectLayer(s, still), terrain: addObjectLayer(s, still), heavy: addObjectLayer(s, moving),
      light: addObjectLayer(s, moving), limb: addObjectLayer(s, moving), ghost: addObjectLayer(s, moving),
    };
    const L = this.layers;
    const pairs = [['heavy', 'fixed'], ['heavy', 'terrain'], ['light', 'terrain'], ['heavy', 'heavy'], ['heavy', 'light'], ['light', 'fixed'], ['light', 'fence'], ['light', 'light'], ['limb', 'light']];
    for (const [a, b] of pairs) {
      enableCollision(s, L[a], L[b]);
    }
    this.world = createWorld(s);
    this.gravity = s.gravity;
    this.addGround(ground ?? [[GROUND_HALF, 0], [-GROUND_HALF, 0]]);
    // The bird collides with props only: the controller keeps it on the ground and inside its bounds.
    // Set the object layers directly: disableObjectLayer() also turns off the broadphase layer, which
    // the limbs share with the props.
    this.birdFilter = filter.create(this.world.settings.layers);
    for (const layer of [L.fixed, L.fence, L.limb, L.ghost]) this.birdFilter.enabledObjectLayers[layer] = 0;
    this.birdUpdate = kcc.createDefaultUpdateSettings();
    this.birdUpdate.stickToFloorStepDown = [0, 0, 0];
    this.birdUpdate.walkStairsStepUp = [0, 0, 0];
    this.birds = [];
    this.heavyFilter = filter.create(this.world.settings.layers);
    for (const layer of [L.fixed, L.fence, L.terrain, L.light, L.limb, L.ghost]) this.heavyFilter.enabledObjectLayers[layer] = 0;
    // Ground rays: the ground, terrain and heavy props.
    this.groundFilter = filter.create(this.world.settings.layers);
    for (const layer of [L.fence, L.light, L.limb, L.ghost]) this.groundFilter.enabledObjectLayers[layer] = 0;
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
    // The inside, from the middle of the box: half sizes across, and the floor and the rim heights.
    (this.hollow ??= new Map()).set(id, { half: [w / 2 - wall, d / 2 - wall], floor: -h / 2 + floor, rim: h / 2 });
    return id;
  }

  // A dynamic convex hull round points: flat array [x, y, z, ...].
  addHull(points, options) {
    return this.addDynamic(convexHull.create({ positions: points, convexRadius: 0.03 }), options);
  }

  // group: a bit from newGroup(). Bodies with the same group don't collide, as a bin and its lid.
  addDynamic(shape, { position, quaternion = [0, 0, 0, 1], mass, friction = 0.6, restitution = 0, damping = 0.05, light = false, group }) {
    return rigidBody.create(this.world, {
      motionType: MotionType.DYNAMIC, objectLayer: light ? this.layers.light : this.layers.heavy, shape,
      position, quaternion, mass, friction, restitution, linearDamping: damping, angularDamping: damping,
      ...(group && { collisionGroups: group, collisionMask: ~group >>> 0 }),
    }).id;
  }

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

  remove(id) { rigidBody.remove(this.world, rigidBody.get(this.world, id)); }

  impulse(id, impulse, at) { rigidBody.addImpulseAtPosition(this.world, this.body(id), impulse, at); }

  // Gives the ibis a solid body. Call before its first update after this.
  addBird(ibis) {
    const L = this.layers, c = ibis.character;
    const shape = capsule.create({ radius: BIRD.solid.radius, halfHeightOfCylinder: BIRD.solid.halfHeight });
    const k = kcc.create({
      shape, shapeOffset: BIRD.solid.at, mass: BIRD.mass, maxStrength: BIRD.strength, innerRigidBody: { shape, objectLayer: L.ghost },
    }, [c.position.x, c.position.y, c.position.z], yaw(c.heading));
    kcc.add(this.world, k);
    const limb = r => rigidBody.create(this.world, {
      motionType: MotionType.KINEMATIC, objectLayer: L.limb, shape: sphere.create({ radius: r }), position: [0, -10, 0],
    }).id;
    const bird = { ibis, kcc: k, limbs: [limb(BIRD.foot), limb(BIRD.foot), limb(BIRD.peck)], placed: false, touching: false, under: null, inside: null };
    this.birds.push(bird);
    c.collide = (controller, dt) => this.moveBird(bird, controller, dt);
    c.controller.groundAt = (x, z, out) => this.groundAt(x, z, c.position.y + GROUND.stepUp, out);
  }

  // One controller sub step: sweep the solid from where it was to where the controller put it. It turns
  // with the heading without a sweep, and the next sweep pushes it back out of what the turn hit.
  // Inside a hollow prop (an upright box with its flaps open), the bird stands on its floor: the walls
  // round it are not a prop to push. Without this, the shove rays and the room check found the wall
  // ahead, the bird pushed the box it stood in and followed it, and the box ran away with the bird.
  // So while inside, the bird's sweep and rays skip that body, and the bird stays inside its walls
  // (inner half size less the solid's radius) until it jumps out: a jump from inside keeps the walls
  // skipped until the feet are over the rim, or the solid hit the wall and tipped the box, and the
  // rising rim caught the bird and put it back in.
  moveBird(bird, c, dt) {
    const inside = bird.inside = c.grounded ? this.insideOf(bird, c) : bird.inside && this.stillIn(bird.inside, c);
    const skip = inside ? body => body.id !== inside.id : undefined;
    this.birdFilter.bodyFilter = this.heavyFilter.bodyFilter = skip;
    this.moveBirdIn(bird, c, dt, inside);
    this.birdFilter.bodyFilter = this.heavyFilter.bodyFilter = undefined;
  }

  // The hollow prop the bird stands inside, as { id, body, info }, or null.
  insideOf(bird, c) {
    const id = bird.under, info = id !== null && this.hollow?.get(id);
    if (!info) return null;
    const body = rigidBody.get(this.world, id);
    if (!body || tiltAngle(body.quaternion) > BIRD.upright) return null;
    const local = this.toLocal(body, c.position);
    if (local.y > info.rim || Math.abs(local.x) > info.half[0] || Math.abs(local.z) > info.half[1]) return null;
    return { id, body, info };
  }

  // In the air after a jump from inside: still inside until the feet are over the rim.
  stillIn(inside, c) {
    const body = rigidBody.get(this.world, inside.id);
    if (!body || c.position.y > body.position[1] + inside.info.rim + BIRD.clear) return null;
    return { ...inside, body };
  }

  toLocal(body, p) {
    return new Vector3(p.x, p.y, p.z).sub(new Vector3().fromArray(body.position)).applyQuaternion(new Quaternion().fromArray(body.quaternion).invert());
  }

  moveBirdIn(bird, c, dt, inside) {
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
    if (inside) {
      // Keep the solid inside the walls, and nothing to push.
      const { body, info } = inside, r = BIRD.solid.radius, local = this.toLocal(body, c.position);
      local.x = Math.min(Math.max(local.x, -Math.max(info.half[0] - r, 0)), Math.max(info.half[0] - r, 0));
      local.z = Math.min(Math.max(local.z, -Math.max(info.half[1] - r, 0)), Math.max(info.half[1] - r, 0));
      local.applyQuaternion(new Quaternion().fromArray(body.quaternion)).add(new Vector3().fromArray(body.position));
      c.position.x = local.x;
      c.position.z = local.z;
      kcc.setPosition(this.world, k, [c.position.x, c.position.y, c.position.z]);
      this.feetGround(bird, c);
      c.shove = 0;
      bird.touching = false;
      if (!c.grounded) c.shove = 0;
      return;
    }
    this.feetGround(bird, c);
    // Whatever stops the bird (the forehead, or the bill in an action or at a run) takes the push. In
    // the air the bird has nothing to push from: no brace and no push, so it can land on a prop.
    const forehead = this.shove(c), room = this.makeRoom(bird, c, dt);
    const contact = forehead ?? room;
    if (!c.grounded) c.shove = 0;
    this.push(bird, c, c.grounded ? contact : null, dt);
  }

  // Pushes the prop the bird is against: one bump for each approach (none again until the bird backs
  // off, so a rocking bin can't pump), then a steady push with the bird's speed. Neither pushes the
  // prop faster than the bird moves (pushUpTo).
  push(bird, c, contact, dt) {
    const bump = contact !== null && !bird.touching;
    if (contact) bird.touching = true;
    else if (c.shove === 0) bird.touching = false;
    if (!contact || c.speed <= 0) return;
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
    this.pushUpTo(hit.id, hit.at, away, BIRD.roomSpeed, BIRD.room * worst * dt);
    return { ...hit, dir: away };
  }

  // Ground under a world point, from a ray down from top: out.y the height, out.n the normal (a
  // Vector3). A prop top gets BIRD.clear. A miss (off the ground) is y = 0.
  groundAt(x, z, top, out) {
    const length = top + GROUND_DEPTH;
    this.ray.reset();
    castRay(this.world, this.ray, this.groundSettings, [x, top, z], [0, -1, 0], length, this.groundFilter);
    if (this.ray.hit.status !== CastRayStatus.COLLIDING) {
      out.y = 0;
      out.n.set(0, 1, 0);
      return out;
    }
    const y = top - this.ray.hit.fraction * length, hit = this.hit, body = rigidBody.get(this.world, this.ray.hit.bodyIdB);
    hit[0] = x; hit[1] = y; hit[2] = z;
    rigidBody.getSurfaceNormal(hit, body, hit, this.ray.hit.subShapeId);
    out.y = y + (body.motionType === MotionType.DYNAMIC ? BIRD.clear : 0);
    out.n.fromArray(hit);
    out.body = body.motionType === MotionType.DYNAMIC ? body.id : null;
    return out;
  }

  // Ground under each posed foot, the higher of the ankle and the toe tip (controller.feet), and the
  // highest of them (controller.floor).
  feetGround(bird, c) {
    const R = bird.ibis.rig, sn = Math.sin(c.heading), cs = Math.cos(c.heading), top = c.position.y + GROUND.stepUp;
    const probe = this.probe;
    let under = null, high = -Infinity;
    [R.footL, R.footR].forEach((foot, i) => {
      const out = c.feet[i];
      out.y = -Infinity;
      for (const ahead of [0, GROUND.toes]) {
        const x = foot.x, z = foot.z + ahead;
        probe.body = null;
        this.groundAt(c.position.x + x * cs + z * sn, c.position.z - x * sn + z * cs, top, probe);
        if (probe.y > out.y) { out.y = probe.y; out.n.copy(probe.n); }
        if (probe.y > high) { high = probe.y; under = probe.body ?? null; }
      }
    });
    c.floor = Math.max(c.feet[0].y, c.feet[1].y);
    bird.under = under;   // the prop the feet stand on, or null
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
    for (const bird of this.birds) this.placeLimbs(bird, dt);
    const n = Math.max(1, Math.ceil(dt / STEP - 1e-6));
    for (let i = 0; i < n; i++) updateWorld(this.world, undefined, dt / n);
    for (const bird of this.birds) bird.placed = true;
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
function tiltAngle([qx, , qz]) { return Math.acos(Math.min(1, Math.max(-1, 1 - 2 * (qx * qx + qz * qz)))); }

function yaw(a) { return [0, Math.sin(a / 2), 0, Math.cos(a / 2)]; }
const mix = (a, b, k) => a + (b - a) * k;
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

