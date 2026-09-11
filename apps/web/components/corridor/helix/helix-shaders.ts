/**
 * The helix, computed on the GPU — spec 2026-09-10 §5.3.
 *
 * Every particle's position is a function of its static attributes and a few
 * uniforms, so a frame costs one `drawArrays` and no CPU work per particle.
 * Order in the vertex shader: helix position → dust drift → entrance assembly
 * → yaw swing → roll → perspective → pointer repulsion in screen space.
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
uniform vec2 uPointer;
uniform float uPointerStrength;
uniform vec2 uViewport;
uniform float uDpr;
uniform float uTurns;
uniform float uRadius;
uniform float uLength;
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

out float vAlpha;
out float vTone;

const float TAU = 6.283185307;
const float PI = 3.141592654;

vec3 strandPoint(float t, float phase, float angleJitter, float radiusJitter) {
  float a = t * uTurns * TAU + uSpinAngle + phase + angleJitter;
  float r = uRadius + radiusJitter;
  return vec3(cos(a) * r, (t - 0.5) * uLength, sin(a) * r);
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

void main() {
  bool isRung = aKind > 1.5 && aKind < 2.5;
  bool isDust = aKind > 2.5;
  bool onB = (aKind > 0.5 && aKind < 1.5) || aKind > 3.5;
  float phase = onB ? PI : 0.0;

  vec3 p;
  vec2 sizeRange;
  vec2 alphaRange;
  if (isRung) {
    vec3 a = strandPoint(aT, 0.0, 0.0, 0.0);
    vec3 b = strandPoint(aT, PI, 0.0, 0.0);
    p = mix(a, b, aSeed.x);
    p.y += aSeed.y * uJitter.y;
    sizeRange = uSizeRung;
    alphaRange = uAlphaRung;
  } else if (isDust) {
    float sigma = uJitter.z * mix(1.0, uDustBoost, uScroll);
    p = strandPoint(aT, phase, aSeed.y * 0.35, aSeed.x * sigma);
    p.y += aSeed.y * 0.25;
    vec3 q = p * 0.6 + vec3(uTime * 0.07);
    p += (vec3(noise(q), noise(q + 17.3), noise(q + 41.1)) - 0.5) * sigma;
    sizeRange = uSizeDust;
    alphaRange = uAlphaDust;
  } else {
    p = strandPoint(aT, phase, aSeed.y * 0.08, aSeed.x * uJitter.x);
    sizeRange = uSizeStrand;
    alphaRange = uAlphaStrand;
  }

  // Entrance: each particle travels in from its scatter point, later along the strand.
  float k = clamp(uAssemble * 1.35 - aT * 0.35, 0.0, 1.0);
  float eased = k >= 1.0 ? 1.0 : 1.0 - pow(2.0, -10.0 * k);
  p = mix(aScatter, p, eased);

  // A slow yaw swing about the axis, then the corner-to-corner roll.
  float yaw = sin(uTime * 0.25) * uYawSwing;
  p = vec3(cos(yaw) * p.x + sin(yaw) * p.z, p.y, -sin(yaw) * p.x + cos(yaw) * p.z);
  p = vec3(cos(uRoll) * p.x - sin(uRoll) * p.y, sin(uRoll) * p.x + cos(uRoll) * p.y, p.z);

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

  float near = clamp(0.5 - p.z / (uRadius * 2.4), 0.0, 1.0);
  float scale = uCameraZ / w;
  gl_Position = vec4(ndc, 0.0, 1.0);
  gl_PointSize = mix(sizeRange.x, sizeRange.y, aSeed.z) * scale * mix(0.7, 1.15, near) * uDpr;
  vAlpha = mix(alphaRange.x, alphaRange.y, fract(aSeed.w * 7.13)) * mix(0.35, 1.0, near) * mix(0.25, 1.0, eased);
  vTone = clamp(aSeed.w * 0.6 + near * 0.4 - (isDust ? 0.1 : 0.0), 0.0, 1.0);
}
`;

export const FRAGMENT_SHADER = `#version 300 es
precision mediump float;

in float vAlpha;
in float vTone;

uniform vec3 uPalette[5];

out vec4 outColor;

vec3 ramp(float x) {
  float s = clamp(x, 0.0, 1.0) * 4.0;
  int i = int(min(floor(s), 3.0));
  return mix(uPalette[i], uPalette[i + 1], s - float(i));
}

void main() {
  vec2 c = gl_PointCoord - 0.5;
  float a = exp(-dot(c, c) * 12.0) * vAlpha;
  if (a < 0.004) discard;
  // Premultiplied, for ONE / ONE_MINUS_SRC_ALPHA blending on a light ground.
  outColor = vec4(ramp(vTone) * a, a);
}
`;
