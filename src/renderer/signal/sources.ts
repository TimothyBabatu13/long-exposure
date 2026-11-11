// Signal sources. The studio does not care where signals come from; the
// sitter (and the verso) always see which kind it was.
//   live:      the SmartSpectra SDK on this machine's camera
//   replay:    a session recorded earlier with the live source
//   synthetic: generated data for UI development and the web demo, labelled
//              as such everywhere. Never presented as a measurement.
import type { SourceEvent, SourceKind, SignalPacket } from '../../shared/types';
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

export class LiveSource implements SignalSource {
  readonly kind = 'live' as const;
  preview: MediaStream | null = null;
  private cb: Listener = () => {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private sdk: any = null;
  private recording: { at: number; e: SourceEvent }[] | null = null;
  private t0 = 0;

  constructor(private apiKey: string, private telemetry: boolean, record = false) {
    if (record) this.recording = [];
  }

  on(cb: Listener): void { this.cb = cb; }

  private emit(e: SourceEvent): void {
    if (this.recording) this.recording.push({ at: now() - this.t0, e });
    this.cb(e);
  }

  async start(): Promise<void> {
    const r = await import('@smartspectra/node-sdk/renderer');
    const { decodeMetrics } = await import('@smartspectra/node-sdk/messages');
    this.t0 = now();
    this.sdk = new r.SmartSpectraSDK({
      apiKey: this.apiKey,
      requestedMetrics: [...r.cardioMetrics, ...r.breathingMetrics, ...r.faceMetrics],
      enableTelemetry: this.telemetry,
    });
    this.sdk.on('streamAvailable', (stream: MediaStream) => { this.preview = stream; });
    this.sdk.on('metrics', (buf: Uint8Array) => {
      const packet = metricsToPacket(decodeMetrics(buf), now());
      this.emit({ type: 'packet', packet });
    });
    this.sdk.on('validationStatus', (code: number, _ts: number, hint: string) =>
      this.emit({ type: 'readiness', readiness: readinessFromCode(code), hint }));
    this.sdk.on('processingStatus', (status: number) =>
      this.emit({ type: 'running', running: status === r.ProcessingStatus.kRunning }));
    this.sdk.on('error', (code: number, message: string, retryable: boolean) =>
      this.emit({ type: 'error', message: `${message} (code ${code})`, fatal: !retryable }));
    await this.sdk.start();
  }

  async stop(): Promise<void> {
    if (!this.sdk) return;
    try { await this.sdk.stop(); } finally { this.sdk.destroy(); this.sdk = null; this.preview = null; }
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
