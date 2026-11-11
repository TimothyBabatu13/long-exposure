#!/usr/bin/env node
// Day-1 spike: measure what the SmartSpectra SDK actually delivers on this
// machine, before trusting any design decision that depends on it.
//
//   npm run spike                 # 90 s, default camera
//   npm run spike -- --seconds 60 --out recordings/spike.ndjson
//
// It answers:
//   1. How late does the pulse waveform arrive? (decides waveform/predicted/rate tier)
//   2. How often do packets arrive, and how many trace samples does each carry?
//   3. How often do landmarks, blink and talking update?
//   4. Are there 478 landmarks, and do they follow the expected topology?
//   5. When do pulse rate, breathing rate and HRV first become stable?
//
// Telemetry is OFF. Nothing is written unless --out is given, and then only
// decoded metrics (no frames).
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { SmartSpectraSDK, CameraSelection, cardioMetrics, breathingMetrics, faceMetrics, decodeMetrics } from '@smartspectra/node-sdk';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, all) => {
  if (a.startsWith('--')) acc.push([a.slice(2), all[i + 1]?.startsWith('--') ? true : all[i + 1] ?? true]);
  return acc;
}, []));
const seconds = Number(args.seconds ?? 90);

function env(name) {
  if (process.env[name]) return process.env[name];
  if (existsSync('.env')) {
    const m = readFileSync('.env', 'utf8').match(new RegExp(`^${name}=(.*)$`, 'm'));
    if (m) return m[1].trim();
  }
  return '';
}

const apiKey = env('SMARTSPECTRA_API_KEY');
if (!apiKey) {
  console.error('Set SMARTSPECTRA_API_KEY in .env or the environment first.');
  process.exit(1);
}

const toS = (ts) => (ts == null ? NaN : (typeof ts === 'number' ? ts : ts.toNumber?.() ?? Number(ts)) / 1e6);
const t0 = Date.now() / 1000;
const stats = { packets: 0, traceSamples: 0, lags: [], landmarkUpdates: 0, landmarkCounts: new Set(), validation: {}, firstStable: {} };
const lines = [];

const sdk = new SmartSpectraSDK({
  apiKey,
  requestedMetrics: [...cardioMetrics, ...breathingMetrics, ...faceMetrics],
  enableTelemetry: false,
});

sdk.on('metrics', (buf) => {
  const arrival = Date.now() / 1000;
  const m = decodeMetrics(buf);
  stats.packets++;
  const trace = m.cardio?.arterialPressureTrace ?? [];
  stats.traceSamples += trace.length;
  if (trace.length) stats.lags.push(arrival - toS(trace[trace.length - 1].timestamp));
  const lm = m.face?.landmarks ?? [];
  if (lm.length) { stats.landmarkUpdates += lm.length; stats.landmarkCounts.add(lm[lm.length - 1].value?.length ?? 0); }
  const mark = (key, list) => {
    const last = list?.[list.length - 1];
    if (last?.stable && !stats.firstStable[key]) stats.firstStable[key] = +(arrival - t0).toFixed(1);
  };
  mark('pulseRate', m.cardio?.pulseRate);
  mark('breathingRate', m.breathing?.rate);
  mark('hrv', m.cardio?.hrv);
  if (args.out) lines.push(JSON.stringify({ arrival, metrics: m.toJSON ? m.toJSON() : m }));
});
sdk.on('validationStatus', (code) => { stats.validation[code] = (stats.validation[code] ?? 0) + 1; });
sdk.on('error', (code, message) => console.error(`SDK error ${code}: ${message}`));

const pct = (xs, p) => { const a = [...xs].sort((x, y) => x - y); return a.length ? a[Math.floor((a.length - 1) * p)] : NaN; };

function report(final = false) {
  const el = Date.now() / 1000 - t0;
  console.log(`\n[${el.toFixed(0)} s] packets ${(stats.packets / el).toFixed(1)}/s · trace samples/packet ${(stats.traceSamples / Math.max(1, stats.packets)).toFixed(1)} · trace rate ${(stats.traceSamples / el).toFixed(1)} Hz`);
  console.log(`  waveform lag p50 ${pct(stats.lags, 0.5).toFixed(3)} s · p90 ${pct(stats.lags, 0.9).toFixed(3)} s  (needs < 0.3 s for the "waveform" tier)`);
  console.log(`  landmark updates ${(stats.landmarkUpdates / el).toFixed(1)}/s · point counts seen: ${[...stats.landmarkCounts].join(', ') || 'none'}`);
  console.log(`  first stable (s): ${JSON.stringify(stats.firstStable)} · validation codes: ${JSON.stringify(stats.validation)}`);
  if (final) {
    const lag = pct(stats.lags, 0.5);
    const tier = Number.isNaN(lag) ? 'rate (no waveform received)' : lag < 0.3 ? 'waveform' : lag < 3 ? 'predicted' : 'rate';
    console.log(`\nVerdict: beat tier = ${tier}. Clock check: lag values far from 0..5 s mean SDK timestamps are not epoch-based.`);
  }
}

sdk.useCamera(CameraSelection.default);
sdk.start();
console.log(`Measuring for ${seconds} s. Sit still, face the camera, good light. Telemetry off.`);
const timer = setInterval(() => report(), 5000);

setTimeout(async () => {
  clearInterval(timer);
  report(true);
  await sdk.stopAsync();
  await sdk.destroy();
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, lines.join('\n'));
    console.log(`Wrote ${lines.length} decoded packets to ${args.out} (no frames).`);
  }
  process.exit(0);
}, seconds * 1000);
