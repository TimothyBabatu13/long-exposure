// Playback of a finished plate: one breath long, with the sitter's own beat
// timings from the sitting replayed inside it, so the loop is seamless and
// the beat-to-beat variation is theirs.
import type { Plate } from '../../shared/types';
import { flushEnvelope } from '../signal/beats';
import type { FrameState } from './plate';
import { topologyLooksRight } from './landmarks';

export function loopLength(plate: Plate): number {
  return Math.min(6, Math.max(3, plate.breathPeriod || 4));
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
    breath: 0.5 - 0.5 * Math.cos((2 * Math.PI * lt) / L),
    development: 1,
    ghosts: opts.ghosts ? plate.ghosts : [],
    smile: plate.smile,
    seal: plate.seal ? { params: plate.seal, progress: 1 } : null,
    capped: false,
    gentle: opts.gentle,
    time: t,
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
