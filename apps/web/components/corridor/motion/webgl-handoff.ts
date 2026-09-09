/**
 * The scene-handoff displacement pass — Landing-Page-Specs §2.2 channel 4.
 *
 * ---------------------------------------------------------------------------
 * WHY RAW WebGL2 AND NOT REACT THREE FIBER
 *
 * §6.1 lists "React Three Fiber + drei, lazy-loaded" for this, and immediately
 * qualifies it: "Used for the scene-handoff displacement pass only. Optional."
 * §2.2 describes what is actually wanted — "a single WebGL post-pass".
 *
 * A single fullscreen pass is one program, one triangle, three uniforms. Doing
 * it through R3F means three.js in the bundle (~145 KB gzipped) plus a
 * reconciler, for a scene graph containing one quad. §16's first anti-pattern
 * is loading a heavy WebGL scene "because Awwwards likes it", and §8.1 budgets
 * the whole Tier A page at 2.5 MB. Ninety lines of GL here spends none of it.
 *
 * If this file ever needs a camera, a mesh, or a loader, that is the signal to
 * bring in a real 3D library — not now.
 * ---------------------------------------------------------------------------
 *
 * WHAT IT DRAWS. A faint phosphor caustic — domain-warped value noise, the
 * light you get through moving glass. Its amplitude is zero at rest and rises
 * with scroll velocity, so it appears only in the handoff between scenes and
 * is gone by the time the reader has arrived anywhere. §2.2's restraint rule:
 * channels 3–6 fire at most three times across the entire page.
 *
 * The loop runs ONLY while the amplitude is above the visible threshold. A
 * permanent rAF for a decorative layer is a permanent battery cost on the
 * laptop of somebody who is reading.
 */

const VERTEX = `#version 300 es
void main() {
  /* A single oversized triangle rather than two triangles for a quad: no
     shared edge for the rasteriser to seam, one fewer vertex, and the
     positions come from gl_VertexID so there is no buffer to allocate. */
  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

const FRAGMENT = `#version 300 es
precision mediump float;

uniform vec2  u_res;
uniform float u_time;
uniform float u_amp;

out vec4 outColor;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

void main() {
  vec2 uv = gl_FragCoord.xy / u_res;
  uv.x *= u_res.x / u_res.y;

  /* Domain warp: sample the field at coordinates that are themselves a field.
     This is what turns noise into something that reads as refraction rather
     than as static. */
  vec2 warp = vec2(
    noise(uv * 2.4 + vec2(0.0, u_time * 0.05)),
    noise(uv * 2.4 + vec2(4.7, 1.3 - u_time * 0.04))
  );

  float n = noise(uv * 3.6 + warp * 1.8);
  float caustic = smoothstep(0.55, 0.95, n);

  /* Phosphor #3FE0C5, and nothing else. §3.1: this accent is a signal, so
     even here it stays under a few percent of the frame. */
  vec3 phosphor = vec3(0.247, 0.878, 0.773);
  float a = caustic * u_amp * 0.5;
  outColor = vec4(phosphor * a, a);
}`;

export interface Handoff {
  /** Feed scroll velocity in px/frame. Amplitude follows, and decays. */
  push: (velocity: number) => void;
  resize: () => void;
  destroy: () => void;
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    console.warn('[corridor] handoff shader failed', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

/**
 * Half resolution, capped.
 *
 * The output is a blurred caustic at a few percent alpha. Rendering it at
 * device resolution would double or quadruple the fragment count to produce
 * detail that is below the threshold of the effect itself.
 */
const SCALE = 0.5;
const MAX_DIMENSION = 1280;

export function createHandoff(canvas: HTMLCanvasElement): Handoff | null {
  const gl = canvas.getContext('webgl2', {
    alpha: true,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'low-power',
  });
  if (gl === null) return null;

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT);
  const program = gl.createProgram();
  if (vertex === null || fragment === null || program === null) return null;

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn('[corridor] handoff link failed', gl.getProgramInfoLog(program));
    return null;
  }

  // The shaders are baked into the program; the objects themselves are dead
  // weight in GPU memory from here on.
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);

  gl.useProgram(program);
  const uRes = gl.getUniformLocation(program, 'u_res');
  const uTime = gl.getUniformLocation(program, 'u_time');
  const uAmp = gl.getUniformLocation(program, 'u_amp');

  gl.enable(gl.BLEND);
  gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

  let amp = 0;
  let raf = 0;
  let destroyed = false;
  const started = performance.now();

  const resize = (): void => {
    const width = Math.min(MAX_DIMENSION, Math.round(window.innerWidth * SCALE));
    const height = Math.round(width * (window.innerHeight / window.innerWidth));
    if (canvas.width === width && canvas.height === height) return;
    canvas.width = width;
    canvas.height = height;
    gl.viewport(0, 0, width, height);
  };

  const frame = (): void => {
    raf = 0;
    if (destroyed) return;

    // Exponential decay. The handoff is an event, not a state.
    amp *= 0.92;
    if (amp < 0.002) {
      amp = 0;
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      canvas.style.opacity = '0';
      return;
    }

    canvas.style.opacity = '1';
    gl.uniform2f(uRes, canvas.width, canvas.height);
    gl.uniform1f(uTime, (performance.now() - started) / 1000);
    gl.uniform1f(uAmp, amp);
    gl.drawArrays(gl.TRIANGLES, 0, 3);

    raf = requestAnimationFrame(frame);
  };

  resize();

  return {
    push: (velocity: number) => {
      // Normalised against a brisk flick, and hard-capped: the effect must not
      // get stronger the harder someone throws the page, or a fast scroll
      // turns the whole viewport green.
      const target = Math.min(0.55, Math.abs(velocity) / 120);
      if (target <= amp) return;
      amp = target;
      if (raf === 0 && !destroyed) raf = requestAnimationFrame(frame);
    },
    resize,
    destroy: () => {
      destroyed = true;
      if (raf !== 0) cancelAnimationFrame(raf);
      gl.deleteProgram(program);
      /*
       * Explicitly drop the context. A page that mounts and unmounts this on a
       * locale switch would otherwise accumulate contexts against the
       * browser's hard limit — typically 8 to 16 — and the failure is that an
       * unrelated canvas elsewhere silently stops working.
       */
      gl.getExtension('WEBGL_lose_context')?.loseContext();
    },
  };
}
