import { describe, expect, it } from 'vitest';
import { READY_LATCH_S, ReadyLatch } from '../src/renderer/signal/latch';

describe('ready latch', () => {
  it('is not ready before the signal was ever stable', () => {
    expect(new ReadyLatch().ready(100)).toBe(false);
  });
  it('stays ready for a while after a stable packet, despite unstable ones', () => {
    const l = new ReadyLatch();
    l.update(true, 45);
    l.update(false, 46);
    expect(l.ready(50)).toBe(true);
    expect(l.ready(45 + READY_LATCH_S)).toBe(true);
    expect(l.ready(45 + READY_LATCH_S + 1)).toBe(false);
  });
  it('can be reset for a new sitting', () => {
    const l = new ReadyLatch();
    l.update(true, 10);
    l.reset();
    expect(l.ready(11)).toBe(false);
  });
});
