// Signal sources. The studio does not care where signals come from; the
// sitter (and the verso) always see which kind it was.
//   live:      the SmartSpectra SDK on this machine's camera
//   replay:    a session recorded earlier with the live source
//   synthetic: generated data for UI development and the web demo, labelled
//              as such everywhere. Never presented as a measurement.
import type { SourceEvent, SourceKind, SignalPacket, StudioBridge } from '../../shared/types';
import { metricsToPacket, readinessFromCode } from './metrics';
import { syntheticPacket } from './synthetic';

export type Listener = (e: SourceEvent) => void;

export interface SignalSource {
  readonly kind: SourceKind;
  start(): Promise<void>;
  stop(): Promise<void>;
  on(cb: Listener): void;
  /** Live camera preview, when the sitter turns the mirror on. */
  preview: MediaStream | null;
}

const now = () => Date.now() / 1000;

/** Mirror preview size (the SDK reads the camera itself, natively). */
export const PREVIEW = { width: 320, height: 240 } as const;

/** SmartSpectraErrorCode values after which the SDK session is over. */
const SESSION_ENDING_ERRORS = new Set([2, 3, 4, 5, 6, 7, 8, 13, 14]);

export function friendlyError(code: number, message: string): string {
  switch (code) {
    case 2: return 'The SmartSpectra API key was rejected. Check SMARTSPECTRA_API_KEY in .env. (code 2)';
    case 4: return 'Your SmartSpectra credits are used up. (code 4)';
    case 5: return 'Could not reach Presage to check the key or load the models. Check your internet connection. (code 5)';
    case 7: return 'The camera is unavailable. Close other apps using it and try again. (code 7)';
    case 13: return 'This API key is not allowed one of the requested metrics. (code 13)';
    case 14: return 'The camera frame rate stayed too low. Close heavy apps, add light (webcams slow down in the dark) and sit again. (code 14)';
    default: return `${message} (code ${code})`;
  }
}

export class LiveSource implements SignalSource {
  readonly kind = 'live' as const;
  preview: MediaStream | null = null;
  private cb: Listener = () => {};
  private recording: { at: number; e: SourceEvent }[] | null = null;
  private unsubscribe: (() => void)[] = [];
  private diag = 0;
  private t0 = 0;

  /**
   * The SDK runs in the main process on the native camera (src/main/sdk.ts):
   * the renderer path copied every frame across processes and starved slower
   * laptops into kSustainedLowFrameRate (14). This class only decodes results.
   * `wantPreview` opens a separate small preview stream for the mirror; if the
   * camera cannot be shared, the mirror stays off and the sitting continues.
   */
  constructor(private bridge: StudioBridge, private wantPreview: boolean, record = false) {
    if (record) this.recording = [];
  }

  on(cb: Listener): void { this.cb = cb; }

  private emit(e: SourceEvent): void {
    if (this.recording) this.recording.push({ at: now() - this.t0, e });
    this.cb(e);
  }

  async start(): Promise<void> {
    const { decodeMetrics } = await import('@smartspectra/node-sdk/messages');
    this.t0 = now();
    const sdk = this.bridge.sdk;
    let packets = 0, lastCode = -1, sawHrv = false;
    this.unsubscribe = [
      sdk.onMetrics((buf) => {
        packets++;
        const packet = metricsToPacket(decodeMetrics(buf), now());
        if (packet.hrv && !sawHrv) { sawHrv = true; console.log('[studio] HRV received'); }
        this.emit({ type: 'packet', packet });
      }),
      sdk.onValidation((code, hint) => {
        if (code !== lastCode) { lastCode = code; console.log(`[studio] readiness code ${code}${hint ? `: ${hint}` : ''}`); }
        this.emit({ type: 'readiness', readiness: readinessFromCode(code), hint });
      }),
      sdk.onRunning((running) => {
        console.log(`[studio] SDK running: ${running}`);
        this.emit({ type: 'running', running });
      }),
      // An error that ends the SDK session must end the sitting too.
      sdk.onError((code, message) =>
        this.emit({ type: 'error', message: friendlyError(code, message), fatal: SESSION_ENDING_ERRORS.has(code) })),
    ];
    this.diag = window.setInterval(() => {
      console.log(`[studio] SDK result packets: ${(packets / 5).toFixed(1)}/s`);
      packets = 0;
    }, 5000);
    try {
      await sdk.start();
    } catch (err) {
      await this.stop();
      throw err;
    }
    if (this.wantPreview) void this.openPreview();
  }

