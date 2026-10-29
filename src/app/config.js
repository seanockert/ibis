// The URL parameters of index.html, read once. anim (0 free play, 1 and up one move from src/moves.js),
// t (fixed time), yaw and pitch (fixed camera, as in sdf.html), scale, count (ibises in a grid), bench
// (frames to time), mud and wet (0 to 1), root (1: with t, place the bird where the move took it),
// props (0: no physics and props in free play), physics (1: show the colliders), env (0 or 1: the street
// and the sky; on in free play, off in the fixed views, so they still match sdf.html), sound (0: no
// sound), terrain (1: steps and a ramp in free play, to test the foot placement), lite (0 or 1: less GPU
// work; on for touch screens), ui (0: no buttons and joystick, for tools/strip.mjs), bird (miner: the
// fixed views show the noisy miner, src/birds.js), fly (with bird=miner in the fixed views: 1 the flight,
// 2 dives, on the spot; src/miner/flight.js), time (with env: day, dusk, night or morning; night=1 is time=night),
// level (a file name in src/levels/, without .json; default suburb).
import { pageBird } from '../birds.js';

// Lite: less GPU work, for touch screens (phones and tablets). The pixel ratio cap (1.5 otherwise): about
// 30% fewer pixels, a little softer. A 2048 shadow map: a quarter of the memory, and the toon step hides
// the softer edge.
const LITE = { pixelRatio: 1.25, shadowMap: 2048 };
const SHADOW_MAP = 4096;   // free play sun shadow map size

export function readConfig(search = location.search) {
  const params = new URLSearchParams(search);
  const number = (name, fallback) => (params.has(name) ? Number(params.get(name)) : fallback);
  const flag = (name, fallback) => (params.has(name) ? params.get(name) === '1' : fallback);
  const fixedTime = number('t', null);
  const count = Number(params.get('count') || 1);
  const bench = params.has('bench') ? Number(params.get('bench')) || 30 : null;
  const lite = flag('lite', matchMedia('(pointer: coarse)').matches);
  // Free play: one bird, the player drives it, the camera follows. Otherwise a fixed view.
  const play = count === 1 && fixedTime === null && !params.has('yaw') && bench === null;
  return {
    play, count, fixedTime, bench, lite,
    bird: pageBird(search),
    fly: play ? 0 : number('fly', 0),
    anim: Number(params.get('anim') || 0),
    scale: Number(params.get('scale') || Math.min(window.devicePixelRatio, lite ? LITE.pixelRatio : 1.5)),
    shadowMap: lite ? LITE.shadowMap : SHADOW_MAP,
    weather: { mud: Number(params.get('mud') || 0), wet: Number(params.get('wet') || 0) },
    env: flag('env', play),
    yaw: number('yaw', null),
    pitch: number('pitch', null),
    root: params.get('root') === '1',
    props: play && params.get('props') !== '0',
    colliders: params.get('physics') === '1',
    terrain: params.get('terrain') === '1',
    // Sound only where the frame loop runs: not in the fixed views or the bench.
    sound: fixedTime === null && bench === null && params.get('sound') !== '0',
    ui: params.get('ui') !== '0',
    time: params.get('time') ?? (params.get('night') === '1' ? 'night' : 'day'),
    level: params.get('level') ?? 'suburb',
  };
}
