// Australian noisy miner: the SDF model. It has the part functions of the ibis model.glsl, so the raymarch
// view, the bake and the game shaders work on it. tools/bake.mjs turns it into public/miner.glb.
// The bones come from src/ibis/rig.js with the miner shape (src/miner/bird.js) as the g* uniforms.
// Needs library.glsl and eye.glsl first.
// A plump body that leans forward, a round dark hood, a short yellow bill, a long tail. Made at about the
// size of the ibis: MINER_SCALE in bird.js shrinks it in the game.

const vec2  WING_BULGE = vec2(0.05, -0.40);   // wing-local (z, y) of the point that sits furthest out
const float HEAD_SCALE = 1.18;
const float BODY_TILT = 0.55;                  // the long axis of the torso leans forward this much in body space
const vec3  BOUND_C = vec3(0.0, 0.85, 0.2);   // sphere that holds the character in every pose, at rest
const float BOUND_R = 1.9;

// Material ids. The same numbers as src/miner/materialIds.js.
const float MAT_GROUND = 1.0;
const float MAT_WHITE = 2.0;    // pale grey body
const float MAT_BLACK = 3.0;    // dark hood and flight feathers
const float MAT_BEAK = 4.0;     // yellow bill
const float MAT_EYE = 5.0;      // yellow eye
const float MAT_PUPIL = 6.0;
const float MAT_TIP = 7.0;      // cream tail tip
const float MAT_LEG = 11.0;     // yellow legs and toes
const float MAT_MOUTH = 12.0;   // inside of the mouth
const float MAT_WING = 13.0;    // grey wing coverts, a separate id so a line splits wing from body
const float MAT_TAIL = 15.0;    // dark tail
const float MAT_THIGH = MAT_WHITE;   // materials of the thighs and the neck, for the bake
const float MAT_NECK = MAT_BLACK;

// ---- rig, set by src/ibis/rig.js ----
uniform vec3 gPelvis, gNeckBase, gNeckCtrl, gNeckTip, gHead, gShoulderL, gShoulderR;
uniform vec3 gHipL, gHipR, gKneeL, gKneeR, gFootL, gFootR;
uniform mat3 gBodyInv, gHeadInv, gWingInvL, gWingInvR;
uniform float gJaw, gBlink;
uniform vec2 gLook;
uniform vec4 gExpr;   // top lid (less than 0 wide open), lid tilt (more than 0 angry), lower lid, pupil size
vec2 gSolid;          // mapChar() result, for the contour pass of raymarch.glsl

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

// 2D ellipse, same approximation as sdEllipsoid.
float sdEllipse2(vec2 p, vec2 r) {
    float k0 = length(p / r), k1 = length(p / (r * r));
    return k0 * (k0 - 1.0) / k1;
}

// 2D blade that tapers from radius ra at a to rb at b.
float sdBlade(vec2 p, vec2 a, vec2 b, float ra, float rb) {
    return sdRoundConeAB(vec3(p, 0.0), vec3(a, 0.0), vec3(b, 0.0), ra, rb);
}

// Wing in its local frame: x outward (thin), -y along the wing, z toward the head.
// Grey coverts over the shoulder, then dark flight feathers that end in blunt fingers, longest at the
// front. The blade is bent onto a paraboloid, so folded it hugs the body and spread it droops at the tip.
vec2 wing(vec3 w) {
    vec2 b = w.zy - WING_BULGE;
    const float KX = 1.40, KY = 0.30;
    vec3 c = vec3(w.x - 0.08 + KX * b.x * b.x + KY * b.y * b.y, w.y, w.z);
    vec2 o = c.zy;
    float coverts = sdEllipse2(o - vec2(0.0, -0.30), vec2(0.32, 0.42));
    float feathers = sdBlade(o, vec2( 0.12, -0.40), vec2( 0.16, -1.02), 0.10, 0.05);
    feathers = min(feathers, sdBlade(o, vec2( 0.04, -0.42), vec2( 0.05, -1.08), 0.10, 0.05));
    feathers = min(feathers, sdBlade(o, vec2(-0.05, -0.42), vec2(-0.07, -1.06), 0.10, 0.05));
    feathers = min(feathers, sdBlade(o, vec2(-0.14, -0.40), vec2(-0.19, -0.96), 0.09, 0.045));
    feathers = min(feathers, sdBlade(o, vec2(-0.20, -0.36), vec2(-0.27, -0.82), 0.08, 0.04));
    float d2 = smin(coverts, feathers, 0.05);
    // Domed over the coverts, thin along the feathers.
    float halfT = 0.014 + 0.070 * smoothstep(0.0, 0.24, -coverts);
    vec2 e = vec2(d2, abs(c.x - 0.05) - halfT);
    float d = length(max(e, 0.0)) + min(max(e.x, e.y), 0.0);
    d /= length(vec3(1.0, 2.0 * KY * b.y, 2.0 * KX * b.x));
    // Dark flight feathers below a line that rises toward the front, grey coverts above.
    float id = c.y < -0.50 + 0.30 * c.z ? MAT_BLACK : MAT_WING;
    return vec2(d, id);
}

