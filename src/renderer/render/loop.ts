// Playback of a finished plate: a whole number of the sitter's own breaths,
// taken from their real chest trace at the end of the sitting, with their own
// beat timings replayed inside it, so the loop is seamless and both rhythms
// are theirs.
import type { Plate, Sample } from '../../shared/types';
import { flushEnvelope } from '../signal/beats';
import type { FrameState } from './plate';
import { topologyLooksRight } from './landmarks';

/** Loop length for plates without a breath curve (older plates, or no usable trace). */
export function fallbackLoopLength(period: number | null | undefined): number {
  return Math.min(6, Math.max(3, period || 4));
}

export function loopLength(plate: Plate): number {
  return plate.breathCurve?.length ? plate.breathPeriod : fallbackLoopLength(plate.breathPeriod);
}

/** Points in a stored breath curve. */
const CURVE_POINTS = 96;

/**
 * The loop's breathing from the real chest trace: the last whole breaths
 * (about 8 s, at least one breath, at most 12 s) resampled, lightly smoothed,
 * scaled to 0..1 and with the drift removed so the end joins the start.
 * Null when the trace is too short or flat; the plate then uses a cosine.
 */
export function breathLoop(trace: readonly Sample[], period: number | null): { L: number; curve: number[] } | null {
  if (!period || period < 1.5 || period > 12 || trace.length < 8) return null;
  const k = Math.max(1, Math.floor(8 / period));
  const L = k * period;
  const end = trace[trace.length - 1].t, start = end - L;
  if (trace[0].t > start + 0.1 * L) return null;
  // Resample by linear interpolation.
  const raw: number[] = [];
  let j = 0;
  for (let i = 0; i < CURVE_POINTS; i++) {
    const t = start + (i / CURVE_POINTS) * L;
    while (j < trace.length - 2 && trace[j + 1].t < t) j++;
    const a = trace[j], b = trace[j + 1] ?? a;
    const f = b.t > a.t ? Math.min(1, Math.max(0, (t - a.t) / (b.t - a.t))) : 0;
    raw.push(a.v + (b.v - a.v) * f);
  }
  // Remove the drift so the loop closes: the point after the last is the first.
  const next = trace[trace.length - 1].v;
  const drift = next - raw[0];
  const flat = raw.map((v, i) => v - (drift * i) / CURVE_POINTS);
  // Light circular smoothing (about 0.3 s).
  const w = Math.max(1, Math.round((0.3 / L) * CURVE_POINTS));
  const sm = flat.map((_, i) => {
    let s = 0;
    for (let d = -w; d <= w; d++) s += flat[(i + d + CURVE_POINTS) % CURVE_POINTS];
    return s / (2 * w + 1);
  });
  const sorted = [...sm].sort((p, q) => p - q);
  const lo = sorted[Math.floor(CURVE_POINTS * 0.05)], hi = sorted[Math.floor(CURVE_POINTS * 0.95)];
  if (!(hi - lo > 1e-9)) return null;
  return { L, curve: sm.map((v) => Math.min(1, Math.max(0, (v - lo) / (hi - lo)))) };
}

/** 0..1 chest rise at loop time lt. */
function breathAt(plate: Plate, lt: number, L: number): number {
  const c = plate.breathCurve;
  if (!c?.length) return 0.5 - 0.5 * Math.cos((2 * Math.PI * lt) / L);
  const x = (lt / L) * c.length, i = Math.floor(x) % c.length, f = x - Math.floor(x);
  return c[i] + (c[(i + 1) % c.length] - c[i]) * f;
}

export function plateFrameAt(plate: Plate, t: number, opts: { gentle: boolean; ghosts: boolean }): FrameState {
  const L = loopLength(plate);
  const lt = ((t % L) + L) % L;
  let sinceBeat = Infinity, period = 60 / (plate.verso.pulseBpm || 70);
  if (plate.beats.length) {
    // Most recent beat at or before lt, wrapping around the loop.
    for (const b of plate.beats) if (b <= lt) sinceBeat = lt - b;
    if (!Number.isFinite(sinceBeat)) sinceBeat = lt + (L - plate.beats[plate.beats.length - 1]);
    if (plate.beats.length > 1) period = L / plate.beats.length;
  }
  const flush = Number.isFinite(sinceBeat) ? flushEnvelope(sinceBeat, period) : 0;
  return {
    face: plate.face,
    topologyOk: topologyLooksRight(plate.face),
    flush,
    travel: Math.min(1, sinceBeat / 0.45),
    breath: breathAt(plate, lt, L),
    development: 1,
    ghosts: opts.ghosts ? plate.ghosts : [],
    smile: plate.smile,
    seal: plate.seal ? { params: plate.seal, progress: 1 } : null,
    capped: false,
    gentle: opts.gentle,
    time: t,
    head: plate.head ?? 'dark',
  };
}

/** Beat times (relative, inside one loop) taken from the end of a sitting. */
export function beatsForLoop(confirmed: readonly number[], endT: number, L: number, fallbackBpm: number | null): number[] {
  const window = confirmed.filter((b) => b > endT - L && b <= endT).map((b) => b - (endT - L));
  if (window.length >= 2) return window;
  const bpm = fallbackBpm || 70;
  const n = Math.max(1, Math.round((L * bpm) / 60));
  return Array.from({ length: n }, (_, i) => (i * L) / n);
}
