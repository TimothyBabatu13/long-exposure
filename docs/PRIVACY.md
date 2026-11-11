# Consent and data handling

Long Exposure reads a person's body through a camera. This page says exactly what that means, what is kept, and what leaves the device. It is also the "Consent and Data Handling" section of the DEV submission.

## Consent

- **Nothing happens until the sitter agrees.** The camera is opened only after the sitter reads the sitting agreement and presses **I agree to sit** (or Enter). There is no auto-start, and the app never runs in the background.
- **Consent is tied to the person in frame.** The plate needs a still, silent, face-on sitter for about a minute. You cannot make one of someone who is not deliberately taking part.
- **One person only.** If the SDK reports a second face, the sitting stops immediately and everything collected so far is discarded.
- **The lens caps itself** whenever the sitter speaks, moves, leaves the frame, or switches away from the window (blur, minimise or hidden). The exposure clock stops, and the cap is logged in the Studio Ledger.
- **A visible indicator** shows when the camera is on. The OS camera light is controlled by the OS and cannot be suppressed by the app.
- **Leave the studio** is always one click away. It stops the camera, drops every value from memory and reloads the app.
- **For a minor,** a parent or guardian should sit with them and agree for them. The sitter, or their guardian, consents for themselves. Nobody consents on behalf of another adult.

## What is read

The SmartSpectra SDK (`@smartspectra/node-sdk` 3.5.0) is asked for its cardio, breathing and face metric groups:

| Signal | Used for |
|---|---|
| Pulse waveform (`cardio.arterialPressureTrace`) | beat timing for the skin flush and the heartbeat sound |
| Pulse rate | the "heart" stage, beat-timing cross-check, the seal |
| Breathing rate and chest trace | the bust breathing, the "breath" stage, the seal |
| HRV (RMSSD, SDNN) | fixing the plate, the seal |
| Face landmarks | the portrait itself, drawn as engraving lines |
| Blinking | ghost eyes (can be turned off) |
| Talking | capping the lens |
| Expressions (only "happy") | the optional "smile that broke through" layer |

**Deliberately not used:** the Baevsky stress index, the other expression scores (angry, sad, fear and so on), and the SDK's LLM "insights" feature. The app makes no judgement about how anyone feels or how healthy they are.

## What is kept

| Data | Where | For how long |
|---|---|---|
| Camera frames | The SDK processes them; Long Exposure never stores, draws or exports them | Not kept |
| Decoded signals | Renderer memory | Until the plate is developed, **Sit again**, or **Leave the studio** |
| The finished plate (averaged face geometry, beat timings, readouts) | Renderer memory | Until **Sit again** or **Leave the studio** |
| Exports (GIF, PNG, verso PNG, `.plate.json`) | Only where the sitter chooses, through a save dialog | The sitter's file, kept as long as they keep it |

A plate holds no photograph, but it **is** derived from biometrics: face geometry and heart and breath rhythm. The export dialogs and the plate file itself say so. Share a plate as you would a photo.

There is no account, no cloud storage, no analytics, and no crash reporting.

## What leaves the device

- **The app itself sends nothing.** The page runs with a strict Content Security Policy. The main process also blocks and logs every network request from the page that is not the app's own files. The Studio Ledger shows the count, and it is 0 in normal use.
- **The SDK contacts Presage.** It authenticates the API key and meters usage; the SDK has error codes for credit exhaustion and network failure. This happens in the SDK's native library, below the layer the app can intercept.
- **Presage telemetry is OFF by default** (`enableTelemetry: false`). A sitter can opt in with `SMARTSPECTRA_TELEMETRY=1`. According to Presage, telemetry contains session summaries and device-readiness reports, and never raw frames or measured vitals. See [Presage's telemetry and privacy notes](https://smartspectra.presagetech.com/docs/telemetry-and-privacy).
- **No AI service** is used by the app.

### Audit it yourself

The "0 bytes sent by this app" claim covers the app. To see what the SDK sends:

1. **Windows:** open Resource Monitor, go to the Network tab, and filter for `Long Exposure.exe` / `electron.exe` during a sitting.
   **macOS:** run `nettop -p <pid>`, or use Little Snitch.
2. Note the destination hosts and the byte counts with telemetry off, then again with it on.
3. Record the result in the table below before publishing the submission.

| Date | Telemetry | Hosts contacted | Approx. bytes out per 60 s sitting |
|---|---|---|---|
| _to fill in on day 1_ | off | | |
| _to fill in on day 1_ | on | | |

## Not a medical device

Long Exposure is portraiture. It does not diagnose, monitor or treat anything, and it does not interpret readings as health information. The numbers on the verso are shown only as evidence that the portrait responded to a real, live signal.
