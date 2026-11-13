import { describe, expect, it } from 'vitest';
import { parsePlate, plateJson } from '../src/renderer/ui/export';
import { sealFrom } from '../src/renderer/render/seal';
import { syntheticFace } from '../src/renderer/signal/synthetic';
import type { Plate } from '../src/shared/types';

const good: Plate = {
  format: 'long-exposure/plate@1', createdAt: '2026-11-13T12:00:00Z', sitterLabel: 'Sitter',
  face: syntheticFace(), beats: [0.1, 0.9, 1.7], beatTier: 'predicted', breathPeriod: 5.6,
  breathCurve: Array.from({ length: 96 }, (_, i) => 0.5 + 0.5 * Math.sin(i / 15)),
  blinkTimes: [], ghosts: [], smile: null, seal: sealFrom({ bpm: 72, rpm: 15, rmssd: 35, sdnn: 45 }), head: 'soft',
  verso: { pulseBpm: 72, breathRpm: 15, rmssd: null, sdnn: null, pulseConfidence: 80, traceExcerpt: [0.1, 0.2], ledger: [], source: 'live', underexposed: false },
};

describe('plate files', () => {
  it('reads back a plate the studio saved', () => {
    expect(parsePlate(plateJson(good)).face.length).toBe(478);
  });

  it('refuses damaged or hand-made files', () => {
    const variant = (patch: Record<string, unknown>) => JSON.stringify({ ...good, ...patch });
    expect(() => parsePlate('not json')).toThrow();
    expect(() => parsePlate(variant({ format: 'other' }))).toThrow();
    expect(() => parsePlate(variant({ face: [{ x: 'a', y: 1 }, { x: 1, y: 1 }, { x: 2, y: 2 }] }))).toThrow();
    expect(() => parsePlate(variant({ beats: [1, null] }))).toThrow();
    expect(() => parsePlate(variant({ breathPeriod: 9999 }))).toThrow();
    expect(() => parsePlate(variant({ seal: { ...good.seal, rings: 1e9 } }))).toThrow();
    expect(() => parsePlate(variant({ verso: { ...good.verso, pulseBpm: 'fast' } }))).toThrow();
  });
});
