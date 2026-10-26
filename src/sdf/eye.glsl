// The eye and the lid in eye space (eyeSpace() in model.glsl), for the SDF (model.glsl) and for the
// runtime shaders in materials.js, which draw the pupil and cut the lid on the baked mesh.
// expr: top lid (less than 0 wide open), lid tilt (more than 0 angry), lower lid, pupil size.
// blink: 1 = happy closed eyes. look: pupil offset.
// Needs the eye shape of the bird first (eye in src/ibis/bird.js): EYE_C, EYE_R, LID_OPEN, PUPIL_DIR and PUPIL_R.

// Lid: positive where it covers the eye. The top lid closes with expr.x and the blink, and tilts down
// toward the bill when angry. The lower lid rises with expr.z.
float lidCover(vec3 e, vec4 expr, float blink) {
    float top = mix(mix(LID_OPEN, -0.13, expr.x), -0.13, blink) - 0.6 * expr.y * e.z;
    float cover = e.y - top;
    if (expr.z > 0.0) cover = max(cover, mix(-0.2, 0.1, expr.z) - e.y);
    return cover;
}

// Negative on the happy arc that the closed lid draws at blink 1.
float lidCrease(vec3 e) { return abs(e.y - (0.01 - 5.0 * e.z * e.z)) - 0.012; }

// Positive inside the pupil. side: the sign of the head's x.
float pupilIn(vec3 e, float side, vec2 look, vec4 expr) {
    vec3 lookDir = normalize(vec3(PUPIL_DIR.x + look.x * side * 0.4, PUPIL_DIR.y + look.y * 0.4, PUPIL_DIR.z));
    return dot(normalize(e / EYE_R), lookDir) - (1.0 - PUPIL_R * expr.w * expr.w);
}