  private async openPreview(): Promise<void> {
    try {
      this.preview = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: PREVIEW.width }, height: { ideal: PREVIEW.height } },
      });
      console.log('[studio] mirror preview on');
    } catch (err) {
      console.log(`[studio] mirror preview unavailable (camera not shareable): ${(err as Error).name}`);
      this.preview = null;
    }
  }

  async stop(): Promise<void> {
    window.clearInterval(this.diag);
    this.unsubscribe.forEach((u) => u());
    this.unsubscribe = [];
    this.preview?.getTracks().forEach((t) => t.stop());
    this.preview = null;
    try { await this.bridge.sdk.stop(); } catch { /* already stopped */ }
  }

  /** NDJSON of everything received, for building replays. Memory only until saved. */
  takeRecording(): string | null {
    if (!this.recording) return null;
    const out = this.recording.map((r) => JSON.stringify(r)).join('\n');
    this.recording = [];
    return out;
  }
}

/** Replays a recording made by LiveSource, rebased onto the current clock. */
export class ReplaySource implements SignalSource {
  readonly kind = 'replay' as const;
  preview = null;
  private cb: Listener = () => {};
  private timers: number[] = [];
  private events: { at: number; e: SourceEvent }[];

  constructor(ndjson: string) {
    this.events = ndjson.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }

  on(cb: Listener): void { this.cb = cb; }

  async start(): Promise<void> {
    const startWall = now();
    const firstPacket = this.events.find((x) => x.e.type === 'packet');
    // Shift every signal timestamp so the recording appears to happen now.
    const recStart = firstPacket && firstPacket.e.type === 'packet' ? firstPacket.e.packet.arrival - firstPacket.at : 0;
    const shift = startWall - recStart;
    for (const { at, e } of this.events) {
      this.timers.push(window.setTimeout(() => {
        this.cb(e.type === 'packet' ? { type: 'packet', packet: shiftPacket(e.packet, shift) } : e);
      }, at * 1000));
    }
  }

  async stop(): Promise<void> {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }
}

function shiftPacket(p: SignalPacket, d: number): SignalPacket {
  const s = <T extends { t: number }>(x: T): T => ({ ...x, t: x.t + d });
  return {
    arrival: p.arrival + d,
    pulseTrace: p.pulseTrace?.map(s),
    pulseRate: p.pulseRate && s(p.pulseRate),
    breathTrace: p.breathTrace?.map(s),
    breathRate: p.breathRate && s(p.breathRate),
    hrv: p.hrv && s(p.hrv),
    blinking: p.blinking?.map(s),
    talking: p.talking?.map(s),
    landmarks: p.landmarks && s(p.landmarks),
    smile: p.smile && s(p.smile),
  };
}

/** Generated signals. Used only when there is no API key, or in the web demo. */
export class SyntheticSource implements SignalSource {
  readonly kind = 'synthetic' as const;
  preview = null;
  private cb: Listener = () => {};
  private timer = 0;
  private t0 = 0;
  private lastSent = 0;

  on(cb: Listener): void { this.cb = cb; }

  async start(): Promise<void> {
    this.t0 = now();
    this.lastSent = this.t0;
    this.cb({ type: 'running', running: true });
    this.cb({ type: 'readiness', readiness: 'ok', hint: 'synthetic' });
    // Chunked roughly like the SDK delivers: a packet every ~250 ms.
    this.timer = window.setInterval(() => {
      const t = now();
      this.cb({ type: 'packet', packet: syntheticPacket(this.t0, this.lastSent, t) });
      this.lastSent = t;
    }, 250);
  }

  async stop(): Promise<void> {
    clearInterval(this.timer);
    this.cb({ type: 'running', running: false });
  }
}
