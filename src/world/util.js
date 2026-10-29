// Small helpers for the world files.
import { Color } from 'three';

// A colour from sRGB values (as picked from the concept art), in the linear working space.
export const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');
// A number as a GLSL float, for constants written into a shader.
export const f = v => v.toFixed(3);
// Is (x, z) in a box { x: [min, max], z: [min, max] }?
export const inBox = (box, x, z) => x >= box.x[0] && x <= box.x[1] && z >= box.z[0] && z <= box.z[1];
