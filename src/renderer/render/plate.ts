// The plate renderer. Canvas 2D draws three soft data layers from the face
// geometry (a height/feature mask, a light layer, and the engraved ink), and one
// WebGL fragment shader turns them into an 1840s daguerreotype: a lit, engraved
// silver portrait inside a stamped brass oval mat, with grain, tarnish and the
// per-beat flush. No camera pixels are used anywhere: the portrait is made from
// face geometry and rhythm only.
import type { HeadStyle, Point, SealParams } from '../../shared/types';
import {
  CONTOURS, FACE_OVAL, RIGHT_EYE, LEFT_EYE, LIPS_INNER, LIPS_OUTER, RIGHT_IRIS, LEFT_IRIS,
  RIGHT_BROW, LEFT_BROW, NOSE_BASE, NOSE_BRIDGE, FOREHEAD, CHIN, NOSE_TIP,
} from './landmarks';
import { drawSeal } from './seal';

/** Upper inner-lip contour, mouth corner to corner: drawn as the meeting line of the lips. */
const LIP_LINE = [78, 191, 80, 81, 82, 13, 312, 311, 310, 415, 308];

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
  /** Top of the head; 'soft' when omitted. */
  head?: HeadStyle;
}

/** Upper lip: outer contour from corner to corner over the top, back along the inner top. */
const UPPER_LIP = [61, 185, 40, 39, 37, 0, 267, 269, 270, 409, 291, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191, 78];
/** The jawline from ear to ear under the chin. */
const JAWLINE = [361, 288, 397, 365, 379, 378, 400, 377, 152, 148, 176, 149, 150, 136, 172, 58, 132];
/** Upper eyelids, outer corner to inner corner. */
const RIGHT_UPPER_LID = [33, 246, 161, 160, 159, 158, 157, 173, 133];
const LEFT_UPPER_LID = [263, 466, 388, 387, 386, 385, 384, 398, 362];

/** The mask and light layers are drawn at 1/SOFT size (see the constructor). */
const SOFT = 4;

const VERT = `#version 300 es
in vec2 aPos; out vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

// Layers: uMask.r = face height (blurred oval), .g = feature shadows, .b = coat.
//         uLight.r = feature highlights, .g = crown (hair/head above the brow).
//         uInk = engraved contours, irises, ghosts, seal (alpha = ink).
const FRAG = `#version 300 es
precision highp float;
in vec2 vUv; out vec4 outColor;
uniform sampler2D uInk; uniform sampler2D uMask; uniform sampler2D uLight;
uniform float uFlush, uTravel, uDev, uTime, uCapped, uGentle, uFaceTop, uFaceBottom, uSize, uCrownTone;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1, 0)), f.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), f.x), f.y);
}
float fbm(vec2 p) { float v = 0.0, a = 0.5; for (int i = 0; i < 5; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; } return v; }

// Engraved line of the given darkness (0 light .. 1 dark): 1 inside the ink line.
float engrave(float coord, float dark) {
  float w = clamp(dark, 0.0, 1.0) * 0.46;
  return 1.0 - smoothstep(w - 0.06, w + 0.02, abs(fract(coord) - 0.5) * 1.0 + 0.0);
}

// A soft read of a mask: the canvas blur of large shapes comes out blocky in
// some browsers, so masks are read from a smaller mip level (about 6 px of
// smoothing at a 720 px plate) before any thresholding.
vec4 soft(sampler2D t, vec2 uv) { return texture(t, uv); }

