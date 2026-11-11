import { describe, expect, it } from 'vitest';
import { BeatTracker, flushEnvelope } from '../src/renderer/signal/beats';
import type { Sample } from '../src/shared/types';

/** A pulse-like waveform at `bpm`, sampled at 30 Hz, with true beat times. */
function wave(bpm: number, seconds: number, t0 = 1_700_000_000, noise = 0.05) {
  const samples: Sample[] = [];
  const beats: number[] = [];
  const period = 60 / bpm;
  for (let b = 0; b * period < seconds; b++) beats.push(t0 + b * period + 0.15 * period);
  let seed = 1;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
  for (let t = 0; t < seconds; t += 1 / 30) {
    const f = (t / period) % 1;
    const v = Math.exp(-(((f - 0.15) / 0.07) ** 2)) + 0.35 * Math.exp(-(((f - 0.45) / 0.1) ** 2)) + rnd() * noise;
    samples.push({ t: t0 + t, v });
  }
  return { samples, beats };
}

/** Feed samples in 1 s chunks arriving `lag` seconds after the newest sample. */
function feed(tr: BeatTracker, samples: Sample[], lag: number, chunk = 1) {
  for (let i = 0; i < samples.length; ) {
    const end = samples[i].t + chunk;
    const part: Sample[] = [];
    while (i < samples.length && samples[i].t < end) part.push(samples[i++]);
    tr.push(part, part[part.length - 1].t + lag);
  }
}

describe('BeatTracker', () => {
  it('finds beats close to the true peaks', () => {
    const { samples, beats } = wave(72, 20);
    const tr = new BeatTracker();
    feed(tr, samples, 0.1, 0.25);
    const found = tr.confirmedBeats;
    expect(found.length).toBeGreaterThan(18);
    for (const b of found) {
      const nearest = beats.reduce((a, x) => (Math.abs(x - b) < Math.abs(a - b) ? x : a));
      expect(Math.abs(nearest - b)).toBeLessThan(0.05);
    }
  });

  it('reports the period from the waveform', () => {
    const { samples } = wave(60, 15);
    const tr = new BeatTracker();
    feed(tr, samples, 0.1);
    const now = samples[samples.length - 1].t + 0.1;
    expect(tr.period(now)).toBeCloseTo(1.0, 1);
  });

  it('chooses the waveform tier for fresh data and predicted for late data', () => {
    const { samples } = wave(70, 15);
    const fresh = new BeatTracker();
    feed(fresh, samples, 0.1, 0.25);
    expect(fresh.tier(samples[samples.length - 1].t + 0.1)).toBe('waveform');

    const late = new BeatTracker();
    feed(late, samples, 1.2);
    expect(late.tier(samples[samples.length - 1].t + 1.2)).toBe('predicted');
  });

  it('falls back to the rate tier when the waveform is noise', () => {
    const tr = new BeatTracker();
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647) - 0.5;
    const t0 = 1_700_000_000;
    const samples: Sample[] = Array.from({ length: 450 }, (_, i) => ({ t: t0 + i / 30, v: rnd() }));
    tr.setRate(65);
    feed(tr, samples, 0.1);
    expect(tr.tier(t0 + 15.1)).toBe('rate');
    expect(tr.period(t0 + 15.1)).toBeCloseTo(60 / 65, 3);
  });

  it('rejects waveform beats that disagree with the SDK pulse rate', () => {
    const { samples } = wave(72, 15);
    const tr = new BeatTracker();
    tr.setRate(120); // the SDK says something very different
    feed(tr, samples, 0.1);
    expect(tr.tier(samples[samples.length - 1].t + 0.1)).toBe('rate');
  });

  it('handles timestamps on a non-epoch clock', () => {
    const { samples } = wave(66, 15, 1000); // e.g. a monotonic clock starting near 1000 s
    const tr = new BeatTracker();
    for (let i = 0; i < samples.length; i += 8) {
      const part = samples.slice(i, i + 8);
      tr.push(part, 1_700_000_000 + part[part.length - 1].t); // arrival on the wall clock
    }
    expect(tr.lag).toBeLessThan(0.5);
    expect(tr.tier(1_700_000_000 + samples[samples.length - 1].t)).not.toBeNull();
  });

  it('predicts phase that keeps advancing between packets', () => {
    const { samples } = wave(60, 12);
    const tr = new BeatTracker();
    feed(tr, samples, 0.1, 0.25);
    const now = samples[samples.length - 1].t + 0.1;
    const a = tr.phase(now)!, b = tr.phase(now + 0.3)!;
    expect(a).not.toBeNull();
    const advanced = (b.sinceBeat - a.sinceBeat + a.period) % a.period;
    expect(advanced).toBeCloseTo(0.3, 2);
  });
});

describe('flushEnvelope', () => {
  it('rises fast and decays before the next beat', () => {
    expect(flushEnvelope(0, 1)).toBe(0);
    expect(flushEnvelope(0.08, 1)).toBeCloseTo(1, 5);
    expect(flushEnvelope(0.9, 1)).toBeLessThan(0.05);
  });
});
