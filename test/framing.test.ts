import { describe, expect, it } from 'vitest';
import { frameFor, placement } from '../src/renderer/ui/framing';

/** A face box in camera pixels, as four corner points. */
const box = (x0: number, y0: number, x1: number, y1: number) =>
  [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x0, y: y1 }, { x: x1, y: y1 }];

describe('framing guide', () => {
  it('infers the usual webcam sizes from how far landmarks reach', () => {
    expect(frameFor(500, 400)).toEqual({ w: 640, h: 480 });
    expect(frameFor(918, 657)).toEqual({ w: 1280, h: 720 });
    expect(frameFor(1500, 900)).toEqual({ w: 1920, h: 1080 });
  });

  it('accepts a face like the recorded live sitting', () => {
    // From sitting-2026-11-12b: x 540..775, y 160..425 in a 1280x720 frame.
    const p = placement(box(540, 130, 775, 400), { w: 1280, h: 720 })!;
    expect(p.ok).toBe(true);
    expect(p.advice).toBe('');
  });

  it('asks the sitter to come closer or move back', () => {
    expect(placement(box(600, 220, 680, 300), { w: 1280, h: 720 })!.advice).toBe('Move a little closer');
    expect(placement(box(400, 0, 880, 600), { w: 1280, h: 720 })!.advice).toBe('Move back a little');
  });

  it('gives directions as the sitter sees themself (mirrored)', () => {
    // Face at the camera image's left edge: the sitter is off to their own right, so they move to their left.
    const camLeft = placement(box(100, 160, 335, 425), { w: 1280, h: 720 })!;
    expect(camLeft.cx).toBeGreaterThan(0.6);
    expect(camLeft.advice).toBe('Move to your left');
    const low = placement(box(540, 380, 775, 645), { w: 1280, h: 720 })!;
    expect(low.advice).toBe('Move up, or tilt the screen down');
  });
});
