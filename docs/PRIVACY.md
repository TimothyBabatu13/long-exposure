# Consent and data handling

Long Exposure reads a person's body through a camera. This page says exactly what that means, what is kept, and what leaves the device. It is also the "Consent and Data Handling" section of the DEV submission.

## Consent

- **Nothing happens until the sitter agrees.** The camera is opened only after the sitter reads the sitting agreement and presses **I agree to sit** (or Enter). There is no auto-start, and the app never runs in the background.
- **Consent is tied to the person in frame.** The plate needs a still, silent, face-on sitter for about a minute. That makes it hard to make one of someone who is not deliberately taking part, though not impossible (a still, quiet person, such as someone absorbed in a video, could be captured once someone else agrees on their behalf), which is why the agreement is addressed to the person in frame.
- **One person only.** If the SDK reports a second face, the lens caps at once (the clock stops). If the second face is seen for about 2 seconds in total, the sitting stops and everything collected so far is discarded. (The face detector flickers, so a single stray frame does not end a sitting, but a face that keeps flickering in still adds up.)
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

### Audit (2026-11-14, Windows 11, telemetry off)

Method: during a live session (the SDK running on the camera for about five minutes, then the app left open), every TCP connection owned by the app's processes was sampled twice a second with `Get-NetTCPConnection`. Remote addresses were matched to hostnames with DNS. Only addresses, ports and timing were recorded, never content (the traffic is TLS-encrypted).

| Time into the session | Process | Host | Port | What it is |
|---|---|---|---|---|
| 23-30 s | main (SDK) | `cont-api.physiology.presagetech.com` (AWS Global Accelerator: 15.197.69.23, 76.223.65.59) | 443 (HTTPS) | SDK start-up: API key check and the model download |
| 252 s | main (SDK) | `cont-api.physiology.presagetech.com` | 443 (HTTPS) | The SDK's periodic usage check |

Findings:

- **Every outside connection went to one Presage host**, from the main process, where the SDK runs. No other host was contacted.
- **The page made no network requests.** The Studio Ledger's count stayed at 0, and the main process blocks any it would make.
- **Telemetry was off**, so no telemetry traffic is expected or was seen.
- **Limits of this audit.** It records which hosts were contacted, not how many bytes or what was sent: the content is encrypted and belongs to the SDK. A connection shorter than the half-second sampling interval could be missed. The telemetry-on case was not tested.

To repeat it: on Windows, Resource Monitor's Network tab filtered to `electron.exe` / `Long Exposure.exe` shows the same hosts and also byte counts; on macOS, `nettop -p <pid>` or Little Snitch.

## Not a medical device

Long Exposure is portraiture. It does not diagnose, monitor or treat anything, and it does not interpret readings as health information. The numbers on the verso are shown only as evidence that the portrait responded to a real, live signal.
