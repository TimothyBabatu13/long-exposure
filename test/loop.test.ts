import { describe, expect, it } from 'vitest';
import { breathLoop, loopLength, plateFrameAt } from '../src/renderer/render/loop';
import type { Plate, Sample } from '../src/shared/types';

/** A chest trace at `rpm` breaths per minute over `secs` seconds, with slow drift. */
const trace = (rpm: number, secs: number, drift = 0): Sample[] =>
  Array.from({ length: secs * 10 }, (_, i) => {
    const t = 1000 + i / 10;
    return { t, v: Math.sin((2 * Math.PI * rpm * (t - 1000)) / 60) + drift * (t - 1000) };
  });

const plate = (extra: Partial<Plate>): Plate => ({
  format: 'long-exposure/plate@1', createdAt: '', sitterLabel: 'x', face: [], beats: [], beatTier: 'rate',
  breathPeriod: 4, blinkTimes: [], ghosts: [], smile: null, seal: null,
  verso: { pulseBpm: 70, breathRpm: 15, rmssd: null, sdnn: null, pulseConfidence: null, traceExcerpt: [], ledger: [], source: 'synthetic', underexposed: false },
  ...extra,
});

describe('breathing loop from the real chest trace', () => {
  it('keeps a slow breather slow (no 6 s clamp)', () => {
    const bl = breathLoop(trace(6, 30), 10)!; // 6 breaths/min: 10 s per breath
    expect(bl.L).toBeCloseTo(10, 5);
  });

  it('loops whole breaths, about 8 s', () => {
    expect(breathLoop(trace(15, 30), 4)!.L).toBeCloseTo(8, 5);   // two breaths
    expect(breathLoop(trace(24, 30), 2.5)!.L).toBeCloseTo(7.5, 5); // three breaths
  });

  it('closes the loop even when the trace drifts', () => {
    const c = breathLoop(trace(15, 30, 0.05), 4)!.curve;
    expect(Math.abs(c[0] - c[c.length - 1])).toBeLessThan(0.15);
  });

  it('gives up on a flat or short trace', () => {
    expect(breathLoop(trace(15, 3), 4)).toBeNull();
    expect(breathLoop(Array.from({ length: 100 }, (_, i) => ({ t: i / 10, v: 1 })), 4)).toBeNull();
    expect(breathLoop(trace(15, 30), null)).toBeNull();
  });

  it('plays the stored curve, and old plates still breathe on a cosine', () => {
    const bl = breathLoop(trace(6, 30), 10)!;
    const p = plate({ breathPeriod: bl.L, breathCurve: bl.curve });
    expect(loopLength(p)).toBeCloseTo(10, 5);
    const values = Array.from({ length: 20 }, (_, i) => plateFrameAt(p, i / 2, { gentle: true, ghosts: false }).breath);
    expect(Math.max(...values) - Math.min(...values)).toBeGreaterThan(0.8);
    const old = plate({ breathPeriod: 9 });
    expect(loopLength(old)).toBe(6);
    expect(plateFrameAt(old, 0, { gentle: true, ghosts: false }).breath).toBeCloseTo(0, 5);
  });
});
