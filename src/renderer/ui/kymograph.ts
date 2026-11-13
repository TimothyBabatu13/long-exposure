// Live traces under the plate, drawn like a 19th-century kymograph: a needle
// scratching through soot on a turning drum. Two lanes: the SDK's pulse
// waveform and its chest (breathing) trace, scrolling as they arrive. Each lane
// stays a flat line (needle at rest) until its signal has locked. No numbers.
import type { Sample } from '../../shared/types';

/** Seconds of signal across the strip. */
export const WINDOW_S = 12;

export interface KymoState {
  pulse: readonly Sample[];
  breath: readonly Sample[];
  pulseOn: boolean;
  breathOn: boolean;
  capped: boolean;
}

/** Seconds for a lane's scale to halve when the signal gets smaller (a held breath stays flat). */
const SCALE_HALF_LIFE_S = 15;

/**
 * Scaling for one lane: centred on the median, sized by the 5th-95th percentile
 * spread. The size grows at once but shrinks slowly, so a quiet stretch is drawn
 * small rather than blown up to fill the lane.
 */
export class LaneScale {
  private span = 0;
  private at: number | null = null;

  update(v: readonly number[], t: number): { mid: number; span: number } | null {
    if (v.length < 8) return null;
    const s = [...v].sort((a, b) => a - b);
    const lo = s[Math.floor(s.length * 0.05)], hi = s[Math.floor(s.length * 0.95)];
    const spread = hi - lo;
    if (this.at != null && spread < this.span) {
      this.span = Math.max(spread, this.span * Math.pow(0.5, Math.max(0, t - this.at) / SCALE_HALF_LIFE_S));
    } else this.span = spread;
    this.at = t;
    return this.span > 1e-9 ? { mid: s[Math.floor(s.length / 2)], span: this.span } : null;
  }

  reset(): void { this.span = 0; this.at = null; }
}

export const pulseScale = new LaneScale();
export const breathScale = new LaneScale();

export function drawKymograph(ctx: CanvasRenderingContext2D, st: KymoState): void {
  const { width: W, height: H } = ctx.canvas;
  const dpr = W / (ctx.canvas.clientWidth || W);
  // Smoked paper: warm soot, darker at the edges where the drum curves away.
  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, '#0b0907'); g.addColorStop(0.5, '#1d1813'); g.addColorStop(1, '#0b0907');
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  // Drum markings, one per second, moving with the newest sample.
  const newest = Math.max(st.pulse.at(-1)?.t ?? 0, st.breath.at(-1)?.t ?? 0);
  const gutter = 52 * dpr; // labels live here; the traces never cross them
  const x = (t: number) => W - ((newest - t) / WINDOW_S) * (W - gutter);
  ctx.strokeStyle = 'rgba(217,203,176,0.07)'; ctx.lineWidth = 1 * dpr;
  for (let t = Math.ceil(newest - WINDOW_S); t <= newest; t++) {
    if (x(t) < gutter) continue;
    ctx.beginPath(); ctx.moveTo(x(t), 0); ctx.lineTo(x(t), H); ctx.stroke();
  }

  const lanes: [string, readonly Sample[], boolean, number, LaneScale][] = [
    ['pulse', st.pulse, st.pulseOn, H * 0.28, pulseScale],
    ['breath', st.breath, st.breathOn, H * 0.73, breathScale],
  ];
  const half = H * 0.2;
  for (const [label, samples, on, mid, scale] of lanes) {
    ctx.fillStyle = 'rgba(217,203,176,0.45)';
    ctx.font = `italic ${Math.round(11 * dpr)}px Georgia, serif`;
    ctx.fillStyle = 'rgba(217,203,176,0.55)';
    ctx.fillText(label, 8 * dpr, mid + 4 * dpr);
    const vis = samples.filter((s) => s.t >= newest - WINDOW_S);
    ctx.save(); ctx.beginPath(); ctx.rect(gutter, 0, W - gutter, H); ctx.clip();
    const sc = on ? scale.update(vis.map((s) => s.v), newest) : null;
    // A scratch through soot is a pale line with a faint glow.
    ctx.strokeStyle = on ? 'rgba(236,226,206,0.9)' : 'rgba(217,203,176,0.25)';
    ctx.lineWidth = (on ? 1.6 : 1) * dpr;
    ctx.shadowColor = 'rgba(236,226,206,0.35)'; ctx.shadowBlur = on ? 3 * dpr : 0;
    ctx.beginPath();
    if (!sc) {
      ctx.moveTo(gutter, mid); ctx.lineTo(W, mid); // needle at rest
    } else {
      vis.forEach((s, i) => {
        const y = mid - Math.min(1, Math.max(-1, (s.v - sc.mid) / sc.span)) * half; // 5-95 % spread fills about half the lane
        if (i === 0) ctx.moveTo(x(s.t), y); else ctx.lineTo(x(s.t), y);
      });
    }
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.restore();
  }
  // The lens cap darkens the drum, as the plate does.
  if (st.capped) { ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(0, 0, W, H); }
}
