// Map a decoded SmartSpectra `Metrics` protobuf onto our SignalPacket.
// Field names follow @smartspectra/node-sdk 3.5.0 (messages/generated.d.ts).
import type { Point, SignalPacket, Sample, Readiness } from '../../shared/types';

type Long = { toNumber(): number };
type Num = number | Long | null | undefined;

/** µs-since-epoch (number or protobuf Long) to seconds. */
export function toSeconds(ts: Num): number {
  if (ts == null) return NaN;
  const n = typeof ts === 'number' ? ts : typeof (ts as Long).toNumber === 'function' ? (ts as Long).toNumber() : Number(ts);
  return n / 1e6;
}

interface M { value?: number | null; stable?: boolean | null; confidence?: number | null; timestamp?: Num }
interface D { detected?: boolean | null; stable?: boolean | null; timestamp?: Num }

function samples(list: M[] | null | undefined): Sample[] | undefined {
  if (!list || list.length === 0) return undefined;
  const out: Sample[] = [];
  for (const m of list) {
    const t = toSeconds(m.timestamp);
    if (Number.isFinite(t) && typeof m.value === 'number') out.push({ t, v: m.value });
  }
  return out.length ? out : undefined;
}

function last<T>(list: T[] | null | undefined): T | undefined {
  return list && list.length ? list[list.length - 1] : undefined;
}

function detections(list: D[] | null | undefined) {
  if (!list || list.length === 0) return undefined;
  return list.map((d) => ({ detected: !!d.detected, t: toSeconds(d.timestamp) }));
}

/** ExpressionType.HAPPY in the SDK enum. */
const HAPPY = 5;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function metricsToPacket(m: any, arrival: number): SignalPacket {
  const p: SignalPacket = { arrival };
  const cardio = m?.cardio;
  const breathing = m?.breathing;
  const face = m?.face;

  p.pulseTrace = samples(cardio?.arterialPressureTrace);
  const pr = last<M>(cardio?.pulseRate);
  if (pr && typeof pr.value === 'number') {
    p.pulseRate = { bpm: pr.value, confidence: pr.confidence ?? 0, stable: !!pr.stable, t: toSeconds(pr.timestamp) };
  }
  const hrv = last<M & { rmssd?: number; sdnn?: number; meanNn?: number }>(cardio?.hrv);
  if (hrv && typeof hrv.rmssd === 'number') {
    p.hrv = {
      rmssd: hrv.rmssd, sdnn: hrv.sdnn ?? 0, meanNn: hrv.meanNn ?? 0,
      confidence: hrv.confidence ?? 0, stable: !!hrv.stable, t: toSeconds(hrv.timestamp),
    };
  }

  p.breathTrace = samples(breathing?.upperTrace);
  const br = last<M>(breathing?.rate);
  if (br && typeof br.value === 'number') {
    p.breathRate = { rpm: br.value, confidence: br.confidence ?? 0, stable: !!br.stable, t: toSeconds(br.timestamp) };
  }

  p.blinking = detections(face?.blinking);
  p.talking = detections(face?.talking);
  const lm = last<{ value?: { x?: number; y?: number }[]; stable?: boolean; timestamp?: Num }>(face?.landmarks);
  if (lm?.value && lm.value.length) {
    const points: Point[] = lm.value.map((q) => ({ x: q.x ?? 0, y: q.y ?? 0 }));
    p.landmarks = { points, stable: !!lm.stable, t: toSeconds(lm.timestamp) };
  }
  const ex = last<{ scores?: { type?: number; confidence?: number }[]; timestamp?: Num }>(face?.expression);
  if (ex?.scores) {
    const happy = ex.scores.find((s) => s.type === HAPPY);
    if (happy) p.smile = { confidence: happy.confidence ?? 0, t: toSeconds(ex.timestamp) };
  }
  return p;
}

/** ValidationCode values from the SDK, mapped to the studio's vocabulary. */
export function readinessFromCode(code: number): Readiness {
  switch (code) {
    case 0: return 'ok';
    case 1: return 'no-face';
    case 2: return 'multiple-faces';
    case 5: return 'too-dark';
    case 6: return 'too-bright';
    case 10: return 'tuning';
    case 11: return 'low-fps';
    case 12: return 'motion';
    case 7: return 'chest';
    case 3: case 15: case 16: case 17: return 'position';
    default: return 'framing'; // face size out of range, too close or too far: these affect the pulse
  }
}
