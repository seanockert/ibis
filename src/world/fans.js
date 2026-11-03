// The gaze of each miner with a gaze (sentry.js), as a fan on the ground: where it looks now and how far
// it sees. Pale yellow when calm, to orange and red as its meter fills. Only while it sits on its perch.
// The fan follows the ground: its points get the ground height each frame.
//
//   const fans = new GazeFans(sentry, height);   // height(x, z): the ground
//   scene.add(fans.object);
//   fans.update();                                // every frame
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Group, Mesh, MeshBasicMaterial } from 'three';

// rings, rays: the fan's grid. near: it starts this far from the perch. lift: above the ground.
// calm, alarm: colours at meter 0 and 1. opacity: of the fill at meter 0 (up to 1.6 times at 1), and of
// the edge, a band edge wide round the fan.
const FAN = { rings: 6, rays: 16, near: 0.6, lift: 0.06, calm: 0xfff0a8, alarm: 0xff4a2a, opacity: 0.3, edge: 0.22, edgeOpacity: 0.85 };

export class GazeFans {
  constructor(sentry, height) {
    this.sentry = sentry;
    this.height = height;
    this.object = new Group();
    this.fans = sentry.guards.filter(G => G.gaze).map(G => {
      const { rings, rays } = FAN, count = (rings + 1) * (rays + 1);
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new BufferAttribute(new Float32Array(count * 3), 3));
      const index = [];
      for (let i = 0; i < rings; i++) for (let j = 0; j < rays; j++) {
        const a = i * (rays + 1) + j, b = a + rays + 1;
        index.push(a, b, a + 1, a + 1, b, b + 1);
      }
      geometry.setIndex(index);
      const material = new MeshBasicMaterial({ color: FAN.calm, transparent: true, opacity: FAN.opacity, depthWrite: false, side: DoubleSide });
      const mesh = new Mesh(geometry, material);
      mesh.frustumCulled = false;
      // The edge: a strip along one side, the arc and the other side (pairs of points, in and out).
      const n = 2 * (rings + 1) + (rays + 1), edge = new BufferGeometry();
      edge.setAttribute('position', new BufferAttribute(new Float32Array(n * 2 * 3), 3));
      const strip = [];
      for (let i = 0; i < n - 1; i++) strip.push(2 * i, 2 * i + 1, 2 * i + 2, 2 * i + 2, 2 * i + 1, 2 * i + 3);
      edge.setIndex(strip);
      const line = new Mesh(edge, new MeshBasicMaterial({ color: FAN.calm, transparent: true, opacity: FAN.edgeOpacity, depthWrite: false, side: DoubleSide }));
      line.frustumCulled = false;
      this.object.add(mesh, line);
      return { G, mesh, line };
    });
    this.colour = new Color();
  }

  update() {
    const { rings, rays, near, lift } = FAN;
    for (const { G, mesh, line } of this.fans) {
      const g = G.gaze, on = G.state === 'watch' && G.flier.flight.landed;
      mesh.visible = line.visible = on;
      if (!on) continue;
      const p = mesh.geometry.attributes.position;
      for (let i = 0; i <= rings; i++) {
        const r = near + (g.range - near) * i / rings;
        for (let j = 0; j <= rays; j++) {
          const a = g.dir - g.angle + 2 * g.angle * j / rays;
          const x = G.spot.x + r * Math.sin(a), z = G.spot.z + r * Math.cos(a);
          p.setXYZ(i * (rays + 1) + j, x, this.height(x, z) + lift, z);
        }
      }
      p.needsUpdate = true;
      // The edge: up the near side, round the arc, down the far side. Each point and one inset toward
      // the middle of the fan by FAN.edge.
      const e = line.geometry.attributes.position, path = [];
      for (let i = 0; i <= rings; i++) path.push([near + (g.range - near) * i / rings, -1]);
      for (let j = 0; j <= rays; j++) path.push([g.range, -1 + 2 * j / rays]);
      for (let i = rings; i >= 0; i--) path.push([near + (g.range - near) * i / rings, 1]);
      path.forEach(([r, k], i) => {
        const a = g.dir + k * g.angle, inA = g.dir + k * (g.angle - FAN.edge / Math.max(r, 1)), rIn = r === g.range ? r - FAN.edge : r;
        for (const [m, rr, aa] of [[0, r, a], [1, rIn, inA]]) {
          const x = G.spot.x + rr * Math.sin(aa), z = G.spot.z + rr * Math.cos(aa);
          e.setXYZ(2 * i + m, x, this.height(x, z) + lift + 0.01, z);
        }
      });
      e.needsUpdate = true;
      const colour = this.colour.set(FAN.calm).lerp(new Color(FAN.alarm), g.meter);
      mesh.material.color.copy(colour);
      line.material.color.copy(colour);
      mesh.material.opacity = FAN.opacity * (1 + 0.6 * g.meter);
    }
  }
}
