// Small helpers for the world files.
import { Color } from 'three';

// A colour from sRGB values (as picked from the concept art), in the linear working space.
export const srgb = (r, g, b) => new Color().setRGB(r, g, b, 'srgb');
// A number as a GLSL float, for constants written into a shader.
export const f = v => v.toFixed(3);
