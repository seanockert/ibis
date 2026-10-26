// Bake kernel: evaluates one part of the bird's model.glsl at grid points or at listed points.
// Each output texel is one sample, numbered row by row from uOffset.
uniform int uPart;     // PART_* below
uniform int uMode;     // 0 grid (d, id) | 1 points (d, id) | 2 points (gradient, d) | 3 palette
uniform int uOffset;   // index of the first sample in this draw
uniform int uWidth;    // output width in texels
uniform vec3 uMin;     // grid: first sample
uniform float uCell;   // grid: sample spacing
uniform ivec3 uDims;   // grid: samples per axis
uniform highp sampler2D uPoints;   // points: xyz, uWidth texels per row
out vec4 outColor;

// Mesh parts.
const int PART_CORE = 1;     // body, tail and thighs
const int PART_LEG_L = 2;    // shank and toes
const int PART_LEG_R = 3;
const int PART_WING_L = 4;
const int PART_WING_R = 5;
const int PART_JAW = 6;
const int PART_EYES = 7;
const int PART_LIDS = 8;     // full lid shells: the runtime shader cuts them at the lid line
const int PART_SCARF = 9;
const int PART_NECK = 15;    // neck tube. Apart from the skull, so it can slide into it as the head turns.
const int PART_HEAD = 16;    // skull and upper bill
// Sub-parts of the core, for skin weights.
const int PART_W_BODY = 10;
const int PART_W_THIGH_L = 11;
const int PART_W_THIGH_R = 12;

vec2 part(vec3 p) {
    vec3 q = bodySpace(p);
    vec3 h = headSpace(p);
    float bodyD = body(q);
    if (uPart == PART_CORE) {
        vec2 res = vec2(bodyD, bodyMat(q));
        addPart(res, tail(q), tailMat(q));
        addPart(res, thigh(p, gHipL, gKneeL, bodyD), MAT_THIGH);
        addPart(res, thigh(p, gHipR, gKneeR, bodyD), MAT_THIGH);
        return res;
    }
    if (uPart == PART_NECK) return vec2(neck(p), MAT_NECK);
    // No neck: a far distance. Not 1e9: smin() computes mix(b, a, 1) and in float that loses a.
    if (uPart == PART_HEAD) return vec2(skullBill(h, 10.0) * HEAD_SCALE, skullMat(h));
    if (uPart == PART_LEG_L) return vec2(lowerLeg(p, gHipL, gKneeL, gFootL, 1.0), MAT_LEG);
    if (uPart == PART_LEG_R) return vec2(lowerLeg(p, gHipR, gKneeR, gFootR, -1.0), MAT_LEG);
    if (uPart == PART_WING_L) return wingL(p);
    if (uPart == PART_WING_R) return wingR(p);
    if (uPart == PART_JAW) { vec2 j = jaw(h); return vec2(j.x * HEAD_SCALE, j.y); }
    if (uPart == PART_EYES) return vec2(sdEllipsoid(eyeSpace(h), EYE_R) * HEAD_SCALE, MAT_EYE);
    if (uPart == PART_LIDS) return vec2(sdEllipsoid(eyeSpace(h), EYE_R + 0.006) * HEAD_SCALE, MAT_BLACK);
#ifdef SCARF
    if (uPart == PART_SCARF) { float solid; return scarfUncarved(q, bodyD, solid); }
#endif
    if (uPart == PART_W_BODY) return vec2(min(bodyD, tail(q)), 0.0);
    if (uPart == PART_W_THIGH_L) return vec2(thighOnly(p, gHipL, gKneeL), 0.0);
    if (uPart == PART_W_THIGH_R) return vec2(thighOnly(p, gHipR, gKneeR), 0.0);
    return vec2(1e9, 0.0);
}

void main() {
    int idx = uOffset + int(gl_FragCoord.y) * uWidth + int(gl_FragCoord.x);
    if (uMode == 3) {
        vec3 lit, shade, line;
        // Bit operations, not / and %: Chrome on Metal gave zeros for idx / 32 here.
        paletteSrgb(float(idx & 31), lit, shade, line);
        int row = idx >> 5;
        outColor = vec4(row == 0 ? lit : row == 1 ? shade : line, 1.0);
        return;
    }
    vec3 p;
    if (uMode == 0) {
        ivec3 c = ivec3(idx % uDims.x, (idx / uDims.x) % uDims.y, idx / (uDims.x * uDims.y));
        p = uMin + vec3(c) * uCell;
    } else {
        p = texelFetch(uPoints, ivec2(idx % uWidth, idx / uWidth), 0).xyz;
    }
    if (uMode == 2) {
        const float E = 0.0004;
        vec3 g = vec3(part(p + vec3(E, 0, 0)).x - part(p - vec3(E, 0, 0)).x,
                      part(p + vec3(0, E, 0)).x - part(p - vec3(0, E, 0)).x,
                      part(p + vec3(0, 0, E)).x - part(p - vec3(0, 0, E)).x) / (2.0 * E);
        outColor = vec4(g, part(p).x);
        return;
    }
    outColor = vec4(part(p), 0.0, 1.0);
}
