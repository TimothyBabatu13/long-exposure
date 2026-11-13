// The studio: wires signal sources, the sitting, the renderer and the UI.
import type { Plate, Point, Readiness, SourceEvent, LedgerEntry, BeatTier, HeadStyle } from '../shared/types';
import { BeatTracker } from './signal/beats';
import { BreathTracker } from './signal/breath';
import { LiveSource, ReplaySource, SyntheticSource, type SignalSource } from './signal/sources';
import { Sitting, pauseCopy, type Stage } from './sitting/machine';
import { PlateRenderer, type FrameState } from './render/plate';
import { LEFT_EYE, LIPS_OUTER, RIGHT_EYE, normalise, smoothToward, topologyLooksRight } from './render/landmarks';
import { sealFrom } from './render/seal';
import { beatsForLoop, plateFrameAt } from './render/loop';
import { drawVerso } from './render/verso';
import { Heartbeat } from './ui/audio';
import { canvasPng, parsePlate, plateGif, plateJson } from './ui/export';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const isWeb = typeof __WEB_BUILD__ !== 'undefined' && __WEB_BUILD__;
const bridge = window.studio;

// ---------------------------------------------------------------------------
// Configuration and the welcome screen
// ---------------------------------------------------------------------------
let config = { hasApiKey: false, telemetry: false, record: false, version: 'web' };
let replayText: string | null = null;

async function init(): Promise<void> {
  if (bridge) config = { ...config, ...(await bridge.config()) };
  const banner = $('source-banner');
  if (isWeb || !bridge) {
    banner.textContent = 'Web demo: no camera is used. You will watch a SYNTHETIC sitting, or a recorded one you load. Install the app for a live sitting.';
    banner.classList.add('warn');
  } else if (!config.hasApiKey) {
    banner.textContent = 'No SmartSpectra API key found (SMARTSPECTRA_API_KEY). The studio will run a SYNTHETIC demo sitting. See README for setup.';
    banner.classList.add('warn');
  } else {
    banner.textContent = `Live sitting: SmartSpectra SDK on this device's camera. Telemetry ${config.telemetry ? 'ON (you opted in)' : 'off'}.`;
  }
  $('telemetry-line').textContent = config.telemetry ? 'You opted in to Presage telemetry (usage reports, no frames or vitals).' : 'Presage telemetry is off.';
  $('net-telemetry').textContent = config.telemetry ? 'on (opted in)' : 'off';
  bridge?.onNetwork((e) => {
    netCount++;
    $('net-count').textContent = String(netCount);
    addLedger({ at: sitting?.exposure ?? 0, kind: 'privacy', text: `blocked request to ${new URL(e.url).host}` });
  });

  $('btn-sit').addEventListener('click', () => void begin());
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && $('welcome').classList.contains('active')) void begin();
  });
  $<HTMLInputElement>('replay-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (!f) return;
    replayText = await f.text();
    void begin();
  });
  for (const id of ['btn-leave', 'btn-leave2']) $(id).addEventListener('click', leaveStudio);
  $('btn-again').addEventListener('click', () => { void stopSource(); resetSitting(); show('welcome'); });
  // Mute or replay the finished plate's heartbeat; playing again restarts the fade.
  $('btn-sound').addEventListener('click', () => { heart.enabled = !heart.enabled; resultBeats = 0; updateSoundButton(); });
  $('btn-flip').addEventListener('click', () => $('flip').classList.toggle('turned'));
  $('btn-gif').addEventListener('click', () => void exportGif());
  $('btn-png').addEventListener('click', () => void exportPng());
  $('btn-verso').addEventListener('click', () => void save('verso.png', canvasPng($('back')), 'PNG image', 'png'));
  $('btn-plate').addEventListener('click', () => plate && void save(`${slug()}.plate.json`, Promise.resolve(plateJson(plate)), 'Plate', 'json'));
  $('btn-record').addEventListener('click', () => {
    // The live source is stopped (and dropped) when the plate develops, so the
    // recording is taken from it at that moment and kept here until saved or wiped.
    const rec = source instanceof LiveSource ? source.takeRecording() : lastRecording;
    if (!rec) { toast('No session recording is available for this sitting.'); return; }
    void save(`${slug()}.ndjson`, Promise.resolve(rec), 'Session recording', 'ndjson');
  });
  if (bridge) $('btn-pair').addEventListener('click', async () => { const t = await bridge.openPlate(); if (t) pairWith(t); });
  else { $('btn-pair').hidden = true; $('pair-web').hidden = false; }
  $<HTMLInputElement>('pair-file').addEventListener('change', async (e) => {
    const f = (e.target as HTMLInputElement).files?.[0];
    if (f) pairWith(await f.text());
  });

  // The unattended smoke test runs behind other windows; everywhere else, leaving the window caps the lens.
  if (!new URLSearchParams(location.search).has('smoke')) {
    window.addEventListener('blur', () => { focused = false; });
    window.addEventListener('focus', () => { focused = true; });
    document.addEventListener('visibilitychange', () => { focused = document.visibilityState === 'visible' && document.hasFocus(); });
  }
}

