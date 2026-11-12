import { describe, expect, it } from 'vitest';
import { BreathTracker } from '../src/renderer/signal/breath';
import type { Sample } from '../src/shared/types';

const HZ = 30;
/** Chest trace from t0 for `seconds`: breathing at `rpm` (amplitude 1), or flat when rpm is 0. */
function trace(t0: number, seconds: number, rpm: number, noise = 0.01): Sample[] {
  const out: Sample[] = [];
  for (let i = 0; i < seconds * HZ; i++) {
    const t = t0 + i / HZ;
    const v = rpm ? Math.sin((2 * Math.PI * t * rpm) / 60) : 0;
    out.push({ t, v: v + noise * Math.sin(t * 37.1) });
  }
  return out;
}

/** Feed a trace in 1/6 s chunks, reading the value 10 times per chunk (60 fps, as the app does). */
function feed(b: BreathTracker, s: Sample[]): number[] {
  const values: number[] = [];
  for (let i = 0; i < s.length; i += 5) {
    b.push(s.slice(i, i + 5));
    for (let k = 0; k < 10; k++) values.push(b.value());
  }
  return values;
}

const range = (xs: number[]) => Math.max(...xs) - Math.min(...xs);

describe('BreathTracker', () => {
  it('follows real breathing', () => {
    const b = new BreathTracker();
    const v = feed(b, trace(0, 40, 14));
    expect(b.mode).toBe('trace');
    expect(range(v.slice(-600))).toBeGreaterThan(0.6);
  });

  it('stays still while the breath is held', () => {
    const b = new BreathTracker();
    feed(b, trace(0, 40, 14));
    const held = feed(b, trace(40, 20, 0)); // a 20 s breath hold
    // Skip the first 2 s while the smoothing settles, then the bust must be still.
    expect(range(held.slice(120))).toBeLessThan(0.08);
  });

  it('invents no motion from the rate alone', () => {
    const b = new BreathTracker();
    b.setRate(14, true);
    const v = Array.from({ length: 50 }, () => b.value());
    expect(b.mode).toBe('none');
    expect(range(v)).toBe(0);
    expect(v[0]).toBe(0.5);
  });

  it('holds the value while the sitter talks', () => {
    const b = new BreathTracker();
    feed(b, trace(0, 20, 14));
    b.hold(true);
    const before = b.value();
    const during = feed(b, trace(20, 5, 14));
    expect(new Set([before, ...during]).size).toBe(1);
  });
});
