// Synthetic signals for development and the web demo. Clearly fake, but
// shaped like the real thing: chunked delivery, a pulse waveform with
// breathing-linked variation, and SDK-like warm-up times (pulse ~12 s,
// breathing ~30 s, HRV ~60 s).
import type { Point, SignalPacket, Sample } from '../../shared/types';
import {
  FACE_OVAL, LEFT_BROW, LEFT_EYE, LEFT_IRIS, LIPS_INNER, LIPS_OUTER, NOSE_BASE, NOSE_BRIDGE,
  RIGHT_BROW, RIGHT_EYE, RIGHT_IRIS, FOREHEAD, CHIN, NOSE_TIP,
} from '../render/landmarks';

const HR = 66;
const BREATH_P = 60 / 14;
const FS = 30;

function hash(n: number): number {
  const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

/** Cardiac phase (in beats) at elapsed time t, with breath-linked variation. */
function cardiacPhase(t: number): number {
  return (HR / 60) * t - (3 / 60) * Math.cos((2 * Math.PI * t) / BREATH_P) * (BREATH_P / (2 * Math.PI));
}

function pulseWave(t: number): number {
  const f = cardiacPhase(t) % 1;
  return Math.exp(-(((f - 0.15) / 0.07) ** 2)) + 0.35 * Math.exp(-(((f - 0.45) / 0.1) ** 2)) + (hash(t * 1000) - 0.5) * 0.08;
}

function ring(cx: number, cy: number, rx: number, ry: number, n: number, a0 = 0, sweep = 2 * Math.PI): Point[] {
  return Array.from({ length: n }, (_, i) => {
    const a = a0 + (sweep * i) / (sweep === 2 * Math.PI ? n : n - 1);
    return { x: cx + rx * Math.cos(a), y: cy + ry * Math.sin(a) };
  });
}

let baseFace: Point[] | null = null;

/** A plausible 478-point face in a 640x480 frame, built from the contour sets. */
export function syntheticFace(): Point[] {
  if (baseFace) return baseFace;
  const p: Point[] = Array.from({ length: 478 }, () => ({ x: 320, y: 250 }));
  const put = (idx: number[], pts: Point[]) => idx.forEach((i, k) => { p[i] = pts[k]; });
  // Oval: index 10 is the top of the forehead, then clockwise around the face.
  put(FACE_OVAL, ring(320, 250, 118, 158, FACE_OVAL.length, -Math.PI / 2));
  put(RIGHT_EYE, ring(272, 222, 24, 9, RIGHT_EYE.length, Math.PI));
  put(LEFT_EYE, ring(368, 222, 24, 9, LEFT_EYE.length, 0));
  put(RIGHT_BROW, ring(270, 205, 34, 12, RIGHT_BROW.length, Math.PI * 1.05, Math.PI * 0.9));
  put(LEFT_BROW, ring(370, 205, 34, 12, LEFT_BROW.length, Math.PI * 1.95, -Math.PI * 0.9));
  put(LIPS_OUTER, ring(320, 330, 40, 13, LIPS_OUTER.length, Math.PI));
  put(LIPS_INNER, ring(320, 330, 32, 4, LIPS_INNER.length, Math.PI));
  put(NOSE_BRIDGE, NOSE_BRIDGE.map((_, k) => ({ x: 320, y: 215 + k * 11 })));
  put(NOSE_BASE, ring(320, 290, 22, 6, NOSE_BASE.length, Math.PI, -Math.PI));
  put(RIGHT_IRIS, [{ x: 272, y: 222 }, ...ring(272, 222, 7, 7, 4)]);
  put(LEFT_IRIS, [{ x: 368, y: 222 }, ...ring(368, 222, 7, 7, 4)]);
  p[FOREHEAD] = { x: 320, y: 92 }; p[CHIN] = { x: 320, y: 408 }; p[NOSE_TIP] = { x: 320, y: 285 };
  // Remaining points scattered inside the oval.
  const used = new Set([...FACE_OVAL, ...RIGHT_EYE, ...LEFT_EYE, ...RIGHT_BROW, ...LEFT_BROW, ...LIPS_OUTER,
    ...LIPS_INNER, ...NOSE_BRIDGE, ...NOSE_BASE, ...RIGHT_IRIS, ...LEFT_IRIS]);
  for (let i = 0; i < 478; i++) {
    if (used.has(i)) continue;
    const a = hash(i) * 2 * Math.PI, r = Math.sqrt(hash(i + 999)) * 0.92;
    p[i] = { x: 320 + 118 * r * Math.cos(a), y: 250 + 158 * r * Math.sin(a) };
  }
  // Seat the face as a well-framed sitter would be: about 40 % of the frame
  // height, a third of the way down, so the framing guide reads "well placed".
  // (The plate normalises the face, so this does not change the portrait.)
  baseFace = p.map((q) => ({ x: 320 + (q.x - 320) * 0.6, y: 160 + (q.y - 250) * 0.6 }));
  return baseFace;
}

export function syntheticPacket(t0: number, from: number, to: number): SignalPacket {
  const e = to - t0;
  const pulseTrace: Sample[] = [];
  const breathTrace: Sample[] = [];
  for (let t = Math.ceil(from * FS) / FS; t < to; t += 1 / FS) {
    pulseTrace.push({ t, v: pulseWave(t - t0) });
    breathTrace.push({ t, v: Math.sin((2 * Math.PI * (t - t0)) / BREATH_P) + (hash(t * 77) - 0.5) * 0.05 });
  }
  const talkingNow = e > 40 && e < 43; // the synthetic sitter speaks once, to show the lens cap
  const blinkNow = (e % 4.7) < 0.15 && e > 3;
  const jitter = (hash(Math.floor(e * 10)) - 0.5) * 0.6;
  const breathLift = Math.sin((2 * Math.PI * e) / BREATH_P) * 1.2;
  const face = syntheticFace().map((q) => ({ x: q.x + jitter, y: q.y + jitter * 0.5 - breathLift }));
  // Close the eyelids during a blink.
  if (blinkNow) for (const idx of [RIGHT_EYE, LEFT_EYE]) {
    const cy = idx === RIGHT_EYE ? 222 : 222;
    for (const i of idx) face[i] = { x: face[i].x, y: cy + (face[i].y - cy) * 0.1 };
  }
  return {
    arrival: to,
    pulseTrace,
    breathTrace,
    pulseRate: e > 12 ? { bpm: HR + Math.sin(e / 9) * 1.5, confidence: 72, stable: true, t: to } : undefined,
    breathRate: e > 30 ? { rpm: 14, confidence: 60, stable: true, t: to } : undefined,
    hrv: e > 60 ? { rmssd: 42, sdnn: 51, meanNn: 909, confidence: 65, stable: true, t: to } : undefined,
    blinking: [{ detected: blinkNow, t: to }],
    talking: [{ detected: talkingNow, t: to }],
    landmarks: { points: face, stable: true, t: to },
    smile: { confidence: e > 48 && e < 53 ? 80 : 5, t: to },
  };
}
