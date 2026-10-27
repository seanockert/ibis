// The stage: renderer, scene, camera with orbit controls, the sun and its shadow, and the colour grade.
//
//   const stage = new Stage(canvas, config, asset.sun);
//   stage.render();   // every frame
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { Grade } from '../world/grade.js';

const FOCAL = 3.2;   // the SDF view's lens: vertical half-angle atan(1 / FOCAL)
const CAM_DIST_PLAY = 12.5;  // free play: the whole walk circle is in view, then the camera follows
const CAM_MAX_PLAY = 18;     // free play: the zoom can't take the camera farther than this
export const TARGET_PLAY = new THREE.Vector3(0, 0.9, 0);
const CAM_MIN_Y = 0.3;      // the orbit can't take the camera lower than this
const GROUND_LIT = new THREE.Color().setRGB(0.925, 0.902, 0.855, 'srgb');
const GROUND_SHADE = new THREE.Color().setRGB(0.80, 0.78, 0.86, 'srgb');
// Free play sun shadow: half size of the area, the sun's distance from the area's centre (above the
// tallest tree top), and the depth bias (about 0.02 units).
const SHADOW = { half: 25, sun: 45, bias: -0.0002 };

export class Stage {
  // sun: the unit direction to the sun (asset.sun).
  constructor(canvas, config, sun) {
    const { play, env } = config;
    this.config = config;
    this.sunDirection = sun;
    // With the street, Grade draws into its own multisampled target: the canvas gets only a full-screen quad.
    const renderer = this.renderer = new THREE.WebGLRenderer({ canvas, antialias: !env, stencil: true });
    renderer.setPixelRatio(config.scale);
    // The canvas CSS sets the size (the large viewport on phones), not innerWidth and innerHeight.
    const size = () => [canvas.clientWidth || innerWidth, canvas.clientHeight || innerHeight];
    let [w, h] = size();
    renderer.setSize(w, h, false);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;

    const scene = this.scene = new THREE.Scene();
    scene.background = GROUND_LIT;
    const camera = this.camera = new THREE.PerspectiveCamera(2 * Math.atan(1 / FOCAL) * 180 / Math.PI, w / h, 0.1, env ? 800 : 100);
    const yaw = config.yaw ?? -0.8;
    const pitch = config.pitch !== null ? -0.05 + 1.15 * config.pitch : play ? 0.25 : 0.22;
    // Close camera, as in the SDF view (view of the bird): screenshots and the grid.
    const { view } = config.bird;
    const target = play ? TARGET_PLAY : new THREE.Vector3(...view.target);
    camera.position.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch))
      .multiplyScalar(play ? CAM_DIST_PLAY : view.dist).add(target);
    const controls = this.controls = new OrbitControls(camera, canvas);
    controls.target.copy(target);
    if (play) controls.maxDistance = CAM_MAX_PLAY;
    controls.update();

    const light = this.sun = new THREE.DirectionalLight(0xffffff, 1);
    light.position.copy(sun).multiplyScalar(6);
    light.castShadow = true;
    light.shadow.mapSize.set(2048, 2048);
    Object.assign(light.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 15 });
    light.shadow.bias = -0.0005;
    light.shadow.normalBias = 0.01;   // no shadow acne on the toon bands
    if (play) {
      // Free play: a wide shadow area round the camera's focus, so props away from the bird keep their
      // shadows. The map is larger, so a texel stays about as small as in the close views.
      light.shadow.mapSize.set(config.shadowMap, config.shadowMap);
      const r = SHADOW.half;
      Object.assign(light.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 2 * SHADOW.sun });
      light.shadow.bias = SHADOW.bias;
    }
    scene.add(light, light.target);

    // With the street: the warm colour grade on the whole frame. Without: a plain ground.
    this.grade = env ? new Grade(renderer, scene, camera) : null;
    if (!env) scene.add(plainGround());

    new ResizeObserver(() => {
      const [nw, nh] = size();
      if (nw === w && nh === h) return;
      [w, h] = [nw, nh];
      renderer.setSize(w, h, false);
      this.grade?.setSize(w, h);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    }).observe(canvas);
  }

  render() { this.grade ? this.grade.render() : this.renderer.render(this.scene, this.camera); }

  // Keeps the camera above the ground: the lowest polar angle for this distance.
  keepAbove() {
    const { camera, controls } = this, reach = camera.position.distanceTo(controls.target);
    controls.maxPolarAngle = Math.PI / 2 + Math.asin(Math.min(Math.max((controls.target.y - CAM_MIN_Y) / reach, -1), 1));
  }

  // Centres the sun's shadow area on a point on the ground. The centre moves in whole shadow texels
  // across the sun's view, so the shadow edges don't crawl as the camera follows the bird.
  shadowTo(point) {
    const sun = this.sunDirection, texel = 2 * SHADOW.half / this.config.shadowMap;
    sunRight.crossVectors(sun, UP).normalize();
    sunUp.crossVectors(sunRight, sun);
    const x = Math.round(point.dot(sunRight) / texel) * texel, y = Math.round(point.dot(sunUp) / texel) * texel;
    centre.copy(sunRight).multiplyScalar(x).addScaledVector(sunUp, y).addScaledVector(sun, point.dot(sun));
    this.sun.target.position.copy(centre);
    this.sun.position.copy(sun).multiplyScalar(SHADOW.sun).add(centre);
  }
}

const UP = new THREE.Vector3(0, 1, 0), sunRight = new THREE.Vector3(), sunUp = new THREE.Vector3(), centre = new THREE.Vector3();   // scratch

// Ground with no street: plain background colour, with the shade colour where the shadow falls. It
// draws first and writes no depth, so it can't cover the outline round the feet.
function plainGround() {
  const material = new THREE.ShadowMaterial({ color: GROUND_SHADE, transparent: false, depthWrite: false });
  material.onBeforeCompile = shader => {
    shader.uniforms.litColor = { value: GROUND_LIT };
    shader.fragmentShader = shader.fragmentShader
      .replace('void main() {', 'uniform vec3 litColor;\nvoid main() {')
      .replace('gl_FragColor = vec4( color, opacity * ( 1.0 - getShadowMask() ) );', 'gl_FragColor = vec4( mix( color, litColor, getShadowMask() ), 1.0 );');
  };
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(60, 60), material);
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  ground.renderOrder = -1;
  return ground;
}
