// Raymarch reference view of a bird, for sdf.html. Needs library.glsl and model.glsl first, and CAM_DIST and
// CAM_TARGET (the close camera of the bird, from viewer.js).

#define DEBUG_MODE 0   // 0 final | 1 distance slice | 2 normals | 3 material ids | 4 steps | 5 masks (band, outline, shadow) | 6 N.L
#define OUTLINE 1      // 1 = thin inner lines from 4 extra edge rays per pixel, plus a thick contour from the primary ray
#define AA 1           // samples per pixel (4 for stills)

// ---- art controls ----
const vec3  SUN_DIR = normalize(vec3(-0.45, 1.3, 0.55));
const float BAND_SPLIT = 0.12;     // N.L threshold between the lit and the shadow band
const float BAND_SOFT = 0.015;     // softness of the band edge
const float OUTLINE_PX = 0.9;      // inner line probe offset in pixels (line is about 2x this), at 700 px tall
const float OUTLINE_DEPTH = 0.05;  // relative depth jump that makes an inner line
const float CONTOUR_LIT = 1.8;     // contour width in pixels on the lit side, at 700 px tall
const float CONTOUR_SHADE = 4.2;   // contour width in pixels on the shadow side
const float CONTOUR_RISE = 0.07;   // how far the ray must move away after a near miss to draw a contour over the body
const float FOCAL = 3.2;           // larger = more telephoto
const float CAM_YAW = -0.8;        // radians around the character; 0 = front

// ---- view helpers, from shader-skills (MIT): https://github.com/gokayfem/shader-skills ----
const float PI  = 3.14159265358979;
const float TAU = 6.28318530717959;

// ---- shader-skills library: hash ----
// 3D integer hash, three decorrelated outputs.
uvec3 pcg3d(uvec3 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    v ^= v >> 16u;
    v.x += v.y * v.z;
    v.y += v.z * v.x;
    v.z += v.x * v.y;
    return v;
}
// Map a uint to [0,1) using the top 24 bits, so the result can never round up to 1.0.
vec3 uintToUnit(uvec3 h) { return vec3(h >> 8u) * (1.0 / 16777216.0); }
// Random vec2 in [0,1)^2 for an integer-valued 2D input.
vec2 hash22(vec2 p) {
    ivec2 q = ivec2(floor(p));
    return uintToUnit(pcg3d(uvec3(q.x, q.y, 0x2545u))).xy;
}

// ---- shader-skills library: raymarch ----
#define ZERO (min(iFrame, 0))
const int RAYMARCH_MAX_STEPS = 256;
// Surface normal from 4 tetrahedral samples (cheaper than 6 central differences, and still centered). eps should scale with distance, e.g. 0.0005 * t: that filters distant detail and avoids sparkling.
vec3 calcNormal(vec3 p, float eps) {
    vec3 n = vec3(0.0);
    for (int i = ZERO; i < 4; i++) {
        vec3 e = 0.5773 * (2.0 * vec3((((i + 3) >> 1) & 1), ((i >> 1) & 1), (i & 1)) - 1.0);
        n += e * map(p + e * eps).x;
    }
    return normalize(n);
}

// ---- shader-skills library: camera ----
// Camera-to-world matrix looking from ro toward ta, with roll in radians. Columns are (right, up, forward).
mat3 cameraMatrix(vec3 ro, vec3 ta, float roll) {
    vec3 w = normalize(ta - ro);
    vec3 up = vec3(sin(roll), cos(roll), 0.0);
    vec3 u = normalize(cross(w, up));
    vec3 v = cross(u, w);
    return mat3(u, v, w);
}
// Primary ray direction for screen point uv. focal is about 1.5-2.5 for natural framing.
vec3 cameraRay(mat3 cam, vec2 uv, float focal) {
    return normalize(cam * vec3(uv, focal));
}

