// The sitting: stages are tied to the SDK's own warm-up times, and the
// exposure clock only runs while the sitter is still, silent and alone in
// frame with the window focused.
//
//   focusing  0-12 s   ghost portrait from landmarks
//   heart     12-30 s  pulse locked: the face flushes with each beat
//   breath    30-60 s  breathing locked: the bust breathes
//   fixing    60 s+    HRV available: the seal is engraved, plate developed
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
/** A second face must persist this long before the sitting is abandoned (single-frame detector flickers are ignored). */
export const SECOND_FACE_ABANDON_S = 2;

export class Sitting {
  stage: Stage = 'focusing';
  exposure = 0;
  pause: PauseReason | null = 'starting';
  underexposed = false;
  readonly ledger: LedgerEntry[] = [];
  private fixedAt: number | null = null;
  private secondFaceFor = 0;

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

    const p = this.pauseFor(i);
    if (p !== this.pause) {
      if (p && p !== 'starting') this.log(p === 'talking' ? 'talk' : p === 'motion' ? 'motion' : 'face', pauseText[p]);
      else if (!p && this.pause && this.pause !== 'starting') this.log('stage', 'still again: lens uncapped');
      this.pause = p;
    }
    if (p) return this.stage;

    this.exposure += dt;
    const e = this.exposure;

    // Stages advance on time AND on the signal actually being ready. The
    // plate waits for the heart; it never pretends.
    if (this.stage === 'focusing' && e >= STAGE_AT.heart && i.pulseReady) this.enter('heart', 'pulse locked: exposing the heart');
    if (this.stage === 'heart' && e >= STAGE_AT.breath && i.breathReady) this.enter('breath', 'breathing locked: exposing the breath');
    if (this.stage === 'breath' && e >= STAGE_AT.fixing && i.hrvReady) this.enter('fixing', 'rhythm settled: fixing the plate');

    if (this.stage !== 'fixing' && e >= MAX_EXPOSURE_S) {
      this.underexposed = true;
      this.enter('fixing', 'the light was poor; the plate is underexposed');
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
