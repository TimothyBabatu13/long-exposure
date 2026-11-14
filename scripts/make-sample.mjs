#!/usr/bin/env node
// Make a small replay sample from a recorded sitting (dev tool):
//   node scripts/make-sample.mjs <recording.ndjson> <out.ndjson> [endSeconds]
// Skips the SDK start-up wait, ends shortly after the plate develops, keeps
// every second set of face landmarks (15/s is plenty for playback) and rounds
// them to 0.1 px. Signals (pulse, breathing, blinks, talking) are kept whole.
import { readFileSync, writeFileSync } from 'node:fs';

const [src, out, endArg] = process.argv.slice(2);
if (!src || !out) { console.error('Usage: node scripts/make-sample.mjs <recording.ndjson> <out.ndjson> [endSeconds]'); process.exit(1); }
const end = Number(endArg ?? 100);
const evs = readFileSync(src, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l));
const runAt = evs.find((x) => x.e.type === 'running' && x.e.running)?.at ?? 0;
const start = Math.max(0, runAt - 1);
let lm = 0;
const kept = [];
for (const x of evs) {
  if (x.at < start || x.at > end) continue;
  const e = structuredClone(x.e);
  if (e.type === 'packet' && e.packet.landmarks) {
    if (lm++ % 2) delete e.packet.landmarks;
    else e.packet.landmarks.points = e.packet.landmarks.points.map((p) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 }));
  }
  kept.push(JSON.stringify({ at: Math.round((x.at - start) * 1000) / 1000, e }));
}
writeFileSync(out, kept.join('\n') + '\n');
console.log(`${kept.length} events, ${(end - start).toFixed(0)} s, start-up wait of ${start.toFixed(1)} s skipped -> ${out}`);
