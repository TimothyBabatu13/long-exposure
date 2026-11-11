// Beat detection on the SDK's pulse waveform (cardio.arterialPressureTrace).
//
// The trace arrives in chunks, some time after the fact. We find real peaks
// in what has arrived, then predict upcoming beats from the recent period and
// the phase of the last confirmed peak. Heartbeats are quasi-periodic, so a
// prediction hides the delivery lag; the plate's verso states which tier was
// used:
//   waveform:  peaks are fresh (lag < 0.3 s), beats drawn close to real time
//   predicted: peaks are real but delayed, beats extrapolated by phase
//   rate:      no clean peaks, beats spaced from the averaged pulse rate
import type { BeatTier, Sample } from '../../shared/types';

const WINDOW_S = 12;
const MIN_INTERVAL_S = 60 / 180; // refractory period: at most 180 bpm
const MAX_INTERVAL_S = 60 / 35;
const CONFIRM_S = 0.25; // a peak needs this much signal after it to count
const FRESH_LAG_S = 0.3;

export function movingAverage(s: Sample[], halfWidth: number): number[] {
  const out = new Array<number>(s.length);
  let lo = 0, hi = 0, sum = 0;
  for (let i = 0; i < s.length; i++) {
    while (hi < s.length && s[hi].t <= s[i].t + halfWidth) sum += s[hi++].v;
    while (s[lo].t < s[i].t - halfWidth) sum -= s[lo++].v;
    out[i] = sum / (hi - lo);
  }
  return out;
}