function show(id: 'welcome' | 'studio' | 'result'): void {
  for (const s of document.querySelectorAll('.screen')) s.classList.toggle('active', s.id === id);
}

function toast(msg: string): void {
  const t = $('toast');
  t.textContent = msg; t.hidden = false;
  window.setTimeout(() => { t.hidden = true; }, 6000);
}

// ---------------------------------------------------------------------------
// Sitting state
// ---------------------------------------------------------------------------
let source: SignalSource | null = null;
let sitting: Sitting | null = null;
let renderer: PlateRenderer | null = null;
const beats = new BeatTracker();
const breath = new BreathTracker();
const heart = new Heartbeat();
let raf = 0;
let netCount = 0;
let focused = true;
let running = false;
let readiness: Readiness = 'no-face';
let readinessHint = '';
/** NDJSON of the last live sitting, kept in memory only until saved, a new sitting, or Leave. */
let lastRecording: string | null = null;
let talking = false;
let blinking = false;
let lastBlinkAt = 0;
let pulse: { bpm: number; confidence: number; ready: boolean } | null = null;
let breathRate: { rpm: number; ready: boolean } | null = null;
let hrv: { rmssd: number; sdnn: number; ready: boolean } | null = null;
let face: Point[] | null = null;
let faceSum: Point[] | null = null;
let faceN = 0;
let topologyOk = false;
let ghosts: Point[][] = [];
let smileSince: number | null = null;
let smile: Point[] | null = null;
let blinkTimes: number[] = [];
let lastSince = Infinity;
let tierSeen: BeatTier = 'rate';
let plate: Plate | null = null;
let pair: Plate | null = null;
let opts: { sound: boolean; ghosts: boolean; gentle: boolean; mirror: boolean; name: string; head: HeadStyle } =
  { sound: true, ghosts: true, gentle: false, mirror: false, name: 'Sitter', head: 'soft' };

function resetSitting(): void {
  cancelAnimationFrame(raf);
  beats.reset(); breath.reset();
  lastRecording = null;
  sitting = null; running = false; readiness = 'no-face'; readinessHint = ''; talking = false; blinking = false;
  pulse = null; breathRate = null; hrv = null; face = null; faceSum = null; faceN = 0;
  ghosts = []; smile = null; smileSince = null; blinkTimes = []; lastSince = Infinity;
  plate = null; pair = null; replayText = null;
  $('ledger-log').replaceChildren();
  $('flip').classList.remove('turned');
  document.querySelector('.pair')?.remove();
  $('flip').hidden = false;
}

function addLedger(e: LedgerEntry): void {
  console.log(`[studio] ledger ${e.at.toFixed(1)}s ${e.kind}: ${e.text}`);
  const li = document.createElement('li');
  const mm = Math.floor(e.at / 60), ss = Math.floor(e.at % 60).toString().padStart(2, '0');
  const b = document.createElement('b');
  b.textContent = `${mm}:${ss}`;
  li.append(b, e.text);
  const log = $('ledger-log');
  log.append(li);
  log.scrollTop = log.scrollHeight;
}

