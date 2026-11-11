// Contour index sets for the 478-point face mesh topology (468 face points
// plus 10 iris points), as published with MediaPipe Face Mesh (Apache-2.0).
// ASSUMPTION, checked by the day-1 spike: SmartSpectra's 478 landmarks use
// this topology. `topologyLooksRight()` guards the assumption at runtime; if
// it fails, the renderer falls back to a topology-free stipple portrait.
import type { Point } from '../../shared/types';

export const FACE_OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377,
  152, 148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109];
export const LIPS_OUTER = [61, 146, 91, 181, 84, 17, 314, 405, 321, 375, 291, 409, 270, 269, 267, 0, 37, 39, 40, 185];
export const LIPS_INNER = [78, 95, 88, 178, 87, 14, 317, 402, 318, 324, 308, 415, 310, 311, 312, 13, 82, 81, 80, 191];
export const RIGHT_EYE = [33, 7, 163, 144, 145, 153, 154, 155, 133, 173, 157, 158, 159, 160, 161, 246];
export const LEFT_EYE = [263, 249, 390, 373, 374, 380, 381, 382, 362, 398, 384, 385, 386, 387, 388, 466];
export const RIGHT_BROW = [46, 53, 52, 65, 55, 70, 63, 105, 66, 107];
export const LEFT_BROW = [276, 283, 282, 295, 285, 300, 293, 334, 296, 336];
export const NOSE_BRIDGE = [168, 6, 197, 195, 5, 4, 1];
export const NOSE_BASE = [98, 97, 2, 326, 327];
export const RIGHT_IRIS = [468, 469, 470, 471, 472];
export const LEFT_IRIS = [473, 474, 475, 476, 477];

export const FOREHEAD = 10;
export const CHIN = 152;
export const NOSE_TIP = 1;

/** Closed contours drawn as engraved ink lines. */
export const CONTOURS: { idx: number[]; closed: boolean; weight: number }[] = [
  { idx: FACE_OVAL, closed: true, weight: 1.6 },
  { idx: RIGHT_EYE, closed: true, weight: 1.3 },
  { idx: LEFT_EYE, closed: true, weight: 1.3 },
  { idx: RIGHT_BROW, closed: false, weight: 1.8 },
  { idx: LEFT_BROW, closed: false, weight: 1.8 },
  { idx: LIPS_OUTER, closed: true, weight: 1.4 },
  { idx: LIPS_INNER, closed: true, weight: 0.9 },
  { idx: NOSE_BRIDGE, closed: false, weight: 1.0 },
  { idx: NOSE_BASE, closed: false, weight: 1.2 },
];

/**
 * Cheap sanity check that the points follow the expected topology: forehead
 * above nose tip above chin, and the oval roughly enclosing the nose tip.
 */
export function topologyLooksRight(p: Point[]): boolean {
  if (p.length < 468) return false;
  const top = p[FOREHEAD], nose = p[NOSE_TIP], chin = p[CHIN];
  if (!top || !nose || !chin) return false;
  if (!(top.y < nose.y && nose.y < chin.y)) return false;
  const xs = FACE_OVAL.map((i) => p[i].x);
  return nose.x > Math.min(...xs) && nose.x < Math.max(...xs);
}

/** Normalise points into a unit box (preserving aspect) centred on 0.5. */
export function normalise(points: Point[]): Point[] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const q of points) {
    if (q.x < minX) minX = q.x; if (q.x > maxX) maxX = q.x;
    if (q.y < minY) minY = q.y; if (q.y > maxY) maxY = q.y;
  }
  const s = Math.max(maxX - minX, maxY - minY) || 1;
  const ox = (s - (maxX - minX)) / 2, oy = (s - (maxY - minY)) / 2;
  return points.map((q) => ({ x: (q.x - minX + ox) / s, y: (q.y - minY + oy) / s }));
}

/** Exponential smoothing of a landmark set toward a new observation. */
export function smoothToward(prev: Point[] | null, next: Point[], alpha: number): Point[] {
  if (!prev || prev.length !== next.length) return next.map((q) => ({ ...q }));
  return prev.map((q, i) => ({ x: q.x + (next[i].x - q.x) * alpha, y: q.y + (next[i].y - q.y) * alpha }));
}