vec2 wingL(vec3 p) { return wing(gWingInvL * (p - gShoulderL)); }

vec2 wingR(vec3 p) {
    vec3 wr = gWingInvR * (p - gShoulderR);
    return wing(vec3(-wr.x, wr.yz));
}

// Width scale of the line between wing and body at p: none at the back of the root, where the wing grows
// out of the back, and full at the front edge and lower down.
float wingSeam(vec3 p) {
    vec3 wl = gWingInvL * (p - gShoulderL), wr = gWingInvR * (p - gShoulderR);
    vec3 w = dot(p - gShoulderL, p - gShoulderL) < dot(p - gShoulderR, p - gShoulderR) ? wl : wr;
    return 1.0 - smoothstep(-0.55, -0.35, w.y) * smoothstep(0.05, -0.10, w.z);
}

// Feathered thigh that flows out of the belly.
float thighOnly(vec3 p, vec3 hip, vec3 knee) {
    return sdEllipsoid(p - (hip + (knee - hip) * 0.40), vec3(0.12, 0.15, 0.14));
}
float thigh(vec3 p, vec3 hip, vec3 knee, float bodyD) { return smin(thighOnly(p, hip, knee), bodyD, 0.14); }

// Bare yellow shank and slim toes, below the thigh. Toe lengths match SHAPE.toes in bird.js.
float lowerLeg(vec3 p, vec3 hip, vec3 knee, vec3 foot, float side) {
    vec3 hk = knee - hip;
    float shank = sdRoundConeAB(p, hip + hk * 0.5, knee, 0.052, 0.044);
    shank = smin(shank, sdRoundConeAB(p, knee, foot, 0.044, 0.038), 0.025);
    // Toes: three forward, one back. Toes curl down while the foot is lifted.
    float curl = clamp((foot.y - 0.06) * 3.0, 0.0, 0.5);
    float toes = length(p - foot) - 0.048;
    for (int i = 0; i < 3; i++) {
        float a = (float(i) - 1.0) * 0.62 + side * 0.14;
        float len = i == 1 ? 0.30 : 0.24;
        vec3 dir = vec3(sin(a), 0.0, cos(a));
        vec3 mid = foot + dir * len * 0.5 + vec3(0.0, -0.008 - curl * 0.08, 0.0);
        vec3 tip = foot + dir * len + vec3(0.0, -0.028 - curl * 0.18, 0.0);
        float toe = min(sdRoundConeAB(p, foot, mid, 0.042, 0.034), sdRoundConeAB(p, mid, tip, 0.034, 0.016));
        toes = smin(toes, toe, 0.03);
    }
    vec3 back = foot + vec3(-side * 0.028, -0.026 - curl * 0.06, -0.14);
    toes = smin(toes, sdRoundConeAB(p, foot, back, 0.038, 0.018), 0.025);
    return smin(shank, toes, 0.03);
}

vec2 leg(vec3 p, vec3 hip, vec3 knee, vec3 foot, float side, float bodyD) {
    vec2 res = vec2(1e9, MAT_LEG);
    addPart(res, thigh(p, hip, knee, bodyD), MAT_THIGH);
    addPart(res, lowerLeg(p, hip, knee, foot, side), MAT_LEG);
    return res;
}

// Head parts in the head frame, +z toward the bill.
vec3 headSpace(vec3 p) { return gHeadInv * (p - gHead) / HEAD_SCALE; }

// The bill: a short wedge, deep at the base and narrow side to side, with a top edge that curves down to
// a sharp point. The jaw (jaw()) is its lower half.
const vec3 BILL_A = vec3(0.0, -0.005, 0.11), BILL_B = vec3(0.0, 0.010, 0.30), BILL_C = vec3(0.0, -0.055, 0.42);
const float BILL_W = 1.45;   // the bill is this much narrower than deep
float bill(vec3 h) { return taperTube(vec3(h.x * BILL_W, h.yz), BILL_A, BILL_B, BILL_C, 0.068, 0.006, 1.0).x / BILL_W; }

// Round skull, a little long, with full cheeks that run forward into the bill.
float skull(vec3 h) {
    float d = sdEllipsoid(h - vec3(0.0, 0.03, -0.02), vec3(0.19, 0.20, 0.22));
    return smin(d, sdEllipsoid(h - vec3(0.0, -0.03, 0.08), vec3(0.14, 0.13, 0.14)), 0.08);
}