async function begin(): Promise<void> {
  if (!$('welcome').classList.contains('active')) return;
  opts = {
    sound: $<HTMLInputElement>('opt-sound').checked,
    ghosts: $<HTMLInputElement>('opt-ghosts').checked,
    gentle: $<HTMLInputElement>('opt-gentle').checked,
    mirror: $<HTMLInputElement>('opt-mirror').checked,
    name: $<HTMLInputElement>('opt-name').value.trim() || 'Sitter',
    head: $<HTMLSelectElement>('opt-head').value as HeadStyle,
  };
  heart.enabled = opts.sound;
  heart.volume = 0.5;
  const pending = replayText;
  resetSitting();
  replayText = pending;

  if (replayText) source = new ReplaySource(replayText);
  else if (!isWeb && bridge && config.hasApiKey) source = new LiveSource(bridge, opts.mirror, config.record);
  else source = new SyntheticSource();
  $('net-source').textContent = source.kind;
  $('btn-record').hidden = !(source.kind === 'live' && config.record);

  sitting = new Sitting(addLedger);
  sitting.log('privacy', `sitting agreed. Telemetry ${config.telemetry ? 'on' : 'off'}. Source: ${source.kind}`);
  // One renderer per canvas for the whole session: a canvas keeps its WebGL context.
  renderer ??= new PlateRenderer($<HTMLCanvasElement>('plate'), 720);
  show('studio');

  source.on(onSource);
  try {
    await source.start();
    if (source.kind === 'live') { $('lens-dot').classList.add('open'); $('lens-text').textContent = 'Camera on · processed on this device'; }
    else $('lens-text').textContent = source.kind === 'synthetic' ? 'No camera · synthetic sitting' : 'No camera · replay';
  } catch (err) {
    toast(`Could not start the camera: ${(err as Error).message}`);
    await stopSource();
    show('welcome');
    return;
  }
  let last = performance.now();
  const loop = (now: number) => {
    raf = requestAnimationFrame(loop);
    // Capped frame rate: the SDK shares the CPU, and the plate's motion is slow.
    if (now - last < 1000 / STUDIO_FPS - 2) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    frame(dt);
  };
  raf = requestAnimationFrame(loop);
}

/** Redraw rates. The plate moves slowly (flush, breath), so these look smooth and keep the fan quiet. */
const STUDIO_FPS = 30;
const RESULT_FPS = 24;
/** On the finished plate the heartbeat plays this many beats, then fades out over RESULT_FADE_BEATS. */
const RESULT_BEATS = 8;
const RESULT_FADE_BEATS = 4;
const RESULT_VOLUME = 0.25;

function onSource(e: SourceEvent): void {
  if (!sitting) return;
  switch (e.type) {
    case 'running': running = e.running; return;
    case 'readiness': readiness = e.readiness; readinessHint = e.hint; return;
    case 'error':
      console.log(`[studio] error (fatal=${e.fatal}): ${e.message}`);
      toast(e.message);
      if (e.fatal) { void stopSource(); resetSitting(); show('welcome'); }
      return;
    case 'packet': break;
  }
  const p = e.packet;
  if (p.pulseTrace) beats.push(p.pulseTrace, p.arrival);
  if (p.pulseRate) {
    beats.setRate(p.pulseRate.bpm);
    pulse = { bpm: p.pulseRate.bpm, confidence: p.pulseRate.confidence, ready: p.pulseRate.stable || p.pulseRate.confidence >= 40 };
  }
  if (p.breathTrace) breath.push(p.breathTrace);
  if (p.breathRate) {
    breath.setRate(p.breathRate.rpm, p.breathRate.stable);
    breathRate = { rpm: p.breathRate.rpm, ready: p.breathRate.stable };
  }
  if (p.hrv) hrv = { rmssd: p.hrv.rmssd, sdnn: p.hrv.sdnn, ready: p.hrv.stable };
  if (p.talking?.length) {
    talking = p.talking[p.talking.length - 1].detected;

  }
  if (p.landmarks) {
    topologyOk = topologyLooksRight(p.landmarks.points);
    face = smoothToward(face, normalise(p.landmarks.points), 0.35);
  }
  const wall = Date.now() / 1000;
  if (p.blinking?.length) {
    const now = p.blinking.some((b) => b.detected);
    if (now && !blinking && wall - lastBlinkAt > 0.4) onBlink(wall);
    blinking = now;
  }
  if (p.smile) {
    if (p.smile.confidence > 60) {
      smileSince ??= wall;
      if (!smile && wall - smileSince >= 3 && face && sitting.pause == null) {
        smile = LIPS_OUTER.map((i) => ({ ...face![i] }));
        sitting.log('smile', 'a smile held for 3 s: exposed into the plate');
      }
    } else smileSince = null;
  }
}

