// The plate renderer. Two layers are drawn with Canvas 2D (engraved ink lines
// and a soft face mask) and composited by one WebGL fragment shader into a
// silver plate with grain, tarnish, vignette and the per-beat skin flush.
// No camera pixels are used anywhere: the portrait is made from face
// geometry and rhythm only.
import type { Point, SealParams } from '../../shared/types';
import { CONTOURS, FACE_OVAL, RIGHT_EYE, LEFT_EYE, LIPS_OUTER, FOREHEAD, CHIN } from './landmarks';
import { drawSeal } from './seal';

export interface FrameState {
  /** Normalised face points (unit box), or null before the face is found. */
  face: Point[] | null;
  topologyOk: boolean;
  /** 0..1 flush envelope from the current beat. */
  flush: number;
  /** 0..1 position of the flush wave from forehead to chin. */
  travel: number;
  /** 0..1 chest rise. */
  breath: number;
  /** 0..1 how far the image has emerged on the plate. */
  development: number;
  ghosts: Point[][];
  smile: Point[] | null;
  seal: { params: SealParams; progress: number } | null;
  capped: boolean;
  gentle: boolean;
  time: number;
}

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uInk; uniform sampler2D uMask;
uniform float uFlush, uTravel, uDev, uTime, uCapped, uGentle, uFaceTop, uFaceBottom, uSize;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 c = uv - 0.5;
  float r = length(c * vec2(1.0, 1.08));

  // Bare silver plate: cool highlight in the centre, warm tarnish creeping in from the edges.
  vec3 silver = mix(vec3(0.80, 0.79, 0.75), vec3(0.50, 0.49, 0.46), smoothstep(0.05, 0.62, r));
  float tarnish = smoothstep(0.30, 0.72, r + (fbm(uv * 6.0) - 0.5) * 0.25);
  silver = mix(silver, vec3(0.36, 0.27, 0.18), tarnish * 0.75);
  // A thin iridescent bloom at the very edge, as on real daguerreotypes.
  silver += vec3(0.05, -0.01, 0.07) * smoothstep(0.55, 0.70, r) * (1.0 - smoothstep(0.70, 0.80, r));

  vec4 mask = texture(uMask, uv);
  vec4 ink = texture(uInk, uv);

  // Engraving: fine horizontal lines that bend around the face, thicker where the face turns away.
  float face = mask.r;
  float shade = clamp(0.25 + 0.75 * (1.0 - face) + mask.g * 0.6, 0.0, 1.0);
  float lines = uv.y * uSize * 0.22 + sin(uv.x * 9.0) * 1.4 * face;
  float hatch = smoothstep(0.5 - shade * 0.42, 0.5 - shade * 0.42 + 0.08, abs(fract(lines) - 0.5));
  float present = smoothstep(0.30, 0.65, max(face, mask.b));
  vec3 image = silver * mix(1.0, 0.55 + 0.45 * hatch, present * 0.85);
  image = mix(image, vec3(0.10, 0.08, 0.06), ink.a * 0.92);
  image += vec3(0.05) * face; // soft halation around the face

  // The flush: a warm wave travelling forehead to chin with each heartbeat.
  float faceV = clamp((uv.y - uFaceTop) / max(0.01, uFaceBottom - uFaceTop), 0.0, 1.0);
  float band = exp(-pow(faceV - uTravel, 2.0) / 0.06);
  float flushAmt = uFlush * face * (0.45 + 0.55 * band) * mix(1.0, 0.55, uGentle);
  image = mix(image, image * vec3(1.20, 0.92, 0.86) + vec3(0.10, 0.02, 0.0), flushAmt);

  // Development: grain first, image after.
  float grainSeed = uGentle > 0.5 ? 0.0 : floor(uTime * 12.0);
  float g = hash(uv * uSize + grainSeed);
  float dev = smoothstep(g * 0.6, g * 0.6 + 0.4, uDev);
  vec3 col = mix(silver, image, dev);
  col += (g - 0.5) * 0.06;

  // Vignette and lens cap.
  col *= 1.0 - smoothstep(0.42, 0.78, r) * 0.55;
  col = mix(col, col * 0.22, uCapped);
  outColor = vec4(col, 1.0);
}`;

export class PlateRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private inkCanvas: HTMLCanvasElement;
  private maskCanvas: HTMLCanvasElement;
  private inkTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private u: Record<string, WebGLUniformLocation | null> = {};

  constructor(canvas: HTMLCanvasElement, readonly size: number) {
    this.canvas = canvas;
    canvas.width = size; canvas.height = size;
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL2 is not available');
    this.gl = gl;
    this.prog = link(gl, VERT, FRAG);
    gl.useProgram(this.prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(this.prog, 'aPos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    for (const n of ['uInk', 'uMask', 'uFlush', 'uTravel', 'uDev', 'uTime', 'uCapped', 'uGentle', 'uFaceTop', 'uFaceBottom', 'uSize']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    this.inkCanvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    for (const c of [this.inkCanvas, this.maskCanvas]) { c.width = size; c.height = size; }
    this.inkTex = makeTex(gl);
    this.maskTex = makeTex(gl);
  }

  /** Where the face sits on the plate, in pixels. */
  private place(p: Point, breath: number, lift = 1): Point {
    const s = this.size, box = s * 0.5;
    return { x: s * 0.5 + (p.x - 0.5) * box, y: s * 0.4 + (p.y - 0.5) * box - breath * s * 0.006 * lift };
  }

  render(f: FrameState): void {
    const s = this.size;
    const ink = this.inkCanvas.getContext('2d')!;
    const mask = this.maskCanvas.getContext('2d')!;
    ink.clearRect(0, 0, s, s);
    mask.clearRect(0, 0, s, s);

    let faceTop = 0.2, faceBottom = 0.6;
    if (f.face) {
      const P = (i: number) => this.place(f.face![i], f.breath);
      faceTop = P(FOREHEAD).y / s; faceBottom = P(CHIN).y / s;
      this.drawBust(ink, mask, f);

      // Mask: red = face, green = shadowed features, blue = bust.
      mask.filter = `blur(${Math.round(s * 0.012)}px)`;
      mask.fillStyle = 'rgb(255,0,0)';
      polygon(mask, (f.topologyOk ? FACE_OVAL : hullIdx(f.face)).map(P), true);
      mask.fill();
      if (f.topologyOk) {
        mask.globalCompositeOperation = 'lighter';
        mask.fillStyle = 'rgb(0,160,0)';
        for (const idx of [RIGHT_EYE, LEFT_EYE, LIPS_OUTER]) { polygon(mask, idx.map(P), true); mask.fill(); }
        mask.globalCompositeOperation = 'source-over';
      }
      mask.filter = 'none';

      // Ink: engraved contours plus a stipple of every landmark.
      ink.lineCap = 'round'; ink.lineJoin = 'round';
      ink.strokeStyle = 'rgba(20,14,8,0.62)';
      if (f.topologyOk) {
        for (const c of CONTOURS) {
          ink.lineWidth = c.weight * (s / 640);
          polygon(ink, c.idx.map(P), c.closed);
          ink.stroke();
        }
      }
      ink.fillStyle = 'rgba(0,0,0,0.45)';
      const dot = Math.max(0.7, s / 900);
      for (const q of f.face) { const p = this.place(q, f.breath); ink.fillRect(p.x - dot / 2, p.y - dot / 2, dot, dot); }

      // Blink ghosts: faint doubled eyes where the sitter blinked.
      ink.strokeStyle = 'rgba(0,0,0,0.22)';
      ink.lineWidth = s / 900;
      for (const g of f.ghosts) { polygon(ink, g.map((q) => this.place(q, f.breath)), true); ink.stroke(); }

      // The smile that broke through, if one was held.
      if (f.smile) {
        ink.strokeStyle = 'rgba(0,0,0,0.3)';
        polygon(ink, f.smile.map((q) => this.place(q, f.breath)), true);
        ink.stroke();
      }
    }

    if (f.seal) drawSeal(ink, f.seal.params, s * 0.86, s * 0.14, s * 0.07, f.seal.progress);

    const gl = this.gl;
    gl.viewport(0, 0, s, s);
    upload(gl, this.inkTex, this.inkCanvas, 0);
    upload(gl, this.maskTex, this.maskCanvas, 1);
    gl.uniform1i(this.u.uInk, 0);
    gl.uniform1i(this.u.uMask, 1);
    gl.uniform1f(this.u.uFlush, f.flush);
    gl.uniform1f(this.u.uTravel, f.travel);
    gl.uniform1f(this.u.uDev, f.development);
    gl.uniform1f(this.u.uTime, f.time);
    gl.uniform1f(this.u.uCapped, f.capped ? 1 : 0);
    gl.uniform1f(this.u.uGentle, f.gentle ? 1 : 0);
    gl.uniform1f(this.u.uFaceTop, faceTop);
    gl.uniform1f(this.u.uFaceBottom, faceBottom);
    gl.uniform1f(this.u.uSize, s);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Neck and shoulders, which rise with the breath more than the face does. */
  private drawBust(ink: CanvasRenderingContext2D, mask: CanvasRenderingContext2D, f: FrameState): void {
    const s = this.size;
    const lift = f.breath * s * 0.014;
    const chinY = s * 0.4 + s * 0.25;
    const neckW = s * 0.085, shoulderY = chinY + s * 0.1 - lift;
    const path = new Path2D();
    path.moveTo(s * 0.5 - neckW, chinY - s * 0.04);
    path.lineTo(s * 0.5 - neckW, shoulderY - s * 0.02);
    path.bezierCurveTo(s * 0.36, shoulderY, s * 0.2, shoulderY + s * 0.01, s * 0.12, s * 1.02);
    path.lineTo(s * 0.88, s * 1.02);
    path.bezierCurveTo(s * 0.8, shoulderY + s * 0.01, s * 0.64, shoulderY, s * 0.5 + neckW, shoulderY - s * 0.02);
    path.lineTo(s * 0.5 + neckW, chinY - s * 0.04);
    mask.filter = `blur(${Math.round(s * 0.02)}px)`;
    mask.fillStyle = 'rgb(0,0,200)';
    mask.fill(path);
    mask.filter = 'none';
    ink.strokeStyle = 'rgba(0,0,0,0.55)';
    ink.lineWidth = s / 500;
    ink.stroke(path);
  }

  toBlob(): Promise<Blob> {
    return new Promise((res, rej) => this.canvas.toBlob((b) => (b ? res(b) : rej(new Error('export failed'))), 'image/png'));
  }

  /** RGBA pixels of the current frame (for GIF export). */
  pixels(): Uint8ClampedArray {
    const gl = this.gl, s = this.size;
    const px = new Uint8Array(s * s * 4);
    gl.readPixels(0, 0, s, s, gl.RGBA, gl.UNSIGNED_BYTE, px);
    // WebGL rows are bottom-up; flip.
    const out = new Uint8ClampedArray(px.length);
    for (let y = 0; y < s; y++) out.set(px.subarray((s - 1 - y) * s * 4, (s - y) * s * 4), y * s * 4);
    return out;
  }

  dispose(): void {
    const gl = this.gl;
    gl.deleteTexture(this.inkTex); gl.deleteTexture(this.maskTex); gl.deleteProgram(this.prog);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }
}

function polygon(ctx: CanvasRenderingContext2D, pts: Point[], closed: boolean): void {
  ctx.beginPath();
  pts.forEach((p, i) => (i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y)));
  if (closed) ctx.closePath();
}

/** Convex hull (indices), used when the landmark topology is not recognised. */
function hullIdx(p: Point[]): number[] {
  const idx = p.map((_, i) => i).sort((a, b) => p[a].x - p[b].x || p[a].y - p[b].y);
  const cross = (o: number, a: number, b: number) => (p[a].x - p[o].x) * (p[b].y - p[o].y) - (p[a].y - p[o].y) * (p[b].x - p[o].x);
  const lower: number[] = [], upper: number[] = [];
  for (const i of idx) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop(); lower.push(i); }
  for (const i of [...idx].reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop(); upper.push(i); }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

function link(gl: WebGL2RenderingContext, vs: string, fs: string): WebGLProgram {
  const sh = (type: number, src: string) => {
    const s = gl.createShader(type)!;
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader error');
    return s;
  };
  const p = gl.createProgram()!;
  gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
  return p;
}

function makeTex(gl: WebGL2RenderingContext): WebGLTexture {
  const t = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, t);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function upload(gl: WebGL2RenderingContext, tex: WebGLTexture, src: HTMLCanvasElement, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
}