// Skull and upper bill. neckD: the neck, which blends into the back of the skull.
float skullBill(vec3 h, float neckD) {
    float d = smin(skull(h), neckD, 0.09);
    return smin(d, bill(h), 0.035);
}

// Yellow where the bill is nearer than the skull, so the colour line follows the crease at the bill base.
float skullMat(vec3 h) { return bill(h) < skull(h) ? MAT_BEAK : MAT_BLACK; }

// Lower bill hinged under the upper one. Its top is the inside of the mouth.
vec2 jaw(vec3 h) {
    vec3 hinge = vec3(0.0, -0.05, 0.12);
    vec3 j = rotX(-gJaw) * (h - hinge) + hinge;
    vec3 A = BILL_A + vec3(0.0, -0.030, 0.0), B = BILL_B + vec3(0.0, -0.040, -0.01), C = BILL_C + vec3(0.0, -0.005, -0.03);
    vec2 jw = taperTube(vec3(j.x * BILL_W, j.yz), A, B, C, 0.050, 0.006, 1.0);
    return vec2(jw.x / BILL_W, jw.y > 0.012 ? MAT_MOUTH : MAT_BEAK);
}

// Eyes, mirrored. The shapes are in eye.glsl.
vec3 eyeSpace(vec3 h) { return vec3(abs(h.x), h.y, h.z) - EYE_C; }

vec2 eye(vec3 h) {
    vec3 e = eyeSpace(h);
    return vec2(sdEllipsoid(e, EYE_R), pupilIn(e, sign(h.x), gLook, gExpr) > 0.0 ? MAT_PUPIL : MAT_EYE);
}

// Lid closes from the top; at blink 1 a dark crease draws a happy arc.
vec2 lid(vec3 h) {
    vec3 e = eyeSpace(h);
    return vec2(max(sdEllipsoid(e, EYE_R + 0.006), -lidCover(e, gExpr, gBlink)), gBlink > 0.9 && lidCrease(e) < 0.0 && e.x > 0.04 ? MAT_PUPIL : MAT_BLACK);
}

vec2 head(vec3 h, float neckD) {
    vec2 res = vec2(skullBill(h, neckD), skullMat(h));
    vec2 j = jaw(h);
    addPart(res, j.x, j.y);
    vec2 e = eye(h);
    addPart(res, e.x, e.y);
    vec2 l = lid(h);
    addPart(res, l.x, l.y);
    return res;
}

// Neck: short and thick, dark like the hood.
float neck(vec3 p) { return taperTube(p, gNeckBase, gNeckCtrl, gNeckTip, 0.13, 0.11, 1.0).x; }

// Body space.
vec3 bodySpace(vec3 p) { return gBodyInv * (p - gPelvis); }

// Torso space: the long axis of the torso is y, leaning forward by BODY_TILT.
vec3 torsoSpace(vec3 q) { return rotX(-BODY_TILT) * (q - vec3(0.0, 0.30, 0.0)); }

// Body: a plump egg, full in the chest, that tapers to the rump.
float body(vec3 q) {
    float d = sdEllipsoid(torsoSpace(q), vec3(0.34, 0.52, 0.38));
    d = smin(d, sdEllipsoid(q - vec3(0.0, 0.52, 0.14), vec3(0.24, 0.24, 0.25)), 0.16);
    return smin(d, sdEllipsoid(q - vec3(0.0, -0.06, -0.26), vec3(0.15, 0.20, 0.20)), 0.12);
}

// Pale breast and belly, grey back. The back has the wing id: no line where the folded wings lie on it.
float bodyMat(vec3 q) { return torsoSpace(q).z < -0.06 ? MAT_WING : MAT_WHITE; }

// Tail: a long, narrow, two-lobed fan that carries on from the line of the back. Dark, with a cream tip.
const vec3 TAIL_O = vec3(0.0, -0.02, -0.30);
const vec3 TAIL_U = vec3(0.0, -0.800, -0.600);   // along the tail
const vec3 TAIL_N = vec3(0.0, 0.600, -0.800);    // fan normal
float tail(vec3 q) {
    vec3 tq = q - TAIL_O;
    vec2 to = vec2(abs(q.x), dot(tq, TAIL_U));
    float fan = sdBlade(to, vec2(0.03, 0.0), vec2(0.08, 0.86), 0.10, 0.08);
    fan = min(fan, sdBlade(to, vec2(0.08, 0.0), vec2(0.16, 0.76), 0.09, 0.07));
    vec2 te = vec2(fan, abs(dot(tq, TAIL_N)) - (0.020 + 0.040 * smoothstep(0.0, 0.08, -fan)));
    return length(max(te, 0.0)) + min(max(te.x, te.y), 0.0);
}
float tailMat(vec3 q) { return dot(q - TAIL_O, TAIL_U) > 0.68 ? MAT_TIP : MAT_TAIL; }