function onBlink(wall: number): void {
  lastBlinkAt = wall;
  if (!sitting || !face || sitting.pause != null || sitting.stage === 'developed') return;
  blinkTimes.push(sitting.exposure);
  if (opts.ghosts && ghosts.length < 8 && topologyOk) {
    // The eyes as they were just before closing, slightly displaced: a double exposure.
    const dx = 0.004 + 0.003 * ghosts.length;
    for (const idx of [RIGHT_EYE, LEFT_EYE]) ghosts.push(idx.map((i) => ({ x: face![i].x + dx, y: face![i].y - dx / 2 })));
    sitting.log('blink', 'blink: ghost left in the eyes');
  } else {
    sitting.log('blink', 'blink');
  }
}

function frame(dt: number): void {
  if (!sitting || !renderer) return;
  const wall = Date.now() / 1000;
  const stage: Stage = sitting.tick(dt, {
    readiness, talking, windowFocused: focused, running,
    pulseReady: !!pulse?.ready && beats.tier(wall) != null,
    breathReady: !!breathRate?.ready,
    hrvReady: !!hrv?.ready,
  });

  // Freeze the breath only for sustained talking (the lens is capped for it), not for flicker.
  breath.hold(sitting.pause === 'talking');

  if (stage === 'abandoned') {
    void stopSource();
    toast('A second face appeared. The sitting stopped and nothing was kept.');
    resetSitting();
    show('welcome');
    return;
  }

  // Accumulate the face geometry over still moments for the final plate.
  // (silent too: a brief word no longer caps the lens, but it would open the mouth on the plate).
  if (face && sitting.pause == null && !talking) {
    if (faceSum && faceSum.length === face.length) {
      faceSum = faceSum.map((q, i) => ({ x: q.x + face![i].x, y: q.y + face![i].y }));
      faceN++;
    } else {
      faceSum = face.map((q) => ({ ...q }));
      faceN = 1;
    }
  }

  const beating = stage === 'heart' || stage === 'breath' || stage === 'fixing';
  let flush = 0, travel = 1;
  if (beating && sitting.pause == null) {
    const ph = beats.phase(wall);
    if (ph) {
      tierSeen = ph.tier;
      if (ph.sinceBeat < lastSince) heart.beat(0);
      lastSince = ph.sinceBeat;
      flush = ph.sinceBeat < 0.08 ? ph.sinceBeat / 0.08 : Math.exp(-(ph.sinceBeat - 0.08) / (Math.max(0.25, ph.period * 0.55) / 3));
      travel = Math.min(1, ph.sinceBeat / 0.45);
    }
  }
  const breathing = stage === 'breath' || stage === 'fixing' || stage === 'developed';
  const fixing = stage === 'fixing' || stage === 'developed';
  const state: FrameState = {
    face, topologyOk, flush, travel,
    breath: breathing ? breath.value(wall) : 0.5,
    development: stage === 'developed' ? 1 : 0.12 + 0.88 * sitting.progress,
    ghosts, smile,
    seal: fixing && !sitting.underexposed ? { params: currentSeal(), progress: Math.min(1, (sitting.exposure - 60) / 3) } : null,
    capped: sitting.pause != null && sitting.pause !== 'starting',
    gentle: opts.gentle, time: wall, head: opts.head,
  };
  renderer.render(state);

  $('progress-fill').style.width = `${sitting.progress * 100}%`;
  // For framing problems the SDK's own hint ("chest not visible", "face too low"…) is more useful than ours.
  $('caption').textContent = sitting.pause === 'framing' && readinessHint ? readinessHint
    : sitting.pause ? pauseCopy[sitting.pause] : stageCopy[stage];

  if (opts.mirror && source?.preview) {
    const v = $<HTMLVideoElement>('mirror');
    if (v.srcObject !== source.preview) { v.srcObject = source.preview; v.hidden = false; }
  }

  if (stage === 'developed') {
    cancelAnimationFrame(raf);
    finish();
  }
}

const stageCopy: Record<Stage, string> = {
  focusing: 'Focusing… sit still, eyes to the lens.',
  heart: 'Exposing the heart.',
  breath: 'Exposing the breath.',
  fixing: 'Fixing the plate.',
  developed: '',
  abandoned: '',
};

