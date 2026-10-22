// Australian white ibis: the SDF model. This is the source of the shape. tools/bake.mjs turns it into
// public/ibis.glb, and sdf.html raymarches it as a reference.
// The bones come from src/ibis/rig.js as the g* uniforms. Needs library.glsl first.

const float WING_FOLD = 0.50;
const vec2  WING_BULGE = vec2(0.05, -0.45);   // wing-local (z, y) of the point that sits furthest out
const vec2  WING_PINK_C = vec2(0.0, -0.10);   // wing-local (z, y) of the centre of the pink underside disc
const float WING_PINK_R = 0.20;
const float HEAD_SCALE = 1.12;
const vec3  NECK_BASE = vec3(0.0, 0.72, 0.20);   // body space
const vec3  BOUND_C = vec3(0.0, 1.0, 0.3);   // sphere that holds the character in every pose, at rest
const float BOUND_R = 1.9;

// Material ids.
const float MAT_GROUND = 1.0;
const float MAT_WHITE = 2.0;
const float MAT_BLACK = 3.0;
const float MAT_BEAK = 4.0;
const float MAT_EYE = 5.0;
const float MAT_PUPIL = 6.0;
const float MAT_MAROON = 7.0;
const float MAT_LEG = 11.0;
const float MAT_MOUTH = 12.0;
const float MAT_WING = 13.0;       // white wing coverts, a separate id so a line splits wing from body
const float MAT_GOLD = 14.0;       // gold bands on the scarf
const float MAT_TAIL = 15.0;       // black like the wing tips, a separate id so a line splits them

// ---- rig, set by src/ibis/rig.js ----
uniform vec3 gPelvis, gNeckBase, gNeckCtrl, gNeckTip, gHead, gShoulderL, gShoulderR;
uniform vec3 gHipL, gHipR, gKneeL, gKneeR, gFootL, gFootR;
uniform mat3 gBodyInv, gHeadInv, gWingInvL, gWingInvR;
uniform float gJaw, gBlink;
uniform vec2 gLook;
uniform vec4 gExpr;   // top lid (less than 0 wide open), lid tilt (more than 0 angry), lower lid, pupil size
vec2 gSolid;   // mapChar() with solid stand-ins for the thin shells (scarf ends), which give a rough contour

mat3 rotX(float a) { float c = cos(a), s = sin(a); return mat3(1.0, 0.0, 0.0, 0.0, c, s, 0.0, -s, c); }

// ---- model ----
float sdRoundConeAB(vec3 p, vec3 a, vec3 b, float r1, float r2) {
    vec3 ba = b - a;
    float h = length(ba);
    vec3 axis = ba / h;
    vec3 pa = p - a;
    float y = dot(pa, axis);
    return sdRoundCone(vec3(length(pa - axis * y), y, 0.0), r1, r2, h);
}

vec3 bezier(vec3 a, vec3 b, vec3 c, float t) { return mix(mix(a, b, t), mix(b, c, t), t); }

// Tapered curved tube from 5 round-cone segments along the Bezier a-b-c, radius r0 to r1.
// Returns vec2(distance, height of p above the nearest axis point), so callers can paint the top side.
vec2 taperTube(vec3 p, vec3 a, vec3 b, vec3 c, float r0, float r1, float tEnd) {
    vec2 res = vec2(1e9, 0.0);
    vec3 prev = a;
    for (int i = 1; i <= 5; i++) {
        float t0 = tEnd * float(i - 1) / 5.0;
        float t1 = tEnd * float(i) / 5.0;
        vec3 next = bezier(a, b, c, t1);
        float d = sdRoundConeAB(p, prev, next, mix(r0, r1, t0), mix(r0, r1, t1));
        if (d < res.x) {
            vec3 ba = next - prev;
            vec3 axisPoint = prev + ba * clamp(dot(p - prev, ba) / dot(ba, ba), 0.0, 1.0);
            res = vec2(d, p.y - axisPoint.y);
        }
        prev = next;
    }
    return res;
}

void addPart(inout vec2 res, float d, float id) { if (d < res.x) res = vec2(d, id); }

float segDist(vec3 p, vec3 a, vec3 b) {
    vec3 pa = p - a, ba = b - a;
    return length(pa - ba * clamp(dot(pa, ba) / dot(ba, ba), 0.0, 1.0));
}

