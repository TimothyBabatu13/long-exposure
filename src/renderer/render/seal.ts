// The maker's mark engraved when the plate is fixed: a guilloché rosette
// whose geometry comes from the sitting's rhythm. It cannot be decoded back
// into numbers by this app; it is unique to the sitting, not a readout.
import type { SealParams } from '../../shared/types';

export function sealFrom(r: { bpm: number | null; rpm: number | null; rmssd: number | null; sdnn: number | null }): SealParams {
  const bpm = r.bpm ?? 70, rpm = r.rpm ?? 14, rmssd = r.rmssd ?? 30, sdnn = r.sdnn ?? 40;
  return {
    lobes: 5 + (Math.round(bpm) % 9),
    ratio: 0.55 + ((rmssd % 40) / 40) * 0.3,
    wobble: 0.04 + ((sdnn % 25) / 25) * 0.1,
    rings: 3 + (Math.round(rpm) % 4),
    twist: ((rmssd * 7 + sdnn * 3) % 360) * (Math.PI / 180),
  };
}

/** Draw the rosette. `progress` 0..1 animates the engraving. */
export function drawSeal(ctx: CanvasRenderingContext2D, p: SealParams, cx: number, cy: number, radius: number, progress = 1, ink = 'rgba(30,24,16,0.9)'): void {
  ctx.save();
  ctx.translate(cx, cy);
  ctx.strokeStyle = ink;
  ctx.lineWidth = Math.max(0.6, radius / 120);
  const steps = 720;
  for (let ring = 0; ring < p.rings; ring++) {
    const rr = radius * (1 - ring * (0.5 / p.rings));
    const phase = p.twist + ring * (Math.PI / p.lobes);
    ctx.beginPath();
    const end = Math.floor(steps * Math.min(1, Math.max(0, progress * p.rings - ring)));
    for (let i = 0; i <= end; i++) {
      const a = (i / steps) * Math.PI * 2;
      // Epitrochoid-style rosette with a slow wobble.
      const r = rr * (p.ratio + (1 - p.ratio) * Math.abs(Math.cos((p.lobes * a) / 2 + phase))) * (1 + p.wobble * Math.sin(a * (p.lobes + 2)));
      const x = r * Math.cos(a), y = r * Math.sin(a);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  if (progress >= 1) {
    ctx.beginPath();
    ctx.arc(0, 0, radius * 1.06, 0, Math.PI * 2);
    ctx.stroke();
  }
  ctx.restore();
}
