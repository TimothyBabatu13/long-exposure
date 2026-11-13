// Normalised signal model. Everything the studio reacts to is expressed in
// these types, whether it comes from the live SDK, a recorded session, or the
// clearly-labelled synthetic demo. Times are seconds on the signal timeline.

export interface Sample {
  /** Seconds on the signal clock. */
  t: number;
  v: number;
}

/** Readiness reported by the SDK's validationStatus event, simplified. */
export type Readiness =
  | 'ok'
  | 'no-face'
  | 'multiple-faces'
  | 'motion'
  | 'too-dark'
  | 'too-bright'
  | 'framing'
  | 'tuning'
  | 'low-fps';

export interface Point {
  x: number;
  y: number;
}

export interface SignalPacket {
  /** Wall-clock arrival time of the packet, seconds (performance timeline). */
  arrival: number;
  pulseTrace?: Sample[];
  /** Beats per minute, with SDK confidence 0-100. */
  pulseRate?: { bpm: number; confidence: number; stable: boolean; t: number };
  breathTrace?: Sample[];
  breathRate?: { rpm: number; confidence: number; stable: boolean; t: number };
  hrv?: { rmssd: number; sdnn: number; meanNn: number; confidence: number; stable: boolean; t: number };
  blinking?: { detected: boolean; t: number }[];
  talking?: { detected: boolean; t: number }[];
  landmarks?: { points: Point[]; stable: boolean; t: number };
  /** Probability 0-100 of a happy expression, the only expression we use. */
  smile?: { confidence: number; t: number };
}

export type SourceKind = 'live' | 'replay' | 'synthetic';

/** How the top of the head is drawn: a neutral soft shade, dark hair, or a bare (bald or close-cropped) head lit like skin. */
export type HeadStyle = 'soft' | 'dark' | 'bare';

export type SourceEvent =
  | { type: 'packet'; packet: SignalPacket }
  | { type: 'readiness'; readiness: Readiness; hint: string }
  | { type: 'running'; running: boolean }
  | { type: 'error'; message: string; fatal: boolean };

/** How the beat timing on a plate was obtained; printed on the verso. */
export type BeatTier = 'waveform' | 'predicted' | 'rate';

export interface LedgerEntry {
  /** Exposure clock, seconds. */
  at: number;
  kind: 'stage' | 'blink' | 'talk' | 'motion' | 'face' | 'smile' | 'signal' | 'privacy';
  text: string;
}

/**
 * Everything needed to redraw a finished plate. It holds no camera frames,
 * but it IS derived from biometrics (face geometry plus heart and breath
 * rhythm), so it is only ever written to disk when the sitter exports it.
 */
export interface Plate {
  format: 'long-exposure/plate@1';
  createdAt: string;
  sitterLabel: string;
  /** Face geometry normalised to a unit box, averaged over the sitting. */
  face: Point[];
  /** Beat times relative to loop start, seconds. One breath cycle or more. */
  beats: number[];
  beatTier: BeatTier;
  breathPeriod: number;
  /**
   * The sitter's own chest trace over one loop (breathPeriod seconds), 0..1,
   * evenly spaced and joined end to start. Plates from before 2026-11-13 lack
   * it and breathe on a cosine.
   */
  breathCurve?: number[];
  blinkTimes: number[];
  /** Eye contours captured at blinks, drawn as double-exposure ghosts. */
  ghosts: Point[][];
  /** Lip contour captured if a smile was held for 3 s or more. */
  smile: Point[] | null;
  /** Null when the plate is underexposed: the seal marks a settled rhythm. */
  seal: SealParams | null;
  /** Head style chosen by the sitter (plates from before 2026-11-13 lack it: 'dark'). */
  head?: HeadStyle;
  /** Readouts for the verso only. Never drawn on the front. */
  verso: {
    pulseBpm: number | null;
    breathRpm: number | null;
    rmssd: number | null;
    sdnn: number | null;
    pulseConfidence: number | null;
    traceExcerpt: number[];
    ledger: LedgerEntry[];
    source: SourceKind;
    underexposed: boolean;
    /** Which signal never settled (plates from before 2026-11-12 lack it). */
    underexposedReason?: string | null;
  };
}

export interface SealParams {
  /** Petal count of the rosette. */
  lobes: number;
  /** Inner/outer radius ratio. */
  ratio: number;
  /** Wobble amplitude. */
  wobble: number;
  /** Number of engraved rings. */
  rings: number;
  /** Rotation offset, radians. */
  twist: number;
}

/** What the preload exposes on window.studio. */
export interface StudioBridge {
  config(): Promise<{ hasApiKey: boolean; telemetry: boolean; record: boolean; version: string }>;
  saveFile(opts: { defaultName: string; data: Uint8Array | string; filters: { name: string; extensions: string[] }[] }): Promise<string | null>;
  openPlate(): Promise<string | null>;
  onNetwork(cb: (entry: { url: string; bytes: number; blocked: boolean }) => void): void;
  /** The SmartSpectra session in the main process (native camera). Each on* returns an unsubscribe. */
  sdk: {
    start(): Promise<void>;
    stop(): Promise<void>;
    onMetrics(cb: (buf: Uint8Array) => void): () => void;
    onValidation(cb: (code: number, hint: string) => void): () => void;
    onRunning(cb: (running: boolean) => void): () => void;
    onError(cb: (code: number, message: string) => void): () => void;
  };
}