// ---- shader-skills library: color ----
// Exact sRGB decode (EOTF): encoded [0,1] -> linear.
vec3 srgbToLinear(vec3 c) {
    c = max(c, 0.0);
    return mix(c / 12.92, pow((c + 0.055) / 1.055, vec3(2.4)), step(0.04045, c));
}
// Exact sRGB encode (OETF): linear -> display [0,1]. Apply exactly once, after tonemapping. pow(c, 1/2.2) is visibly wrong near black (0.001 encodes to 0.013 here vs 0.043 with 2.2).
vec3 linearToSrgb(vec3 c) {
    c = max(c, 0.0);
    return mix(c * 12.92, 1.055 * pow(c, vec3(1.0 / 2.4)) - 0.055, step(0.0031308, c));
}

// ---- shader-skills library: post ----
// Subpixel offset in [-0.5, 0.5)^2 for sample i of a supersampling loop (R2 low-discrepancy sequence). Better coverage than a regular grid for any sample count.
vec2 aaOffset(int i) {
    return fract(0.5 + float(i) * vec2(0.7548776662, 0.5698402910)) - 0.5;
}
// Triangular-PDF dither of +-1 LSB for 8-bit output. Add AFTER linearToSrgb, right before writing fragColor.
vec3 ditherTPDF(vec2 fragCoord, int frame) {
    vec2 r = hash22(vec2(floor(fragCoord) + 7919.0 * float(frame % 1024)));
    return vec3((r.x + r.y - 1.0) / 255.0);
}

// ---- shader-skills library: debug ----
// Distance field as contour bands: warm outside, cool inside, white zero line. Bands are 0.1 units apart.
vec3 debugDistance(float d) {
    vec3 col = (d > 0.0) ? vec3(0.9, 0.6, 0.3) : vec3(0.4, 0.7, 0.85);
    col *= 1.0 - exp(-4.0 * abs(d));
    col *= 0.8 + 0.2 * cos(TAU * d / 0.1);
    return mix(col, vec3(1.0), 1.0 - smoothstep(0.0, 0.01, abs(d)));
}
// Normal as RGB.
vec3 debugNormal(vec3 n) { return 0.5 + 0.5 * n; }
// Distinct color per integer id.
vec3 debugIdColor(float id) {
    return 0.55 + 0.45 * cos(TAU * (0.618034 * id + vec3(0.0, 0.33, 0.67)));
}
// Heat ramp for a value in [0,1]: black, blue, magenta, orange, yellow, white.
vec3 debugHeat(float t) {
    t = clamp(t, 0.0, 1.0);
    return clamp(vec3(1.5 * t, 1.6 * t * t * t - 0.1, 0.9 * sin(PI * t) + 0.2 * t * t), 0.0, 1.0);
}

// Toon colours in linear space.
void palette(float id, out vec3 lit, out vec3 shade, out vec3 line) {
    paletteSrgb(id, lit, shade, line);
    lit = srgbToLinear(lit); shade = srgbToLinear(shade); line = srgbToLinear(line);
}

// ---- shading ----
void camera(out vec3 ro, out vec3 ta) {
    float yaw = CAM_YAW, pitch = 0.22;
    if (iMouse.z > 0.0 || iMouse.x > 0.0) {
        yaw = (iMouse.x / iResolution.x - 0.5) * TAU;
        pitch = mix(-0.05, 1.1, iMouse.y / iResolution.y);
    }
    ta = CAM_TARGET;
    ro = ta + CAM_DIST * vec3(sin(yaw) * cos(pitch), sin(pitch), cos(yaw) * cos(pitch));
}

vec3 primaryRay(vec2 fragCoord, vec3 ro, vec3 ta) {
    vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    return cameraRay(cameraMatrix(ro, ta, 0.0), uv, FOCAL);
}

// Ray span inside the bound sphere, or vec2(-1.0) on a miss.
vec2 boundSpan(vec3 ro, vec3 rd) {
    vec3 oc = ro - boundCentre();
    float b = dot(oc, rd);
    float h = b * b - dot(oc, oc) + BOUND_R * BOUND_R;
    if (h < 0.0) return vec2(-1.0);
    h = sqrt(h);
    return vec2(max(-b - h, 0.0), -b + h);
}

