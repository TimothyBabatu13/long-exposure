// The back of the plate: the evidence. Raw readouts, a stretch of the actual
// pulse waveform, how the beat timing was obtained, and the cause log of
// everything that happened during the sitting. The front never shows numbers.
import type { BeatTier, Plate } from '../../shared/types';

const tierText: Record<BeatTier, string> = {
  waveform: 'Beat timing: peaks of the pulse waveform, close to real time.',
  predicted: 'Beat timing: real waveform peaks, delivered late, extended by phase.',
  rate: 'Beat timing: estimated from the averaged pulse rate (waveform too faint).',
};

const sourceText = {
  live: 'Source: live camera, SmartSpectra SDK, on this device.',
  replay: 'Source: REPLAY of a recorded sitting. Not live.',
  synthetic: 'Source: SYNTHETIC demo data. Not a measurement of anyone.',
} as const;

export function drawVerso(canvas: HTMLCanvasElement, plate: Plate): void {
  const s = canvas.width;
  const ctx = canvas.getContext('2d')!;
  const u = s / 640;
  ctx.fillStyle = '#2a2219';
  ctx.fillRect(0, 0, s, s);
  ctx.fillStyle = '#d9cbb0';
  ctx.font = `${22 * u}px "Iowan Old Style", Georgia, serif`;
  ctx.fillText('Verso', 32 * u, 48 * u);
  ctx.font = `${12 * u}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = '#b5a68a';
  ctx.fillText(`${plate.sitterLabel} · ${new Date(plate.createdAt).toLocaleString()}`, 32 * u, 70 * u);

  const v = plate.verso;
  const rows: [string, string][] = [
    ['Pulse', v.pulseBpm != null ? `${v.pulseBpm.toFixed(0)} bpm` : 'n/a'],
    ['Breathing', v.breathRpm != null ? `${v.breathRpm.toFixed(1)} /min` : 'n/a'],
    ['RMSSD', v.rmssd != null ? `${v.rmssd.toFixed(0)} ms` : 'n/a'],
    ['SDNN', v.sdnn != null ? `${v.sdnn.toFixed(0)} ms` : 'n/a'],
    ['Pulse confidence', v.pulseConfidence != null ? `${v.pulseConfidence.toFixed(0)} / 100` : 'n/a'],
  ];
  ctx.font = `${14 * u}px ui-monospace, Consolas, monospace`;
  rows.forEach(([k, val], i) => {
    ctx.fillStyle = '#9c8e74'; ctx.fillText(k, 32 * u, (110 + i * 24) * u);
    ctx.fillStyle = '#efe3c8'; ctx.fillText(val, 210 * u, (110 + i * 24) * u);
  });

  // Waveform excerpt.
  const x0 = 32 * u, y0 = 250 * u, w = s - 64 * u, h = 70 * u;
  ctx.strokeStyle = '#5a4c38'; ctx.strokeRect(x0, y0, w, h);
  const tr = v.traceExcerpt;
  if (tr.length > 1) {
    const lo = Math.min(...tr), hi = Math.max(...tr);
    ctx.strokeStyle = '#e6b8a0'; ctx.lineWidth = 1.4 * u;
    ctx.beginPath();
    tr.forEach((val, i) => {
      const x = x0 + (i / (tr.length - 1)) * w;
      const y = y0 + h - ((val - lo) / (hi - lo || 1)) * (h - 8 * u) - 4 * u;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  ctx.font = `${11 * u}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = '#9c8e74';
  ctx.fillText('pulse waveform, last seconds of the sitting (unitless)', x0, y0 + h + 16 * u);
  ctx.fillText(tierText[plate.beatTier], x0, y0 + h + 32 * u);
  ctx.fillText(sourceText[v.source], x0, y0 + h + 48 * u);
  if (v.underexposed) ctx.fillText(`Underexposed: ${v.underexposedReason ?? 'the signal never fully settled'}. No seal.`, x0, y0 + h + 64 * u);

  // Cause log.
  ctx.fillStyle = '#d9cbb0';
  ctx.font = `${13 * u}px "Iowan Old Style", Georgia, serif`;
  ctx.fillText('What happened during the sitting', x0, 420 * u);
  ctx.font = `${11 * u}px ui-monospace, Consolas, monospace`;
  ctx.fillStyle = '#b5a68a';
  const entries = v.ledger.slice(-11);
  entries.forEach((e, i) => {
    const mm = Math.floor(e.at / 60), ss = Math.floor(e.at % 60).toString().padStart(2, '0');
    ctx.fillText(`${mm}:${ss}  ${e.text}`, x0, (442 + i * 15) * u);
  });

  ctx.fillStyle = '#7d705a';
  ctx.fillText('Not a medical device. For portraiture only.', x0, s - 20 * u);
}
