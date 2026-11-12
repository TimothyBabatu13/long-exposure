// The sitting: stages are tied to the SDK's own warm-up times, and the
// exposure clock only runs while the sitter is still, silent and alone in
// frame with the window focused.
//
//   focusing  0-12 s   ghost portrait from landmarks
//   heart     12-30 s  pulse locked: the face flushes with each beat
//   breath    30-60 s  breathing locked: the bust breathes
//   fixing    60 s+    rhythm settled (pulse still locked, or HRV): the seal is engraved
//
// HRV is a bonus, not a gate: in the first live sittings the SDK sent no HRV in
// 230 s, so a plate that waited for it could never be fixed.
import type { LedgerEntry, Readiness } from '../../shared/types';

export type Stage = 'focusing' | 'heart' | 'breath' | 'fixing' | 'developed' | 'abandoned';
export type PauseReason = 'talking' | 'motion' | 'no-face' | 'lighting' | 'framing' | 'crowd' | 'away' | 'starting';

export interface SittingInputs {
  readiness: Readiness;
  talking: boolean;
  windowFocused: boolean;
  running: boolean;
  pulseReady: boolean;
  breathReady: boolean;
  hrvReady: boolean;
}

export const STAGE_AT = { heart: 12, breath: 30, fixing: 60 } as const;
/** If HRV never stabilises, the plate develops as "underexposed" at this point. */
export const MAX_EXPOSURE_S = 120;
const FIX_DURATION_S = 3;
const UNDEREXPOSED_REASON = {
  focusing: 'the pulse never settled',
  heart: 'the breathing never settled',
  breath: 'the pulse was lost before the plate could be fixed',
} as const;
/** A second face must persist this long before the sitting is abandoned (single-frame detector flickers are ignored). */
export const SECOND_FACE_ABANDON_S = 2;
/** A flickering problem must last this long before the lens caps (seconds). */
export const CAP_DELAY_S = 0.5;
/** ...and be gone this long before it uncaps. */
export const UNCAP_DELAY_S = 0.3;
/** Pauses that cap at once: privacy (window left, second face) and start-up. */
const IMMEDIATE_PAUSES: ReadonlySet<PauseReason> = new Set(['away', 'crowd', 'starting']);

export class Sitting {
  stage: Stage = 'focusing';
  exposure = 0;
  pause: PauseReason | null = 'starting';
  underexposed = false;
  /** Which signal never settled, when the plate is underexposed. */
  underexposedReason: string | null = null;
  readonly ledger: LedgerEntry[] = [];
  private fixedAt: number | null = null;
  private secondFaceFor = 0;
  private pending: PauseReason | null = null;
  private pendingFor = 0;

  constructor(private onLedger: (e: LedgerEntry) => void = () => {}) {}

  log(kind: LedgerEntry['kind'], text: string): void {
    const e = { at: Math.round(this.exposure * 10) / 10, kind, text };
    this.ledger.push(e);
    this.onLedger(e);
  }

  private pauseFor(i: SittingInputs): PauseReason | null {
    if (!i.running) return 'starting';
    if (!i.windowFocused) return 'away';
    switch (i.readiness) {
      case 'no-face': return 'no-face';
      case 'motion': return 'motion';
      case 'too-dark': case 'too-bright': return 'lighting';
      case 'framing': return 'framing';
      case 'multiple-faces': return 'crowd';
      default: break;
    }
    if (i.talking) return 'talking';
    return null;
  }

