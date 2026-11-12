// Dev check: replays a recorded live sitting through the same signal and stage
// code as the app (BeatTracker, Sitting; see src/renderer/main.ts) and prints
// the ledger, so stage logic can be tuned without another live sitting.
import { readFileSync } from 'node:fs';
import { it } from 'vitest';

// Run with: REC=recordings/<file>.ndjson npx vitest run test/replay.test.ts
// Skipped unless REC points at a recording (recordings are never committed).
import { BeatTracker } from '../src/renderer/signal/beats';
import { Sitting } from '../src/renderer/sitting/machine';
import type { Readiness, SourceEvent } from '../src/shared/types';

it.skipIf(!process.env.REC)('replays a recorded sitting through the stage machine', () => {
  const lines = readFileSync(process.env.REC!, 'utf8').split('\n').filter(Boolean);
  const evs = lines.map((l) => JSON.parse(l) as { at: number; e: SourceEvent });
  const beats = new BeatTracker();
  const sitting = new Sitting((e) => console.log(`  ${e.at.toFixed(1).padStart(6)}s  ${e.kind}: ${e.text}`));
  let running = false, readiness: Readiness = 'no-face', talking = false;
  let pulse: { ready: boolean } | null = null, breathReady = false, hrvReady = false;
  let clock = 0, wall = 0;
  const tick = (to: number) => {
    while (clock + 1 / 30 <= to) {
      clock += 1 / 30;
      sitting.tick(1 / 30, { readiness, talking, windowFocused: true, running,
        pulseReady: !!pulse?.ready && beats.tier(wall) != null, breathReady, hrvReady });
    }
  };
  for (const { at, e } of evs) {
    tick(at);
    if (e.type === 'running') running = e.running;
    else if (e.type === 'readiness') readiness = e.readiness;
    else if (e.type === 'packet') {
      const p = e.packet; wall = p.arrival;
      if (p.pulseTrace) beats.push(p.pulseTrace, p.arrival);
      if (p.pulseRate) { beats.setRate(p.pulseRate.bpm); pulse = { ready: p.pulseRate.stable || p.pulseRate.confidence >= 40 }; }
      if (p.breathRate) breathReady = p.breathRate.stable;
      if (p.hrv) hrvReady = p.hrv.stable;
      if (p.talking?.length) talking = p.talking[p.talking.length - 1].detected;
    }
  }
  console.log(`  RESULT stage=${sitting.stage} underexposed=${sitting.underexposed} exposure=${sitting.exposure.toFixed(1)}s beats=${beats.confirmedBeats.length} tier=${beats.tier(wall)}`);
});
