// Breath for the portrait: how far the chest has risen, 0 (exhaled) to 1
// (inhaled), from the SDK's chest trace and nothing else.
//
// Honesty rules (the sitter can test them by holding their breath):
//  - No invented motion. Without a usable chest trace the bust rests at 0.5;
//    there is no fallback oscillation at the average rate.
//  - A held breath stays still. The trace is scaled against the sitter's
//    normal breathing (a robust spread over the last WINDOW_S), and that scale
//    only shrinks slowly (SCALE_HALF_LIFE_S), so the small noise left during a
//    hold is never stretched into fake breaths.
//  - Talking spoils the chest signal, so the value is held while the sitter speaks.
import type { Sample } from '../../shared/types';
import { movingAverage } from './beats';

/** Seconds of chest trace kept and used to find the centre and the breath size. */
export const WINDOW_S = 30;
/** Trace needed before the bust moves at all, seconds. */
export const MIN_SPAN_S = 6;
/** How slowly the breath-size scale may shrink (half-life, seconds of signal). */
export const SCALE_HALF_LIFE_S = 20;
/** Half-width of the smoothing applied to the trace, seconds. */
const SMOOTH_S = 0.25;

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

export class BreathTracker {
  private buf: Sample[] = [];
  private rpm: number | null = null;
  private stable = false;
  private held: number | null = null;
  private lastValue = 0.5;
  private scale = 0;
  private scaleAt: number | null = null;
  private source: 'trace' | 'none' = 'none';

  push(chunk: Sample[]): void {
    for (const s of chunk) {
      if (this.buf.length && s.t <= this.buf[this.buf.length - 1].t) continue;
      this.buf.push(s);
    }
    const newest = this.buf.length ? this.buf[this.buf.length - 1].t : 0;
    while (this.buf.length && this.buf[0].t < newest - WINDOW_S) this.buf.shift();
  }

  /** The SDK's breathing rate: used for stage timing and the loop length, never for motion. */
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
  get mode(): 'trace' | 'none' { return this.source; }
  /** The chest trace received in the last WINDOW_S seconds (for the live strip). */
  get trace(): readonly Sample[] { return this.buf; }

  /** 0..1 chest rise now. `_now` is kept for API compatibility; only the trace matters. */
  value(_now?: number): number {
    if (this.held != null) return this.held;
    const target = this.fromTrace();
    // Light smoothing so the portrait never jerks.
    this.lastValue += ((target ?? 0.5) - this.lastValue) * 0.15;
    return this.lastValue;
  }

  private fromTrace(): number | null {
    const b = this.buf;
    if (b.length < 2 || b[b.length - 1].t - b[0].t < MIN_SPAN_S) { this.source = 'none'; return null; }
    const sm = movingAverage(b, SMOOTH_S);
    const sorted = [...sm].sort((p, q) => p - q);
    const centre = percentile(sorted, 0.5);
    // Typical breath size: half the 10-90 % spread, robust to single spikes.
    const spread = (percentile(sorted, 0.9) - percentile(sorted, 0.1)) / 2;
    const t = b[b.length - 1].t;
    if (this.scaleAt != null && spread < this.scale) {
      // Shrink no faster than the half-life allows, so a hold stays still.
      const decay = Math.pow(0.5, Math.max(0, t - this.scaleAt) / SCALE_HALF_LIFE_S);
      this.scale = Math.max(spread, this.scale * decay);
    } else {
      this.scale = spread;
    }
    this.scaleAt = t;
    if (!(this.scale > 1e-9)) { this.source = 'none'; return null; }
    this.source = 'trace';
    const x = (sm[sm.length - 1] - centre) / this.scale;
    return 0.5 + 0.5 * Math.max(-1, Math.min(1, x));
  }

  reset(): void {
    this.buf = []; this.rpm = null; this.stable = false; this.held = null;
    this.lastValue = 0.5; this.scale = 0; this.scaleAt = null; this.source = 'none';
  }
}