// 2D ellipse, same approximation as sdEllipsoid. Close to exact for the low aspect used here.
float sdEllipse2(vec2 p, vec2 r) {
    float k0 = length(p / r), k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

// 2D blade that tapers from radius ra at a to rb at b.
float sdBlade(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    return sdRoundConeAB(vec3(p, 0.0), vec3(a, 0.0), vec3(b, 0.0), ra, rb);
}

// Wing in its local frame: x outward (thin), -y along the wing, z toward the head.
// A flat outline in the y-z plane given a lens-shaped thickness, so the field stays exact outside it
// and the contour has a clean width. The blade is bent onto a paraboloid that wraps the body side: it
// bulges over the belly and curves in at the top, bottom and edges, so the root sinks into the shoulder.
vec2 wing(vec3 w) {
    vec2 b = w.zy - WING_BULGE;
    vec3 c = vec3(w.x - 0.14 + 1.0 * b.x * b.x + 0.55 * b.y * b.y, w.y, w.z);
    vec2 o = c.zy;
    float body = sdEllipse2(o - vec2(0.0, -0.36), vec2(0.33, 0.50));
    // Pointed flight feathers hang down past the rump, longest in the middle.
    float feathers = sdBlade(o, vec2(0.16, -0.52), vec2(0.10, -0.94), 0.13, 0.02);
    feathers = min(feathers, sdBlade(o, vec2(0.02, -0.54), vec2(-0.03, -0.99), 0.14, 0.02));
    feathers = min(feathers, sdBlade(o, vec2(-0.12, -0.52), vec2(-0.18, -1.02), 0.13, 0.02));
    feathers = min(feathers, sdBlade(o, vec2(-0.18, -0.46), vec2(-0.24, -0.86), 0.11, 0.02));
    float d2 = smin(body, feathers, 0.05);
    // Domed over the main blade, thin at the rim and along the feathers. The dome follows the ellipse
    // only, so the feather joins don't put bumps in the shading.
    float halfT = 0.012 + 0.085 * smoothstep(0.0, 0.26, -body);
    vec2 e = vec2(d2, abs(c.x - 0.05) - halfT);
    float d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
    // Undo the stretch of the bend so the step stays safe.
    d /= length(vec3(1.0, 1.1 * b.y, 2.0 * b.x));
    // Black flight feathers below a jagged line.
    float zig = abs(fract(c.z * 3.6 + 0.25) - 0.5) * 0.36;
    float id = c.y < -0.54 + zig + 0.2 * c.z ? MAT_BLACK : MAT_WING;
    // Pink bare skin on the underside, a disc round the root. The body cuts it to a half disc against the body.
    if (c.x < 0.05 && length(o - WING_PINK_C) < WING_PINK_R) id = MAT_MOUTH;
    return vec2(d, id);
}

vec2 wingL(vec3 p) { return wing(gWingInvL * (p - gShoulderL)); }

vec2 wingR(vec3 p) {
    vec3 wr = gWingInvR * (p - gShoulderR);
    return wing(vec3(-wr.x, wr.yz));
}

// Width scale of the line between wing and body at p: none at the back of the root, where the wing grows
// out of the back, and full at the front edge and lower down, where the wing edge lies over the body.
// The line gets thinner, not paler.
float wingSeam(vec3 p) {
    vec3 wl = gWingInvL * (p - gShoulderL), wr = gWingInvR * (p - gShoulderR);
    vec3 w = dot(p - gShoulderL, p - gShoulderL) < dot(p - gShoulderR, p - gShoulderR) ? wl : wr;
    return 1.0 - smoothstep(-0.62, -0.42, w.y) * smoothstep(0.05, -0.10, w.z);
}

// Fluffy white thigh that flows out of the belly.
float thigh(vec3 p, vec3 hip, vec3 knee, float bodyD) {
    float d = sdEllipsoid(p - (hip + (knee - hip) * 0.42), vec3(0.17, 0.20, 0.18));
    return smin(d, bodyD, 0.14);
}

// Bare shank and toes, below the thigh.
float lowerLeg(vec3 p, vec3 hip, vec3 knee, vec3 foot, float side) {
    vec3 hk = knee - hip;
    float shank = sdRoundConeAB(p, hip + hk * 0.5, knee, 0.075, 0.066);
    shank = smin(shank, sdRoundConeAB(p, knee, foot, 0.066, 0.056), 0.03);
    // Toes: three forward, one back. Each arches from the ankle and tapers to a point on the ground.
    // Toes curl down while the foot is lifted.
    float curl = clamp((foot.y - 0.06) * 3.0, 0.0, 0.5);
    float toes = length(p - foot) - 0.07;
    for (int i = 0; i < 3; i++) {
        float a = (float(i) - 1.0) * 0.62 + side * 0.14;
        float len = i == 1 ? 0.42 : 0.34;
        vec3 dir = vec3(sin(a), 0.0, cos(a));
        vec3 mid = foot + dir * len * 0.5 + vec3(0.0, -0.008 - curl * 0.08, 0.0);
        vec3 tip = foot + dir * len + vec3(0.0, -0.028 - curl * 0.18, 0.0);
        float toe = min(sdRoundConeAB(p, foot, mid, 0.058, 0.046), sdRoundConeAB(p, mid, tip, 0.046, 0.018));
        toes = smin(toes, toe, 0.04);
    }
    vec3 back = foot + vec3(-side * 0.04, -0.026 - curl * 0.06, -0.20);
    toes = smin(toes, sdRoundConeAB(p, foot, back, 0.052, 0.02), 0.035);
    return smin(shank, toes, 0.04);
}

vec2 leg(vec3 p, vec3 hip, vec3 knee, vec3 foot, float side, float bodyD) {
    vec2 res = vec2(1e9, MAT_LEG);
    addPart(res, thigh(p, hip, knee, bodyD), MAT_WHITE);
    addPart(res, lowerLeg(p, hip, knee, foot, side), MAT_LEG);
    return res;
}

// Head parts in the head frame, +z toward the beak.
vec3 headSpace(vec3 p) { return gHeadInv * (p - gHead) / HEAD_SCALE; }

// Skull and upper bill. The skull narrows into a thick beak base with no seam, so the upper bill
// shares the head material.
float skullBill(vec3 h, float neckD) {
    // Narrow skull that runs back to a point. Flat crown and bevelled sides give it hard planes.
    float skull = sdEllipsoid(h - vec3(0.0, 0.02, -0.03), vec3(0.14, 0.20, 0.22));
    skull = smin(skull, sdEllipsoid(h - vec3(0.0, 0.05, -0.16), vec3(0.10, 0.16, 0.17)), 0.06);
    float planes = max(h.y - 0.20 + 0.10 * h.z, dot(vec2(abs(h.x), h.y), vec2(0.91, 0.41)) - 0.16);
    skull = -smin(-skull, -planes, 0.03);
    // Jagged tuft: three short spikes that point back and down from the back of the head.
    vec3 th = vec3(h.x * 1.6, h.y, h.z);
    float tuft = sdRoundConeAB(th, vec3(0.0, 0.0, -0.20), vec3(0.0, -0.06, -0.36), 0.07, 0.006);
    tuft = min(tuft, sdRoundConeAB(th, vec3(0.0, -0.07, -0.18), vec3(0.0, -0.15, -0.32), 0.06, 0.006));
    tuft = min(tuft, sdRoundConeAB(th, vec3(0.0, -0.12, -0.13), vec3(0.0, -0.22, -0.24), 0.05, 0.006));
    skull = smin(skull, tuft / 1.6, 0.025);
    // Cheeks taper forward into the bill.
    skull = smin(skull, sdEllipsoid(h - vec3(0.0, -0.03, 0.13), vec3(0.11, 0.13, 0.17)), 0.08);
    skull = smin(skull, neckD, 0.10);

    // Upper bill: narrow from side to side, deep at the base, and blended into the forehead.
    vec3 A = vec3(0.0, -0.01, 0.10), B = vec3(0.0, 0.0, 0.58), C = vec3(0.0, -0.42, 0.86);
    vec3 nb = vec3(h.x * 1.35, h.y, h.z);
    float bill = taperTube(nb, A, B, C, 0.10, 0.014, 1.0).x / 1.35;
    return smin(skull, bill, 0.10);
}

// Lower jaw hinged under the bill. Its top is the pink mouth.
vec2 jaw(vec3 h) {
    vec3 A = vec3(0.0, -0.01, 0.10), B = vec3(0.0, 0.0, 0.58), C = vec3(0.0, -0.42, 0.86);
    vec3 hinge = vec3(0.0, -0.07, 0.10);
    vec3 j = rotX(-gJaw) * (h - hinge) + hinge;
    vec3 down = vec3(0.0, -0.035, 0.0);
    vec2 jw = taperTube(vec3(j.x * 1.35, j.yz), A + down + vec3(0.0, 0.0, 0.06), B + down, C + down, 0.075, 0.013, 0.96);
    return vec2(jw.x / 1.35, jw.y > 0.012 ? MAT_MOUTH : MAT_BEAK);
}

// Eyes, mirrored. Flattened so the eye reads as a big disc without bulging past the head.
const vec3 EYE_R = vec3(0.07, 0.12, 0.12);
vec3 eyeSpace(vec3 h) { return vec3(abs(h.x), h.y, h.z) - vec3(0.095, 0.04, 0.0); }

// Big pupils look forward along the bill.
vec2 eye(vec3 h) {
    vec3 e = eyeSpace(h);
    vec3 lookDir = normalize(vec3(0.55 + gLook.x * sign(h.x) * 0.4, 0.12 + gLook.y * 0.4, 0.83));
    return vec2(sdEllipsoid(e, EYE_R), dot(normalize(e / EYE_R), lookDir) > 1.0 - 0.14 * gExpr.w * gExpr.w ? MAT_PUPIL : MAT_EYE);
}

// Lid: positive where it covers the eye. The top lid closes with gExpr.x and the blink, and tilts down
// toward the bill when angry. The lower lid rises with gExpr.z. Same as lidCut() in materials.js.
float lidCover(vec3 e) {
    float top = mix(mix(0.115, -0.13, gExpr.x), -0.13, gBlink) - 0.6 * gExpr.y * e.z;
    float cover = e.y - top;
    if (gExpr.z > 0.0) cover = max(cover, mix(-0.2, 0.1, gExpr.z) - e.y);
    return cover;
}

// Lid closes from the top; at blink 1 a dark crease draws a happy arc.
vec2 lid(vec3 h) {
    vec3 e = eyeSpace(h);
    float crease = abs(e.y - (0.01 - 5.0 * e.z * e.z)) - 0.012;
    return vec2(max(sdEllipsoid(e, EYE_R + 0.006), -lidCover(e)), gBlink > 0.9 && crease < 0.0 && e.x > 0.04 ? MAT_PUPIL : MAT_BLACK);
}

vec2 head(vec3 h, float neckD) {
    vec2 res = vec2(skullBill(h, neckD), MAT_BLACK);
    vec2 j = jaw(h);
    addPart(res, j.x, j.y);
    vec2 e = eye(h);
    addPart(res, e.x, e.y);
    vec2 l = lid(h);
    addPart(res, l.x, l.y);
    return res;
}

// Neck tapers from the shoulders to the nape.
float neck(vec3 p) { return taperTube(p, gNeckBase, gNeckCtrl, gNeckTip, 0.13, 0.095, 1.0).x; }

// Body space.
vec3 bodySpace(vec3 p) { return gBodyInv * (p - gPelvis); }

// Body: pear shape, deep at the belly, with the chest pushed up and forward and the rump sloping to the tail.
float body(vec3 q) {
    float d = sdEllipsoid(q - vec3(0.0, 0.20, -0.06), vec3(0.37, 0.43, 0.44));
    d = smin(d, sdEllipsoid(q - vec3(0.0, 0.56, 0.12), vec3(0.23, 0.30, 0.27)), 0.22);
    return smin(d, sdEllipsoid(q - vec3(0.0, 0.30, -0.32), vec3(0.22, 0.26, 0.26)), 0.16);
}

// Tail: a triangle fan that hangs down under the folded wings and shows below their tips, built
// like the wing. One wide long feather in the middle and a shorter one on each side.
float tail(vec3 q) {
    const vec3 TAIL_O = vec3(0.0, 0.02, -0.40);
    const vec3 TAIL_U = vec3(0.0, -0.920, -0.392);   // along the tail
    const vec3 TAIL_N = vec3(0.0, 0.392, -0.920);    // fan normal
    vec3 tq = q - TAIL_O;
    vec2 to = vec2(abs(q.x), dot(tq, TAIL_U));
    float fan = sdBlade(to, vec2(0.0, 0.0), vec2(0.0, 0.48), 0.18, 0.075);
    fan = min(fan, sdBlade(to, vec2(0.06, 0.0), vec2(0.13, 0.40), 0.13, 0.045));
    vec2 te = vec2(fan, abs(dot(tq, TAIL_N)) - (0.02 + 0.05 * smoothstep(0.0, 0.1, -fan)));
    return length(max(te, 0.0)) + min(max(te.x, te.y), 0.0);
}

// Footy scarf: two chunky turns round the neck and two flat ends down the chest. Maroon, with a
// gold band at each end. It sits low on the neck to stay clear of the head.

// The two turns, in body space. The ring tips up at the back, so it clears the shoulders and wraps the
// whole neck.
float scarfWrap(vec3 q) {
    vec3 cq = rotX(-0.35) * (q - NECK_BASE - vec3(0.0, 0.13, -0.02));
    vec3 sq = cq + vec3(0.0, 0.05, 0.0);
    return smin(sdTorus(sq + vec3(0.0, 0.035, 0.0), vec2(0.155, 0.068)),
                sdTorus(sq - vec3(0.0, 0.06, 0.0), vec2(0.14, 0.06)), 0.03);
}

// Outline of end i on the chest, in body space: negative inside the strip. Each end is tilted out a
// little, with its top tucked under the wrap. Corners slightly round, so a mesh of it stays clean.
float scarfStrip(vec3 q, int i) {
    float side = i == 0 ? -1.0 : 1.0;
    float u = q.x - side * 0.085 - side * 0.14 * (0.8 - q.y);
    float yEnd = i == 0 ? 0.18 : 0.32;
    const float R = 0.012;
    vec2 d = abs(vec2(u, q.y - 0.5 * (0.82 + yEnd))) - vec2(0.085, 0.5 * (0.82 - yEnd)) + R;
    return length(max(d, 0.0)) + min(max(d.x, d.y), 0.0) - R;
}

// The scarf before the head pushes it aside. Returns the scarf and puts its solid stand-in in solid.
// The baked mesh uses this: the head moves apart from the scarf, so a carve baked in one pose would be
// wrong in the others.
vec2 scarfUncarved(vec3 q, float bodyD, out float solid) {
    float wrap = scarfWrap(q);
    // Each end is a strip on a shell over the chest.
    float ends = 1e9, endsSolid = 1e9, trim = 1e9;
    for (int i = 0; i < 2; i++) {
        float strip = scarfStrip(q, i);
        float end = max(max(abs(bodyD - 0.032) - 0.022, strip), -q.z);
        if (end < ends && q.y < (i == 0 ? 0.18 : 0.32) + 0.18) trim = end;
        ends = min(ends, end);
        endsSolid = min(endsSolid, max(max(bodyD - 0.054, strip), -q.z));
    }
    // The ends blend into the wrap where they come out from under it, so no thin sliver shows.
    solid = smin(wrap, endsSolid, 0.02);
    return vec2(smin(wrap, ends, 0.02), wrap < ends ? MAT_MAROON : trim == ends ? MAT_GOLD : MAT_MAROON);
}

// Returns the scarf and puts its solid stand-in in solid.
vec2 scarf(vec3 p, vec3 q, float bodyD, out float solid) {
    vec2 res = scarfUncarved(q, bodyD, solid);
    // The head pushes the scarf aside instead of cutting into it. A skull-sized ellipsoid, without the
    // neck, is carved out with a small gap.
    vec3 hq = headSpace(p);
    float skull = sdEllipsoid(hq - vec3(0.0, 0.0, 0.02), vec3(0.19, 0.21, 0.24)) * HEAD_SCALE;
    float carve = 0.012 - skull;
    res.x = max(res.x, carve);
    solid = max(solid, carve);
    return res;
}

// The sphere moves with the pelvis on the ground and rises with it only past a small bob, so the
// sphere (and the contour) is the same as at rest in the ground clips.
vec3 boundCentre() { return BOUND_C + vec3(gPelvis.x, max(gPelvis.y - 0.68, 0.0), gPelvis.z); }

// Character only, no ground. The primary ray reads this to find the contour.
vec2 mapChar(vec3 p) {
    float bound = length(p - boundCentre()) - BOUND_R;
    gSolid = vec2(bound, MAT_GROUND);
    if (bound > 0.1) return gSolid;
    vec2 res = vec2(1e9, MAT_GROUND);

    vec3 q = bodySpace(p);
    float bodyD = body(q);
    addPart(res, bodyD, MAT_WHITE);
    addPart(res, tail(q), MAT_TAIL);

    // Each limb is only evaluated when a cheap bound around it is nearer than the closest part so far.
    // Wings: every feather is within 1.12 of the shoulder.
    if (length(p - gShoulderL) - 1.12 < res.x) {
        vec2 w = wingL(p);
        if (w.x < res.x) res = w;
    }
    if (length(p - gShoulderR) - 1.12 < res.x) {
        vec2 w = wingR(p);
        if (w.x < res.x) res = w;
    }

    // Legs: thigh, bent knee and toes are within 0.5 of the hip-to-foot line.
    if (segDist(p, gHipL, gFootL) - 0.5 < res.x) {
        vec2 legL = leg(p, gHipL, gKneeL, gFootL, 1.0, bodyD);
        if (legL.x < res.x) res = legL;
    }
    if (segDist(p, gHipR, gFootR) - 0.5 < res.x) {
        vec2 legR = leg(p, gHipR, gKneeR, gFootR, -1.0, bodyD);
        if (legR.x < res.x) res = legR;
    }

    // Bound: the bill reach around the head, and the neck chord widened by half the control point
    // offset (the most a quadratic Bezier bows out).
    float bow = 0.5 * segDist(gNeckCtrl, gNeckBase, gNeckTip);
    float headBound = min(length(p - gHead) - 1.18 * HEAD_SCALE, segDist(p, gNeckBase, gNeckTip) - bow - 0.14);
    if (headBound < res.x) {
        vec2 hd = head(headSpace(p), neck(p) / HEAD_SCALE);
        hd.x *= HEAD_SCALE;
        if (hd.x < res.x) res = hd;
    }

    // The scarf sits within 0.2 of the body. Far away, the body gives a safe step.
    if (bodyD > 0.3) {
        res.x = min(res.x, bodyD - 0.2);
        gSolid = res;
        return res;
    }

    vec2 solid = res;
    float scarfSolid;
    vec2 s = scarf(p, q, bodyD, scarfSolid);
    addPart(res, s.x, s.y);
    addPart(solid, scarfSolid, MAT_MAROON);
    gSolid = solid;
    return res;
}

vec2 map(vec3 p) {
    vec2 res = mapChar(p);
    return p.y < res.x ? vec2(p.y, MAT_GROUND) : res;
}

// Toon colours: lit band, shadow band and line, in sRGB.
void paletteSrgb(float id, out vec3 lit, out vec3 shade, out vec3 line) {
    lit = vec3(0.925, 0.902, 0.855); shade = vec3(0.80, 0.78, 0.86); line = vec3(0.55, 0.53, 0.66);
    if (id == MAT_WHITE || id == MAT_WING) { lit = vec3(0.95, 0.93, 0.89); shade = vec3(0.76, 0.75, 0.83); line = vec3(0.30, 0.30, 0.42); }
    else if (id == MAT_BLACK || id == MAT_TAIL) { lit = vec3(0.25, 0.27, 0.36); shade = vec3(0.15, 0.16, 0.24); line = vec3(0.07, 0.07, 0.12); }
    else if (id == MAT_BEAK) { lit = vec3(0.24, 0.26, 0.35); shade = vec3(0.14, 0.15, 0.23); line = vec3(0.06, 0.06, 0.10); }
    else if (id == MAT_EYE) { lit = vec3(0.96, 0.77, 0.30); shade = vec3(0.85, 0.58, 0.24); line = vec3(0.10, 0.09, 0.12); }
    else if (id == MAT_PUPIL) { lit = vec3(0.09, 0.09, 0.13); shade = vec3(0.07, 0.07, 0.11); line = vec3(0.05, 0.05, 0.08); }
    else if (id == MAT_GOLD) { lit = vec3(0.99, 0.78, 0.20); shade = vec3(0.86, 0.57, 0.27); line = vec3(0.45, 0.25, 0.12); }
    else if (id == MAT_MAROON) { lit = vec3(0.52, 0.13, 0.24); shade = vec3(0.35, 0.08, 0.19); line = vec3(0.18, 0.03, 0.09); }
    else if (id == MAT_LEG) { lit = vec3(0.23, 0.24, 0.31); shade = vec3(0.13, 0.14, 0.20); line = vec3(0.06, 0.06, 0.10); }
    else if (id == MAT_MOUTH) { lit = vec3(0.91, 0.55, 0.56); shade = vec3(0.72, 0.38, 0.45); line = vec3(0.42, 0.18, 0.24); }
}

void palette(float id, out vec3 lit, out vec3 shade, out vec3 line) {
    paletteSrgb(id, lit, shade, line);
    lit = srgbToLinear(lit); shade = srgbToLinear(shade); line = srgbToLinear(line);
}
