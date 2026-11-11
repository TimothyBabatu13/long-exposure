// Exports. Nothing is written to disk except through these functions, and
// each one goes through a save dialog the sitter controls.
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { Plate } from '../../shared/types';
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

export function parsePlate(text: string): Plate {
  const p = JSON.parse(text);
  if (p?.format !== 'long-exposure/plate@1' || !Array.isArray(p.face)) throw new Error('Not a Long Exposure plate file');
  return p as Plate;
}
