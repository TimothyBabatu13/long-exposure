#!/usr/bin/env node
// Unattended synthetic sitting: builds, launches the app with no API key, and
// saves a screenshot of each stage to ./smoke (or the folder given).
import { spawnSync, spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? 'smoke');
mkdirSync(dir, { recursive: true });
const shell = process.platform === 'win32';
const build = spawnSync('npx', ['electron-vite', 'build'], { stdio: 'inherit', shell });
if (build.status !== 0) process.exit(build.status ?? 1);
const child = spawn('npx', ['electron', '.'], {
  stdio: 'inherit',
  shell,
  env: { ...process.env, LE_SMOKE_DIR: dir, SMARTSPECTRA_API_KEY: '' },
});
child.on('exit', (code) => {
  console.log(`Screenshots in ${dir}`);
  process.exit(code ?? 0);
});
