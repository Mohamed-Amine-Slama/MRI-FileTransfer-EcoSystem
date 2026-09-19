/**
 * The helix, computed on the GPU — spec 2026-09-10 §5.3.
 *
 * Every particle's position is a function of its static attributes and a few
 * uniforms, so a frame costs one `drawArrays` and no CPU work per particle.
 * Order in the vertex shader: helix position (ribbon backbones, base-pair
 * rungs, dust halo) → entrance assembly → yaw swing → pitch toward the camera
 * → roll → perspective → depth of field → pointer repulsion in screen space.
 */

export const VERTEX_SHADER = `#version 300 es
precision highp float;

in float aKind;
in float aT;
in vec4 aSeed;
in vec3 aScatter;

uniform float uTime;
uniform float uSpinAngle;
uniform float uAssemble;
uniform float uScroll;
uniform float uRoll;
uniform float uPitch;
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uTurns;
uniform float uRadius;
uniform float uLength;
uniform float uGroove;
uniform vec2 uRibbon;
uniform float uYawSwing;
uniform float uCameraZ;
uniform float uFocal;
uniform float uAspect;
uniform float uPointerRadius;
uniform float uPointerMax;
uniform vec2 uSizeStrand;
uniform vec2 uSizeRung;
uniform vec2 uSizeDust;
uniform vec2 uAlphaStrand;
uniform vec2 uAlphaRung;
uniform vec2 uAlphaDust;
uniform vec3 uJitter;
uniform float uDustBoost;
uniform vec3 uDof;
uniform vec3 uLight;
uniform vec2 uDensity;

out float vAlpha;
out float vTone;
out float vSoft;

const float TAU = 6.283185307;

vec3 onHelix(float angle, float y, float radius) {
  return vec3(cos(angle) * radius, y, sin(angle) * radius);
}

float hash(vec3 p) {
  p = fract(p * 0.3183099 + 0.1);
  p *= 17.0;
  return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
}

float noise(vec3 x) {
  vec3 i = floor(x);
  vec3 f = fract(x);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(hash(i), hash(i + vec3(1.0, 0.0, 0.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 0.0)), hash(i + vec3(1.0, 1.0, 0.0)), f.x), f.y),
    mix(mix(hash(i + vec3(0.0, 0.0, 1.0)), hash(i + vec3(1.0, 0.0, 1.0)), f.x),
        mix(hash(i + vec3(0.0, 1.0, 1.0)), hash(i + vec3(1.0, 1.0, 1.0)), f.x), f.y),
    f.z);
}

/*
 * Per-particle 3D fuzz — three standard normals and a uniform — hashed from
 * the vertex index rather than uploaded: it needs no seeding the tests could
 * check, and generating it on the CPU was most of the geometry's cost.
 */
uint pcg(uint v) {
  uint state = v * 747796405u + 2891336453u;
  uint word = ((state >> ((state >> 28u) + 4u)) ^ state) * 277803737u;
  return (word >> 22u) ^ word;
}

vec4 vertexJitter(uint id) {
  uint a = pcg(id * 3u + 1u);
  uint b = pcg(a);
  uint c = pcg(b);
  vec3 u = vec3(float(a), float(b), float(c)) / 4294967296.0;
  float r = sqrt(-2.0 * log(max(u.x, 1e-7)));
  float r2 = sqrt(-2.0 * log(max(fract(u.z * 7.0), 1e-7)));
  return vec4(r * cos(TAU * u.y), r * sin(TAU * u.y), r2 * cos(TAU * u.z), fract(u.y * 13.0 + u.x));
}

vec3 yawPitchRoll(vec3 p, float yaw) {
  p = vec3(cos(yaw) * p.x + sin(yaw) * p.z, p.y, -sin(yaw) * p.x + cos(yaw) * p.z);
  p = vec3(p.x, cos(uPitch) * p.y - sin(uPitch) * p.z, sin(uPitch) * p.y + cos(uPitch) * p.z);
  return vec3(cos(uRoll) * p.x - sin(uRoll) * p.y, sin(uRoll) * p.x + cos(uRoll) * p.y, p.z);
}

void main() {
  bool isRung = aKind > 1.5 && aKind < 2.5;
  bool isDust = aKind > 2.5;
  bool onB = (aKind > 0.5 && aKind < 1.5) || aKind > 3.5;
  vec4 aJitter = vertexJitter(uint(gl_VertexID));

  float y = (aT - 0.5) * uLength;
  float angle = aT * uTurns * TAU + uSpinAngle + (onB ? uGroove : 0.0);
  // Outward surface normal at the particle's backbone, for the lighting.
  vec3 normal = vec3(cos(angle), 0.0, sin(angle));
  float edge = 0.0;

  vec3 p;
  vec2 sizeRange;
  vec2 alphaRange;
  float tone;
  if (isRung) {
    // A base pair: the chord between the two backbones at the same height.
    vec3 a = onHelix(angle, y, uRadius * 0.97);
    vec3 b = onHelix(angle + uGroove, y, uRadius * 0.97);
    p = mix(a, b, aSeed.x) + aJitter.xyz * uJitter.y;
    float mid = angle + uGroove * 0.5;
    normal = vec3(cos(mid), 0.0, sin(mid));
    sizeRange = uSizeRung;
    alphaRange = uAlphaRung;
    tone = 0.55 + aSeed.w * 0.35;
  } else if (isDust) {
    // Most dust is a halo hugging the backbone; a quarter is mist, sprayed wider.
    float sigma = uJitter.z * mix(1.0, uDustBoost, uScroll) * (aJitter.w < 0.25 ? 3.4 : 1.0);
    p = onHelix(angle + aSeed.y * 0.1, y, uRadius + aSeed.x * sigma * 0.4);
    vec3 q = p * 0.55 + vec3(uTime * 0.06);
    p += aJitter.xyz * sigma * 0.45 + (vec3(noise(q), noise(q + 17.3), noise(q + 41.1)) - 0.5) * sigma;
    sizeRange = uSizeDust;
    alphaRange = uAlphaDust;
    tone = 0.15 + aSeed.w * 0.7;
  } else {
    /*
     * A backbone is a ribbon lying on the cylinder. \`across\` is the
     * direction on the cylinder's surface perpendicular to the helix curve
     * (the surface normal crossed with the curve's tangent), so the ribbon
     * shows its full width where it faces the camera and turns edge-on at
     * the silhouette, the way a twisted band does.
     */
    float rk = uRadius * uTurns * TAU / uLength;
    vec3 across = vec3(-sin(angle), -rk, cos(angle)) / sqrt(1.0 + rk * rk);
    p = onHelix(angle, y, uRadius + aSeed.y * uRibbon.y) + across * aSeed.x * uRibbon.x;
    p += aJitter.xyz * uJitter.x;
    edge = smoothstep(0.75, 1.0, abs(aSeed.x));
    sizeRange = uSizeStrand;
    alphaRange = uAlphaStrand;
    tone = 0.22 + aSeed.w * 0.36;
  }

  // Entrance: each particle travels in from its scatter point, later along the strand.
  float k = clamp(uAssemble * 1.35 - aT * 0.35, 0.0, 1.0);
  float eased = k >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * k);
  p = mix(aScatter, p, eased);

  float yaw = sin(uTime * 0.25) * uYawSwing;
  p = yawPitchRoll(p, yaw);
  normal = yawPitchRoll(normal, yaw);

  // Lit from uLight; the side facing away falls toward the palette's shadow end.
  float lit = 0.5 + 0.5 * dot(normal, normalize(uLight));
  tone = clamp(tone + (lit - 0.5) * 0.7 - edge * 0.35, 0.0, 1.0);

  // Perspective: the camera sits uCameraZ in front of the origin, looking at it.
  float w = p.z + uCameraZ;
  vec2 ndc = vec2(p.x * uFocal / uAspect, p.y * uFocal) / w;

  // Pointer repulsion, in CSS pixels with a top-left origin, like the pointer.
  vec2 px = vec2((ndc.x * 0.5 + 0.5) * uViewport.x, (0.5 - ndc.y * 0.5) * uViewport.y);
  vec2 away = px - uPointer;
  float dist = length(away);
  if (uPointerStrength > 0.0 && dist < uPointerRadius && dist > 0.001) {
    float push = (1.0 - smoothstep(0.0, uPointerRadius, dist)) * uPointerMax * uPointerStrength;
    px += away / dist * push;
  }
  ndc = vec2(px.x / uViewport.x * 2.0 - 1.0, 1.0 - px.y / uViewport.y * 2.0);

  /*
   * Size: perspective, then the density correction, then depth of field. A
   * blurred particle grows and dims together (roughly constant energy), so
   * the near coil turns soft instead of heavy. A particle under one CSS
   * pixel is drawn at one pixel with its coverage folded into its alpha,
   * which keeps the finest grain from shimmering.
   */
  float sharp = mix(sizeRange.x, sizeRange.y, aSeed.z) * (uCameraZ / w) * uDensity.y;
  float blur = min(uDof.z, abs(w - uCameraZ - uDof.x) * uDof.y);
  float size = sharp + blur;
  float alpha = mix(alphaRange.x, alphaRange.y, fract(aSeed.w * 7.13)) * uDensity.x;
  alpha *= clamp(pow(sharp / size, 1.3), 0.14, 1.0);
  if (size < 1.0) {
    alpha *= size;
    size = 1.0;
  }
  // Smoke, not tubing: density comes and goes in clumps along each backbone.
  if (!isRung) alpha *= mix(0.4, 1.6, noise(vec3(aT * 34.0, onB ? 9.0 : 0.0, aSeed.x * 1.2)));
  // Far particles fade a little, like haze; the entrance fades them up.
  float depth = clamp((w - uCameraZ) / (uLength * 0.35) * 0.5 + 0.5, 0.0, 1.0);
  alpha *= mix(1.0, 0.5, depth) * mix(0.25, 1.0, eased);

  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = size * uDpr;
  vAlpha = alpha;
  vTone = tone;
  vSoft = clamp(blur / size, 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in float vAlpha;
in float vTone;
in float vSoft;

uniform vec3 uPalette[5];

out vec4 outColor;

vec3 ramp(float x) {
  float s = clamp(x, 0.0, 1.0) * 4.0;
  int i = int(min(floor(s), 3.0));
  return mix(uPalette[i], uPalette[i + 1], s - float(i));
}

void main() {
  // 0 at the centre of the sprite, 1 at its rim.
  vec2 c = gl_PointCoord - 0.5;
  float r2 = dot(c, c) * 4.0;
  if (r2 > 1.0) discard;
  // A sharp grain is a tight gaussian; a blurred one flattens toward a soft disc.
  float falloff = mix(exp(-r2 * 3.0), 1.0 - r2 * r2, vSoft);
  float a = falloff * vAlpha;
  if (a < 0.003) discard;
  // Premultiplied, for ONE / ONE_MINUS_SRC_ALPHA blending on a light ground.
  outColor = vec4(ramp(vTone) * a, a);
}
`;
