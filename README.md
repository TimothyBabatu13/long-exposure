# Long Exposure

**A 60-second living daguerreotype.** You sit for a portrait, as people did in 1840. The plate develops while you hold still, and the finished portrait flushes with your real heartbeat and breathes at your real breathing rate. No photograph of you is taken or kept.

Built for the [DEV Presage SmartSpectra SDK Challenge](https://dev.to/challenges/presage-2026-11-04) with [`@smartspectra/node-sdk`](https://www.npmjs.com/package/@smartspectra/node-sdk).

> In 1840 a portrait took a minute. You had to hold still. Your heart couldn't.

---

## How a sitting works

The SDK needs time before each signal is reliable: about 12 s for pulse, 30 s for breathing and 60 s for HRV. Long Exposure does not hide that wait behind a spinner. The wait is the exposure.

| Exposure | Stage | What the SDK provides | What you see |
|---|---|---|---|
| 0–12 s | **Focusing** | 478 face landmarks, blinks | A ghost of your face emerges as engraving lines on a silver plate |
| 12–30 s | **Exposing the heart** | Pulse waveform and pulse rate | Each heartbeat sends a warm flush from forehead to chin, with a soft heartbeat sound |
| 30–60 s | **Exposing the breath** | Breathing rate and chest trace | The bust rises and falls with your breathing |
| 60 s+ | **Fixing** | HRV (RMSSD, SDNN) | A guilloché seal, unique to this sitting, is engraved in the corner |

The SDK works best on a still, silent, well-lit sitter, so the studio enforces exactly that:

- **Talking caps the lens.** Speech spoils the breathing signal, so the exposure clock stops while you speak.
- **Movement, leaving the frame, poor light or switching windows** also cap the lens.
- **A second face** ends the sitting and discards everything.
- **Blinks** leave faint doubled "ghost" eyes, like on real long-exposure plates. This can be turned off.
- **A smile held for 3 s** is exposed into the plate as a faint layer.
- A stage starts only when its signal is actually ready, never on a timer alone. If the signal never settles, the plate develops as **underexposed** and says so.

When the plate is developed the camera is released. You can then:

- **Turn the plate over.** The **verso** (back) shows the evidence: raw readouts, a stretch of your actual pulse waveform, which beat-timing method was used, and a timestamped log of everything that happened. The front never shows numbers.
- **Save a GIF loop** (one breath long, with your own beat timings), PNGs of the front and back, or a `.plate.json` file.
- **Double Exposure:** load someone else's saved plate and watch both portraits side by side, each beating in its own rhythm.

---

## Quick start

**Requirements**

- Node.js 20+ (24 LTS recommended)
- A webcam
- Windows x64, macOS on Apple Silicon, or Linux x64/arm64 (glibc 2.35+)
- A free SmartSpectra API key from [physiology.presagetech.com](https://physiology.presagetech.com/auth/register)

```bash
git clone <this repo> long-exposure
cd long-exposure
npm install            # also downloads the SDK native runtime for every platform (a few hundred MB)
cp .env.example .env   # then paste your key: SMARTSPECTRA_API_KEY=...
npm run dev            # starts the app with hot reload
```

**No API key?** The app still runs. It plays a **synthetic** sitting, labelled as such on screen, on the verso and in every export. Use it to try the studio, not as a measurement.

**For the best plate**

- Face a lamp or a window. Avoid flickering LED or fluorescent light.
- Put the laptop on a table. A handheld camera ruins the breathing signal.
- Sit square to the camera, and stay still and quiet for about a minute.

---

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Run the app with hot reload |
| `npm start` | Run the production build |
| `npm run build` | Build main, preload and renderer into `out/` |
| `npm run dist:win` / `npm run dist:mac` | Package an installer into `release/` |
| `npm test` | Unit tests: beat detection, tier selection, sitting stages |
| `npm run typecheck` | TypeScript check |
| `npm run spike` | **Day-1 SDK measurement** (needs a key and a camera, see below) |
| `npm run smoke` | Unattended synthetic sitting that saves a screenshot of each stage |
| `npm run build:web` | Static web build of the studio in synthetic and replay mode (`dist-web/`) |

### `npm run spike`: measure the SDK before trusting it

```bash
npm run spike                                         # 90 s on the default camera
npm run spike -- --seconds 60 --out recordings/spike.ndjson
```

The spike runs headless with telemetry off and reports:

- packet rate, trace samples per packet and trace sample rate
- **pulse-waveform delivery lag** (p50/p90), which decides the beat tier (below)
- landmark update rate and point count (it should be 478)
- when pulse, breathing and HRV first become stable
- the readiness codes the SDK reported

With `--out` it writes the decoded metrics as NDJSON, with no frames.

### Replays

Set `SMARTSPECTRA_RECORD=1` in `.env` and the result screen gains a **Save session recording** button. It saves every received signal (no frames) as `.ndjson`. **Play a recorded sitting** on the welcome screen plays it back, labelled **REPLAY**. This lets judges without a key, or the web build, see a real sitting.

---

## How it works

```
 Electron main process                         Renderer (sandboxed, context-isolated)
 ┌───────────────────────────────┐             ┌───────────────────────────────────────────┐
 │ bindSmartSpectraIpc(window)   │◄─frames──── │ SmartSpectraSDK (renderer) ◄─ camera      │
 │  └ SmartSpectra native SDK    │──metrics──► │  └ metricsToPacket()  → SignalPacket      │
 │ permission handler: camera    │             │ BeatTracker  (waveform → beats)           │
 │   only, own page only         │             │ BreathTracker (chest trace / rate)        │
 │ webRequest: block + log all   │──ledger───► │ Sitting      (stages, lens cap, ledger)   │
 │   non-local requests          │             │ PlateRenderer (Canvas2D ink + WebGL plate)│
 │ save dialog (the only writes) │◄─export──── │ Heartbeat (Web Audio), GIF/PNG export     │
 └───────────────────────────────┘             └───────────────────────────────────────────┘
```

- **Stack:**
  - Electron 45 with electron-vite and TypeScript.
  - Raw WebGL2 with one fragment shader; there is no UI framework and no 3D engine, which keeps memory low.
  - Web Audio for the heartbeat sound, gifenc for GIF export, Vitest for tests.
- **SDK integration:**
  - The renderer-side `@smartspectra/node-sdk/renderer` captures the camera.
  - `bindSmartSpectraIpc` runs the native pipeline in the main process.
  - It requests the cardio, breathing and face metric groups.
  - Decoding uses `@smartspectra/node-sdk/messages`. See [`src/renderer/signal/metrics.ts`](src/renderer/signal/metrics.ts).

### Beat timing tiers

The pulse waveform (`cardio.arterialPressureTrace`) arrives in chunks, after a delay. [`BeatTracker`](src/renderer/signal/beats.ts) band-limits it and finds peaks with a refractory window. It cross-checks the peaks against the SDK's own pulse rate, then picks a tier:

| Tier | When | How beats are drawn |
|---|---|---|
| `waveform` | Peaks are consistent and arrive less than 0.3 s late | At the detected peak phase |
| `predicted` | Peaks are real but arrive late | Extended forward from the last real peak at the measured period |
| `rate` | No clean peaks | Evenly spaced from the averaged pulse rate |

The verso always prints which tier was used. The exported loop replays the sitter's actual beat-to-beat intervals from the end of the sitting.

### The portrait

[`PlateRenderer`](src/renderer/render/plate.ts) draws two layers with Canvas 2D:

- **Ink:** engraved contours of the face, eyes, brows, lips and nose, plus a stipple of all 478 points and the blink ghosts.
- **Mask:** a soft fill of the face and features.

One fragment shader combines them into:

- a silver plate with tarnish, an iridescent edge, grain and vignette;
- engraving hatch lines that bend around the face;
- the travelling flush on each beat;
- grain-first development;
- the lens cap.

The contours assume the standard 478-point face-mesh topology (468 points plus 10 iris points). [`topologyLooksRight()`](src/renderer/render/landmarks.ts) checks this at runtime and falls back to a topology-free stipple portrait if it doesn't match.

---

## Consent and data handling

The full statement is in **[docs/PRIVACY.md](docs/PRIVACY.md)**. In short:

- **Consent:**
  - The camera opens only after the sitter agrees.
  - The plate needs a still, silent, face-on person, so covert capture does not work.
  - A second face stops the sitting.
  - The lens caps when you talk, move or switch windows.
  - **Leave the studio** wipes everything.
- **No frames are stored, drawn or exported.** The portrait is made from face geometry and rhythm only.
- **Memory only:** nothing is written to disk except files the sitter saves through a save dialog.
- **The app sends nothing:**
  - A strict CSP is in place, and the main process blocks and logs any request from the page.
  - The Studio Ledger shows the count.
- **Presage telemetry is off by default** (`enableTelemetry: false`); opt in with `SMARTSPECTRA_TELEMETRY=1`.
- **The SDK itself contacts Presage** to check the API key and meter usage. The audit table in PRIVACY.md records what it sends.
- **No AI service.** The stress index and the negative-emotion scores are deliberately unused.
- **Not a medical device.** This is portraiture, with no health claims.

---

## Project layout

```
src/
  main/index.ts           Electron main: window, permissions, network ledger, save dialogs
  preload/index.ts        SDK bridge plus window.studio (bundled to CJS for the sandbox)
  shared/types.ts         Signal, plate and bridge types
  renderer/
    main.ts               Studio controller
    signal/               metrics.ts (SDK → packet), beats.ts, breath.ts, sources.ts, synthetic.ts
    sitting/machine.ts    Stages, lens cap, ledger
    render/               plate.ts (WebGL), landmarks.ts, seal.ts, loop.ts, verso.ts
    ui/                   audio.ts, export.ts
scripts/spike.mjs         Day-1 SDK measurement
scripts/smoke.mjs         Unattended synthetic run with screenshots
test/                     Vitest unit tests
docs/                     PRIVACY.md, DEMO.md
```

## Status

The app is working in synthetic mode: all stages, the lens cap, blink ghosts, the seal, the verso, and GIF, PNG and plate export. Unit tests pass.

**Not yet verified against the live SDK on a real camera.** Run `npm run spike` first, then update this section with what it reports:

- [ ] Waveform lag and the resulting beat tier
- [ ] The landmark topology matches the 478-point face mesh
- [ ] Network audit of SDK traffic (docs/PRIVACY.md)
- [ ] Tested in poor light, with glasses, and across skin tones (camera pulse readings are weaker on darker skin and in low light)

## Credits and licence

- Long Exposure source code: MIT.
- The SmartSpectra SDK is © Presage Technologies and ships under its own licence (see `node_modules/@smartspectra/node-sdk/LICENSE`).
- Face-mesh contour index lists follow the published MediaPipe Face Mesh topology (Apache-2.0).
