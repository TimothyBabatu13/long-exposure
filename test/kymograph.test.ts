import { describe, expect, it } from 'vitest';
import { LaneScale } from '../src/renderer/ui/kymograph';

const wave = (amp: number, n = 60) => Array.from({ length: n }, (_, i) => amp * Math.sin(i / 3));

describe('kymograph lane scale', () => {
  it('needs a few samples before drawing', () => {
    expect(new LaneScale().update([1, 2, 3], 0)).toBeNull();
  });

  it('grows at once for a bigger signal', () => {
    const s = new LaneScale();
    const small = s.update(wave(1), 0)!.span;
    expect(s.update(wave(4), 1)!.span).toBeCloseTo(small * 4, 1);
  });

  it('keeps a held breath small instead of blowing it up', () => {
    const s = new LaneScale();
    const breathing = s.update(wave(1), 0)!.span;
    // Two seconds into a hold the trace is nearly flat; the scale barely shrinks,
    // so the drawn line stays near the middle of the lane.
    const held = s.update(wave(0.02), 2)!.span;
    expect(held).toBeGreaterThan(breathing * 0.85);
  });
});