  /** Advance by dt seconds. Returns the stage after the update. */
  tick(dt: number, i: SittingInputs): Stage {
    if (this.stage === 'developed' || this.stage === 'abandoned') return this.stage;

    // A second face ends the sitting: the plate is for one consenting person.
    // The detector flickers, so the lens caps at once but the sitting is only
    // abandoned if the second face stays for SECOND_FACE_ABANDON_S.
    this.secondFaceFor = i.readiness === 'multiple-faces' ? this.secondFaceFor + dt : 0;
    if (this.secondFaceFor >= SECOND_FACE_ABANDON_S) {
      this.stage = 'abandoned';
      this.log('face', 'second face in frame: sitting stopped, nothing kept');
      return this.stage;
    }

    // The SDK's readiness and talking flags flicker frame to frame. A problem
    // must last CAP_DELAY_S before the lens caps, and be gone for UNCAP_DELAY_S
    // before it uncaps, so brief flickers neither stop the clock nor fill the
    // ledger. Leaving the window, a second face and start-up cap at once.
    const raw = this.pauseFor(i);
    if (raw === this.pause) {
      this.pendingFor = 0;
    } else {
      if (raw === this.pending) this.pendingFor += dt;
      else { this.pending = raw; this.pendingFor = dt; }
      const need = raw == null ? UNCAP_DELAY_S : IMMEDIATE_PAUSES.has(raw) ? 0 : CAP_DELAY_S;
      if (this.pendingFor >= need) {
        if (raw && raw !== 'starting') this.log(raw === 'talking' ? 'talk' : raw === 'motion' ? 'motion' : 'face', pauseText[raw]);
        else if (!raw && this.pause && this.pause !== 'starting') this.log('stage', 'still again: lens uncapped');
        this.pause = raw;
        this.pendingFor = 0;
      }
    }
    if (this.pause) return this.stage;

    this.exposure += dt;
    const e = this.exposure;

    // Stages advance on time AND on the signal actually being ready. The
    // plate waits for the heart; it never pretends.
    if (this.stage === 'focusing' && e >= STAGE_AT.heart && i.pulseReady) this.enter('heart', 'pulse locked: exposing the heart');
    if (this.stage === 'heart' && e >= STAGE_AT.breath && i.breathReady) this.enter('breath', 'breathing locked: exposing the breath');
    if (this.stage === 'breath' && e >= STAGE_AT.fixing && (i.hrvReady || i.pulseReady)) {
      this.enter('fixing', i.hrvReady ? 'rhythm settled (with HRV): fixing the plate' : 'rhythm settled: fixing the plate');
    }

    if (this.stage !== 'fixing' && e >= MAX_EXPOSURE_S) {
      this.underexposed = true;
      // Name the signal that never settled, not a guess at the cause.
      this.underexposedReason = UNDEREXPOSED_REASON[this.stage as 'focusing' | 'heart' | 'breath'] ?? UNDEREXPOSED_REASON.breath;
      this.enter('fixing', `${this.underexposedReason}: the plate is underexposed`);
    }
    if (this.stage === 'fixing') {
      this.fixedAt ??= e;
      if (e - this.fixedAt >= FIX_DURATION_S) this.enter('developed', 'plate developed');
    }
    return this.stage;
  }

  private enter(s: Stage, text: string): void {
    this.stage = s;
    this.log('stage', text);
  }

  /** 0..1 progress through the full 60 s exposure, for the progress line. */
  get progress(): number {
    return Math.min(1, this.exposure / STAGE_AT.fixing);
  }
}

const pauseText: Record<Exclude<PauseReason, 'starting'>, string> = {
  talking: 'speech: lens capped',
  motion: 'movement: lens capped',
  'no-face': 'sitter lost: lens capped',
  lighting: 'light out of range: lens capped',
  framing: 'out of frame: lens capped',
  crowd: 'second face in frame: lens capped',
  away: 'studio window left: lens capped',
};

export const pauseCopy: Record<PauseReason, string> = {
  starting: 'Preparing the studio: loading the camera and the SDK models (slower on a slow connection)…',
  talking: 'Hold still… no talking, the plate is exposing.',
  motion: 'Hold still. The plate blurs when you move.',
  'no-face': 'The photographer cannot see you.',
  lighting: 'The light is wrong. Face a lamp or a window.',
  framing: 'Sit square to the camera, face centred.',
  crowd: 'Someone else is in frame. The plate is for one sitter.',
  away: 'The lens is capped while the studio is in the background.',
};
