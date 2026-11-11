import { describe, expect, it } from 'vitest';
import { Sitting, MAX_EXPOSURE_S, SECOND_FACE_ABANDON_S, type SittingInputs } from '../src/renderer/sitting/machine';

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
    expect(s.exposure).toBeCloseTo(before, 5);
    run(s, 1);
    expect(s.pause).toBeNull();
    expect(s.ledger.some((e) => e.text.includes('speech'))).toBe(true);
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

  it('develops an underexposed plate if the signal never settles', () => {
    const s = new Sitting();
    run(s, MAX_EXPOSURE_S + 5, { hrvReady: false });
    expect(s.underexposed).toBe(true);
    expect(s.stage).toBe('developed');
  });
});
