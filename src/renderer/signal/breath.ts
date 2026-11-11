// Breath for the portrait: how far the chest has risen, 0 (exhaled) to 1
// (inhaled). It comes from the SDK's chest trace when the breathing rate is
// stable, otherwise from a gentle oscillation at the measured rate. Talking
// spoils breathing, so the value is held while the sitter speaks.
import type { Sample } from '../../shared/types';
import { movingAverage } from './beats';

export class BreathTracker {
  private buf: Sample[] = [];
  private rpm: number | null = null;
  private stable = false;
  private held: number | null = null;
  private lastValue = 0.5;
  private source: 'trace' | 'rate' | 'none' = 'none';

  push(chunk: Sample[]): void {
    for (const s of chunk) {
      if (this.buf.length && s.t <= this.buf[this.buf.length - 1].t) continue;
      this.buf.push(s);
    }
    const newest = this.buf.length ? this.buf[this.buf.length - 1].t : 0;
    while (this.buf.length && this.buf[0].t < newest - 20) this.buf.shift();
  }

  setRate(rpm: number, stable: boolean): void {
    this.rpm = rpm > 3 && rpm < 45 ? rpm : null;
    this.stable = stable;
  }

  hold(on: boolean): void {
    this.held = on ? this.lastValue : null;
  }

  get period(): number | null { return this.rpm ? 60 / this.rpm : null; }
  get rate(): number | null { return this.rpm; }
  get isStable(): boolean { return this.stable; }
  get mode(): 'trace' | 'rate' | 'none' { return this.source; }

  /** 0..1 chest rise at `now` (seconds, wall clock). */
  value(now: number): number {
    if (this.held != null) return this.held;
    let v: number;
    if (this.stable && this.buf.length > 30) {
      const sm = movingAverage(this.buf, 0.25);
      const recent = sm.slice(-Math.min(sm.length, 300));
      const lo = Math.min(...recent), hi = Math.max(...recent);
      v = hi - lo > 1e-9 ? (sm[sm.length - 1] - lo) / (hi - lo) : 0.5;
      this.source = 'trace';
    } else if (this.rpm) {
      v = 0.5 + 0.5 * Math.sin((2 * Math.PI * now) / (60 / this.rpm));
      this.source = 'rate';
    } else {
      v = 0.5;
      this.source = 'none';
    }
    // Light smoothing so the portrait never jerks.
    this.lastValue += (v - this.lastValue) * 0.15;
    return this.lastValue;
  }

  reset(): void {
    this.buf = []; this.rpm = null; this.stable = false; this.held = null; this.lastValue = 0.5; this.source = 'none';
  }
}