void main() {
  vec2 uv = vec2(vUv.x, 1.0 - vUv.y);
  vec2 c = uv - vec2(0.5, 0.49);
  // The oval window of the brass mat.
  float e = length(c / vec2(0.405, 0.465));

  vec4 mask = soft(uMask, uv);
  vec4 lightL = soft(uLight, uv);
  vec4 ink = texture(uInk, uv);
  float face = mask.r, coat = mask.b, crown = lightL.g;

  // Surface direction from the slope of the face height; light from the upper left.
  // Measured over a wide step and two scales: the mask is 8-bit, and a narrow
  // difference turns its quantisation into visible stair-steps.
  float px = 8.0 / uSize, lod = 0.0;
  float hx = textureLod(uMask, uv + vec2(px, 0.0), lod).r - textureLod(uMask, uv - vec2(px, 0.0), lod).r;
  float hy = textureLod(uMask, uv + vec2(0.0, px), lod).r - textureLod(uMask, uv - vec2(0.0, px), lod).r;
  vec3 n = normalize(vec3(-hx * 4.5, -hy * 4.5, 1.0));
  float lambert = clamp(dot(n, normalize(vec3(-0.55, -0.65, 0.75))), 0.0, 1.0);

  // Tone, 0 dark .. 1 light: studio background, coat, crown, lit face.
  float bg = 0.56 + 0.16 * (1.0 - smoothstep(0.0, 0.55, length(c - vec2(0.0, -0.06)))); // soft halo behind the head
  float faceTone = 0.2 + 0.62 * lambert - mask.g * 0.38 + lightL.r * 0.16;
  float tone = bg;
  tone = mix(tone, 0.16 + 0.12 * (1.0 - uv.y), coat);
  tone = mix(tone, uCrownTone, crown * (1.0 - face));
  tone = mix(tone, faceTone, smoothstep(0.08, 0.6, face));
  tone = clamp(tone, 0.0, 1.0);

  // Engraving: horizontal lines that bend over the face's curve, thicker in shadow,
  // crossed with a second set in the deepest shadows.
  float lines = uv.y * uSize * 0.30 + ((hx + hy) * 1.2 + sin(uv.x * 7.0) * 0.9) * smoothstep(0.1, 0.7, face);
  float dark = 1.0 - tone;
  float ink1 = engrave(lines, dark * 1.05);
  float cross = engrave((uv.x + uv.y) * uSize * 0.21, smoothstep(0.6, 0.9, dark) * 0.7 * smoothstep(0.2, 0.6, face));
  float inked = max(ink1, cross);

  // Silver positive: continuous tone, as a real daguerreotype is. The
  // engraving survives only as a faint texture over the sitter, strongest in
  // the shadows, so the face reads as a photograph rather than as scanlines.
  vec3 silverHi = vec3(0.86, 0.84, 0.79), silverLo = vec3(0.13, 0.11, 0.09);
  vec3 smoothTone = mix(silverLo, silverHi, smoothstep(0.02, 0.98, tone)) + (fbm(uv * 3.0) - 0.5) * 0.04;
  float sitter = smoothstep(0.0, 0.6, clamp(face + coat + crown, 0.0, 1.0));
  vec3 image = smoothTone;
  image = mix(image, vec3(0.10, 0.08, 0.06), ink.a * 0.85);

  // The flush: a warm wave travelling forehead to chin with each heartbeat.
  float faceV = clamp((uv.y - uFaceTop) / max(0.01, uFaceBottom - uFaceTop), 0.0, 1.0);
  float band = exp(-pow(faceV - uTravel, 2.0) / 0.09);
  float flushAmt = uFlush * smoothstep(0.05, 0.5, face) * (0.3 + 0.7 * band) * mix(1.0, 0.7, uGentle);
  // The pulse is mostly light, with only a hint of warmth: a brightening that
  // reads on any skin tone and on a silver plate, rather than "rosy cheeks".
  vec3 flushed = image * vec3(1.24, 1.14, 1.06) + vec3(0.06, 0.045, 0.025);
  image = mix(image, flushed, flushAmt);

  // Bare plate (before development): cool silver, tarnish creeping from the edge.
  vec3 bare = mix(vec3(0.80, 0.79, 0.75), vec3(0.52, 0.50, 0.47), smoothstep(0.1, 1.0, e));
  float tarnish = smoothstep(0.55, 1.0, e + (fbm(uv * 6.0) - 0.5) * 0.35);
  vec3 tarnishCol = vec3(0.38, 0.28, 0.19);
  bare = mix(bare, tarnishCol, tarnish * 0.6);

  // Development: grain first, image after.
  float grainSeed = uGentle > 0.5 ? 0.0 : floor(uTime * 12.0);
  float g = hash(uv * uSize + grainSeed);
  float dev = smoothstep(g * 0.6, g * 0.6 + 0.4, uDev);
  vec3 col = mix(bare, image, dev);
  col = mix(col, col * 0.8 + tarnishCol * 0.25, tarnish * 0.5);
  // Iridescent bloom just inside the mat, as on real plates.
  col += vec3(0.03, -0.005, 0.035) * smoothstep(0.86, 0.98, e) * (1.0 - smoothstep(0.98, 1.0, e));
  col += (g - 0.5) * 0.05;
  col *= 1.0 - smoothstep(0.55, 1.0, e) * 0.35;
  col = mix(col, col * 0.22, uCapped);

  // Brass mat: stamped border, lit bevel at the window, worn gilt.
  vec3 brass = vec3(0.60, 0.46, 0.22) * (0.75 + 0.5 * fbm(uv * 40.0));
  float ang = atan(c.y, c.x);
  float stamp = smoothstep(0.4, 0.9, sin(ang * 120.0)) * smoothstep(1.06, 1.07, e) * (1.0 - smoothstep(1.10, 1.11, e));
  brass *= 1.0 - stamp * 0.22;
  float bevel = smoothstep(1.0, 1.0, e) * (1.0 - smoothstep(1.0, 1.045, e));
  float bevelLight = 0.5 + 0.5 * dot(normalize(c), normalize(vec2(0.6, 0.75)));
  brass = mix(brass, brass * (0.55 + 0.9 * bevelLight), bevel);
  brass *= 1.0 - smoothstep(0.3, 0.75, length(uv - 0.5)) * 0.45;
  float inMat = smoothstep(0.995, 1.005, e);
  outColor = vec4(mix(col, brass, inMat), 1.0);
}`;

export class PlateRenderer {
  readonly canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private prog: WebGLProgram;
  private inkCanvas: HTMLCanvasElement;
  private maskCanvas: HTMLCanvasElement;
  private lightCanvas: HTMLCanvasElement;
  private inkTex: WebGLTexture;
  private maskTex: WebGLTexture;
  private lightTex: WebGLTexture;
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
    for (const n of ['uInk', 'uMask', 'uLight', 'uFlush', 'uTravel', 'uDev', 'uTime', 'uCapped', 'uGentle', 'uFaceTop', 'uFaceBottom', 'uSize', 'uCrownTone']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    this.inkCanvas = document.createElement('canvas');
    this.maskCanvas = document.createElement('canvas');
    this.lightCanvas = document.createElement('canvas');
    this.inkCanvas.width = size; this.inkCanvas.height = size;
    // The soft layers are drawn small and stretched by the GPU: a small canvas
    // blur is smooth, while a large one comes out blocky in Chromium.
    for (const c of [this.maskCanvas, this.lightCanvas]) { c.width = Math.ceil(size / SOFT); c.height = Math.ceil(size / SOFT); }
    this.inkTex = makeTex(gl);
    this.maskTex = makeTex(gl);
    this.lightTex = makeTex(gl);
  }

  /** Where the face sits on the plate, in pixels. */
  private place(p: Point, breath: number, lift = 1): Point {
    const s = this.size, box = s * 0.33;
    return { x: s * 0.5 + (p.x - 0.5) * box, y: s * 0.40 + (p.y - 0.5) * box - breath * s * 0.006 * lift };
  }

  render(f: FrameState): void {
    const s = this.size;
    const ink = this.inkCanvas.getContext('2d')!;
    const mask = this.maskCanvas.getContext('2d')!;
    const light = this.lightCanvas.getContext('2d')!;
    ink.clearRect(0, 0, s, s);
    // The soft layers are opaque black underneath: values live in the colour
    // channels. On a transparent canvas the faded edges are stored with low
    // alpha, and un-premultiplying them on upload snaps them to full colour in
    // coarse steps, which drew stair-stepped, hard-edged masks.
    for (const c of [mask, light]) {
      c.resetTransform(); c.globalCompositeOperation = 'source-over';
      c.fillStyle = '#000'; c.fillRect(0, 0, c.canvas.width, c.canvas.height);
      c.setTransform(1 / SOFT, 0, 0, 1 / SOFT, 0, 0);
    }

    let faceTop = 0.2, faceBottom = 0.6;
    if (f.face) {
      const P = (i: number) => this.place(f.face![i], f.breath);
      faceTop = P(FOREHEAD).y / s; faceBottom = P(CHIN).y / s;
      this.drawBust(mask, f);
      if (f.topologyOk) this.drawCrown(f.head === 'bare' ? mask : light, f, P);

      // Height: the face oval, heavily blurred, reads as a dome to the shader.
      mask.filter = `blur(${(s * 0.028 / SOFT).toFixed(1)}px)`;
      mask.fillStyle = 'rgb(255,0,0)';
      polygon(mask, (f.topologyOk ? FACE_OVAL : hullIdx(f.face)).map(P), true);
      mask.fill();
      if (f.topologyOk) { this.drawFeatures(mask, light, P); this.drawLikeness(mask, light, ink, P); }
      mask.filter = 'none';

      // Ink: light engraved contours, irises with a catchlight, sparse stipple.
      ink.lineCap = 'round'; ink.lineJoin = 'round';
      if (f.topologyOk) {
        for (const c of CONTOURS) {
          if (c.idx === LIPS_INNER) continue; // drawn below as the closed lip line
          // Nose and face outline are shown by tone (see drawLikeness); a drawn line
          // there reads as a cartoon, so they stay faint.
          const faint = c.idx === FACE_OVAL || c.idx === LIPS_OUTER || c.idx === NOSE_BRIDGE || c.idx === NOSE_BASE;
          ink.strokeStyle = faint ? 'rgba(20,14,8,0.12)' : 'rgba(20,14,8,0.55)';
          ink.lineWidth = c.weight * (s / 760);
          polygon(ink, c.idx.map(P), c.closed);
          ink.stroke();
        }
        // The line where the lips meet, so a still mouth reads as closed and calm.
        ink.strokeStyle = 'rgba(20,14,8,0.7)';
        ink.lineWidth = 1.3 * (s / 760);
        polygon(ink, LIP_LINE.map(P), false);
        ink.stroke();
        this.drawIrises(ink, P);
      }
      ink.fillStyle = 'rgba(0,0,0,0.18)';
      const dot = Math.max(0.6, s / 1100);
      for (const q of f.face) { const p = this.place(q, f.breath); ink.fillRect(p.x - dot / 2, p.y - dot / 2, dot, dot); }

      // Blink ghosts: faint doubled eyes where the sitter blinked.
      ink.strokeStyle = 'rgba(0,0,0,0.2)';
      ink.lineWidth = s / 900;
      for (const g of f.ghosts) { polygon(ink, g.map((q) => this.place(q, f.breath)), true); ink.stroke(); }

      // The smile that broke through, if one was held.
      if (f.smile) {
        ink.strokeStyle = 'rgba(0,0,0,0.3)';
        polygon(ink, f.smile.map((q) => this.place(q, f.breath)), true);
        ink.stroke();
      }
    }

    // The maker's seal sits on the brass mat, bottom right.
    if (f.seal) drawSeal(ink, f.seal.params, s * 0.875, s * 0.885, s * 0.055, f.seal.progress, 'rgba(40,26,8,0.85)');

    const gl = this.gl;
    gl.viewport(0, 0, s, s);
    upload(gl, this.inkTex, this.inkCanvas, 0);
    upload(gl, this.maskTex, this.maskCanvas, 1);
    upload(gl, this.lightTex, this.lightCanvas, 2);
    gl.uniform1i(this.u.uInk, 0);
    gl.uniform1i(this.u.uMask, 1);
    gl.uniform1i(this.u.uLight, 2);
    gl.uniform1f(this.u.uFlush, f.flush);
    gl.uniform1f(this.u.uTravel, f.travel);
    gl.uniform1f(this.u.uDev, f.development);
    gl.uniform1f(this.u.uTime, f.time);
    gl.uniform1f(this.u.uCapped, f.capped ? 1 : 0);
    gl.uniform1f(this.u.uGentle, f.gentle ? 1 : 0);
    gl.uniform1f(this.u.uFaceTop, faceTop);
    gl.uniform1f(this.u.uFaceBottom, faceBottom);
    gl.uniform1f(this.u.uSize, s);
    gl.uniform1f(this.u.uCrownTone, f.head === 'dark' ? 0.10 : 0.30);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  /** Shadows (green) in the eye sockets, under the brows, nose, lower lip and jaw; highlights (light red). */
  private drawFeatures(mask: CanvasRenderingContext2D, light: CanvasRenderingContext2D, P: (i: number) => Point): void {
    const s = this.size;
    const blob = (ctx: CanvasRenderingContext2D, cx: number, cy: number, rx: number, ry: number, style: string) => {
      ctx.fillStyle = style; ctx.beginPath(); ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    };
    const centre = (idx: number[]) => {
      const pts = idx.map(P);
      return { x: pts.reduce((a, p) => a + p.x, 0) / pts.length, y: pts.reduce((a, p) => a + p.y, 0) / pts.length };
    };
    const faceW = Math.abs(P(454).x - P(234).x);
    mask.globalCompositeOperation = 'lighter';
    mask.filter = `blur(${(s * 0.012 / SOFT).toFixed(1)}px)`;
    for (const [eye, brow] of [[RIGHT_EYE, RIGHT_BROW], [LEFT_EYE, LEFT_BROW]] as const) {
      const ec = centre(eye), bc = centre(brow);
      blob(mask, ec.x, (ec.y * 2 + bc.y) / 3, faceW * 0.13, faceW * 0.07, 'rgb(0,175,0)'); // socket
    }
    const nb = centre(NOSE_BASE), nt = P(NOSE_TIP);
    blob(mask, nb.x + faceW * 0.03, nb.y + faceW * 0.03, faceW * 0.13, faceW * 0.045, 'rgb(0,185,0)'); // under the nose
    const lo = P(17);
    blob(mask, lo.x, lo.y + faceW * 0.05, faceW * 0.14, faceW * 0.04, 'rgb(0,150,0)'); // under the lower lip
    const chin = P(CHIN);
    blob(mask, chin.x, chin.y + faceW * 0.06, faceW * 0.2, faceW * 0.05, 'rgb(0,170,0)'); // shadow under the chin
    blob(mask, P(454).x - faceW * 0.1, P(454).y + faceW * 0.05, faceW * 0.16, faceW * 0.38, 'rgb(0,80,0)'); // shadow side, away from the light (upper left)
    mask.globalCompositeOperation = 'source-over';

    light.filter = `blur(${(s * 0.012 / SOFT).toFixed(1)}px)`;
    blob(light, nt.x - faceW * 0.02, (P(6).y + nt.y) / 2, faceW * 0.035, faceW * 0.16, 'rgb(200,0,0)'); // nose bridge
    blob(light, P(10).x - faceW * 0.06, P(10).y + faceW * 0.14, faceW * 0.22, faceW * 0.09, 'rgb(160,0,0)'); // forehead
    blob(light, P(116).x, P(116).y + faceW * 0.03, faceW * 0.06, faceW * 0.035, 'rgb(80,0,0)'); // lit cheekbone
    light.filter = 'none';
  }

  /**
   * What makes the plate look like this sitter rather than anyone: tone and
   * line taken from their own landmarks. Lips are toned by their real outline
   * (upper lip darker, a highlight on the lower), the nose gets a shadow down
   * its far side and nostrils where the sitter's are, the brows are filled at
   * their real thickness, the upper eyelid is drawn as a line, and the jaw
   * casts a shadow that follows the sitter's jawline.
   */
  private drawLikeness(mask: CanvasRenderingContext2D, light: CanvasRenderingContext2D, ink: CanvasRenderingContext2D, P: (i: number) => Point): void {
    const s = this.size;
    const faceW = Math.abs(P(454).x - P(234).x);
    const path = (ctx: CanvasRenderingContext2D, idx: number[], closed: boolean, dx = 0, dy = 0) => {
      ctx.beginPath();
      idx.forEach((i, k) => { const q = P(i); if (k === 0) ctx.moveTo(q.x + dx, q.y + dy); else ctx.lineTo(q.x + dx, q.y + dy); });
      if (closed) ctx.closePath();
    };
    // Light comes from the upper left of the plate; the far side is the right.
    const farSign = P(358).x > P(129).x ? 1 : -1;

    mask.globalCompositeOperation = 'lighter';
    mask.filter = `blur(${(s * 0.004 / SOFT).toFixed(1)}px)`;
    // Lips: the sitter's own outline, upper lip in shadow.
    mask.fillStyle = 'rgb(0,70,0)'; path(mask, LIPS_OUTER, true); mask.fill();
    mask.fillStyle = 'rgb(0,60,0)'; path(mask, UPPER_LIP, true); mask.fill();
    // Nose: a shadow down the far side of the bridge to the nostril wing.
    mask.filter = `blur(${(s * 0.008 / SOFT).toFixed(1)}px)`;
    mask.strokeStyle = 'rgb(0,150,0)'; mask.lineWidth = faceW * 0.07; mask.lineCap = 'round';
    path(mask, [168, 6, 197, 195, 5], false, farSign * faceW * 0.05, 0); mask.stroke();
    // Jaw: the shadow under the sitter's jawline onto the neck.
    mask.filter = `blur(${(s * 0.012 / SOFT).toFixed(1)}px)`;
    mask.strokeStyle = 'rgb(0,120,0)'; mask.lineWidth = faceW * 0.09;
    path(mask, JAWLINE, false, 0, faceW * 0.05); mask.stroke();
    mask.globalCompositeOperation = 'source-over';
    mask.filter = 'none';

    // A highlight on the lower lip.
    const lo = P(17), li = P(14);
    light.filter = `blur(${(s * 0.004 / SOFT).toFixed(1)}px)`;
    light.fillStyle = 'rgb(120,0,0)';
    light.beginPath(); light.ellipse((lo.x + li.x) / 2 - faceW * 0.02, (lo.y + li.y) / 2, faceW * 0.07, faceW * 0.015, 0, 0, Math.PI * 2); light.fill();
    light.filter = 'none';

    // Ink: brows at their real thickness, the upper eyelids, the nostrils.
    ink.filter = `blur(${(s / 600).toFixed(1)}px)`;
    ink.fillStyle = 'rgba(25,18,10,0.34)';
    for (const brow of [RIGHT_BROW, LEFT_BROW]) { path(ink, brow, true); ink.fill(); }
    ink.filter = 'none';
    ink.strokeStyle = 'rgba(20,14,8,0.8)'; ink.lineWidth = 2.2 * (s / 760); ink.lineCap = 'round';
    for (const lid of [RIGHT_UPPER_LID, LEFT_UPPER_LID]) { path(ink, lid, false); ink.stroke(); }
    ink.fillStyle = 'rgba(20,14,8,0.5)';
    for (const [a, b] of [[98, 2], [2, 327]] as const) {
      const qa = P(a), qb = P(b);
      ink.beginPath(); ink.ellipse((qa.x + qb.x) / 2, (qa.y + qb.y) / 2 - faceW * 0.008, faceW * 0.022, faceW * 0.011, 0, 0, Math.PI * 2); ink.fill();
    }
  }

  /**
   * The top of the head above the brow, so the head does not end at the hairline.
   * Hair ('soft', 'dark') is a shaded crown on the light layer; a bare head is a
   * lower dome on the height layer, so the shader lights it like the face.
   */
  private drawCrown(layer: CanvasRenderingContext2D, f: FrameState, P: (i: number) => Point): void {
    const s = this.size, bare = f.head === 'bare';
    const top = P(FOREHEAD), l = P(234), r = P(454), chin = P(CHIN);
    const w = Math.abs(r.x - l.x), h = Math.abs(chin.y - top.y);
    const light = layer;
    light.filter = `blur(${(s * (bare ? 0.03 : 0.045) / SOFT).toFixed(1)}px)`;
    light.fillStyle = bare ? 'rgb(210,0,0)' : 'rgb(0,255,0)';
    light.beginPath();
    if (bare) light.ellipse((l.x + r.x) / 2, top.y + h * 0.18, w * 0.47, h * 0.40, 0, Math.PI, Math.PI * 2);
    else light.ellipse((l.x + r.x) / 2, top.y + h * 0.12, w * 0.58, h * 0.42, 0, Math.PI, Math.PI * 2);
    light.fill();
    light.filter = 'none';
  }

  /** Irises as dark discs with a small catchlight, the life of a portrait. */
  private drawIrises(ink: CanvasRenderingContext2D, P: (i: number) => Point): void {
    for (const iris of [RIGHT_IRIS, LEFT_IRIS]) {
      const c = P(iris[0]);
      const r = Math.max(...iris.slice(1).map((i) => Math.hypot(P(i).x - c.x, P(i).y - c.y))) * 0.9;
      ink.fillStyle = 'rgba(15,10,6,0.62)';
      ink.beginPath(); ink.arc(c.x, c.y, r, 0, Math.PI * 2); ink.fill();
      ink.fillStyle = 'rgba(15,10,6,0.85)';
      ink.beginPath(); ink.arc(c.x, c.y, r * 0.45, 0, Math.PI * 2); ink.fill();
      ink.clearRect(c.x - r * 0.45, c.y - r * 0.5, r * 0.3, r * 0.3); // catchlight from the upper left
    }
  }

  /** Neck and coat as soft data (no outline): a dark garment that breathes. */
  private drawBust(mask: CanvasRenderingContext2D, f: FrameState): void {
    const s = this.size;
    const lift = f.breath * s * 0.014;
    const chin = this.place(f.face![CHIN], f.breath);
    const faceW = Math.abs(this.place(f.face![454], f.breath).x - this.place(f.face![234], f.breath).x) || s * 0.25;
    const neckW = faceW * 0.3, shoulderY = chin.y + faceW * 0.42 - lift, cx = chin.x;
    const path = new Path2D();
    path.moveTo(cx - neckW, chin.y - faceW * 0.15);
    path.lineTo(cx - neckW, shoulderY - faceW * 0.06);
    path.bezierCurveTo(cx - faceW * 0.62, shoulderY, cx - faceW * 1.25, shoulderY + faceW * 0.05, cx - faceW * 1.55, s * 1.05);
    path.lineTo(cx + faceW * 1.55, s * 1.05);
    path.bezierCurveTo(cx + faceW * 1.25, shoulderY + faceW * 0.05, cx + faceW * 0.62, shoulderY, cx + neckW, shoulderY - faceW * 0.06);
    path.lineTo(cx + neckW, chin.y - faceW * 0.15);
    mask.filter = `blur(${(s * 0.02 / SOFT).toFixed(1)}px)`;
    mask.fillStyle = 'rgb(0,0,230)';
    mask.fill(path);
    mask.filter = 'none';
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
    gl.deleteTexture(this.inkTex); gl.deleteTexture(this.maskTex); gl.deleteTexture(this.lightTex); gl.deleteProgram(this.prog);
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
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return t;
}

function upload(gl: WebGL2RenderingContext, tex: WebGLTexture, src: HTMLCanvasElement, unit: number): void {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  // Smaller, smoothed copies: the shader reads soft masks from these cheaply.
  gl.generateMipmap(gl.TEXTURE_2D);
}