// Ground plane y = 0, or -1 when the ray goes up.
float groundHit(vec3 ro, vec3 rd) { return rd.y < 0.0 ? -ro.y / rd.y : -1.0; }

// Character hit, else the ground, else vec3(-1.0). Only the part of the ray in the bound sphere is marched.
vec3 trace(vec3 ro, vec3 rd, float tmin) {
    float tg = groundHit(ro, rd);
    vec2 span = boundSpan(ro, rd);
    if (span.y > 0.0) {
        float t = max(span.x, tmin);
        float tEnd = tg > 0.0 ? min(span.y, tg) : span.y;
        for (int i = ZERO; i < RAYMARCH_MAX_STEPS; i++) {
            vec2 h = mapChar(ro + rd * t);
            if (h.x < max(0.0002 * t, 1e-5)) return vec3(t, h.y, float(i));
            t += h.x * 0.8;
            if (t > tEnd) break;
        }
    }
    return tg > 0.0 ? vec3(tg, MAT_GROUND, 0.0) : vec3(-1.0, -1.0, 0.0);
}

// Primary march that also finds the nearest miss: the smallest angular gap d/t at a point where the ray
// passes the character and moves away again. graze = (gap, t, material id, largest distance after it).
// A gap under a pixel or two draws the contour, so its width can change smoothly along the outline.
vec3 traceContour(vec3 ro, vec3 rd, out vec4 graze) {
    graze = vec4(1e9, 0.0, MAT_GROUND, 0.0);
    float tg = groundHit(ro, rd);
    vec2 span = boundSpan(ro, rd);
    if (span.y > 0.0) {
        float t = span.x, tEnd = tg > 0.0 ? min(span.y, tg) : span.y;
        float dPrev = 1e9, tPrev = 1.0, idPrev = MAT_GROUND;
        bool falling = false;
        for (int i = ZERO; i < RAYMARCH_MAX_STEPS; i++) {
            vec2 c = mapChar(ro + rd * t);
            if (falling && gSolid.x > dPrev && dPrev / tPrev < graze.x) graze = vec4(dPrev / tPrev, tPrev, idPrev, dPrev);
            if (graze.x < 1e8) graze.w = max(graze.w, gSolid.x);
            falling = gSolid.x < dPrev;
            dPrev = gSolid.x; tPrev = t; idPrev = gSolid.y;
            if (c.x < max(0.0002 * t, 1e-5)) return vec3(t, c.y, float(i));
            // Short steps near the character, so the sampled gap is close to the true one and the line is clean.
            t += c.x < 0.06 ? min(c.x * 0.8, 0.012) : c.x * 0.8;
            if (t > tEnd) break;
        }
    }
    if (tg < 0.0) return vec3(-1.0, -1.0, 0.0);
    // On the ground the gap at the hit point outlines the feet where they touch down.
    mapChar(ro + rd * tg);
    if (gSolid.x / tg < graze.x) graze = vec4(gSolid.x / tg, tg, gSolid.y, 1e9);
    return vec3(tg, MAT_GROUND, 0.0);
}