function currentSeal() {
  // Without SDK HRV, the seal's variation comes from the beat-to-beat intervals
  // of the detected pulse peaks. This only shapes the artwork; the verso never
  // shows these as HRV readings.
  const v = hrv ? { a: hrv.rmssd, b: hrv.sdnn } : beatVariation(beats.confirmedBeats);
  return sealFrom({ bpm: pulse?.bpm ?? null, rpm: breathRate?.rpm ?? null, rmssd: v?.a ?? null, sdnn: v?.b ?? null });
}

/** Successive-difference and spread (ms) of the last beat intervals, or null if too few. */
function beatVariation(beatTimes: readonly number[]): { a: number; b: number } | null {
  const iv = beatTimes.slice(-31).slice(1).map((t, i) => (t - beatTimes.slice(-31)[i]) * 1000);
  if (iv.length < 8) return null;
  const diffs = iv.slice(1).map((x, i) => x - iv[i]);
  const mean = iv.reduce((s, x) => s + x, 0) / iv.length;
  return {
    a: Math.sqrt(diffs.reduce((s, d) => s + d * d, 0) / diffs.length),
    b: Math.sqrt(iv.reduce((s, x) => s + (x - mean) ** 2, 0) / iv.length),
  };
}

// ---------------------------------------------------------------------------
// The finished plate
// ---------------------------------------------------------------------------
function finish(): void {
  if (!sitting) return;
  const wall = Date.now() / 1000;
  const L = Math.min(6, Math.max(3, breath.period ?? 4));
  const avgFace = faceSum && faceN > 0 ? faceSum.map((q) => ({ x: q.x / faceN, y: q.y / faceN })) : face ?? [];
  const trace = beats.trace.filter((s) => s.t > beats.toSignal(wall) - 6).map((s) => s.v);
  const step = Math.max(1, Math.ceil(trace.length / 240));
  plate = {
    format: 'long-exposure/plate@1',
    createdAt: new Date().toISOString(),
    sitterLabel: opts.name,
    face: avgFace,
    beats: tierSeen === 'rate' ? beatsForLoop([], 0, L, pulse?.bpm ?? null) : beatsForLoop(beats.confirmedBeats, beats.toSignal(wall), L, pulse?.bpm ?? null),
    beatTier: tierSeen,
    breathPeriod: L,
    blinkTimes,
    ghosts: opts.ghosts ? ghosts : [],
    smile,
    seal: sitting.underexposed ? null : currentSeal(),
    head: opts.head,
    verso: {
      pulseBpm: pulse?.bpm ?? null,
      breathRpm: breathRate?.rpm ?? null,
      rmssd: hrv?.rmssd ?? null,
      sdnn: hrv?.sdnn ?? null,
      pulseConfidence: pulse?.confidence ?? null,
      traceExcerpt: trace.filter((_, i) => i % step === 0),
      ledger: [...sitting.ledger],
      source: source?.kind ?? 'synthetic',
      underexposed: sitting.underexposed,
      underexposedReason: sitting.underexposedReason,
    },
  };
  // The plate is made; release the camera now.
  void stopSource();
  showPlate(plate);
}

let resultRaf = 0;
let frontRenderer: PlateRenderer | null = null;
function showPlate(p: Plate): void {
  show('result');
  const front = (frontRenderer ??= new PlateRenderer($<HTMLCanvasElement>('front'), 720));
  const back = $<HTMLCanvasElement>('back');
  back.width = 720; back.height = 720;
  drawVerso(back, p);
  $('endcard').textContent = `0 frames saved · 0 bytes sent by this app · 1 plate made${p.verso.source !== 'live' ? ` · ${p.verso.source.toUpperCase()} DATA` : ''}`;
  const t0 = performance.now();
  let lastTravel = 1, lastDraw = -Infinity;
  resultBeats = 0;
  cancelAnimationFrame(resultRaf);
  updateSoundButton();
  const loop = (now: number) => {
    if (!$('result').classList.contains('active')) return;
    resultRaf = requestAnimationFrame(loop);
    if (now - lastDraw < 1000 / RESULT_FPS - 2) return;
    lastDraw = now;
    const t = (now - t0) / 1000;
    const f = plateFrameAt(p, t, { gentle: opts.gentle, ghosts: opts.ghosts });
    front.render(f);
    // The finished plate beats a few times, quietly, then fades to silence
    // (travel restarts at each beat). The plate itself keeps beating visually.
    if (f.travel < lastTravel) {
      const fade = 1 - Math.max(0, resultBeats - RESULT_BEATS) / RESULT_FADE_BEATS;
      if (fade > 0 && heart.enabled) { heart.volume = RESULT_VOLUME * fade; heart.beat(0); }
      resultBeats++;
    }
    lastTravel = f.travel;
  };
  resultRaf = requestAnimationFrame(loop);
}