function median(xs: number[]): number {
  const a = [...xs].sort((p, q) => p - q);
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

export class BeatTracker {
  private buf: Sample[] = [];
  private beats: number[] = [];
  private rateBpm: number | null = null;
  private lagEma: number | null = null;
  private clockOffset = 0;
  private minObservedDelta = Infinity;
  private rateAnchor: number | null = null;

  /** Feed a chunk of trace samples. `arrival` is wall-clock seconds. */
  push(chunk: Sample[], arrival: number): void {
    if (!chunk.length) return;
    for (const s of chunk) {
      if (this.buf.length && s.t <= this.buf[this.buf.length - 1].t) continue;
      this.buf.push(s);
    }
    const newest = this.buf[this.buf.length - 1].t;
    while (this.buf.length && this.buf[0].t < newest - WINDOW_S) this.buf.shift();

    // Clock handling. SDK timestamps are documented as µs since epoch, the
    // same clock as Date.now(). If they turn out not to be, fall back to
    // treating the fastest-arriving packet as zero lag.
    const delta = arrival - newest;
    if (Math.abs(delta) > 30) {
      this.minObservedDelta = Math.min(this.minObservedDelta, delta);
      this.clockOffset = this.minObservedDelta;
    } else {
      this.clockOffset = 0;
    }
    const lag = delta - this.clockOffset;
    this.lagEma = this.lagEma == null ? lag : this.lagEma * 0.8 + lag * 0.2;
    this.detect();
  }

  setRate(bpm: number | null): void {
    this.rateBpm = bpm && bpm > 30 && bpm < 200 ? bpm : null;
  }

  /** Average delivery lag, seconds. */
  get lag(): number { return this.lagEma ?? 0; }

  /** Convert wall-clock seconds to the signal clock. */
  toSignal(wall: number): number { return wall - this.clockOffset; }

  get confirmedBeats(): readonly number[] { return this.beats; }

  get trace(): readonly Sample[] { return this.buf; }

  private detect(): void {
    const s = this.buf;
    if (s.length < 20) return;
    const smooth = movingAverage(s, 0.05);
    const trend = movingAverage(s, 0.6);
    const x = smooth.map((v, i) => v - trend[i]);
    const newest = s[s.length - 1].t;
    const recent = x.filter((_, i) => s[i].t > newest - 8);
    const mean = recent.reduce((a, b) => a + b, 0) / recent.length;
    const sd = Math.sqrt(recent.reduce((a, b) => a + (b - mean) ** 2, 0) / recent.length) || 1e-9;
    const threshold = mean + 0.3 * sd;
    const lastBeat = this.beats.length ? this.beats[this.beats.length - 1] : -Infinity;

    for (let i = 1; i < s.length - 1; i++) {
      const t = s[i].t;
      if (t <= lastBeat + MIN_INTERVAL_S || t > newest - CONFIRM_S) continue;
      if (x[i] < threshold) continue;
      // Local maximum within ±0.25 s.
      let isMax = true;
      for (let j = i - 1; j >= 0 && s[j].t >= t - 0.25; j--) if (x[j] > x[i]) { isMax = false; break; }
      if (isMax) for (let j = i + 1; j < s.length && s[j].t <= t + 0.25; j++) if (x[j] >= x[i]) { isMax = false; break; }
      if (!isMax) continue;
      const prev = this.beats.length ? this.beats[this.beats.length - 1] : null;
      if (prev != null && t - prev < MIN_INTERVAL_S) continue;
      this.beats.push(t);
      if (this.beats.length > 64) this.beats.shift();
      return this.detect(); // re-scan after the new beat with an updated refractory window
    }
  }

  /** Recent beat-to-beat intervals that agree with each other. */
  private consistentIntervals(now: number): number[] {
    const b = this.beats.filter((t) => t > now - 8);
    const iv: number[] = [];
    for (let i = 1; i < b.length; i++) {
      const d = b[i] - b[i - 1];
      if (d >= MIN_INTERVAL_S && d <= MAX_INTERVAL_S) iv.push(d);
    }
    if (iv.length < 3) return [];
    const m = median(iv);
    const ok = iv.filter((d) => Math.abs(d - m) / m < 0.25);
    if (ok.length < iv.length * 0.7) return [];
    // Cross-check with the SDK's own averaged rate when it is available.
    if (this.rateBpm && Math.abs(60 / m - this.rateBpm) / this.rateBpm > 0.3) return [];
    return ok;
  }

  tier(wallNow: number): BeatTier | null {
    const now = this.toSignal(wallNow);
    const lastBeat = this.beats[this.beats.length - 1];
    const peaksFresh = lastBeat != null && now - lastBeat < 3 + this.lag;
    if (peaksFresh && this.consistentIntervals(now).length) return this.lag < FRESH_LAG_S ? 'waveform' : 'predicted';
    return this.rateBpm ? 'rate' : null;
  }

  /** Current beat period in seconds, or null if unknown. */
  period(wallNow: number): number | null {
    const iv = this.consistentIntervals(this.toSignal(wallNow));
    if (iv.length) return median(iv.slice(-6));
    return this.rateBpm ? 60 / this.rateBpm : null;
  }

  /**
   * Seconds since the most recent (real or predicted) beat, as of wallNow,
   * plus the period. The renderer turns this into the flush envelope.
   */
  phase(wallNow: number): { sinceBeat: number; period: number; tier: BeatTier } | null {
    const tier = this.tier(wallNow);
    const period = this.period(wallNow);
    if (!tier || !period) return null;
    const now = this.toSignal(wallNow);
    let anchor: number;
    if (tier === 'rate') {
      this.rateAnchor ??= now;
      anchor = this.rateAnchor;
    } else {
      anchor = this.beats[this.beats.length - 1];
      this.rateAnchor = null;
    }
    const elapsed = now - anchor;
    const sinceBeat = ((elapsed % period) + period) % period;
    return { sinceBeat, period, tier };
  }

  reset(): void {
    this.buf = []; this.beats = []; this.lagEma = null; this.rateAnchor = null;
    this.minObservedDelta = Infinity; this.clockOffset = 0;
  }
}

/** Flush envelope: fast attack, slower decay, peaking ~80 ms after the beat. */
export function flushEnvelope(sinceBeat: number, period: number): number {
  const attack = 0.08;
  if (sinceBeat < attack) return sinceBeat / attack;
  const decay = Math.max(0.25, period * 0.55);
  return Math.exp(-(sinceBeat - attack) / (decay / 3));
}
