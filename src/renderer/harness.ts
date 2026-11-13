// Dev-only render harness (npm run render:plate): draws a plate from a recorded
// sitting in several fixed states with the real PlateRenderer, so the look can
// be tuned and compared without a live sitting. Not part of the app's UI.
import type { Point } from '../shared/types';
import { PlateRenderer, type FrameState } from './render/plate';
import { sealFrom } from './render/seal';
import { drawGuide, frameFor, placement } from './ui/framing';

interface HarnessState { name: string; frame: Partial<FrameState> }

const STATES: HarnessState[] = [
  { name: '1-focusing', frame: { development: 0.45 } },
  { name: '2-heartbeat', frame: { development: 0.8, flush: 1, travel: 0.35 } },
  { name: '3-inhale', frame: { development: 0.9, breath: 1 } },
  { name: '4-developed', frame: { development: 1, seal: { params: sealFrom({ bpm: 72, rpm: 15, rmssd: 35, sdnn: 45 }), progress: 1 } } },
  { name: '5-underexposed', frame: { development: 1 } },
  { name: '6-head-dark', frame: { development: 1, head: 'dark' } },
  { name: '7-head-bare', frame: { development: 1, head: 'bare' } },
];

declare global {
  interface Window {
    __harness(face: Point[], size: number): Promise<{ name: string; png: string }[]>;
    __guide(raw: Point[]): { name: string; png: string }[];
  }
}

window.__harness = async (face, size) => {
  const canvas = document.createElement('canvas');
  document.body.append(canvas);
  const r = new PlateRenderer(canvas, size);
  const out: { name: string; png: string }[] = [];
  const sheet = document.createElement('canvas');
  const cols = 3, rows = Math.ceil(STATES.length / cols), cell = Math.round(size / 2);
  sheet.width = cols * cell; sheet.height = rows * cell;
  const sctx = sheet.getContext('2d')!;
  sctx.fillStyle = '#0d0c0a'; sctx.fillRect(0, 0, sheet.width, sheet.height);
  STATES.forEach((st, i) => {
    r.render({
      face, topologyOk: face.length >= 468, flush: 0, travel: 1, breath: 0.5, development: 1,
      ghosts: [], smile: null, seal: null, capped: false, gentle: true, time: 0,
      ...st.frame,
    });
    out.push({ name: st.name, png: canvas.toDataURL('image/png') });
    sctx.drawImage(canvas, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
    sctx.fillStyle = '#d9cbb0'; sctx.font = `${Math.round(cell / 22)}px Georgia, serif`;
    sctx.fillText(st.name, (i % cols) * cell + 10, Math.floor(i / cols) * cell + cell / 14);
  });
  out.push({ name: '0-sheet', png: sheet.toDataURL('image/png') });
  r.dispose();
  return out;
};

// The framing guide for one recorded face: as recorded, shifted off-centre, and too far away.
window.__guide = (raw) => {
  const fr = frameFor(1280, 720);
  const cx = raw.reduce((a, p) => a + p.x, 0) / raw.length, cy = raw.reduce((a, p) => a + p.y, 0) / raw.length;
  const variants: [string, Point[]][] = [
    ['guide-1-as-recorded', raw],
    ['guide-2-off-left', raw.map((p) => ({ x: p.x + 260, y: p.y }))],
    ['guide-3-too-far', raw.map((p) => ({ x: cx + (p.x - cx) * 0.5, y: cy + (p.y - cy) * 0.5 }))],
  ];
  return variants.map(([name, pts]) => {
    const c = document.createElement('canvas'); c.width = 576; c.height = 324;
    const ctx = c.getContext('2d')!;
    const pl = placement(pts, fr);
    drawGuide(ctx, pts, fr, pl);
    ctx.fillStyle = '#d9cbb0'; ctx.font = '16px Georgia, serif';
    ctx.fillText(pl?.ok ? 'Well placed' : pl?.advice ?? '', 10, c.height - 10);
    const out = document.createElement('canvas'); out.width = c.width; out.height = c.height;
    const o = out.getContext('2d')!; o.fillStyle = '#1a1714'; o.fillRect(0, 0, c.width, c.height); o.drawImage(c, 0, 0);
    return { name, png: out.toDataURL('image/png') };
  });
};