let resultBeats = 0;

function updateSoundButton(): void {
  $('btn-sound').textContent = heart.enabled ? 'Mute heartbeat' : 'Play heartbeat';
}

function pairWith(text: string): void {
  if (!plate) return;
  try { pair = parsePlate(text); } catch (err) { toast((err as Error).message); return; }
  $('flip').hidden = true;
  document.querySelector('.pair')?.remove();
  const wrap = document.createElement('div');
  wrap.className = 'pair';
  const a = document.createElement('canvas'), b = document.createElement('canvas');
  a.className = b.className = 'plate';
  wrap.append(a, b);
  $('flip').after(wrap);
  const ra = new PlateRenderer(a, 560), rb = new PlateRenderer(b, 560);
  const t0 = performance.now();
  let lastDraw = -Infinity;
  const loop = (now: number) => {
    if (!wrap.isConnected) { ra.dispose(); rb.dispose(); return; }
    if (now - lastDraw < 1000 / RESULT_FPS - 2) { requestAnimationFrame(loop); return; }
    lastDraw = now;
    const t = (now - t0) / 1000;
    ra.render(plateFrameAt(plate!, t, { gentle: opts.gentle, ghosts: opts.ghosts }));
    rb.render(plateFrameAt(pair!, t, { gentle: opts.gentle, ghosts: opts.ghosts }));
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
  $('endcard').textContent = `Double Exposure · ${plate.sitterLabel} and ${pair.sitterLabel} · each beating in their own rhythm`;
}

async function exportGif(): Promise<void> {
  if (!plate) return;
  const btn = $<HTMLButtonElement>('btn-gif');
  btn.disabled = true; btn.textContent = 'Developing GIF…';
  try {
    await save(`${slug()}.gif`, plateGif(plate, { gentle: true, ghosts: opts.ghosts }), 'GIF image', 'gif');
  } finally {
    btn.disabled = false; btn.textContent = 'Save GIF loop';
  }
}

async function exportPng(): Promise<void> {
  const pairEl = document.querySelector<HTMLDivElement>('.pair');
  if (pairEl) {
    const [a, b] = pairEl.querySelectorAll('canvas');
    const c = document.createElement('canvas');
    c.width = a.width * 2 + 40; c.height = a.height;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#0d0c0a'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(a, 0, 0); ctx.drawImage(b, a.width + 40, 0);
    return save('double-exposure.png', canvasPng(c), 'PNG image', 'png');
  }
  return save(`${slug()}.png`, canvasPng($('front')), 'PNG image', 'png');
}

async function save(name: string, data: Promise<Uint8Array | string>, label: string, ext: string): Promise<void> {
  try {
    const bytes = await data;
    if (bridge) {
      const path = await bridge.saveFile({ defaultName: name, data: bytes, filters: [{ name: label, extensions: [ext] }] });
      if (path) toast(`Saved to ${path}`);
    } else {
      const blob = new Blob([bytes as BlobPart]);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    }
  } catch (err) {
    toast(`Export failed: ${(err as Error).message}`);
  }
}

function slug(): string {
  return `long-exposure-${opts.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}`;
}

async function stopSource(): Promise<void> {
  const s = source;
  if (s instanceof LiveSource) lastRecording = s.takeRecording() ?? lastRecording;
  source = null;
  $('lens-dot').classList.remove('open');
  $('lens-text').textContent = 'Lens closed';
  const v = $<HTMLVideoElement>('mirror');
  v.srcObject = null; v.hidden = true;
  await s?.stop().catch(() => {});
}

/** Wipe everything: stop the camera, drop every value, reload the page. */
async function leaveStudio(): Promise<void> {
  cancelAnimationFrame(raf);
  cancelAnimationFrame(resultRaf);
  await stopSource();
  resetSitting();
  heart.dispose();
  location.reload();
}

void init();
