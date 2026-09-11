import { HELIX } from './helix-config';
import { buildHelix } from './helix-geometry';
import { FRAGMENT_SHADER, VERTEX_SHADER } from './helix-shaders';

/**
 * The helix's GL, and nothing else — spec 2026-09-10 §5.
 *
 * Imperative and React-free. `HelixCanvas` imports this lazily, after LCP, so
 * none of it is in the first-load bundle. Every failure returns `null` rather
 * than throwing: a page whose hero decoration failed must still be a page.
 */

export const ATTRIBUTES = ['aKind', 'aT', 'aSeed', 'aScatter'] as const;

export const UNIFORMS = [
  'uTime', 'uSpinAngle', 'uAssemble', 'uScroll', 'uRoll', 'uPointer', 'uPointerStrength',
  'uViewport', 'uDpr', 'uTurns', 'uRadius', 'uLength', 'uYawSwing', 'uCameraZ', 'uFocal',
  'uAspect', 'uPointerRadius', 'uPointerMax', 'uSizeStrand', 'uSizeRung', 'uSizeDust',
  'uAlphaStrand', 'uAlphaRung', 'uAlphaDust', 'uJitter', 'uDustBoost', 'uPalette',
] as const;

type UniformName = (typeof UNIFORMS)[number];

export interface HelixFrame {
  /** Seconds, for the dust drift and yaw swing. */
  time: number;
  /** Radians, integrated by the caller so a speed change never jumps. */
  spinAngle: number;
  /** 0 = scattered, 1 = assembled. */
  assemble: number;
  /** Host scroll-out progress, 0..1. */
  scroll: number;
  /** CSS px relative to the canvas's top-left. */
  pointer: readonly [number, number];
  /** 0..1, eased by the caller. */
  pointerStrength: number;
}

export interface HelixRenderer {
  resize(cssWidth: number, cssHeight: number, dpr: number): void;
  render(frame: HelixFrame): void;
  dispose(): void;
}

export function hexToRgb01(hex: string): [number, number, number] {
  const n = parseInt(hex.replace('#', ''), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function warn(message: string, detail: string | null): void {
  if (process.env.NODE_ENV !== 'production') console.warn(`[helix] ${message}`, detail ?? '');
}

function context(canvas: HTMLCanvasElement, preserve: boolean): WebGL2RenderingContext | null {
  try {
    return canvas.getContext('webgl2', {
      alpha: true,
      premultipliedAlpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      powerPreference: 'low-power',
      preserveDrawingBuffer: preserve,
    });
  } catch {
    return null;
  }
}

function compile(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type);
  if (shader === null) return null;
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    warn('shader failed to compile', gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
}

export function createHelixRenderer(
  canvas: HTMLCanvasElement,
  options: { count: number; mirror: boolean; preserveDrawingBuffer?: boolean },
): HelixRenderer | null {
  const gl = context(canvas, options.preserveDrawingBuffer === true);
  if (gl === null) {
    warn('WebGL2 context unavailable', null);
    return null;
  }

  const vertex = compile(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragment = compile(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  if (vertex === null || fragment === null) return null;

  const program = gl.createProgram();
  if (program === null) {
    gl.deleteShader(vertex);
    gl.deleteShader(fragment);
    return null;
  }
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    warn('program failed to link', gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }

  const started = performance.now();
  const data = buildHelix({ count: options.count });
  performance.measure('helix:geometry', { start: started, end: performance.now() });

  const vao = gl.createVertexArray();
  if (vao === null) {
    gl.deleteProgram(program);
    return null;
  }
  gl.bindVertexArray(vao);
  const buffers: WebGLBuffer[] = [];
  let attributeFailed = false;
  const attribute = (name: (typeof ATTRIBUTES)[number], array: Float32Array, size: number): void => {
    if (attributeFailed) return;
    const location = gl.getAttribLocation(program, name);
    if (location < 0) return;
    const buffer = gl.createBuffer();
    if (buffer === null) {
      attributeFailed = true;
      return;
    }
    buffers.push(buffer);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, array, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 0, 0);
  };
  attribute('aKind', data.kind, 1);
  attribute('aT', data.t, 1);
  attribute('aSeed', data.seed, 4);
  attribute('aScatter', data.scatter, 3);
  gl.bindVertexArray(null);

  if (attributeFailed) {
    warn('attribute buffer creation failed', null);
    for (const buffer of buffers) gl.deleteBuffer(buffer);
    gl.deleteVertexArray(vao);
    gl.deleteProgram(program);
    return null;
  }

  const u = {} as Record<UniformName, WebGLUniformLocation | null>;
  for (const name of UNIFORMS) u[name] = gl.getUniformLocation(program, name);

  const deg = Math.PI / 180;
  gl.useProgram(program);
  gl.uniform1f(u.uTurns, HELIX.turns);
  gl.uniform1f(u.uRadius, HELIX.radius);
  gl.uniform1f(u.uLength, HELIX.length);
  gl.uniform1f(u.uRoll, HELIX.rollDeg * deg * (options.mirror ? -1 : 1));
  gl.uniform1f(u.uYawSwing, HELIX.yawSwingDeg * deg);
  gl.uniform1f(u.uCameraZ, HELIX.cameraZ);
  gl.uniform1f(u.uFocal, 1 / Math.tan((HELIX.fovDeg * deg) / 2));
  gl.uniform1f(u.uPointerMax, HELIX.pointer.maxPx);
  gl.uniform2f(u.uSizeStrand, ...HELIX.size.strand);
  gl.uniform2f(u.uSizeRung, ...HELIX.size.rung);
  gl.uniform2f(u.uSizeDust, ...HELIX.size.dust);
  gl.uniform2f(u.uAlphaStrand, ...HELIX.alpha.strand);
  gl.uniform2f(u.uAlphaRung, ...HELIX.alpha.rung);
  gl.uniform2f(u.uAlphaDust, ...HELIX.alpha.dust);
  gl.uniform3f(u.uJitter, HELIX.jitter.strand, HELIX.jitter.rung, HELIX.jitter.dust);
  gl.uniform1f(u.uDustBoost, HELIX.scrollDustBoost);
  gl.uniform3fv(u.uPalette, new Float32Array(HELIX.palette.flatMap((hex) => hexToRgb01(hex))));

  // Premultiplied "over". Additive blending washes out to white on a light ground.
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.disable(gl.DEPTH_TEST);
  gl.clearColor(0, 0, 0, 0);

  return {
    resize(cssWidth, cssHeight, dpr) {
      const width = Math.max(1, cssWidth);
      const height = Math.max(1, cssHeight);
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      gl.uniform2f(u.uViewport, width, height);
      gl.uniform1f(u.uAspect, width / height);
      gl.uniform1f(u.uDpr, dpr);
      gl.uniform1f(u.uPointerRadius, Math.min(width, height) * HELIX.pointer.radiusFrac);
    },
    render(frame) {
      gl.useProgram(program);
      gl.uniform1f(u.uTime, frame.time);
      gl.uniform1f(u.uSpinAngle, frame.spinAngle);
      gl.uniform1f(u.uAssemble, frame.assemble);
      gl.uniform1f(u.uScroll, frame.scroll);
      gl.uniform2f(u.uPointer, frame.pointer[0], frame.pointer[1]);
      gl.uniform1f(u.uPointerStrength, frame.pointerStrength);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.POINTS, 0, data.count);
      gl.bindVertexArray(null);
    },
    dispose() {
      for (const buffer of buffers) gl.deleteBuffer(buffer);
      gl.deleteVertexArray(vao);
      gl.deleteProgram(program);
    },
  };
}