vec3 render(vec2 fragCoord) {
    vec3 ro, ta;
    camera(ro, ta);
    vec3 rd = primaryRay(fragCoord, ro, ta);
    vec3 bgLit, bgShade, bgLine;
    palette(MAT_GROUND, bgLit, bgShade, bgLine);

#if DEBUG_MODE == 1
    vec2 uv = (2.0 * fragCoord - iResolution.xy) / iResolution.y;
    return debugDistance(map(vec3(0.0, uv.y * 1.3 + 1.0, uv.x * 1.3 + 0.3)).x);   // slice at x = 0
#endif

    vec4 graze;
    vec3 hit = traceContour(ro, rd, graze);
#if DEBUG_MODE == 4
    return debugHeat(hit.z / 120.0);
#endif
    float px = 2.0 / (iResolution.y * FOCAL);   // one pixel as an angle
    float res = iResolution.y / 700.0;          // line widths are set for a 700 px tall view
    float contour = 0.0;
    vec3 contourCol = bgLine;
#if OUTLINE == 1
    // Contour where the ray passes close to the character, then hits the background or a part behind.
    // Over the character the line fades in with how far the ray moved away, so shallow gaps don't flicker.
    if (graze.x < CONTOUR_SHADE * res * px) {
        vec3 gp = ro + rd * graze.y;
        // A wide normal sample, so sharp edges like the scarf ends don't make the width jump.
        float sun = dot(calcNormal(gp, 0.03), SUN_DIR);
        float w = mix(CONTOUR_SHADE, CONTOUR_LIT, smoothstep(-0.3, 0.6, sun)) * res * px;
        contour = 1.0 - smoothstep(w - px, w, graze.x);
        if (hit.y != MAT_GROUND && hit.x > 0.0) {
            contour *= smoothstep(0.5 * CONTOUR_RISE, CONTOUR_RISE, graze.w - graze.x * graze.y);
        }
        vec3 a, b;
        palette(graze.z, a, b, contourCol);
    }
#endif
    if (hit.x < 0.0) return mix(bgLit, contourCol, contour);

    float t = hit.x;
    float id = hit.y;
    vec3 p = ro + rd * t;
    vec3 lit, shade, line;
    palette(id, lit, shade, line);

    // Two-band cel ramp. The ground only takes the character's cast shadow.
    float band;
    vec3 n = vec3(0.0, 1.0, 0.0);
    if (id == MAT_GROUND) {
        band = trace(p + vec3(0.0, 0.002, 0.0), SUN_DIR, 0.0).x < 0.0 ? 1.0 : 0.0;
    } else {
        n = calcNormal(p, 0.0005 * t);
        band = smoothstep(BAND_SPLIT - BAND_SOFT, BAND_SPLIT + BAND_SOFT, dot(n, SUN_DIR));
    }
    vec3 col = mix(shade, lit, band);

    float edge = 0.0;
#if OUTLINE == 1
    // Edge rays: a line where the hit changes part, material or depth. Only on the character: the contour
    // already outlines it against the ground. They start just in front of the hit to save steps.
    vec3 lineCol = line;
    float tFront = t;
    // Thinner probes where a wing grows out of the body, so the line there tapers away.
    float probe = OUTLINE_PX * res * (id == MAT_WHITE || id == MAT_WING ? wingSeam(p) : 1.0);
    for (int i = ZERO; i < 4; i++) {
        if (id == MAT_GROUND) break;
        vec2 o = vec2(i == 0 ? 1.0 : (i == 1 ? -1.0 : 0.0), i == 2 ? 1.0 : (i == 3 ? -1.0 : 0.0)) * probe;
        vec3 h = trace(ro, primaryRay(fragCoord + o, ro, ta), 0.9 * t);
        float hid = h.x < 0.0 ? MAT_GROUND : h.y;
        float dz = abs(h.x - t) / min(h.x, t);
        if (hid != id || dz > OUTLINE_DEPTH || h.x < 0.0) {
            edge = 1.0;
            if (hid != MAT_GROUND && h.x < tFront) {
                tFront = h.x;
                vec3 a, b;
                palette(hid, a, b, lineCol);
            }
        }
    }
    col = mix(col, lineCol, edge);
    col = mix(col, contourCol, contour);
#endif

#if DEBUG_MODE == 2
    return debugNormal(n);
#elif DEBUG_MODE == 3
    return debugIdColor(id);
#elif DEBUG_MODE == 5
    return vec3(band, edge, contour);
#elif DEBUG_MODE == 6
    return vec3(max(dot(n, SUN_DIR), 0.0));
#endif
    return col;
}

void mainImage(out vec4 fragColor, in vec2 fragCoord) {
    vec3 acc = vec3(0.0);
    for (int i = 0; i < AA; i++) {
        acc += render(fragCoord + (AA > 1 ? aaOffset(i) : vec2(0.0)));
    }
    vec3 col = acc / float(AA);
#if DEBUG_MODE == 0
    col = linearToSrgb(col) + ditherTPDF(fragCoord, iFrame);
#endif
    fragColor = vec4(col, 1.0);
}
