import { describe, expect, it } from 'vitest';
import { Sitting, MAX_EXPOSURE_S, SECOND_FACE_ABANDON_S, CAP_DELAY_S, TALK_CAP_DELAY_S, MAX_SITTING_S, type SittingInputs } from '../src/renderer/sitting/machine';

const still: SittingInputs = {
  readiness: 'ok', talking: false, windowFocused: true, running: true,
  pulseReady: true, breathReady: true, hrvReady: true,
};

function run(s: Sitting, seconds: number, inputs: Partial<SittingInputs> = {}, dt = 0.1) {
  for (let t = 0; t < seconds; t += dt) s.tick(dt, { ...still, ...inputs });
}

describe('Sitting', () => {
  it('moves through the stages on the SDK warm-up times', () => {
    const s = new Sitting();
    run(s, 11.5); expect(s.stage).toBe('focusing');
    run(s, 1); expect(s.stage).toBe('heart');
    run(s, 18); expect(s.stage).toBe('breath');
    run(s, 30); expect(s.stage).toBe('fixing');
    run(s, 4); expect(s.stage).toBe('developed');
  });

  it('caps the lens while the sitter talks, and the exposure clock stops', () => {
    const s = new Sitting();
    run(s, 5);
    const before = s.exposure;
    run(s, 3, { talking: true });
    expect(s.pause).toBe('talking');
    // The clock runs only for the cap delay, then stops.
    expect(s.exposure).toBeGreaterThan(before);
    expect(s.exposure).toBeLessThanOrEqual(before + TALK_CAP_DELAY_S + 1e-9);
    run(s, 1);
    expect(s.pause).toBeNull();
    expect(s.ledger.some((e) => e.text.includes('speech'))).toBe(true);
  });

  it('ignores flickering talk and framing flags (no cap, no ledger noise)', () => {
    const s = new Sitting();
    run(s, 5);
    const pauses = () => s.ledger.filter((e) => e.kind !== 'stage' || e.text.includes('uncapped')).length;
    const entries = pauses();
    for (let k = 0; k < 40; k++) {
      s.tick(0.1, { ...still, talking: k % 2 === 0 });
      s.tick(0.1, { ...still, readiness: k % 3 === 0 ? 'framing' : 'ok' });
    }
    expect(s.pause).toBeNull();
    expect(pauses()).toBe(entries);
    expect(s.exposure).toBeGreaterThan(12);
  });

  it('caps at once when the window is left', () => {
    const s = new Sitting();
    run(s, 5);
    s.tick(0.1, { ...still, windowFocused: false });
    expect(s.pause).toBe('away');
  });

  it('pauses when the window loses focus (no background sensing)', () => {
    const s = new Sitting();
    run(s, 2, { windowFocused: false });
    expect(s.pause).toBe('away');
    expect(s.exposure).toBe(0);
  });

  it('waits for the heart instead of pretending', () => {
    const s = new Sitting();
    run(s, 20, { pulseReady: false });
    expect(s.stage).toBe('focusing');
    run(s, 0.2);
    expect(s.stage).toBe('heart');
  });

  it('caps the lens on a brief second-face flicker but keeps the sitting', () => {
    const s = new Sitting();
    run(s, 10);
    s.tick(0.5, { ...still, readiness: 'multiple-faces' });
    expect(s.stage).toBe('focusing');
    expect(s.pause).toBe('crowd');
    run(s, 1);
    expect(s.pause).toBeNull();
  });

  it('abandons the sitting when a second face stays', () => {
    const s = new Sitting();
    run(s, 10);
    for (let t = 0; t < SECOND_FACE_ABANDON_S + 0.2; t += 0.1) s.tick(0.1, { ...still, readiness: 'multiple-faces' });
    expect(s.stage).toBe('abandoned');
  });

  it('fixes the plate without HRV when the pulse is still locked at 60 s', () => {
    const s = new Sitting();
    run(s, 61, { hrvReady: false });
    expect(s.stage).toBe('fixing');
    run(s, 4, { hrvReady: false });
    expect(s.stage).toBe('developed');
    expect(s.underexposed).toBe(false);
  });

  it('develops an underexposed plate if the pulse is lost and HRV never comes', () => {
    const s = new Sitting();
    run(s, 40);
    expect(s.stage).toBe('breath');
    run(s, MAX_EXPOSURE_S, { hrvReady: false, pulseReady: false });
    expect(s.underexposed).toBe(true);
    expect(s.underexposedReason).toBe('the pulse was lost before the plate could be fixed');
    expect(s.ledger.some((e) => e.text.includes('light'))).toBe(false);
    expect(s.stage).toBe('developed');
  });
});

describe('Sitting: talking', () => {
  it('does not cap for a short lip movement under the talk delay', () => {
    const s = new Sitting();
    run(s, 5);
    run(s, TALK_CAP_DELAY_S - 0.3, { talking: true });
    expect(s.pause).toBeNull();
    expect(s.ledger.some((e) => e.text.includes('speech'))).toBe(false);
  });

  it('still caps for sustained talking, and other problems keep the short delay', () => {
    const s = new Sitting();
    run(s, 5);
    run(s, TALK_CAP_DELAY_S + 0.3, { talking: true });
    expect(s.pause).toBe('talking');
    const t = new Sitting();
    run(t, 5);
    run(t, CAP_DELAY_S + 0.2, { readiness: 'motion' });
    expect(t.pause).toBe('motion');
  });
});

describe('sitting limits', () => {
  it('a second face that keeps flickering still ends the sitting', () => {
    const s = new Sitting();
    run(s, 10);
    // 0.3 s of second face, 0.2 s without, over and over: the old timer reset every gap.
    for (let k = 0; k < 40 && s.stage !== 'abandoned'; k++) {
      for (let t = 0; t < 0.3; t += 0.1) s.tick(0.1, { ...still, readiness: 'multiple-faces' });
      for (let t = 0; t < 0.2; t += 0.1) s.tick(0.1, still);
    }
    expect(s.stage).toBe('abandoned');
    expect(s.abandonReason).toBe('crowd');
  });

  it('a single flicker does not end it', () => {
    const s = new Sitting();
    run(s, 10);
    s.tick(0.1, { ...still, readiness: 'multiple-faces' });
    run(s, 20);
    expect(s.stage).not.toBe('abandoned');
  });

  it('stops after five minutes with no exposure, keeping nothing', () => {
    const s = new Sitting();
    for (let t = 0; t < MAX_SITTING_S + 1; t += 0.5) s.tick(0.5, { ...still, readiness: 'too-dark' });
    expect(s.stage).toBe('abandoned');
    expect(s.abandonReason).toBe('timeout');
  });

  it('develops an underexposed plate if the lens stays capped after some exposure', () => {
    const s = new Sitting();
    run(s, 20);
    for (let t = 0; t < MAX_SITTING_S; t += 0.5) s.tick(0.5, { ...still, readiness: 'too-dark' });
    for (let t = 0; t < 4; t += 0.5) s.tick(0.5, { ...still, readiness: 'too-dark' });
    expect(s.stage).toBe('developed');
    expect(s.underexposed).toBe(true);
  });
});
