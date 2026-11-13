// Framing guide: where the sitter's face is in the camera's view, drawn as an
// outline from the SDK's face landmarks. The SDK holds the camera, so the
// studio cannot show a mirror; this shows position without any camera pixels.
import type { Point } from '../../shared/types';
import { FACE_OVAL } from '../render/landmarks';

export interface Frame { w: number; h: number }

/**
 * The SDK does not report its capture size, so infer it from the furthest the
 * landmarks have reached this sitting: the smallest usual webcam size that fits.
 */
export function frameFor(maxX: number, maxY: number): Frame {
  for (const f of [{ w: 640, h: 480 }, { w: 1280, h: 720 }, { w: 1920, h: 1080 }]) {
    if (maxX <= f.w && maxY <= f.h) return f;
  }
  return { w: Math.ceil(maxX), h: Math.ceil(maxY) };
}

/** Target zone in the frame (fractions): face centred, high enough that the chest shows. */
// Tuned on recorded sittings: the SDK accepted face centres from about 0.24 to 0.42
// of the frame height, and asked for "more of the chest" when the face sat lower.
export const TARGET = { cx: 0.5, cy: 0.33, rx: 0.12, ry: 0.11, minH: 0.24, maxH: 0.55 };

export interface Placement {
  /** Face centre and height as fractions of the frame, mirrored horizontally (as the sitter sees themself). */
  cx: number; cy: number; h: number;
  ok: boolean;
  /** One short instruction, or '' when the face is well placed. */
  advice: string;
}

export function placement(points: readonly Point[], frame: Frame): Placement | null {
  if (points.length < 3) return null;
  let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x; if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y; if (p.y > y1) y1 = p.y;
  }
  const cx = 1 - (x0 + x1) / 2 / frame.w, cy = (y0 + y1) / 2 / frame.h, h = (y1 - y0) / frame.h;
  const dx = (cx - TARGET.cx) / TARGET.rx, dy = (cy - TARGET.cy) / TARGET.ry;
  let advice = '';
  if (h < TARGET.minH) advice = 'Move a little closer';
  else if (h > TARGET.maxH) advice = 'Move back a little';
  else if (Math.abs(dy) > 1 && Math.abs(dy) >= Math.abs(dx)) advice = dy > 0 ? 'Move up, or tilt the screen down' : 'Move down, or tilt the screen up';
  else if (Math.abs(dx) > 1) advice = dx > 0 ? 'Move to your left' : 'Move to your right';
  return { cx, cy, h, ok: advice === '', advice };
}

/**
 * The target as a head-and-shoulders outline: an egg-shaped face (wider brow,
 * narrower chin) centred on (cx, cy) with height fh, then neck and shoulders
 * running to the bottom of the frame, so the sitter sees the chest should show.
 */
function sitterSilhouette(ctx: CanvasRenderingContext2D, cx: number, cy: number, fh: number, H: number): void {
  const hw = fh * 0.43, top = cy - fh / 2, chin = cy + fh / 2;
  ctx.beginPath();
  ctx.moveTo(cx, top);
  ctx.bezierCurveTo(cx + hw * 1.3, top, cx + hw * 1.05, cy + fh * 0.2, cx + hw * 0.55, cy + fh * 0.42);
  ctx.quadraticCurveTo(cx + hw * 0.3, chin, cx, chin);
  ctx.quadraticCurveTo(cx - hw * 0.3, chin, cx - hw * 0.55, cy + fh * 0.42);
  ctx.bezierCurveTo(cx - hw * 1.05, cy + fh * 0.2, cx - hw * 1.3, top, cx, top);
  // Neck and shoulders.
  const neck = hw * 0.45, sy = chin + fh * 0.22, sw = hw * 2.9;
  for (const d of [1, -1]) {
    ctx.moveTo(cx + d * neck, chin - fh * 0.04);
    ctx.lineTo(cx + d * neck, sy - fh * 0.06);
    ctx.quadraticCurveTo(cx + d * neck * 1.4, sy, cx + d * sw * 0.7, sy + fh * 0.03);
    ctx.quadraticCurveTo(cx + d * sw, sy + fh * 0.08, cx + d * sw * 1.02, H);
  }
}

/** Draws the guide: frame, target silhouette, and the face outline (mirrored). */
export function drawGuide(ctx: CanvasRenderingContext2D, points: readonly Point[] | null, frame: Frame | null, p: Placement | null): void {
  const { width: W, height: H } = ctx.canvas;
  ctx.clearRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(217,203,176,0.35)'; ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
  // Target.
  ctx.setLineDash([4, 4]);
  ctx.strokeStyle = p?.ok ? 'rgba(160,200,140,0.9)' : 'rgba(217,203,176,0.6)';
  sitterSilhouette(ctx, TARGET.cx * W, TARGET.cy * H, ((TARGET.minH + TARGET.maxH) / 2) * H, H);
  ctx.stroke();
  ctx.setLineDash([]);
  if (!points || !frame || points.length < 468) {
    if (points && frame && p) { // no topology: a dot at the face centre
      ctx.fillStyle = p.ok ? 'rgba(160,200,140,0.9)' : 'rgba(230,170,90,0.9)';
      ctx.beginPath(); ctx.arc(p.cx * W, p.cy * H, 5, 0, Math.PI * 2); ctx.fill();
    }
    return;
  }
  ctx.strokeStyle = p?.ok ? 'rgba(160,200,140,0.95)' : 'rgba(230,170,90,0.95)';
  ctx.lineWidth = 2;
  ctx.beginPath();
  FACE_OVAL.forEach((i, k) => {
    const x = (1 - points[i].x / frame.w) * W, y = (points[i].y / frame.h) * H;
    if (k === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  });
  ctx.closePath();
  ctx.stroke();
}