// The sphere moves with the pelvis on the ground and rises with it only past a small bob.
vec3 boundCentre() { return BOUND_C + vec3(gPelvis.x, max(gPelvis.y - 0.55, 0.0), gPelvis.z); }

// Character only, no ground. The primary ray reads this to find the contour.
vec2 mapChar(vec3 p) {
    float bound = length(p - boundCentre()) - BOUND_R;
    gSolid = vec2(bound, MAT_GROUND);
    if (bound > 0.1) return gSolid;
    vec2 res = vec2(1e9, MAT_GROUND);

    vec3 q = bodySpace(p);
    float bodyD = body(q);
    addPart(res, bodyD, bodyMat(q));
    addPart(res, tail(q), tailMat(q));

    // Each limb is only evaluated when a cheap bound around it is nearer than the closest part so far.
    // Wings: every feather is within 1.25 of the shoulder.
    if (length(p - gShoulderL) - 1.25 < res.x) {
        vec2 w = wingL(p);
        if (w.x < res.x) res = w;
    }
    if (length(p - gShoulderR) - 1.25 < res.x) {
        vec2 w = wingR(p);
        if (w.x < res.x) res = w;
    }

    // Legs: thigh, bent knee and toes are within 0.45 of the hip-to-foot line.
    if (segDist(p, gHipL, gFootL) - 0.45 < res.x) {
        vec2 legL = leg(p, gHipL, gKneeL, gFootL, 1.0, bodyD);
        if (legL.x < res.x) res = legL;
    }
    if (segDist(p, gHipR, gFootR) - 0.45 < res.x) {
        vec2 legR = leg(p, gHipR, gKneeR, gFootR, -1.0, bodyD);
        if (legR.x < res.x) res = legR;
    }

    // Bound: the bill reach around the head, and the neck chord widened by half the control point offset.
    float bow = 0.5 * segDist(gNeckCtrl, gNeckBase, gNeckTip);
    float headBound = min(length(p - gHead) - 0.75 * HEAD_SCALE, segDist(p, gNeckBase, gNeckTip) - bow - 0.20);
    if (headBound < res.x) {
        vec2 hd = head(headSpace(p), neck(p) / HEAD_SCALE);
        hd.x *= HEAD_SCALE;
        if (hd.x < res.x) res = hd;
    }

    gSolid = res;
    return res;
}

vec2 map(vec3 p) {
    vec2 res = mapChar(p);
    return p.y < res.x ? vec2(p.y, MAT_GROUND) : res;
}

// Toon colours: lit band, shadow band and line, in sRGB. Flat, soft, a little lilac in the shadows, as the
// ibis.
void paletteSrgb(float id, out vec3 lit, out vec3 shade, out vec3 line) {
    lit = vec3(0.925, 0.902, 0.855); shade = vec3(0.80, 0.78, 0.86); line = vec3(0.55, 0.53, 0.66);
    if (id == MAT_WHITE)      { lit = vec3(0.90, 0.87, 0.86); shade = vec3(0.74, 0.71, 0.81); line = vec3(0.32, 0.30, 0.42); }
    else if (id == MAT_WING)  { lit = vec3(0.76, 0.75, 0.80); shade = vec3(0.60, 0.59, 0.71); line = vec3(0.27, 0.26, 0.38); }
    else if (id == MAT_BLACK || id == MAT_TAIL) { lit = vec3(0.29, 0.30, 0.40); shade = vec3(0.19, 0.20, 0.29); line = vec3(0.08, 0.08, 0.14); }
    else if (id == MAT_TIP)   { lit = vec3(0.93, 0.90, 0.87); shade = vec3(0.76, 0.73, 0.82); line = vec3(0.32, 0.30, 0.42); }
    else if (id == MAT_BEAK)  { lit = vec3(1.00, 0.80, 0.20); shade = vec3(0.93, 0.60, 0.17); line = vec3(0.50, 0.28, 0.08); }
    else if (id == MAT_LEG)   { lit = vec3(0.99, 0.72, 0.20); shade = vec3(0.90, 0.52, 0.16); line = vec3(0.48, 0.24, 0.07); }
    else if (id == MAT_MOUTH) { lit = vec3(0.96, 0.58, 0.20); shade = vec3(0.84, 0.42, 0.17); line = vec3(0.46, 0.21, 0.06); }
    else if (id == MAT_EYE)   { lit = vec3(0.99, 0.90, 0.30); shade = vec3(0.93, 0.76, 0.20); line = vec3(0.12, 0.10, 0.14); }
    else if (id == MAT_PUPIL) { lit = vec3(0.07, 0.07, 0.12); shade = vec3(0.05, 0.05, 0.10); line = vec3(0.04, 0.04, 0.08); }
}
