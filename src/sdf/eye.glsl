// The eye and the lid in eye space (eyeSpace() in model.glsl), for the SDF (model.glsl) and for the
// runtime shaders in materials.js, which draw the pupil and cut the lid on the baked mesh.
// expr: top lid (less than 0 wide open), lid tilt (more than 0 angry), lower lid, pupil size.
// blink: 1 = happy closed eyes. look: pupil offset.

// Eyes, mirrored: the centre in head space (x on each side). Flattened, so the eye reads as a big disc
// without bulging past the head.
const vec3 EYE_C = vec3(0.095, 0.04, 0.0);
const vec3 EYE_R = vec3(0.07, 0.12, 0.12);

// Lid: positive where it covers the eye. The top lid closes with expr.x and the blink, and tilts down
// toward the bill when angry. The lower lid rises with expr.z.
float lidCover(vec3 e, vec4 expr, float blink) {
    float top = mix(mix(0.115, -0.13, expr.x), -0.13, blink) - 0.6 * expr.y * e.z;
    float cover = e.y - top;
    if (expr.z > 0.0) cover = max(cover, mix(-0.2, 0.1, expr.z) - e.y);
    return cover;
}

// Negative on the happy arc that the closed lid draws at blink 1.
float lidCrease(vec3 e) { return abs(e.y - (0.01 - 5.0 * e.z * e.z)) - 0.012; }

// Positive inside the pupil. Big pupils look forward along the bill. side: the sign of the head's x.
float pupilIn(vec3 e, float side, vec2 look, vec4 expr) {
    vec3 lookDir = normalize(vec3(0.55 + look.x * side * 0.4, 0.12 + look.y * 0.4, 0.83));
    return dot(normalize(e / EYE_R), lookDir) - (1.0 - 0.14 * expr.w * expr.w);
}
