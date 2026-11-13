// Exports. Nothing is written to disk except through these functions, and
// each one goes through a save dialog the sitter controls.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Plate, Point } from '../../shared/types';
import { PlateRenderer } from '../render/plate';
import { loopLength, plateFrameAt } from '../render/loop';

/** A small looping GIF (DEV comments render GIFs, not video). */
export async function plateGif(plate: Plate, opts: { size?: number; fps?: number; gentle: boolean; ghosts: boolean }): Promise<Uint8Array> {
  const size = opts.size ?? 480, fps = opts.fps ?? 15;
  const canvas = document.createElement('canvas');
  const r = new PlateRenderer(canvas, size);
  const gif = GIFEncoder();
  const L = loopLength(plate);
  const frames = Math.round(L * fps);
  try {
    for (let i = 0; i < frames; i++) {
      r.render(plateFrameAt(plate, i / fps, { gentle: true, ghosts: opts.ghosts }));
      const rgba = r.pixels();
      const palette = quantize(rgba, 128);
      gif.writeFrame(applyPalette(rgba, palette), size, size, { palette, delay: Math.round(1000 / fps) });
      if (i % 5 === 0) await new Promise((res) => setTimeout(res, 0)); // keep the UI responsive
    }
    gif.finish();
    return gif.bytes();
  } finally {
    r.dispose();
  }
}

export async function canvasPng(canvas: HTMLCanvasElement): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('PNG export failed'))), 'image/png'));
  return new Uint8Array(await blob.arrayBuffer());
}

export function plateJson(plate: Plate): string {
  return JSON.stringify({
    ...plate,
    _note: 'Long Exposure plate. Contains no camera frames, but it is derived from biometrics (face geometry, heart and breath rhythm). Share it as you would a photo.',
  }, null, 1);
}

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const isPoint = (q: unknown) => !!q && isNum((q as Point).x) && isNum((q as Point).y);
const numsOrNull = (v: unknown) => v == null || isNum(v);

/**
 * Reads someone else's plate file. Everything it draws or prints is checked,
 * so a damaged or hand-made file is refused rather than half-rendered.
 */
export function parsePlate(text: string): Plate {
  const bad = (why: string): never => { throw new Error(`Not a usable Long Exposure plate (${why})`); };
  let p: Plate;
  try { p = JSON.parse(text); } catch { return bad('not JSON'); }
  if (p?.format !== 'long-exposure/plate@1') bad('unknown format');
  if (!Array.isArray(p.face) || p.face.length < 3 || p.face.length > 1000 || !p.face.every(isPoint)) bad('face');
  if (!Array.isArray(p.beats) || p.beats.length > 200 || !p.beats.every(isNum)) bad('beats');
  if (!isNum(p.breathPeriod) || p.breathPeriod <= 0 || p.breathPeriod > 20) bad('breath period');
  if (p.breathCurve != null && (!Array.isArray(p.breathCurve) || p.breathCurve.length > 1000 || !p.breathCurve.every(isNum))) bad('breath curve');
  if (!Array.isArray(p.ghosts) || !p.ghosts.every((g) => Array.isArray(g) && g.every(isPoint))) bad('ghosts');
  if (p.smile != null && (!Array.isArray(p.smile) || !p.smile.every(isPoint))) bad('smile');
  if (typeof p.sitterLabel !== 'string' || p.sitterLabel.length > 80) bad('name');
  if (p.seal != null) {
    const sp = p.seal as unknown as Record<string, unknown>;
    if (!Object.values(sp).every(isNum) || !isNum(sp.lobes) || sp.lobes > 64 || !isNum(sp.rings) || sp.rings > 64) bad('seal');
  }
  const v = p.verso;
  if (!v || ![v.pulseBpm, v.breathRpm, v.rmssd, v.sdnn, v.pulseConfidence].every(numsOrNull)) bad('readouts');
  if (!Array.isArray(v.traceExcerpt) || !v.traceExcerpt.every(isNum) || !Array.isArray(v.ledger)) bad('verso');
  return p;
}
