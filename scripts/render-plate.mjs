#!/usr/bin/env node
// Render a plate from a recorded sitting in fixed states (dev tool for tuning
// the look). Usage: npm run render:plate -- <recording.ndjson> [outDir]
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const rec = process.argv[2];
if (!rec) { console.error('Usage: npm run render:plate -- <recording.ndjson> [outDir]'); process.exit(1); }
const out = resolve(process.argv[3] ?? 'renders');
const shell = process.platform === 'win32';
const build = spawnSync('npx', ['electron-vite', 'build'], { stdio: 'inherit', shell });
if (build.status !== 0) process.exit(build.status ?? 1);
const run = spawnSync('npx', ['electron', '.'], {
  stdio: 'inherit', shell,
  env: { ...process.env, LE_HARNESS: resolve(rec), LE_HARNESS_OUT: out, SMARTSPECTRA_API_KEY: '' },
});
process.exit(run.status ?? 0);
